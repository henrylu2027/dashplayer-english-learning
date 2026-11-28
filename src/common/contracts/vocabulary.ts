import type { SrsSourceModule } from '@/common/contracts/srs';

/**
 * 生词出处契约。
 *
 * 出处必须由收藏方在收藏那一刻提供：句子、模块、以及（视频句才有的）视频与字幕路径。
 * 「学会了」用这句语境生成复习卡；没有出处的词只能用词本身作答。
 */

/**
 * 收藏时提交的出处。
 */
export interface WordOriginInput {
    /** 收藏来源模块。 */
    module: SrsSourceModule;
    /** 收藏时所在的句子原文。 */
    sentence: string;
    /** 视频字幕内容哈希；自由文本不传。 */
    videoKey?: string;
    /** 字幕句序号；自由文本不传。 */
    sentenceIndex?: number;
    /** 视频绝对路径，供以后回放原声。 */
    videoPath?: string;
    /** 字幕绝对路径，供以后回放原声。 */
    subtitlePath?: string;
}

/**
 * 已落库的出处。
 */
export interface WordOrigin extends WordOriginInput {
    /** 收藏时间，epoch 毫秒。 */
    createdAt: number;
}

/**
 * 词汇工坊的一个词条。
 */
export interface VocabularyWordVO {
    id: number;
    word: string;
    translate: string;
    created_at: string;
    updated_at: string;
    /** 学会了的时间，epoch 毫秒；未学会为 null。 */
    learnedAt: number | null;
    /** 最近一条出处；没有出处为 null。 */
    origin: WordOrigin | null;
}

/**
 * 「学会了」的结果。
 */
export interface LearnWordData {
    /** 归一化后的词条原形。 */
    word: string;
    /** 是否使用了出处句作为语境；false 表示只能按词本身建卡。 */
    hasContext: boolean;
    /** 是否因当日上限进入待办队列。 */
    queued: boolean;
    /** 入池后的卡片 ID；排队中或已存在时为对应值，排队中可能为 null。 */
    cardId: number | null;
    /** 是否因没有原声原句被拒绝入池；词本身仍标为已学。 */
    srsRejected: boolean;
}
