import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';
import type { SrsCard, SrsOverview } from '@/common/contracts/srs';

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
    /** 本次跟读记录 ID。 */
    lastAttemptId: number;
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
     * 查询复习概览。
     * @param now 当前时间，epoch 毫秒。
     * @param dueLimit 待复习列表最多返回条数。
     * @param upcomingLimit 未来列表最多返回条数。
     * @returns 到期/未来卡片与总数。
     */
    overview(now: number, dueLimit: number, upcomingLimit: number): Promise<SrsOverview>;

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
}
