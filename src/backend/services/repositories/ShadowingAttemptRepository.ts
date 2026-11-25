import type {
    ShadowingAttemptSource,
    ShadowingAttemptSummary,
    ShadowingWordFeedback,
} from '@/common/contracts/shadowing';

/**
 * 新建一条跟读记录的输入。
 */
export interface CreateShadowingAttemptParams {
    /** 句子来源；视频来源必须带 videoKey 与 sentenceIndex。 */
    source: ShadowingAttemptSource;
    /** 参考文本。 */
    referenceText: string;
    /** 识别文本。 */
    recognizedText: string;
    /** 综合得分，0~100。 */
    score: number;
    /** 准确度，0~100。 */
    accuracy: number;
    /** 完整度，0~100。 */
    completeness: number;
    /** 语速，词/分钟。 */
    wordsPerMinute: number;
    /** 录音时长，秒。 */
    durationSec: number;
    /** 逐词对齐反馈，按 JSON 原样落库。 */
    wordFeedback: ShadowingWordFeedback[];
}

/**
 * 跟读记录查询；`limit` 必填，其余条件为可选的精确过滤。
 */
export interface ListShadowingAttemptsQuery {
    /** 最多返回多少条。 */
    limit: number;
    /** 只查某个视频字幕下的记录。 */
    videoKey?: string;
    /** 只查某个字幕句的记录。 */
    sentenceIndex?: number;
}

/**
 * 一段时间内的跟读统计。
 */
export interface ShadowingAttemptStats {
    /** 记录条数。 */
    count: number;
    /** 平均综合分；没有记录时为 null。 */
    averageScore: number | null;
}

/**
 * 某一天的跟读次数，日期按本机时区切分。
 */
export interface ShadowingDailyCount {
    /** 本地日期，格式 `YYYY-MM-DD`。 */
    day: string;
    /** 当天记录条数。 */
    count: number;
}

/**
 * 单条跟读记录的完整内容。
 *
 * 比摘要多出识别文本、逐词反馈和回放路径，供复习判定与以后还原错词。
 */
export interface ShadowingAttemptDetail extends ShadowingAttemptSummary {
    /** 取句时的视频绝对路径；自由输入为 null。 */
    videoPath: string | null;
    /** 取句时的字幕绝对路径；自由输入为 null。 */
    subtitlePath: string | null;
    /** 识别文本。 */
    recognizedText: string;
    /** 逐词对齐反馈。 */
    wordFeedback: ShadowingWordFeedback[];
}

/**
 * 跟读记录持久化端口。
 */
export default interface ShadowingAttemptRepository {
    /**
     * 保存一次跟读评测。
     * @param params 来源、评分数值与逐词反馈。
     * @returns 落库后的记录摘要。
     */
    create(params: CreateShadowingAttemptParams): Promise<ShadowingAttemptSummary>;

    /**
     * 按时间倒序列出跟读记录。
     * @param query 条数与可选过滤条件。
     * @returns 记录摘要列表。
     */
    list(query: ListShadowingAttemptsQuery): Promise<ShadowingAttemptSummary[]>;

    /**
     * 按 ID 读取单条记录的完整内容。
     * @param id 跟读记录 ID。
     * @returns 记录详情；不存在时返回 null。
     */
    findById(id: number): Promise<ShadowingAttemptDetail | null>;

    /**
     * 统计某个时间点之后的跟读次数与平均分。
     * @param sinceMs 起始时间，epoch 毫秒（含）。
     * @returns 次数与平均分。
     */
    summarySince(sinceMs: number): Promise<ShadowingAttemptStats>;

    /**
     * 按本机时区把记录聚合为每日次数。
     * @param sinceMs 起始时间，epoch 毫秒（含）。
     * @returns 从早到晚排列的每日次数；没有记录的日期不会出现。
     */
    dailyCountsSince(sinceMs: number): Promise<ShadowingDailyCount[]>;
}
