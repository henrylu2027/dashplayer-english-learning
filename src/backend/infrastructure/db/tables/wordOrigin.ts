import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * 生词出处。
 *
 * 一个词可以有多个出处：在哪一句字幕、哪段对话里被收藏的。
 * 出处不只是展示信息——「学会了」要用它把这句语境做成复习卡的载体，
 * 所以必须在收藏那一刻写入，事后无法从词表反推。
 */
export const wordOrigin = sqliteTable('dp_word_origin', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 词条原形（小写），与 dp_words.word 对应。 */
    word: text('word').notNull(),
    /** 收藏来源模块（player/original/practice/dialogue）。 */
    module: text('module').notNull(),
    /** 收藏时所在的句子原文。 */
    sentence: text('sentence').notNull(),
    /** 句子的稳定键，与复习卡同一套算法；用于同词同句去重。 */
    sentence_key: text('sentence_key').notNull(),
    /** 视频字幕内容哈希；自由文本为 null。 */
    video_key: text('video_key'),
    /** 字幕句序号；自由文本为 null。 */
    sentence_index: integer('sentence_index', { mode: 'number' }),
    /** 视频绝对路径，供以后回放原声。 */
    video_path: text('video_path'),
    /** 字幕绝对路径，供以后回放原声。 */
    subtitle_path: text('subtitle_path'),
    /** 收藏时间，epoch 毫秒。 */
    created_at: integer('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
    wordSentenceUniqueIdx: uniqueIndex('dp_word_origin_word_sentence_unique').on(table.word, table.sentence_key),
    wordIdx: index('dp_word_origin_word_idx').on(table.word),
}));

/** 生词出处查询行类型。 */
export type WordOriginRow = typeof wordOrigin.$inferSelect;

/** 生词出处插入行类型。 */
export type InsertWordOriginRow = typeof wordOrigin.$inferInsert;
