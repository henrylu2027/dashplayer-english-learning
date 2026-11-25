import { desc, eq, gte, sql } from 'drizzle-orm';
import { injectable } from 'inversify';

import db from '@/backend/infrastructure/db';
import { practiceAttempt, type PracticeAttemptRow } from '@/backend/infrastructure/db/tables/practiceAttempt';
import type { PracticeAttemptSummary, PracticeMode } from '@/common/contracts/practice';
import type PracticeAttemptRepository from '@/backend/services/repositories/PracticeAttemptRepository';
import type {
    CreatePracticeAttemptParams,
    ListPracticeAttemptsQuery,
    PracticeAttemptStats,
    PracticeDailyCount,
} from '@/backend/services/repositories/PracticeAttemptRepository';

/** 合法的练习模式；读取时据此拒绝损坏数据。 */
const PRACTICE_MODES: readonly PracticeMode[] = ['dictation', 'retell'];

/**
 * 把数据库行映射为跨层练习记录摘要。
 */
function mapRow(row: PracticeAttemptRow): PracticeAttemptSummary {
    if (!PRACTICE_MODES.includes(row.mode as PracticeMode)) {
        throw new Error(`数据库中的练习模式无效: ${row.mode}`);
    }
    return {
        id: row.id,
        mode: row.mode as PracticeMode,
        referenceText: row.reference_text,
        userText: row.user_text,
        score: row.score,
        sourceKind: row.source_kind as PracticeAttemptSummary['sourceKind'],
        videoKey: row.video_key,
        sentenceIndex: row.sentence_index,
        createdAt: row.created_at,
    };
}

/**
 * 使用 Drizzle 访问练习记录表。
 */
@injectable()
export default class PracticeAttemptRepositoryImpl implements PracticeAttemptRepository {
    public async create(params: CreatePracticeAttemptParams): Promise<PracticeAttemptSummary> {
        const result = db
            .insert(practiceAttempt)
            .values({
                mode: params.mode,
                source_kind: params.source.kind,
                video_key: params.source.videoKey ?? null,
                sentence_index: params.source.sentenceIndex ?? null,
                video_path: params.source.videoPath ?? null,
                subtitle_path: params.source.subtitlePath ?? null,
                reference_text: params.referenceText,
                user_text: params.userText,
                score: params.score,
                word_feedback: JSON.stringify(params.wordFeedback),
                created_at: Date.now(),
            })
            .run();

        const id = Number(result.lastInsertRowid);
        const row = db
            .select()
            .from(practiceAttempt)
            .where(eq(practiceAttempt.id, id))
            .get();
        if (!row) {
            throw new Error(`练习记录写入后无法读取: ${id}`);
        }
        return mapRow(row);
    }

    public async list(query: ListPracticeAttemptsQuery): Promise<PracticeAttemptSummary[]> {
        const rows = db
            .select()
            .from(practiceAttempt)
            .where(query.mode ? eq(practiceAttempt.mode, query.mode) : undefined)
            .orderBy(desc(practiceAttempt.created_at), desc(practiceAttempt.id))
            .limit(query.limit)
            .all();
        return rows.map(mapRow);
    }

    public async summarySince(sinceMs: number): Promise<PracticeAttemptStats> {
        const row = db
            .select({ count: sql<number>`count(*)` })
            .from(practiceAttempt)
            .where(gte(practiceAttempt.created_at, sinceMs))
            .get();
        return { count: Number(row?.count ?? 0) };
    }

    public async dailyCountsSince(sinceMs: number): Promise<PracticeDailyCount[]> {
        // 与跟读统计一致：按本机时区切日，避免深夜记录被算到前一天
        const dayExpression = sql<string>`strftime('%Y-%m-%d', ${practiceAttempt.created_at} / 1000, 'unixepoch', 'localtime')`;
        const rows = db
            .select({
                day: dayExpression,
                count: sql<number>`count(*)`,
            })
            .from(practiceAttempt)
            .where(gte(practiceAttempt.created_at, sinceMs))
            .groupBy(dayExpression)
            .orderBy(dayExpression)
            .all();
        return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
    }
}
