import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';
import type { SrsCard } from '@/common/contracts/srs';
import type { Sentence } from '@/common/types/SentenceC';

/**
 * 由播放器当前句构造视频来源。
 *
 * @param sentence 播放器高亮句。
 * @param videoPath 当前视频绝对路径；缺失时不写入。
 * @param subtitlePath 当前字幕绝对路径；缺失时不写入。
 * @returns 绑定 videoKey + sentenceIndex 的来源对象。
 */
export function buildVideoShadowingSource(
    sentence: Sentence,
    videoPath: string | null,
    subtitlePath: string | null,
): ShadowingAttemptSource {
    return {
        kind: 'video',
        videoKey: sentence.fileHash,
        sentenceIndex: sentence.index,
        videoPath: videoPath ?? undefined,
        subtitlePath: subtitlePath ?? undefined,
    };
}

/**
 * 由复习卡片还原跟读来源，供复习时录音评分使用。
 *
 * @param card 复习卡片。
 * @returns 与卡片指向同一句的来源对象；自由文本卡片返回 `free`。
 */
export function shadowingSourceFromCard(card: SrsCard): ShadowingAttemptSource {
    if (card.sourceKind === 'video') {
        return {
            kind: 'video',
            videoKey: card.videoKey ?? undefined,
            sentenceIndex: card.sentenceIndex ?? undefined,
            videoPath: card.videoPath ?? undefined,
            subtitlePath: card.subtitlePath ?? undefined,
        };
    }
    return { kind: 'free' };
}
