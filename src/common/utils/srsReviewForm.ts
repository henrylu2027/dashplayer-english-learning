import type { SrsCard, SrsReviewForm } from '@/common/contracts/srs';

/**
 * 判定复习形态所需的卡片字段。
 */
export type SrsReviewCardShape = Pick<
    SrsCard,
    'stage' | 'word' | 'referenceText' | 'sourceKind' | 'videoPath' | 'subtitlePath'
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
 * 由卡片原料与阶段决定复习形态。
 *
 * 规则固定、可复现：
 * - 只有词的卡片只能认词自评；
 * - 有原声的句子卡在阶段 2~3 走听写，其余阶段跟读；
 * - 没有原声的句子卡一律跟读（听写无从播放）。
 *
 * @param card 判定所需的卡片字段。
 * @returns 复习形态。
 */
export function resolveSrsReviewForm(card: SrsReviewCardShape): SrsReviewForm {
    if (isWordOnlySrsCard(card)) {
        return 'recall';
    }
    const canDictate = card.sourceKind === 'video'
        && Boolean(card.videoPath)
        && Boolean(card.subtitlePath);
    if (canDictate && (card.stage === 2 || card.stage === 3)) {
        return 'dictation';
    }
    return 'shadowing';
}
