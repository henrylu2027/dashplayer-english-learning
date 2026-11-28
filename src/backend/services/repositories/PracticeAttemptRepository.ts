import type { ShadowingAttemptSource, ShadowingWordFeedback } from '@/common/contracts/shadowing';
import type { PracticeAttemptSummary, PracticeMode, RetellKeywordFeedback } from '@/common/contracts/practice';

/**
 * 新建练习记录的输入。
 */
export interface CreatePracticeAttemptParams {
    /** 练习模式。 */
    mode: PracticeMode;
    /** 句子来源。 */
    source: ShadowingAttemptSource;
    /** 参考文本。 */
    referenceText: string;
    /** 用户输出：听写输入或复述识别文本。 */
    userText: string;
    /** 得分，0~100。 */
    score: number;
    /** 逐词对齐或关键词覆盖明细，按 JSON 落库。 */
    wordFeedback: ShadowingWordFeedback[] | RetellKeywordFeedback[];
}

/**
 * 练习记录查询。
 */
export interface ListPracticeAttemptsQuery {
    /** 最多返回多少条。 */
    limit: number;
    /** 只看某一种模式。 */
    mode?: PracticeMode;
}

/**
 * 一段时间内的练习次数。
 *
 * 听写与复述的分数语义不同（词准确率 / 关键词覆盖），因此不跨模式求平均。
 */
export interface PracticeAttemptStats {
    /** 记录条数。 */
    count: number;
}

/**
 * 某一天的练习次数，日期按本机时区切分。
 */
export interface PracticeDailyCount {
    /** 本地日期，格式 `YYYY-MM-DD`。 */
    day: string;
    /** 当天记录条数。 */
    count: number;
}

/**
 * 练习记录持久化端口。
 */
export default interface PracticeAttemptRepository {
    /**
     * 保存一条练习记录。
     * @param params 练习内容与得分。
     * @returns 落库后的记录摘要。
     */
    create(params: CreatePracticeAttemptParams): Promise<PracticeAttemptSummary>;

    /**
     * 按时间倒序列出练习记录。
     * @param query 条数与可选模式过滤。
     * @returns 记录摘要列表。
     */
    list(query: ListPracticeAttemptsQuery): Promise<PracticeAttemptSummary[]>;

    /**
     * 按 ID 查询一条练习记录，供复习判定读取真实得分。
     * @param id 记录 ID。
     * @returns 记录摘要；不存在时返回 null。
     */
    findById(id: number): Promise<PracticeAttemptSummary | null>;

    /**
     * 读取一条练习记录的逐词反馈，供复习判定生成错误标签。
     * @param id 记录 ID。
     * @returns 逐词反馈；记录不存在或内容损坏时为空数组。
     */
    findWordFeedback(id: number): Promise<ShadowingWordFeedback[]>;

    /**
     * 统计某个时间点之后的练习次数。
     * @param sinceMs 起始时间，epoch 毫秒（含）。
     * @returns 记录条数。
     */
    summarySince(sinceMs: number): Promise<PracticeAttemptStats>;

    /**
     * 按本机时区把练习记录聚合为每日次数。
     * @param sinceMs 起始时间，epoch 毫秒（含）。
     * @returns 从早到晚排列的每日次数；没有记录的日期不会出现。
     */
    dailyCountsSince(sinceMs: number): Promise<PracticeDailyCount[]>;
}
