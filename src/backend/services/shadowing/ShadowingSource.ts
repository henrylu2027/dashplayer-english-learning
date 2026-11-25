import { createHash } from 'crypto';
import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';
import { normalizeWord, tokenizeForScoring } from '@/common/utils/wordTokens';

/**
 * 校验跟读句子来源并剥掉与来源类型无关的字段。
 *
 * 视频来源必须带字幕哈希与句子序号，保证跟读记录、复习和统计都能回到具体句子；
 * 自由输入不保留任何视频路径，避免下游误以为可以回放原声。
 *
 * @param source 前端提交的来源。
 * @returns 已校验并收敛字段的来源。
 * @throws 来源缺失、类型未知或视频来源缺少关键字段时抛出。
 */
export function normalizeShadowingSource(source: ShadowingAttemptSource): ShadowingAttemptSource {
    if (source === null || typeof source !== 'object') {
        throw new Error('跟读来源缺失');
    }
    if (source.kind === 'free') {
        return { kind: 'free' };
    }
    if (source.kind !== 'video') {
        throw new Error(`未知的跟读来源类型：${String((source as { kind?: unknown }).kind)}`);
    }
    const videoKey = source.videoKey;
    const sentenceIndex = source.sentenceIndex;
    if (typeof videoKey !== 'string' || videoKey.trim().length === 0) {
        throw new Error('视频来源缺少字幕哈希');
    }
    if (typeof sentenceIndex !== 'number' || !Number.isInteger(sentenceIndex) || sentenceIndex < 0) {
        throw new Error('视频来源缺少合法的句子序号');
    }
    return {
        kind: 'video',
        videoKey: videoKey.trim(),
        sentenceIndex,
        videoPath: typeof source.videoPath === 'string' && source.videoPath.length > 0
            ? source.videoPath
            : undefined,
        subtitlePath: typeof source.subtitlePath === 'string' && source.subtitlePath.length > 0
            ? source.subtitlePath
            : undefined,
    };
}

/**
 * 把句子文本归一化为可比较的键：只保留词本身，忽略大小写与标点。
 *
 * @param referenceText 句子文本。
 * @returns 以单个空格连接的归一化词串；无有效词时为空串。
 */
export function normalizedTextKey(referenceText: string): string {
    return tokenizeForScoring(referenceText).map(normalizeWord).join(' ');
}

/**
 * 生成复习卡片的唯一键。
 *
 * 视频句用 `video:<字幕哈希>:<句序号>`，同一句无论从播放器还是历史记录加入都归到一张卡；
 * 自由文本用归一化文本的 SHA-1，避免仅标点或大小写不同产生重复卡片。
 *
 * @param referenceText 句子文本。
 * @param source 句子来源。
 * @returns 唯一卡片键。
 * @throws 来源非法或自由文本没有有效单词时抛出。
 */
export function buildSrsCardKey(referenceText: string, source: ShadowingAttemptSource): string {
    const normalizedSource = normalizeShadowingSource(source);
    if (normalizedSource.kind === 'video') {
        return `video:${normalizedSource.videoKey}:${normalizedSource.sentenceIndex}`;
    }
    const textKey = normalizedTextKey(referenceText);
    if (textKey.length === 0) {
        throw new Error('参考文本没有可复习的单词');
    }
    const hash = createHash('sha1').update(textKey).digest('hex');
    return `free:${hash}`;
}
