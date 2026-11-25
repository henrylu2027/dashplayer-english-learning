import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { injectable } from 'inversify';

import db from '@/backend/infrastructure/db';
import {
    dialogueSession,
    type DialogueSessionRow,
} from '@/backend/infrastructure/db/tables/dialogueSession';
import {
    dialogueTurn,
    type DialogueTurnRow,
} from '@/backend/infrastructure/db/tables/dialogueTurn';
import {
    DIALOGUE_BACKENDS,
    DIALOGUE_DIFFICULTIES,
    DIALOGUE_ROLES,
    dialogueReviewSchema,
    dialogueSceneSchema,
    type DialogueDifficulty,
    type DialogueModelBackend,
    type DialogueReview,
    type DialogueRole,
    type DialogueScene,
    type DialogueSessionSummary,
    type DialogueTurnVO,
} from '@/common/contracts/dialogue';
import type DialogueRepository from '@/backend/services/repositories/DialogueRepository';
import type {
    AppendDialogueTurnParams,
    CreateDialogueSessionParams,
    DialogueDailyCount,
    DialogueSessionRecord,
    DialogueTurnStats,
} from '@/backend/services/repositories/DialogueRepository';

/**
 * 校验数据库里的难度值；出现未知值时显式报错，避免把损坏数据当默认值。
 * @param value 数据库原始值。
 */
function parseDifficulty(value: string): DialogueDifficulty {
    if (!DIALOGUE_DIFFICULTIES.includes(value as DialogueDifficulty)) {
        throw new Error(`数据库中的对话难度无效: ${value}`);
    }
    return value as DialogueDifficulty;
}

/**
 * 校验数据库里的模型后端值。
 * @param value 数据库原始值。
 */
function parseBackend(value: string): DialogueModelBackend {
    if (!DIALOGUE_BACKENDS.includes(value as DialogueModelBackend)) {
        throw new Error(`数据库中的对话模型后端无效: ${value}`);
    }
    return value as DialogueModelBackend;
}

/**
 * 校验数据库里的回合角色。
 * @param value 数据库原始值。
 */
function parseRole(value: string): DialogueRole {
    if (!DIALOGUE_ROLES.includes(value as DialogueRole)) {
        throw new Error(`数据库中的对话角色无效: ${value}`);
    }
    return value as DialogueRole;
}

/**
 * 解析场景 JSON；结构与契约不符时直接报错。
 * @param json 数据库中的场景字段。
 */
function parseScene(json: string): DialogueScene {
    return dialogueSceneSchema.parse(JSON.parse(json));
}

/**
 * 解析复盘 JSON。
 * @param json 数据库中的复盘字段。
 */
function parseReview(json: string): DialogueReview {
    return dialogueReviewSchema.parse(JSON.parse(json));
}

/**
 * 映射会话行为跨层摘要。
 * @param row 数据库行。
 * @param turnCount 已记录回合数。
 */
function mapSession(row: DialogueSessionRow, turnCount: number): DialogueSessionSummary {
    return {
        id: row.id,
        chatSessionId: row.chat_session_id,
        title: row.title,
        anchorText: row.anchor_text,
        difficulty: parseDifficulty(row.difficulty),
        backend: parseBackend(row.backend),
        turnCount,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
    };
}

/**
 * 映射回合行。
 * @param row 数据库行。
 */
function mapTurn(row: DialogueTurnRow): DialogueTurnVO {
    return {
        id: row.id,
        role: parseRole(row.role),
        content: row.content,
        cardId: row.card_id,
        createdAt: row.created_at,
    };
}

/**
 * 使用 Drizzle 访问场景对话会话与回合表。
 */
@injectable()
export default class DialogueRepositoryImpl implements DialogueRepository {
    public async createSession(params: CreateDialogueSessionParams): Promise<DialogueSessionRecord> {
        const source = params.source;
        const result = db
            .insert(dialogueSession)
            .values({
                chat_session_id: params.chatSessionId,
                video_key: source.videoKey ?? null,
                sentence_index: source.sentenceIndex ?? null,
                video_path: source.videoPath ?? null,
                subtitle_path: source.subtitlePath ?? null,
                anchor_text: params.anchorText,
                title: params.scene.title,
                scene_json: JSON.stringify(params.scene),
                difficulty: params.difficulty,
                backend: params.backend,
                status: 'active',
                review_json: null,
                created_at: Date.now(),
                finished_at: null,
            })
            .run();

        const id = Number(result.lastInsertRowid);
        const row = db
            .select()
            .from(dialogueSession)
            .where(eq(dialogueSession.id, id))
            .get();
        if (!row) {
            throw new Error(`对话会话写入后无法读取: ${id}`);
        }
        return {
            session: mapSession(row, 0),
            scene: params.scene,
            review: null,
        };
    }

