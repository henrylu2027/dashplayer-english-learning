import type {
    ShadowingAttemptSource,
    ShadowingSourceKind,
    ShadowingWordFeedback,
} from '@/common/contracts/shadowing';

/**
 * 精听练习契约：听写与复述。
 *
 * 两种模式都以“视频句/自由文本”为学习单元：听写校对用户键盘输入，
 * 复述只要求覆盖关键信息，不强制逐字一致。结果与跟读记录分开保存，
 * 但加入复习时仍回到同一套 SRS 卡片。
 */

/**
 * 练习模式。
 */
export type PracticeMode = 'dictation' | 'retell';

/**
 * 一条练习记录摘要。
 */
export interface PracticeAttemptSummary {
    /** 记录 ID。 */
    id: number;
    /** 练习模式。 */
    mode: PracticeMode;
    /** 参考文本。 */
    referenceText: string;
    /** 用户输出：听写为键盘输入，复述为识别文本。 */
    userText: string;
    /** 得分：听写为词准确率，复述为关键词覆盖率，0~100。 */
    score: number;
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
 * 听写请求。
 */
export interface DictationRequest {
    /** 参考文本。 */
    referenceText: string;
    /** 用户键入的文本。 */
    typedText: string;
    /** 句子来源。 */
    source: ShadowingAttemptSource;
}

/**
 * 听写校对结果。
 */
export interface DictationResult {
    /** 已保存的练习记录。 */
    attempt: PracticeAttemptSummary;
    /** 逐词对齐反馈。 */
    words: ShadowingWordFeedback[];
    /** 参考词数。 */
    referenceWordCount: number;
    /** 拼写完全正确的词数。 */
    correctWordCount: number;
    /** 词准确率，0~100。 */
    accuracy: number;
    /** 本地模型给出的语法分，0~100；模型不可用时为 null。 */
    grammarScore: number | null;
    /** 发音分，0~100；听写没有录音，固定为 null。 */
    pronunciationScore: number | null;
    /** 与参考句的相似度，0~100；模型不可用时为 null。 */
    similarityScore: number | null;
    /** 语句层面的问题，形如「时态：过去时写成了现在时」；模型不可用时为空数组。 */
    grammarIssues: string[];
    /** 模型挑出的值得记的生词/句型；模型不可用时为空数组。 */
    vocab: string[];
    /** 模型的一句点评；模型不可用时为 null。 */
    graderNote: string | null;
    /** 评分失败原因；成功时为 null。 */
    graderError: string | null;
}

/**
 * 复述请求。
 */
export interface RetellRequest {
    /** 参考文本。 */
    referenceText: string;
    /** 句子来源。 */
    source: ShadowingAttemptSource;
    /** 渲染进程录制的原始音频字节。 */
    audio: Uint8Array;
    /** 录音 MIME 类型。 */
    mimeType: string;
}

/**
 * 一个关键词的覆盖情况。
 */
export interface RetellKeywordFeedback {
    /** 归一化后的关键词。 */
    word: string;
    /** 本次复述是否说到了这个词。 */
    covered: boolean;
}

/**
 * 复述结果。
 */
export interface RetellResult {
    /** 已保存的练习记录。 */
    attempt: PracticeAttemptSummary;
    /** 参考文本。 */
    referenceText: string;
    /** 识别文本。 */
    recognizedText: string;
    /** 关键词覆盖明细。 */
    keywords: RetellKeywordFeedback[];
    /** 关键词覆盖率，0~100。 */
    coverage: number;
    /** 参考句与识别文本的逐词对齐结果，用于错词/漏词/多余词着色。 */
    words: ShadowingWordFeedback[];
    /** 本地模型给出的语法分，0~100；模型不可用时为 null。 */
    grammarScore: number | null;
    /** 本地模型给出的发音分，0~100；模型不可用时为 null。 */
    pronunciationScore: number | null;
    /** 与参考句的相似度，0~100；模型不可用时为 null。 */
    similarityScore: number | null;
    /** 语句层面的问题，形如「时态：过去时写成了现在时」；模型不可用时为空数组。 */
    grammarIssues: string[];
    /** 模型挑出的值得记的生词/句型；模型不可用时为空数组。 */
    vocab: string[];
    /** 模型的一句点评；模型不可用时为 null。 */
    graderNote: string | null;
    /** 评分失败原因；成功时为 null。 */
    graderError: string | null;
}

/**
 * 练习记录查询。
 */
export interface PracticeAttemptQuery {
    /** 最多返回多少条，范围 1~50。 */
    limit?: number;
    /** 只看某一种模式。 */
    mode?: PracticeMode;
}
