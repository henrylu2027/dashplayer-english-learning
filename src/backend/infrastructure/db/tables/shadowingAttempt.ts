import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 持久化每次跟读评测。
 *
 * `video_key + sentence_index` 是可学习对象的稳定身份：复习、统计和对话都按这个键
 * 回溯到视频句子；自由输入没有视频来源，二者均为 null。逐词反馈以 JSON 保存，
 * 复习时可以还原当时读错/漏读的具体位置。
 */
export const shadowingAttempt = sqliteTable('dp_shadowing_attempt', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    source_kind: text('source_kind').notNull(),
    video_key: text('video_key'),
    sentence_index: integer('sentence_index', { mode: 'number' }),
    video_path: text('video_path'),
    subtitle_path: text('subtitle_path'),
    reference_text: text('reference_text').notNull(),
    recognized_text: text('recognized_text').notNull(),
    score: integer('score', { mode: 'number' }).notNull(),
    accuracy: integer('accuracy', { mode: 'number' }).notNull(),
    completeness: integer('completeness', { mode: 'number' }).notNull(),
    words_per_minute: integer('words_per_minute', { mode: 'number' }).notNull(),
    duration_sec: real('duration_sec').notNull(),
    word_feedback: text('word_feedback').notNull(),
    created_at: integer('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
    createdAtIdx: index('dp_shadowing_attempt_created_at_idx').on(table.created_at),
    videoSentenceIdx: index('dp_shadowing_attempt_video_sentence_idx')
        .on(table.video_key, table.sentence_index, table.created_at),
}));

/** 跟读记录查询行类型。 */
export type ShadowingAttemptRow = typeof shadowingAttempt.$inferSelect;

/** 跟读记录插入行类型。 */
export type InsertShadowingAttemptRow = typeof shadowingAttempt.$inferInsert;
