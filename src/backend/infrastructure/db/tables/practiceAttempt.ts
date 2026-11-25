import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 精听练习记录（听写 / 复述）。
 *
 * 与跟读记录分表保存：听写没有音频、复述评分是关键词覆盖，二者与跟读的
 * 音频时长、语速等字段语义不同，混在一张表里会让统计失真。
 * `word_feedback` 存 JSON：听写是逐词对齐，复述是关键词覆盖明细。
 */
export const practiceAttempt = sqliteTable('dp_practice_attempt', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    mode: text('mode').notNull(),
    source_kind: text('source_kind').notNull(),
    video_key: text('video_key'),
    sentence_index: integer('sentence_index', { mode: 'number' }),
    video_path: text('video_path'),
    subtitle_path: text('subtitle_path'),
    reference_text: text('reference_text').notNull(),
    user_text: text('user_text').notNull(),
    score: integer('score', { mode: 'number' }).notNull(),
    word_feedback: text('word_feedback').notNull(),
    created_at: integer('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
    createdAtIdx: index('dp_practice_attempt_created_at_idx').on(table.created_at),
    modeCreatedAtIdx: index('dp_practice_attempt_mode_created_at_idx').on(table.mode, table.created_at),
}));

/** 练习记录查询行类型。 */
export type PracticeAttemptRow = typeof practiceAttempt.$inferSelect;

/** 练习记录插入行类型。 */
export type InsertPracticeAttemptRow = typeof practiceAttempt.$inferInsert;
