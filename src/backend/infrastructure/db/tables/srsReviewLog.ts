import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 间隔复习日志。
 *
 * 每次用户点下掌握度判定后写一条，记录当时的形态、机器分与用户判定；
 * 卡片表只保存最新状态，历史回溯与「本次会话」统计都从这里读。
 */
export const srsReviewLog = sqliteTable('dp_srs_review_log', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    /** 复习卡片 ID。 */
    card_id: integer('card_id', { mode: 'number' }).notNull(),
    /** 本次复习形态：shadowing / dictation / recall / vocab。 */
    form: text('form').notNull(),
    /** 机器分；认词与词汇卡没有机器分时为 null。 */
    score: integer('score', { mode: 'number' }),
    /** 机器分是否达到通过线；无机器分时为 null。 */
    passed: integer('passed', { mode: 'number' }),
    /** 用户判定：forgot / fuzzy / known。 */
    verdict: text('verdict').notNull(),
    /** 本次错误标签，逗号分隔；P0 先留空。 */
    error_tags: text('error_tags').notNull().default(''),
    /** 判定时间，epoch 毫秒。 */
    created_at: integer('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
    cardIdx: index('dp_srs_review_log_card_idx').on(table.card_id, table.created_at),
    createdIdx: index('dp_srs_review_log_created_idx').on(table.created_at),
}));

/** 复习日志查询行类型。 */
export type SrsReviewLogRow = typeof srsReviewLog.$inferSelect;

/** 复习日志插入行类型。 */
export type InsertSrsReviewLogRow = typeof srsReviewLog.$inferInsert;
