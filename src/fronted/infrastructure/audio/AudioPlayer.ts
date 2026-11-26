import StrUtil from '@/common/utils/str-util';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import type { Nullable } from '@/common/types/Types';
import { TypeGuards } from '@/common/utils/TypeGuards';
import { getRendererLogger } from '@/fronted/log/simple-logger';

const api = backendClient;
const cache = new Map<string, string>();
let player: HTMLAudioElement | null = null;

export const playAudioUrl = async (audioUrl: Nullable<string>) => {
    if (TypeGuards.isNull(audioUrl)) {
        return;
    }
    player?.pause();
    getRendererLogger('AudioPlayer').debug('play audio url', { audioUrl });
    player = new Audio(audioUrl);
    // 单词/句子朗读按满音量播放：TTS 音频本身峰值只有 -6 dBFS 左右，
    // 之前再乘 0.5（-6 dB）听起来明显偏小，与视频原声也不成比例。
    player.volume = 1;
    await player.play();
};

/**
 * 使用浏览器内置语音朗读单词，作为 sherpa 离线 TTS 不可用时的回退。
 *
 * @param word 待朗读的英文单词。
 */
export const playWord = async (word: string) => {
    if (!('speechSynthesis' in window)) {
        getRendererLogger('AudioPlayer').debug('speech synthesis unavailable');
        return;
    }
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
};

/**
 * 取单个单词的真人美式发音（在线词典，本地缓存）。
 *
 * 只对单个英文单词有效；离线、非单词或接口异常时返回 null，
 * 调用方应退回本地 TTS，不要静默无声。
 *
 * @param word 待朗读的单词。
 * @returns 音频 URL 或 null。
 */
export const getWordAudioUrl = async (word: string): Promise<Nullable<string>> => {
    try {
        return await api.call('ai-func/word-audio', word);
    } catch (error) {
        getRendererLogger('AudioPlayer').warn('word audio failed', { error });
        return null;
    }
};

/**
 * 播放音频并等到播完。
 *
 * 说明：朗读排队时用得上——上一句没读完就播下一句会互相打断。
 * 播放失败或被打断时同样会 resolve，避免队列卡死。
 *
 * @param audioUrl 音频地址。
 */
export const playAudioUrlAndWait = async (audioUrl: Nullable<string>): Promise<void> => {
    if (TypeGuards.isNull(audioUrl)) {
        return;
    }
    player?.pause();
    player = new Audio(audioUrl);
    player.volume = 1;
    await new Promise<void>((resolve) => {
        const done = (): void => resolve();
        player?.addEventListener('ended', done, { once: true });
        player?.addEventListener('pause', done, { once: true });
        player?.addEventListener('error', done, { once: true });
        player?.play().catch(done);
    });
};

export const getTtsUrl = async (str: string) => {
    str = str.trim();
    if (StrUtil.isBlank(str)) {
        return;
    }
    let audioUrl = cache.get(str);
    if (audioUrl) {
        return audioUrl;
    }

    try {
        audioUrl = await api.call('ai-func/tts', str);
        getRendererLogger('AudioPlayer').debug('tts result', { audioUrl });
    } catch (error) {
        getRendererLogger('AudioPlayer').warn('tts failed', { error });
        return;
    }

    if (!StrUtil.isBlank(audioUrl)) {
        cache.set(str, audioUrl);
        return audioUrl;
    }
    return;
};
