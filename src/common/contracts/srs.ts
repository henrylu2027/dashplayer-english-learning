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
 * 每日新卡入池上限的默认值。
 *
 * 0 表示暂停入池：新学的句子只进待办队列，不会生成新卡。
 */
export const SRS_DEFAULT_DAILY_NEW_CARD_LIMIT = 50;

/** 每日新卡入池上限允许的最大值。 */
export const SRS_MAX_DAILY_NEW_CARD_LIMIT = 200;

/**
 * 学习来源模块。
 *
 * 五条学习路径 + 复习页自身；入池时记录来源，复习页据此显示标签。
 */
export type SrsSourceModule = 'player' | 'original' | 'practice' | 'dialogue' | 'vocabulary';

/**
 * 复习形态。
 *
 * - `shadowing`：听原声后跟读，按跟读综合分判定；
 * - `dictation`：听原声后听写整句，按词准确率判定；
 * - `recall`：听原声后回忆整句，显示原文后自评；
 * - `vocab`：看目标词回忆词义，展开释义与原句，固定形态。
 */
export type SrsReviewForm = 'shadowing' | 'dictation' | 'recall' | 'vocab';

/**
 * 掌握度判定。底部三按钮定方向，机器分只在跟读/听写形态下封顶。
 */
export type SrsVerdict = 'forgot' | 'fuzzy' | 'known';

/**
 * 一张间隔复习卡片。
 */
