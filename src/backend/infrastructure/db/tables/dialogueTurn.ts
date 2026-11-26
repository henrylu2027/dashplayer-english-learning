import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 场景对话回合。
 *
 * 按完成顺序增量落库：用户消息发送时、助手消息结束时各追加一条，
 * 应用中途关闭也不会丢掉已经发生的对话。card_id 预留给后续把回合与复习卡片关联，
 * 当前版本复盘里的好句直接进复习队列，不在这里写卡片 ID。
 */
export const dialogueTurn = sqliteTable('dp_dialogue_turn', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    session_id: integer('session_id', { mode: 'number' }).notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    card_id: integer('card_id', { mode: 'number' }),
    /** 逐句纠错 JSON；未请求或助手的发言为空。 */
    correction_json: text('correction_json'),
    created_at: integer('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
    sessionIdx: index('dp_dialogue_turn_session_idx').on(table.session_id, table.created_at),
}));

/** 对话回合查询行类型。 */
export type DialogueTurnRow = typeof dialogueTurn.$inferSelect;

/** 对话回合插入行类型。 */
export type InsertDialogueTurnRow = typeof dialogueTurn.$inferInsert;
