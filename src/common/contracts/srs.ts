import type { ShadowingAttemptSource, ShadowingSourceKind } from '@/common/contracts/shadowing';

/**
 * 间隔复习（SRS）契约。
 *
 * 一张卡片对应一个可复习对象（视频句或自由文本）。复习动作不是看卡片，
 * 而是听原声后跟读，由跟读得分决定是否通过；通过才延后到下一次复习。
 */

/**
 * 复习通过所需的跟读综合分。
 *
 * 与跟读打分的权重配合：读错一两个词仍可通过，漏读整段或多处读错会不达标。
 */
export const SRS_PASS_SCORE = 80;

/**
 * 通过后各阶段对应的间隔天数。
 *
 * 新卡 stage=0 立即可复习；第 1 次通过后 stage=1，间隔 1 天；之后 3/7/14/30 天。
 * 到达最后一个阶段后保持 30 天循环，不再无限延长。
 */
export const SRS_INTERVAL_DAYS: readonly number[] = [1, 3, 7, 14, 30];

/**
 * 一张间隔复习卡片。
 */
export interface SrsCard {
    /** 卡片 ID。 */
    id: number;
    /** 要跟读的句子文本。 */
    referenceText: string;
    /** 来源类型。 */
    sourceKind: ShadowingSourceKind;
    /** 视频字幕内容哈希；自由输入时为 null。 */
    videoKey: string | null;
    /** 字幕句序号；自由输入时为 null。 */
    sentenceIndex: number | null;
    /** 视频绝对路径，用于提取原声；缺失表示无法播放原声。 */
    videoPath: string | null;
    /** 字幕绝对路径，用于解析句子时间区间；缺失表示无法播放原声。 */
    subtitlePath: string | null;
    /** 当前复习阶段，范围 0~5。 */
    stage: number;
    /** 下次复习时间，epoch 毫秒；小于等于当前时间即待复习。 */
    dueAt: number;
    /** 最近一次复习的跟读综合分；从未复习时为 null。 */
    lastScore: number | null;
    /** 最近一次复习对应的跟读记录 ID；从未复习时为 null。 */
    lastAttemptId: number | null;
    /** 累计复习次数。 */
    reviewCount: number;
    /** 累计通过次数。 */
    passCount: number;
    /** 创建时间，epoch 毫秒。 */
    createdAt: number;
    /** 最后更新时间，epoch 毫秒。 */
    updatedAt: number;
}

/**
 * 复习页概览：待复习卡、未来卡与计数。
 */
export interface SrsOverview {
    /** 已到期、今天需要复习的卡片，按到期时间从早到晚。 */
    dueCards: SrsCard[];
    /** 尚未到期的卡片，按到期时间从早到晚。 */
    upcomingCards: SrsCard[];
    /** 待复习总数（不受列表条数限制）。 */
    dueCount: number;
    /** 卡片总数。 */
    totalCount: number;
    /** 生成这份概览的时间，epoch 毫秒；前端据此计算“还有几天”文案，避免渲染期取当前时间。 */
    generatedAt: number;
}

/**
 * 加入复习的请求。
 */
export interface SrsAddCardRequest {
    /** 要复习的句子文本。 */
    referenceText: string;
    /** 句子来源；同一视频句或同一自由文本只会有一张卡。 */
    source: ShadowingAttemptSource;
}

/**
 * 加入复习的结果。
 */
export interface SrsAddCardResponse {
    /** 已存在或新建的卡片。 */
    card: SrsCard;
    /** 本次是否新建；false 表示这句话已经在复习队列里。 */
    created: boolean;
}

/**
 * 提交一次复习结果。
 */
export interface SrsSubmitReviewRequest {
    /** 复习卡片 ID。 */
    cardId: number;
    /** 本次复习对应的跟读记录 ID；得分与来源都以这条记录为准。 */
    attemptId: number;
}

/**
 * 复习结果。
 */
export interface SrsReviewOutcome {
    /** 更新后的卡片。 */
    card: SrsCard;
    /** 本次是否通过。 */
    passed: boolean;
    /** 本次跟读综合分。 */
    score: number;
    /** 通过后的间隔天数；未通过为 0，卡片立即回到待复习。 */
    intervalDays: number;
}
