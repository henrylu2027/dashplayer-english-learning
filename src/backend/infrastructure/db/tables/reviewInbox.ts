import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * 复习入池待办队列。
 *
 * 每日新卡有上限；超出的条目先放这里，按优先级排队，
 * 等后续日期腾出额度时再转成正式复习卡，避免一天灌进来几百条。
 */
export const reviewInbox = sqliteTable('dp_review_inbox', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    card_key: text('card_key').notNull(),
    reference_text: text('reference_text').notNull(),
    source_kind: text('source_kind').notNull(),
    video_key: text('video_key'),
    sentence_index: integer('sentence_index', { mode: 'number' }),
    video_path: text('video_path'),
    subtitle_path: text('subtitle_path'),
    word: text('word'),
    source_modules: text('source_modules').notNull().default(''),
    priority: integer('priority', { mode: 'number' }).notNull().default(2),
    created_at: integer('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
    cardKeyUniqueIdx: uniqueIndex('dp_review_inbox_key_unique').on(table.card_key),
    priorityIdx: index('dp_review_inbox_priority_idx').on(table.priority, table.created_at),
}));

/** 入池队列行类型。 */
export type ReviewInboxRow = typeof reviewInbox.$inferSelect;

/** 入池队列插入行类型。 */
export type InsertReviewInboxRow = typeof reviewInbox.$inferInsert;
