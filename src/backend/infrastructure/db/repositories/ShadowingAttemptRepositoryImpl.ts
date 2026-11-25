import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { injectable } from 'inversify';

import db from '@/backend/infrastructure/db';
import {
    shadowingAttempt,
    type ShadowingAttemptRow,
} from '@/backend/infrastructure/db/tables/shadowingAttempt';
import type {
    ShadowingAttemptSummary,
    ShadowingSourceKind,
    ShadowingWordFeedback,
} from '@/common/contracts/shadowing';
import type ShadowingAttemptRepository from '@/backend/services/repositories/ShadowingAttemptRepository';
import type {
    CreateShadowingAttemptParams,
    ListShadowingAttemptsQuery,
    ShadowingAttemptDetail,
    ShadowingAttemptStats,
    ShadowingDailyCount,
} from '@/backend/services/repositories/ShadowingAttemptRepository';

/** 合法的来源类型；读取时据此拒绝损坏数据。 */
const SOURCE_KINDS: readonly ShadowingSourceKind[] = ['free', 'video'];

/**
 * 把数据库行映射为跨层记录摘要。
 *
 * 来源类型非法时直接抛错，避免把损坏数据当作自由输入悄悄展示。
 */
function mapRow(row: ShadowingAttemptRow): ShadowingAttemptSummary {
    if (!SOURCE_KINDS.includes(row.source_kind as ShadowingSourceKind)) {
        throw new Error(`数据库中的跟读来源类型无效: ${row.source_kind}`);
    }
    return {
        id: row.id,
        referenceText: row.reference_text,
        score: row.score,
        accuracy: row.accuracy,
        completeness: row.completeness,
        sourceKind: row.source_kind as ShadowingSourceKind,
        videoKey: row.video_key,
        sentenceIndex: row.sentence_index,
        createdAt: row.created_at,
    };
}

/**
 * 把数据库行映射为完整记录；逐词反馈按 JSON 解析，损坏时直接抛错。
 */
function mapDetail(row: ShadowingAttemptRow): ShadowingAttemptDetail {
    const wordFeedback = JSON.parse(row.word_feedback) as ShadowingWordFeedback[];
    if (!Array.isArray(wordFeedback)) {
        throw new Error(`跟读记录的逐词反馈格式无效: ${row.id}`);
    }
    return {
        ...mapRow(row),
        videoPath: row.video_path,
        subtitlePath: row.subtitle_path,
        recognizedText: row.recognized_text,
        wordFeedback,
    };
}

/**
 * 使用 Drizzle 访问跟读记录表。
 */
@injectable()
export default class ShadowingAttemptRepositoryImpl implements ShadowingAttemptRepository {
    public async create(params: CreateShadowingAttemptParams): Promise<ShadowingAttemptSummary> {
        const result = db
            .insert(shadowingAttempt)
            .values({
                source_kind: params.source.kind,
                video_key: params.source.videoKey ?? null,
                sentence_index: params.source.sentenceIndex ?? null,
                video_path: params.source.videoPath ?? null,
                subtitle_path: params.source.subtitlePath ?? null,
                reference_text: params.referenceText,
                recognized_text: params.recognizedText,
                score: params.score,
                accuracy: params.accuracy,
                completeness: params.completeness,
                words_per_minute: params.wordsPerMinute,
                duration_sec: params.durationSec,
                word_feedback: JSON.stringify(params.wordFeedback),
                created_at: Date.now(),
            })
            .run();

        const id = Number(result.lastInsertRowid);
        const row = db
            .select()
            .from(shadowingAttempt)
            .where(eq(shadowingAttempt.id, id))
            .get();
        if (!row) {
            throw new Error(`跟读记录写入后无法读取: ${id}`);
        }
        return mapRow(row);
    }

    public async list(query: ListShadowingAttemptsQuery): Promise<ShadowingAttemptSummary[]> {
        const conditions = [];
        if (query.videoKey !== undefined) {
            conditions.push(eq(shadowingAttempt.video_key, query.videoKey));
        }
        if (query.sentenceIndex !== undefined) {
            conditions.push(eq(shadowingAttempt.sentence_index, query.sentenceIndex));
        }

        const rows = db
            .select()
            .from(shadowingAttempt)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(shadowingAttempt.created_at), desc(shadowingAttempt.id))
            .limit(query.limit)
            .all();
        return rows.map(mapRow);
    }

    public async findById(id: number): Promise<ShadowingAttemptDetail | null> {
        const row = db
            .select()
            .from(shadowingAttempt)
            .where(eq(shadowingAttempt.id, id))
            .get();
        return row ? mapDetail(row) : null;
    }

    public async summarySince(sinceMs: number): Promise<ShadowingAttemptStats> {
        const row = db
            .select({
                count: sql<number>`count(*)`,
                averageScore: sql<number | null>`avg(${shadowingAttempt.score})`,
            })
            .from(shadowingAttempt)
            .where(gte(shadowingAttempt.created_at, sinceMs))
            .get();
        const averageScore = row?.averageScore;
        return {
            count: Number(row?.count ?? 0),
            averageScore: averageScore === null || averageScore === undefined ? null : Number(averageScore),
        };
    }

    public async dailyCountsSince(sinceMs: number): Promise<ShadowingDailyCount[]> {
        // 按本机时区切日：unixepoch 还原秒，localtime 转本地日历日，避免跨时区把深夜算到前一天
        const dayExpression = sql<string>`strftime('%Y-%m-%d', ${shadowingAttempt.created_at} / 1000, 'unixepoch', 'localtime')`;
        const rows = db
            .select({
                day: dayExpression,
                count: sql<number>`count(*)`,
            })
            .from(shadowingAttempt)
            .where(gte(shadowingAttempt.created_at, sinceMs))
            .groupBy(dayExpression)
            .orderBy(dayExpression)
            .all();
        return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
    }
}
