"""本地发音评估侧车。

用法：
    python score.py --wav <16kHz 单声道 PCM16 WAV> --text "<参考句>"

输出（stdout，单行 JSON）：
    {"score": 87, "words": [{"word": "think", "score": 92}, ...],
     "durationSec": 2.4, "model": "wav2vec2-base-960h"}

原理：wav2vec2 字符级 CTC 模型对音频给出每帧字符后验，
用强制对齐把参考句的字母贴到音频上，取每个字母对齐位置的后验概率，
按词聚合得出单词发音分。纯本地、无网络。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import wave
from pathlib import Path

import cmudict
import numpy as np
import onnxruntime as ort

HERE = Path(__file__).resolve().parent
MODEL_PATH = HERE / "models" / "onnx_model_quantized.onnx"
TOKENIZER_PATH = HERE / "models" / "tokenizer.json"

SAMPLE_RATE = 16000
PAD_TOKEN = "<pad>"
WORD_SEPARATOR = "|"

#: CMU 发音词典；重音位置按其中的数字标记得出
PRON_DICT = cmudict.dict()


def load_vocab() -> dict[str, int]:
    """读 tokenizer.json 里的 token -> id 映射。"""
    data = json.loads(TOKENIZER_PATH.read_text(encoding="utf-8"))
    model = data.get("model", {})
    vocab = model.get("vocab")
    if isinstance(vocab, dict):
        return {str(k): int(v) for k, v in vocab.items()}
    if isinstance(vocab, list):
        return {str(token): index for index, token in enumerate(vocab)}
    raise RuntimeError("tokenizer.json 里没有找到 vocab")


def read_wav(path: str) -> np.ndarray:
    """读 16kHz 单声道 PCM WAV，返回 [-1,1] 的 float32 波形。"""
    with wave.open(path, "rb") as handle:
        if handle.getnchannels() != 1:
            raise RuntimeError(f"需要单声道音频，实际 {handle.getnchannels()} 声道")
        if handle.getframerate() != SAMPLE_RATE:
            raise RuntimeError(f"需要 {SAMPLE_RATE} Hz 采样率，实际 {handle.getframerate()}")
        if handle.getsampwidth() != 2:
            raise RuntimeError(f"需要 16bit PCM，实际 {handle.getsampwidth() * 8} bit")
        frames = handle.readframes(handle.getnframes())
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if samples.size == 0:
        raise RuntimeError("音频为空")
    return samples


def encode_text(text: str, vocab: dict[str, int]) -> tuple[list[int], list[int]]:
    """把参考句编码成 token 序列，并返回每个 token 所属的词序号。

    空格转成 `|`；不在词表里的字符（标点等）直接跳过。
    """
    tokens: list[int] = []
    word_of_token: list[int] = []
    word_index = 0
    previous_was_space = True
    for char in text.upper():
        if char.isalnum() or char == "'":
            token = char
        elif char == " ":
            if not previous_was_space and tokens:
                word_index += 1
            previous_was_space = True
            continue
        else:
            continue
        token_id = vocab.get(token)
        if token_id is None:
            continue
        tokens.append(token_id)
        word_of_token.append(word_index)
        previous_was_space = False
    return tokens, word_of_token


def ctc_align(probs: np.ndarray, tokens: list[int], blank: int) -> tuple[np.ndarray, np.ndarray]:
    """CTC 强制对齐，返回每个 token 的后验概率与帧区间。"""
    frames = probs.shape[0]
    if not tokens:
        raise RuntimeError("参考句没有可对齐的字母")
    # 扩展序列：blank, t1, blank, t2, ..., blank
    extended = [blank]
    for token in tokens:
        extended.append(token)
        extended.append(blank)
    states = len(extended)

    if frames < len(tokens):
        raise RuntimeError("音频太短，放不下参考句")

    log_probs = np.log(np.clip(probs, 1e-8, None))
    neg_inf = -1e30
    score = np.full(states, neg_inf, dtype=np.float64)
    score[0] = log_probs[0, extended[0]]
    if states > 1:
        score[1] = log_probs[0, extended[1]]
    back = np.zeros((frames, states), dtype=np.int8)

    for t in range(1, frames):
        previous = score
        stay = previous
        step = np.concatenate(([neg_inf], previous[:-1]))
        skip = np.full(states, neg_inf)
        if states > 2:
            skip[2:] = previous[:-2]
        # 只有当前状态与前两个状态标签不同时才能跳格（CTC 规则）
        skip_mask = np.zeros(states, dtype=bool)
        for s in range(2, states):
            skip_mask[s] = extended[s] != extended[s - 2] and extended[s] != blank
        skip = np.where(skip_mask, skip, neg_inf)
        stacked = np.stack([stay, step, skip])
        choice = np.argmax(stacked, axis=0)
        score = stacked[choice, np.arange(states)] + log_probs[t, extended]
        back[t] = choice

    end_states = [states - 1] if states == 1 else [states - 1, states - 2]
    final = np.argmax([score[s] for s in end_states])
    state = end_states[final]

    token_probs = np.zeros(len(tokens), dtype=np.float64)
    token_start = np.full(len(tokens), -1, dtype=np.int32)
    token_end = np.full(len(tokens), -1, dtype=np.int32)
    for t in range(frames - 1, -1, -1):
        if state % 2 == 1:
            index = (state - 1) // 2
            token_probs[index] = probs[t, extended[state]]
            if token_end[index] < 0:
                token_end[index] = t
            token_start[index] = t
        if t == 0:
            break
        state -= int(back[t, state])
    if (token_end < 0).all():
        raise RuntimeError("对齐失败")
    return token_probs, np.stack([token_start, token_end], axis=1)


def score_words(text: str, token_probs: np.ndarray, word_of_token: list[int]) -> list[dict]:
    """按词聚合字母后验，得到每个词的发音分。"""
    buckets: dict[int, list[float]] = {}
    for token_score, word_index in zip(token_probs, word_of_token):
        buckets.setdefault(word_index, []).append(float(token_score))

    plain_words = [
        word for word in text.replace("|", " ").split()
        if any(char.isalnum() or char == "'" for char in word)
    ]
    words: list[dict] = []
    for word_index in sorted(buckets):
        values = buckets[word_index]
        mean = sum(values) / len(values)
        words.append({
            "word": plain_words[word_index] if word_index < len(plain_words) else "",
            "score": int(round(max(0.0, min(1.0, mean)) * 100)),
        })
    return words


def frame_energy(samples: np.ndarray, frames: int, hop: int = 320) -> np.ndarray:
    """把波形按帧切成 RMS 能量，长度与模型输出的帧数对齐。"""
    energy = np.zeros(frames, dtype=np.float64)
    for index in range(frames):
        start = index * hop
        end = min(start + hop, samples.size)
        if start >= samples.size:
            break
        chunk = samples[start:end]
        energy[index] = float(np.sqrt(np.mean(chunk * chunk)))
    return energy


def word_targets(word: str) -> tuple[int, int] | None:
    """查 CMU 词典，返回该词的（音节数，重读音节下标）。"""
    key = re.sub(r"[^a-z']", "", word.lower())
    if not key:
        return None
    entries = PRON_DICT.get(key)
    if not entries:
        return None
    phones = entries[0]
    vowel_indexes = [index for index, phone in enumerate(phones) if phone[-1:].isdigit()]
    if not vowel_indexes:
        return None
    stresses = [phones[index][-1] for index in vowel_indexes]
    if "1" in stresses:
        stressed = stresses.index("1")
    elif "2" in stresses:
        stressed = stresses.index("2")
    else:
        stressed = 0
    return len(vowel_indexes), stressed


def analyze_stress(
    words: list[dict],
    token_frames: np.ndarray,
    word_of_token: list[int],
    energy: np.ndarray,
) -> None:
    """按词比较「实际最响的音节」与词典重音位置，写回 words。"""
    spans: dict[int, list[int]] = {}
    for frames, word_index in zip(token_frames, word_of_token):
        start, end = int(frames[0]), int(frames[1])
        if end < 0:
            continue
        current = spans.get(word_index)
        if current is None:
            spans[word_index] = [start, end]
        else:
            current[0] = min(current[0], start)
            current[1] = max(current[1], end)

    for index, word in enumerate(words):
        target = word_targets(word["word"])
        span = spans.get(index)
        if target is None or span is None:
            word["stress"] = None
            continue
        syllables, stressed = target
        start, end = span
        if syllables <= 1 or end <= start or energy.size == 0:
            word["stress"] = None
            continue
        edges = np.linspace(start, end + 1, syllables + 1).astype(int)
        means = []
        for part in range(syllables):
            lo = max(0, edges[part])
            hi = min(energy.size, max(edges[part + 1], lo + 1))
            means.append(float(np.mean(energy[lo:hi])) if hi > lo else 0.0)
        heard = int(np.argmax(means))
        word["stress"] = {
            "expected": stressed,
            "heard": heard,
            "ok": heard == stressed,
            "syllables": syllables,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wav", required=True)
    parser.add_argument("--text", required=True)
    args = parser.parse_args()

    if not MODEL_PATH.exists():
        print(json.dumps({"error": f"模型缺失：{MODEL_PATH}"}), file=sys.stdout)
        return 2

    vocab = load_vocab()
    blank = vocab.get(PAD_TOKEN, 0)
    tokens, word_of_token = encode_text(args.text, vocab)
    if not tokens:
        print(json.dumps({"error": "参考句没有可评分的字母"}), file=sys.stdout)
        return 2

    samples = read_wav(args.wav)
    session = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    logits = session.run(None, {input_name: samples[np.newaxis, :].astype(np.float32)})[0]
    logits = np.squeeze(logits, axis=0)
    shifted = logits - logits.max(axis=1, keepdims=True)
    probs = np.exp(shifted)
    probs /= probs.sum(axis=1, keepdims=True)

    token_probs, token_frames = ctc_align(probs, tokens, blank)
    words = score_words(args.text, token_probs, word_of_token)
    energy = frame_energy(samples, probs.shape[0])
    analyze_stress(words, token_frames, word_of_token, energy)
    overall = int(round(float(np.mean(token_probs)) * 100))
    stress_checked = [word for word in words if word.get("stress")]
    stress_ok = sum(1 for word in stress_checked if word["stress"]["ok"])
    payload = {
        "score": max(0, min(100, overall)),
        "words": words,
        "stressChecked": len(stress_checked),
        "stressOk": stress_ok,
        "durationSec": round(samples.size / SAMPLE_RATE, 2),
        "model": "wav2vec2-base-960h",
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - 侧车只把错误交给调用方
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        raise SystemExit(2)