    public async getSession(id: number): Promise<DialogueSessionRecord> {
        const row = db
            .select()
            .from(dialogueSession)
            .where(eq(dialogueSession.id, id))
            .get();
        if (!row) {
            throw new Error(`对话会话不存在: ${id}`);
        }
        return {
            session: mapSession(row, this.countTurns(id)),
            scene: parseScene(row.scene_json),
            review: row.review_json ? parseReview(row.review_json) : null,
        };
    }

    public async listSessions(limit: number): Promise<DialogueSessionSummary[]> {
        const rows = db
            .select()
            .from(dialogueSession)
            .orderBy(desc(dialogueSession.created_at), desc(dialogueSession.id))
            .limit(limit)
            .all();
        if (rows.length === 0) {
            return [];
        }
        const counts = db
            .select({
                sessionId: dialogueTurn.session_id,
                value: sql<number>`count(*)`,
            })
            .from(dialogueTurn)
            .groupBy(dialogueTurn.session_id)
            .all();
        const countMap = new Map(counts.map((item) => [item.sessionId, Number(item.value)]));
        return rows.map((row) => mapSession(row, countMap.get(row.id) ?? 0));
    }

    public async appendTurn(params: AppendDialogueTurnParams): Promise<DialogueTurnVO> {
        const result = db
            .insert(dialogueTurn)
            .values({
                session_id: params.sessionId,
                role: params.role,
                content: params.content,
                card_id: params.cardId ?? null,
                created_at: Date.now(),
            })
            .run();
        const id = Number(result.lastInsertRowid);
        const row = db
            .select()
            .from(dialogueTurn)
            .where(eq(dialogueTurn.id, id))
            .get();
        if (!row) {
            throw new Error(`对话回合写入后无法读取: ${id}`);
        }
        return mapTurn(row);
    }

    public async listTurns(sessionId: number): Promise<DialogueTurnVO[]> {
        return db
            .select()
            .from(dialogueTurn)
            .where(eq(dialogueTurn.session_id, sessionId))
            .orderBy(dialogueTurn.created_at, dialogueTurn.id)
            .all()
            .map(mapTurn);
    }

    public async finishSession(id: number, review: DialogueReview): Promise<DialogueSessionRecord> {
        const now = Date.now();
        const updated = db
            .update(dialogueSession)
            .set({
                status: 'finished',
                review_json: JSON.stringify(review),
                finished_at: now,
            })
            .where(eq(dialogueSession.id, id))
            .run();
        if (updated.changes === 0) {
            throw new Error(`对话会话不存在: ${id}`);
        }
        return this.getSession(id);
    }

    public async countUserTurnsSince(sinceMs: number): Promise<DialogueTurnStats> {
        const row = db
            .select({ count: sql<number>`count(*)` })
            .from(dialogueTurn)
            .where(and(eq(dialogueTurn.role, 'user'), gte(dialogueTurn.created_at, sinceMs)))
            .get();
        return { count: Number(row?.count ?? 0) };
    }

    public async dailyUserTurnCountsSince(sinceMs: number): Promise<DialogueDailyCount[]> {
        const dayExpression = sql<string>`strftime('%Y-%m-%d', ${dialogueTurn.created_at} / 1000, 'unixepoch', 'localtime')`;
        const rows = db
            .select({
                day: dayExpression,
                count: sql<number>`count(*)`,
            })
            .from(dialogueTurn)
            .where(and(eq(dialogueTurn.role, 'user'), gte(dialogueTurn.created_at, sinceMs)))
            .groupBy(dayExpression)
            .orderBy(dayExpression)
            .all();
        return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
    }

    /**
     * 统计一个会话的回合数。
     * @param sessionId 对话数据库主键。
     */
    private countTurns(sessionId: number): number {
        const row = db
            .select({ value: sql<number>`count(*)` })
            .from(dialogueTurn)
            .where(eq(dialogueTurn.session_id, sessionId))
            .get();
        return row ? Number(row.value) : 0;
    }
}
