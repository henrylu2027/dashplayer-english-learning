import type { ShadowingScoreVO, ShadowingWordFeedback } from '@/common/contracts/shadowing';
import { normalizeWord, tokenizeForScoring } from '@/common/utils/wordTokens';

/**
 * 逐词对齐的编辑操作。
 *
 * `match` 表示两边同词；`substitute` 表示该位置读错；`delete` 表示参考词漏读；
 * `insert` 表示识别结果多出参考文本没有的词。
 */
type AlignmentOperation =
    | { kind: 'match'; referenceIndex: number; recognizedIndex: number }
    | { kind: 'substitute'; referenceIndex: number; recognizedIndex: number }
    | { kind: 'delete'; referenceIndex: number }
    | { kind: 'insert'; recognizedIndex: number };

/**
 * 两段文本的逐词对齐结果。
 *
 * 跟读评分、听写校对共用这份结果；复述走关键词覆盖，不使用逐词对齐。
 */
export interface TextAlignment {
    /** 按参考文本顺序排列的逐词反馈；多读词插在其被读出的位置。 */
    words: ShadowingWordFeedback[];
    /** 参考词数。 */
    referenceWordCount: number;
    /** 实际词数（识别或输入）。 */
    actualWordCount: number;
    /** 完全一致的词数。 */
    correctWordCount: number;
    /** 被替换的词数。 */
    mispronouncedWordCount: number;
    /** 漏读的词数。 */
    missingWordCount: number;
    /** 多读的词数。 */
    extraWordCount: number;
}

/**
 * 综合得分中各项的权重。
 *
 * 准确度权重最高；完整度次之；多读与语速只占小头，避免为了语速牺牲清晰度。
 */
const SCORE_WEIGHTS = {
    accuracy: 0.55,
    completeness: 0.25,
    fluency: 0.1,
    pace: 0.1,
} as const;

/** 理想语速（词/分钟）。低于或高于该值越远，语速项得分越低。 */
const IDEAL_WORDS_PER_MINUTE = 130;

/**
 * 编辑距离的代价（按 10 倍放大，保持整数运算）：替换 11，漏读/多读各 10。
 *
 * 替换略贵于一次漏读或多读，是为了让对齐优先保住相同的词：
 * `a cup of coffee` 对 `a cup coffee please` 会得到「漏读 of + 读对 coffee + 多读 please」，
 * 而不是把 of 和 coffee 都判成读错、让一个错词吞掉后面的正确词。
 */
const SUBSTITUTE_COST = 11;
const INSERT_DELETE_COST = 10;

/**
 * 短录音的语速统计不可靠（一句话零点几秒就能读出很高数值），
 * 低于该时长时语速项按满分处理，只展示、不扣分。
 */
const MIN_DURATION_FOR_PACE_SECOND = 3;

/**
 * 用编辑距离对齐两组词，并回溯出逐词操作。
 *
 * 回溯优先级：同词 > 替换 > 漏读 > 多读，保证「读错一个词」不会被拆成
 * 一次漏读加一次多读，反馈更符合直觉。
 *
 * @param referenceWords 归一化后的参考词。
 * @param recognizedWords 归一化后的识别词。
 * @returns 按文本顺序排列的编辑操作。
 */
function alignWords(referenceWords: string[], recognizedWords: string[]): AlignmentOperation[] {
    const referenceCount = referenceWords.length;
    const recognizedCount = recognizedWords.length;
    const distances: number[][] = Array.from(
        { length: referenceCount + 1 },
        () => new Array<number>(recognizedCount + 1).fill(0),
    );
    for (let i = 0; i <= referenceCount; i++) {
        distances[i][0] = i * INSERT_DELETE_COST;
    }
    for (let j = 0; j <= recognizedCount; j++) {
        distances[0][j] = j * INSERT_DELETE_COST;
    }
    for (let i = 1; i <= referenceCount; i++) {
        for (let j = 1; j <= recognizedCount; j++) {
            const substituteCost = referenceWords[i - 1] === recognizedWords[j - 1] ? 0 : SUBSTITUTE_COST;
            distances[i][j] = Math.min(
                distances[i - 1][j - 1] + substituteCost,
                distances[i - 1][j] + INSERT_DELETE_COST,
                distances[i][j - 1] + INSERT_DELETE_COST,
            );
        }
    }

    const operations: AlignmentOperation[] = [];
    let i = referenceCount;
    let j = recognizedCount;
    while (i > 0 || j > 0) {
        if (
            i > 0
            && j > 0
            && referenceWords[i - 1] === recognizedWords[j - 1]
            && distances[i][j] === distances[i - 1][j - 1]
        ) {
            operations.push({ kind: 'match', referenceIndex: i - 1, recognizedIndex: j - 1 });
            i--;
            j--;
            continue;
        }
        if (i > 0 && j > 0 && distances[i][j] === distances[i - 1][j - 1] + SUBSTITUTE_COST) {
            operations.push({ kind: 'substitute', referenceIndex: i - 1, recognizedIndex: j - 1 });
            i--;
            j--;
            continue;
        }
        if (i > 0 && distances[i][j] === distances[i - 1][j] + INSERT_DELETE_COST) {
            operations.push({ kind: 'delete', referenceIndex: i - 1 });
            i--;
            continue;
        }
        operations.push({ kind: 'insert', recognizedIndex: j - 1 });
        j--;
    }
    return operations.reverse();
}