export interface SrsCard {
    /** 卡片 ID。 */
    id: number;
    /** 要跟读的句子文本。 */
    referenceText: string;
    /** 语境卡的目标词；普通句子卡为 null。 */
    word: string | null;
    /** 学习来源模块（去重后的有序列表）。 */
    sourceModules: SrsSourceModule[];
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
    /** 掌握时间，epoch 毫秒；null 表示尚未掌握。 */
    masteredAt: number | null;
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
    /** 今日待复习：到期时间落在今天零点之后、当前时间之前的卡片数。 */
    todayDueCount: number;
    /** 逾期卡片数：到期时间早于今天零点。 */
    overdueCount: number;
    /** 已掌握卡片数。 */
    masteredCount: number;
    /** 卡片总数（含已掌握）。 */
    totalCount: number;
    /** 今日新学（今天入池、明天第一次到期）的卡片，只做预览。 */
    newCards: SrsCard[];
    /** 今日新学数量（全量计数，不受列表条数限制）。 */
    newCount: number;
    /** 当前设置的每日新卡上限；0 表示暂停入池。 */
    dailyNewCardLimit: number;
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
 * 统一入池请求：任一学习模块学完后把句子交给间隔复习。
 */
export interface SrsIngestRequest {
    /** 要复习的句子文本。 */
    referenceText: string;
    /** 句子来源；视频句可回放原声。 */
    source: ShadowingAttemptSource;
    /** 学习来源模块。 */
    module: SrsSourceModule;
    /** 本次学习是否未达标；未达标直接进到期区并标记薄弱。 */
    failed?: boolean;
    /** 语境卡的目标词。 */
    word?: string;
}

/**
 * 入池结果。
 */
export interface SrsIngestResponse {
    /** 入池后的卡片；排队中时为 null。 */
    card: SrsCard | null;
    /** 本次是否新建卡片。 */
    created: boolean;
    /** 是否因当日上限进入待办队列。 */
    queued: boolean;
    /** 是否被拒绝入池：没有原声原句的裸词不进入复习。 */
    rejected: boolean;
}

/**
 * 一次复习的取证方式。
 *
 * 前端不能自行声明分数：机器可评的形态必须提交已落库的记录 ID，
 * 只有认词允许自评。
 */
export type SrsReviewEvidence =
    | {
        /** 跟读形态：提交跟读记录。 */
        type: 'shadowing';
        /** 跟读记录 ID。 */
        attemptId: number;
    }
    | {
        /** 听写形态：提交听写记录。 */
        type: 'dictation';
        /** 练习记录 ID，必须是听写模式。 */
        attemptId: number;
    }
    | {
        /** 认词形态：自评是否记得。 */
        type: 'recall';
        /** 本次是否记得。 */
        remembered: boolean;
    };

/**
 * 提交一次复习结果。
 */
export interface SrsSubmitReviewRequest {
    /** 复习卡片 ID。 */
    cardId: number;
    /** 本次复习的取证方式。 */
    evidence: SrsReviewEvidence;
}

/**
 * 复习结果。
 */
export interface SrsReviewOutcome {
    /** 更新后的卡片。 */
    card: SrsCard;
    /** 本次使用的复习形态。 */
    form: SrsReviewForm;
    /** 本次是否通过。 */
    passed: boolean;
    /** 本次跟读综合分。 */
    score: number;
    /** 通过后的间隔天数；未通过为 0，卡片立即回到待复习。 */
    intervalDays: number;
}

/**
 * 复习前的打分请求：只读成绩，不改排期。
 *
 * 前端先看到机器分，再决定点哪个掌握度按钮；两步之间不需要临时状态表。
 */
export interface SrsCheckRequest {
    /** 复习卡片 ID。 */
    cardId: number;
    /** 取证方式；认词与词汇形态不需要。 */
    evidence?: SrsReviewEvidence;
}

/**
 * 打分结果。
 */
export interface SrsCheckResult {
    /** 复习卡片 ID。 */
    cardId: number;
    /** 本次使用的复习形态。 */
    form: SrsReviewForm;
    /** 机器分；认词与词汇形态没有机器分，为 null。 */
    score: number | null;
    /** 机器分是否达到通过线；没有机器分为 null。 */
    passed: boolean | null;
    /** 通过线。 */
    passLine: number;
}

/**
 * 掌握度判定请求：按钮定方向，后端重读机器分后再计算阶段。
 */
export interface SrsVerdictRequest {
    /** 复习卡片 ID。 */
    cardId: number;
    /** 用户判定。 */
    verdict: SrsVerdict;
    /** 取证方式；认词与词汇形态不需要。 */
    evidence?: SrsReviewEvidence;
}

/**
 * 判定结果。
 */
export interface SrsVerdictResult {
    /** 更新后的卡片。 */
    card: SrsCard;
    /** 本次使用的复习形态。 */
    form: SrsReviewForm;
    /** 用户判定。 */
    verdict: SrsVerdict;
    /** 机器分；没有机器分时为 null。 */
    score: number | null;
    /** 机器分是否通过；没有机器分为 null。 */
    passed: boolean | null;
    /** 本次判定后的间隔天数。 */
    intervalDays: number;
    /** 本次判定是否把卡片标记为已掌握。 */
    mastered: boolean;
}

/**
 * 左侧复习队列的查询范围。
 *
 * - `today`：今天到期但未逾期；
 * - `overdue`：到期时间早于今天零点；
 * - `new`：今天新入池，只做预览；
 * - `all`：全部未掌握卡片；
 * - `mastered`：已掌握卡片。
 */
export type SrsQueueScope = 'today' | 'overdue' | 'new' | 'all' | 'mastered';

/**
 * 队列筛选。依据卡片形态与来源，不新增存储字段。
 */
export type SrsQueueFilter = 'all' | 'shadowing' | 'dictation' | 'word' | 'dialogue';

/**
 * 队列分页请求。
 */
export interface SrsQueueRequest {
    /** 查询范围。 */
    scope: SrsQueueScope;
    /** 筛选条件；默认全部。 */
    filter?: SrsQueueFilter;
    /** 偏移量，从 0 开始。 */
    offset?: number;
    /** 本次最多返回条数。 */
    limit?: number;
}

/**
 * 队列分页结果。
 */
export interface SrsQueueResponse {
    /** 当前页卡片。 */
    cards: SrsCard[];
    /** 该范围与筛选下的总数。 */
    total: number;
}

/**
 * 卡片的词表释义。
 */
export interface SrsWordDefinition {
    /** 目标词。 */
    word: string;
    /** 中文释义；词表里没有时为 null。 */
    translate: string | null;
}

/**
 * 卡片在播放器里的定位信息。
 */
export interface SrsCardLocation {
    /** 观看记录 ID，可直接拼到 `#/player/<id>`。 */
    historyId: string;
    /** 句子起始时间，单位为秒。 */
    startSeconds: number;
}

/**
 * 一条历史复习记录。
 */
export interface SrsHistoryItem {
    /** 日志 ID。 */
    id: number;
    /** 卡片 ID。 */
    cardId: number;
    /** 词句预览。 */
    text: string;
    /** 本次形态。 */
    form: SrsReviewForm;
    /** 机器分；没有机器分时为 null。 */
    score: number | null;
    /** 机器分是否通过；没有机器分为 null。 */
    passed: boolean | null;
    /** 用户判定。 */
    verdict: SrsVerdict;
    /** 判定时间，epoch 毫秒。 */
    createdAt: number;
}

/**
 * 历史复习记录查询。
 */
export interface SrsHistoryRequest {
    /** 返回最近多少条，默认 100，最大 500。 */
    limit?: number;
}

/**
 * 历史复习记录结果。
 */
export interface SrsHistoryResponse {
    /** 按时间倒序的记录。 */
    items: SrsHistoryItem[];
}
