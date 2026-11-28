import type { WordOrigin } from '@/common/contracts/vocabulary';

/**
 * 写入一条出处所需字段。
 */
export interface AddWordOriginParams {
    /** 词条原形（小写）。 */
    word: string;
    /** 收藏来源模块。 */
    module: string;
    /** 句子原文。 */
    sentence: string;
    /** 句子稳定键，与复习卡同一套算法。 */
    sentenceKey: string;
    /** 视频字幕哈希。 */
    videoKey?: string;
    /** 字幕句序号。 */
    sentenceIndex?: number;
    /** 视频绝对路径。 */
    videoPath?: string;
    /** 字幕绝对路径。 */
    subtitlePath?: string;
    /** 收藏时间，epoch 毫秒。 */
    createdAt: number;
}

/**
 * 生词出处的仓储契约。
 */
export default interface WordOriginRepository {
    /**
     * 记录一条出处；同一词同句只保留一条。
     *
     * @param params 出处字段。
     */
    add(params: AddWordOriginParams): Promise<void>;

    /**
     * 取一个词最适合做语境卡的出处：优先视频句，其次最新一条。
     *
     * @param word 词条原形。
     * @returns 出处；没有时返回 null。
     */
    findPreferred(word: string): Promise<WordOrigin | null>;

    /**
     * 取每个词最新的一条出处，供词汇工坊列表展示。
     *
     * @returns 词到出处的映射。
     */
    listLatestByWord(): Promise<Map<string, WordOrigin>>;

    /**
     * 删除一个词的全部出处；词条被删除时调用。
     *
     * @param word 词条原形。
     */
    deleteByWord(word: string): Promise<void>;

    /**
     * 单词改名时同步迁移出处。
     *
     * @param oldWord 旧词条原形。
     * @param newWord 新词条原形。
     */
    renameWord(oldWord: string, newWord: string): Promise<void>;
}
