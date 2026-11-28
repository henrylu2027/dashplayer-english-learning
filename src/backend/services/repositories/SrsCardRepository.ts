import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';
import type { SrsCard, SrsOverview, SrsSourceModule } from '@/common/contracts/srs';

/**
 * 新建复习卡片的输入。
 */
export interface CreateSrsCardParams {
    /** 唯一卡片键。 */
    cardKey: string;
    /** 句子文本。 */
    referenceText: string;
    /** 句子来源。 */
    source: ShadowingAttemptSource;
    /** 首次到期时间，epoch 毫秒。 */
    dueAt: number;
    /** 语境卡的目标词。 */
    word?: string | null;
    /** 学习来源模块。 */
    modules?: SrsSourceModule[];
    /** 入池优先级，数值越小越优先。 */
    priority?: number;
}

/**
 * 待办队列里的一条入池请求。
 */
export interface IntakeItem {
    /** 唯一卡片键。 */
    cardKey: string;
    /** 句子文本。 */
    referenceText: string;
    /** 句子来源。 */
    source: ShadowingAttemptSource;
    /** 目标词。 */
    word: string | null;
    /** 学习来源模块。 */
    modules: SrsSourceModule[];
    /** 入池优先级。 */
    priority: number;
    /** 入队时间。 */
    createdAt: number;
}

/**
 * 一次复习之后的卡片更新。
 */
export interface UpdateSrsCardReviewParams {
    /** 卡片 ID。 */
    id: number;
    /** 新阶段。 */
    stage: number;
    /** 新到期时间，epoch 毫秒。 */
    dueAt: number;
    /** 本次跟读得分。 */
    lastScore: number;
    /** 本次跟读记录 ID；听写与认词没有跟读记录时为 null。 */
    lastAttemptId: number | null;
    /** 本次是否通过，用于累计通过次数。 */
    passed: boolean;
}

/**
 * 复习卡片的持久化端口。
 */
export default interface SrsCardRepository {
    /**
     * 按卡片键创建；已存在时返回原卡片。
     * @param params 卡片内容。
     * @returns 卡片与是否新建。
     */
    createIfAbsent(params: CreateSrsCardParams): Promise<{ card: SrsCard; created: boolean }>;

    /**
     * 按 ID 查询卡片。
     * @param id 卡片 ID。
     * @returns 卡片；不存在时返回 null。
     */
    findById(id: number): Promise<SrsCard | null>;

    /**
     * 按卡片键查询卡片。
     * @param cardKey 唯一卡片键。
     * @returns 卡片；不存在时返回 null。
     */
    findByCardKey(cardKey: string): Promise<SrsCard | null>;

    /**
     * 查询复习概览。
     * @param now 当前时间，epoch 毫秒。
     * @param dueLimit 待复习列表最多返回条数。
     * @param upcomingLimit 未来列表最多返回条数。
     * @param newFrom 今日新学的统计起点（本地零点），epoch 毫秒。
     * @returns 到期/未来/今日新学卡片与总数；每日上限由服务层补充。
     */
    overview(now: number, dueLimit: number, upcomingLimit: number, newFrom: number): Promise<Omit<SrsOverview, 'dailyNewCardLimit'>>;

    /**
     * 写入一次复习结果并累计次数。
     * @param params 新阶段、到期时间与本次成绩。
     * @returns 更新后的卡片。
     * @throws 卡片不存在时抛出。
     */
    updateAfterReview(params: UpdateSrsCardReviewParams): Promise<SrsCard>;

    /**
     * 删除卡片。
     * @param id 卡片 ID。
     * @throws 卡片不存在时抛出。
     */
    deleteById(id: number): Promise<void>;

    /**
     * 统计某个时间区间内新建的卡片数，用于每日入池上限。
     * @param from 起始时间（含），epoch 毫秒。
     * @param to 结束时间（不含），epoch 毫秒。
     */
    countCreatedBetween(from: number, to: number): Promise<number>;

    /**
     * 查询某个时间区间内新建的卡片，按创建时间倒序。
     * @param from 起始时间（含）。
     * @param to 结束时间（不含）。
     * @param limit 最多返回条数。
     */
    listCreatedBetween(from: number, to: number, limit: number): Promise<SrsCard[]>;

    /**
     * 合并已有卡片的来源模块与目标词，不改变调度。
     * @param cardKey 卡片键。
     * @param modules 追加的来源模块。
     * @param word 目标词；为空时保持原值。
     */
    mergeCardMeta(cardKey: string, modules: SrsSourceModule[], word?: string | null): Promise<void>;

    /**
     * 读取待办队列中的一条。
     * @param cardKey 卡片键。
     */
    findIntake(cardKey: string): Promise<IntakeItem | null>;

    /**
     * 写入待办队列；同一卡片键已存在时合并模块与优先级。
     * @param item 入池请求。
     */
    enqueueIntake(item: IntakeItem): Promise<void>;

    /**
     * 按优先级取待办队列，数值小的在前，同优先级按入队时间。
     * @param limit 最多返回条数。
     */
    listIntake(limit: number): Promise<IntakeItem[]>;

    /**
     * 从待办队列移除一条。
     * @param cardKey 卡片键。
     */
    removeIntake(cardKey: string): Promise<void>;
}
