import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 场景对话会话。
 *
 * 一行对应一次从视频台词出发的角色扮演：场景卡与复盘都以 JSON 保存，
 * 视频句字段让整段对话能回溯到具体台词；聊天流本身仍由 main 进程内存会话承载。
 */
export const dialogueSession = sqliteTable('dp_dialogue_session', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    chat_session_id: text('chat_session_id').notNull(),
    video_key: text('video_key'),
    sentence_index: integer('sentence_index', { mode: 'number' }),
    video_path: text('video_path'),
    subtitle_path: text('subtitle_path'),
    anchor_text: text('anchor_text').notNull(),
    title: text('title').notNull(),
    scene_json: text('scene_json').notNull(),
    /** 剧本起止字幕句序号；旧版按锚点句生成的对话为空。 */
    clip_start: integer('clip_start', { mode: 'number' }),
    clip_end: integer('clip_end', { mode: 'number' }),
    /** 说话人显示名，学习者可改；为空时界面回落到「说话人 A/B」。 */
    role_a_name: text('role_a_name'),
    role_b_name: text('role_b_name'),
    /** 学习者扮演哪一方：a / b。 */
    learner_role: text('learner_role'),
    /** 完整剧本 JSON（台词行 + 角色名 + 扮演方）。 */
    script_json: text('script_json'),
    difficulty: text('difficulty').notNull(),
    /** 场景生成模式：video（跟随视频剧情）/ custom（自编主题）。 */
    mode: text('mode').notNull().default('video'),
    backend: text('backend').notNull(),
    status: text('status').notNull(),
    review_json: text('review_json'),
    created_at: integer('created_at', { mode: 'number' }).notNull(),
    finished_at: integer('finished_at', { mode: 'number' }),
}, (table) => ({
    createdAtIdx: index('dp_dialogue_session_created_at_idx').on(table.created_at),
    chatSessionIdIdx: index('dp_dialogue_session_chat_session_id_idx').on(table.chat_session_id),
}));

/** 对话会话查询行类型。 */
export type DialogueSessionRow = typeof dialogueSession.$inferSelect;

/** 对话会话插入行类型。 */
export type InsertDialogueSessionRow = typeof dialogueSession.$inferInsert;
