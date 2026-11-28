import type { SrsCard, SrsReviewForm } from '@/common/contracts/srs';

/**
 * 判定复习形态所需的卡片字段。
 */
export type SrsReviewCardShape = Pick<
    SrsCard,
    'stage' | 'word' | 'referenceText' | 'sourceKind' | 'videoPath' | 'subtitlePath' | 'sourceModules'
>;

/**
 * 是否为「只有词」的卡片：目标词就是整段参考文本，没有语境句。
 *
 * @param card 判定所需的卡片字段。
 * @returns 词卡返回 true。
 */
export function isWordOnlySrsCard(card: SrsReviewCardShape): boolean {
    if (!card.word) {
        return false;
    }
    return card.referenceText.trim().toLowerCase() === card.word.trim().toLowerCase();
}

/**
 * 卡片是否有可回放的原声。
 *
 * @param card 判定所需的卡片字段。
 * @returns 视频句且保留视频/字幕路径时返回 true。
 */
export function hasSrsAudio(card: SrsReviewCardShape): boolean {
    return card.sourceKind === 'video' && Boolean(card.videoPath) && Boolean(card.subtitlePath);
}

/**
 * 由卡片原料与阶段决定复习形态。
 *
 * 规则固定、可复现：
 * - 只有词的卡片只能认词自评；这类卡没有原声原句，队列层已不再推送；
 * - 带语境句的目标词卡固定走词汇形态，不随阶段变化；
 * - 有原声的句子卡按阶段轮换：0~1 跟读、2~3 听写、4~5 听音回忆；
 * - 没有原声的句子卡一律跟读（听写与回忆都无从播放）。
 *
 * @param card 判定所需的卡片字段。
 * @returns 复习形态。
 */
export function resolveSrsReviewForm(card: SrsReviewCardShape): SrsReviewForm {
    if (isWordOnlySrsCard(card)) {
        return 'recall';
    }
    if (card.word?.trim()) {
        return 'vocab';
    }
    // 场景对话来源的句子固定走口头复述
    if (card.sourceModules.includes('dialogue')) {
        return 'scenario';
    }
    if (hasSrsAudio(card)) {
        if (card.stage <= 1) {
            return 'shadowing';
        }
        if (card.stage <= 3) {
            return 'dictation';
        }
        return 'recall';
    }
    return 'shadowing';
}