/**
 * 对两段文本做逐词对齐。
 *
 * 跟读评分与听写校对共用：两者都是“参考文本 vs 实际输出”的逐词比对，
 * 只是实际输出一个来自语音识别，一个来自键盘输入。
 *
 * @param referenceText 参考文本。
 * @param actualText 实际输出文本。
 * @returns 逐词反馈与各类计数。
 * @throws 参考文本切不出任何单词时抛出。
 */
export function alignText(referenceText: string, actualText: string): TextAlignment {
    const referenceTokens = tokenizeForScoring(referenceText);
    if (referenceTokens.length === 0) {
        throw new Error('参考文本没有可评测的单词');
    }
    const actualTokens = tokenizeForScoring(actualText);
    const operations = alignWords(
        referenceTokens.map(normalizeWord),
        actualTokens.map(normalizeWord),
    );

    const words: ShadowingWordFeedback[] = [];
    let correctWordCount = 0;
    let mispronouncedWordCount = 0;
    let missingWordCount = 0;
    let extraWordCount = 0;
    for (const operation of operations) {
        switch (operation.kind) {
            case 'match':
                words.push({
                    expected: referenceTokens[operation.referenceIndex],
                    actual: actualTokens[operation.recognizedIndex],
                    status: 'correct',
                });
                correctWordCount++;
                break;
            case 'substitute':
                words.push({
                    expected: referenceTokens[operation.referenceIndex],
                    actual: actualTokens[operation.recognizedIndex],
                    status: 'mispronounced',
                });
                mispronouncedWordCount++;
                break;
            case 'delete':
                words.push({
                    expected: referenceTokens[operation.referenceIndex],
                    status: 'missing',
                });
                missingWordCount++;
                break;
            case 'insert':
                words.push({
                    actual: actualTokens[operation.recognizedIndex],
                    status: 'extra',
                });
                extraWordCount++;
                break;
        }
    }

    return {
        words,
        referenceWordCount: referenceTokens.length,
        actualWordCount: actualTokens.length,
        correctWordCount,
        mispronouncedWordCount,
        missingWordCount,
        extraWordCount,
    };
}

/**
 * 计算语速项得分，范围 0~1。
 *
 * @param wordsPerMinute 实际语速。
 * @param durationSec 录音时长；过短时语速不可靠，返回满分。
 * @returns 语速项得分。
 */
function paceScore(wordsPerMinute: number, durationSec: number): number {
    if (durationSec < MIN_DURATION_FOR_PACE_SECOND) {
        return 1;
    }
    const deviation = Math.abs(wordsPerMinute - IDEAL_WORDS_PER_MINUTE) / IDEAL_WORDS_PER_MINUTE;
    return Math.max(0, 1 - deviation);
}

/**
 * 对一次跟读做逐词评测。
 *
 * 算法：参考文本与识别文本各切成词序列，用编辑距离对齐后统计
 * 读对 / 读错 / 漏读 / 多读四种情况，再按准确度、完整度、多读惩罚、
 * 语速加权得到综合得分。本函数是纯函数，便于脱离 Electron 环境复用。
 *
 * @param referenceText 用户要跟读的参考文本。
 * @param recognizedText 本地语音识别结果。
 * @param durationSec 录音时长，单位秒；必须大于 0。
 * @returns 逐词反馈与各项得分。
 * @throws 参考文本切不出任何单词，或录音时长为非正数时抛出。
 */
export function scoreShadowing(
    referenceText: string,
    recognizedText: string,
    durationSec: number,
): ShadowingScoreVO {
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
        throw new Error(`录音时长非法：${durationSec}`);
    }
    const alignment = alignText(referenceText, recognizedText);
    const referenceCount = alignment.referenceWordCount;
    const accuracy = alignment.correctWordCount / referenceCount;
    const completeness = (alignment.correctWordCount + alignment.mispronouncedWordCount) / referenceCount;
    const fluency = alignment.correctWordCount / (referenceCount + alignment.extraWordCount);
    const wordsPerMinute = Math.round(alignment.actualWordCount / (durationSec / 60));
    // 完全没识别到词时语速项不可能算“达标”；否则一句没说也会因短录音拿到基础分
    const pace = alignment.actualWordCount === 0 ? 0 : paceScore(wordsPerMinute, durationSec);
    const score = Math.round(
        100 * (
            SCORE_WEIGHTS.accuracy * accuracy
            + SCORE_WEIGHTS.completeness * completeness
            + SCORE_WEIGHTS.fluency * fluency
            + SCORE_WEIGHTS.pace * pace
        ),
    );

    return {
        recognizedText: recognizedText.trim(),
        words: alignment.words,
        referenceWordCount: referenceCount,
        correctWordCount: alignment.correctWordCount,
        score,
        accuracy: Math.round(accuracy * 100),
        completeness: Math.round(completeness * 100),
        wordsPerMinute,
        durationSec: Math.round(durationSec * 100) / 100,
    };
}
