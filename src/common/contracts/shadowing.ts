/**
 * 跟读打分功能契约类型。
 *
 * 评测完全在本地完成：录音经 ffmpeg 转码后走现有语音识别引擎，
 * 再把识别文本与参考文本做逐词对齐，不依赖任何云端服务。
 */

/**
 * 一个词的评测状态。
 *
 * - `correct`：读对；
 * - `mispronounced`：该位置读成了别的词；
 * - `missing`：参考文本里有、但没有读到；
 * - `extra`：参考文本里没有、但多读了。
 */
export type ShadowingWordStatus = 'correct' | 'mispronounced' | 'missing' | 'extra';

/**
 * 逐词对齐结果中的一项。
 */
export interface ShadowingWordFeedback {
    /** 参考文本中的词，保留用户输入的原始大小写；额外词没有该字段。 */
    expected?: string;
    /** 识别出的词，保留识别原文；漏读词没有该字段。 */
    actual?: string;
    /** 该词的评测状态。 */
    status: ShadowingWordStatus;
}

/**
 * 一次跟读评测的结果。
 */
export interface ShadowingScoreVO {
    /** 识别出的完整文本。 */
    recognizedText: string;
    /** 逐词对齐结果，按参考文本顺序排列；额外词插在其被读出的位置。 */
    words: ShadowingWordFeedback[];
    /** 参考词数。 */
    referenceWordCount: number;
    /** 完全读对的词数。 */
    correctWordCount: number;
    /** 综合得分，范围 0~100。 */
    score: number;
    /** 准确度，范围 0~100：读对的词占参考词的比例。 */
    accuracy: number;
    /** 完整度，范围 0~100：至少开口读到的参考词占比（读错也算读到）。 */
    completeness: number;
    /** 语速，单位词/分钟；按识别出的词数除以录音时长计算。 */
    wordsPerMinute: number;
    /** 参与评测的录音时长，单位秒。 */
    durationSec: number;
}

/**
 * 跟读句子来源类型。
 *
 * - `free`：用户手输或选择示例句；
 * - `video`：取自带字幕的视频句子，绑定 `videoKey + sentenceIndex`，供复习与统计回溯。
 */
export type ShadowingSourceKind = 'free' | 'video';

/**
 * 一次跟读的句子来源。
 */
export interface ShadowingAttemptSource {
    /** 来源类型。 */
    kind: ShadowingSourceKind;
    /** 视频字幕内容哈希；仅 `video` 来源存在。 */
    videoKey?: string;
    /** 字幕句序号；仅 `video` 来源存在。 */
    sentenceIndex?: number;
    /** 取句时正在播放的视频绝对路径，供以后回放原声。 */
    videoPath?: string;
    /** 取句时绑定的字幕文件绝对路径，供以后回放原声。 */
    subtitlePath?: string;
}

/**
 * 一条已保存的跟读记录摘要。
 *
 * 只包含列表和统计需要的字段；逐词反馈留在数据库里，供后续复习页按需读取。
 */
export interface ShadowingAttemptSummary {
    /** 记录 ID。 */
    id: number;
    /** 本次跟读的参考文本。 */
    referenceText: string;
    /** 综合得分，范围 0~100。 */
    score: number;
    /** 准确度，范围 0~100。 */
    accuracy: number;
    /** 完整度，范围 0~100。 */
    completeness: number;
    /** 来源类型。 */
    sourceKind: ShadowingSourceKind;
    /** 视频字幕内容哈希；自由输入时为 null。 */
    videoKey: string | null;
    /** 字幕句序号；自由输入时为 null。 */
    sentenceIndex: number | null;
    /** 记录时间，epoch 毫秒。 */
    createdAt: number;
}

/**
 * 跟读评分接口的返回：评分结果 + 已落库的记录摘要。
 */
export interface ShadowingScoreResponse {
    /** 本次逐词评测结果。 */
    result: ShadowingScoreVO;
    /** 已保存的跟读记录。 */
    attempt: ShadowingAttemptSummary;
}

/**
 * 跟读记录查询参数。
 */
export interface ShadowingAttemptQuery {
    /** 最多返回多少条，范围 1~50。 */
    limit?: number;
    /** 只查某个视频字幕下的记录。 */
    videoKey?: string;
    /** 只查某个字幕句的记录；通常与 videoKey 一起使用。 */
    sentenceIndex?: number;
}

/**
 * 跟读评测请求。
 */
export interface ShadowingScoreRequest {
    /** 用户要跟读的参考文本。 */
    referenceText: string;
    /** 渲染进程录制的原始音频字节。 */
    audio: Uint8Array;
    /** 录音的 MIME 类型，用于决定临时文件扩展名。 */
    mimeType: string;
    /** 本次跟读的句子来源；每次评分都会落库一条记录。 */
    source: ShadowingAttemptSource;
}
