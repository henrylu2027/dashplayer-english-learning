import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * 间隔复习卡片。
 *
 * `card_key` 是可复习对象的稳定身份：视频句为 `video:<字幕哈希>:<句序号>`，
 * 自由文本为归一化文本的哈希，保证同一句只生成一张卡。复习本身仍以跟读记录为准，
 * 卡片只保存调度状态和最近一次结果。
 */
export const srsCard = sqliteTable('dp_srs_card', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    card_key: text('card_key').notNull(),
    source_kind: text('source_kind').notNull(),
    video_key: text('video_key'),
    sentence_index: integer('sentence_index', { mode: 'number' }),
    video_path: text('video_path'),
    subtitle_path: text('subtitle_path'),
    reference_text: text('reference_text').notNull(),
    stage: integer('stage', { mode: 'number' }).notNull().default(0),
    due_at: integer('due_at', { mode: 'number' }).notNull(),
    last_score: integer('last_score', { mode: 'number' }),
    last_attempt_id: integer('last_attempt_id', { mode: 'number' }),
    review_count: integer('review_count', { mode: 'number' }).notNull().default(0),
    pass_count: integer('pass_count', { mode: 'number' }).notNull().default(0),
    created_at: integer('created_at', { mode: 'number' }).notNull(),
    updated_at: integer('updated_at', { mode: 'number' }).notNull(),
}, (table) => ({
    cardKeyUniqueIdx: uniqueIndex('dp_srs_card_key_unique').on(table.card_key),
    dueAtIdx: index('dp_srs_card_due_at_idx').on(table.due_at),
}));

/** 复习卡片查询行类型。 */
export type SrsCardRow = typeof srsCard.$inferSelect;

/** 复习卡片插入行类型。 */
export type InsertSrsCardRow = typeof srsCard.$inferInsert;
