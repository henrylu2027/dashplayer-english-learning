import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import { injectable } from 'inversify';

import db from '@/backend/infrastructure/db';
import { srsCard, type SrsCardRow } from '@/backend/infrastructure/db/tables/srsCard';
import { reviewInbox } from '@/backend/infrastructure/db/tables/reviewInbox';
import { srsReviewLog } from '@/backend/infrastructure/db/tables/srsReviewLog';
import type { ShadowingSourceKind } from '@/common/contracts/shadowing';
import type {
    SrsCard,
    SrsErrorTag,
    SrsHistoryDay,
    SrsOverview,
    SrsQueueFilter,
    SrsQueueResponse,
    SrsReviewForm,
    SrsSourceModule,
    SrsVerdict,
} from '@/common/contracts/srs';
import type SrsCardRepository from '@/backend/services/repositories/SrsCardRepository';
import type {
    CreateSrsCardParams,
    IntakeItem,
    SrsQueueQuery,
    SrsReviewLogEntry,
    UpdateSrsCardReviewParams,
} from '@/backend/services/repositories/SrsCardRepository';

/** 合法的来源类型；读取时据此拒绝损坏数据。 */
const SOURCE_KINDS: readonly ShadowingSourceKind[] = ['free', 'video'];

/** 合法的学习来源模块；未知值读取时丢弃，避免旧数据撑爆界面。 */
const SOURCE_MODULES: readonly SrsSourceModule[] = ['player', 'original', 'practice', 'dialogue', 'vocabulary'];

/** 合法的错误标签；未知值读取时丢弃。 */
const ERROR_TAGS: readonly SrsErrorTag[] = [
    'pronunciation', 'stress', 'fluency', 'spelling', 'tense',
    'plural', 'missing', 'extra', 'meaning', 'structure',
];

/**
 * 解析逗号分隔的错误标签。
 * @param value 数据库里的标签串。
 */
function parseErrorTags(value: string | null): SrsErrorTag[] {
    if (!value) {
        return [];
    }
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item): item is SrsErrorTag => ERROR_TAGS.includes(item as SrsErrorTag));
}

/**
 * 解析逗号分隔的来源模块。
 * @param value 数据库里的模块串。
 */
function parseModules(value: string | null): SrsSourceModule[] {
    if (!value) {
        return [];
    }
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item): item is SrsSourceModule => SOURCE_MODULES.includes(item as SrsSourceModule));
}

/**
 * 合并两组来源模块并去重。
 * @param base 原模块列表。
 * @param extra 追加模块。
 */
function mergeModules(base: SrsSourceModule[], extra: SrsSourceModule[]): SrsSourceModule[] {
    const merged = [...base];
    extra.forEach((item) => {
        if (!merged.includes(item)) {
            merged.push(item);
        }
    });
    return merged;
}

/**
 * 可复习条件：排除「无原声原句」的裸词。
 *
 * 早期把默认词表批量推进复习池产生的裸词（单个词、没有视频绑定）
 * 复习时无从播放也无从跟读，统一在查询层过滤掉。
 */
const REVIEWABLE: SQL = sql`NOT (
    (
        ${srsCard.source_kind} <> 'video'
        OR ${srsCard.video_path} IS NULL
        OR ${srsCard.subtitle_path} IS NULL
    )
    AND instr(trim(${srsCard.reference_text}), ' ') = 0
)`;

/** 卡片是否有可回放的原声。 */
const HAS_AUDIO: SQL = sql`(
    ${srsCard.source_kind} = 'video'
    AND ${srsCard.video_path} IS NOT NULL
    AND ${srsCard.subtitle_path} IS NOT NULL
)`;

/** 卡片是否带目标词（语境卡）。 */
const HAS_WORD: SQL = sql`(${srsCard.word} IS NOT NULL AND trim(${srsCard.word}) <> '')`;

/**
 * 按复习形态生成筛选条件，与 `resolveSrsReviewForm` 保持一致。
 * @param filter 形态筛选。
 * @returns SQL 条件；`all` 返回 undefined。
 */
function formFilter(filter: SrsQueueFilter): SQL | undefined {
    if (filter === 'word') {
        return HAS_WORD;
    }
    if (filter === 'dialogue') {
        return sql`${srsCard.source_modules} LIKE '%dialogue%'`;
    }
    const noWord = sql`(${srsCard.word} IS NULL OR trim(${srsCard.word}) = '')`;
    if (filter === 'dictation') {
        return sql`${noWord} AND ${HAS_AUDIO} AND ${srsCard.stage} BETWEEN 2 AND 3`;
    }
    if (filter === 'shadowing') {
        return sql`${noWord} AND NOT (${HAS_AUDIO} AND ${srsCard.stage} >= 2)`;
    }
    return undefined;
}

/**
 * 把数据库行映射为跨层卡片。
 */
function mapRow(row: SrsCardRow): SrsCard {
    if (!SOURCE_KINDS.includes(row.source_kind as ShadowingSourceKind)) {
        throw new Error(`数据库中的复习卡片来源类型无效: ${row.source_kind}`);
    }
    return {
        id: row.id,
        referenceText: row.reference_text,
        word: row.word,
        sourceModules: parseModules(row.source_modules),
        sourceKind: row.source_kind as ShadowingSourceKind,
        videoKey: row.video_key,
        sentenceIndex: row.sentence_index,
        videoPath: row.video_path,
        subtitlePath: row.subtitle_path,
        stage: row.stage,
        dueAt: row.due_at,
        lastScore: row.last_score,
        lastAttemptId: row.last_attempt_id,
        reviewCount: row.review_count,
        passCount: row.pass_count,
        masteredAt: row.mastered_at,
        lastErrorTags: parseErrorTags(row.last_error_tags),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * 使用 Drizzle 访问复习卡片表。
 */
@injectable()
export default class SrsCardRepositoryImpl implements SrsCardRepository {
    /**
     * 按卡片键查询。
     * @param cardKey 唯一卡片键。
     * @returns 卡片；不存在时返回 null。
     */
    public async findByCardKey(cardKey: string): Promise<SrsCard | null> {
        const row = db
            .select()
            .from(srsCard)
            .where(eq(srsCard.card_key, cardKey))
            .get();
        return row ? mapRow(row) : null;
    }

    public async createIfAbsent(params: CreateSrsCardParams): Promise<{ card: SrsCard; created: boolean }> {
        const now = Date.now();
        const result = db
            .insert(srsCard)
            .values({
                card_key: params.cardKey,
                source_kind: params.source.kind,
                video_key: params.source.videoKey ?? null,
                sentence_index: params.source.sentenceIndex ?? null,
                video_path: params.source.videoPath ?? null,
                subtitle_path: params.source.subtitlePath ?? null,
                reference_text: params.referenceText,
                word: params.word ?? null,
                source_modules: (params.modules ?? []).join(','),
                priority: params.priority ?? 2,
                stage: 0,
                due_at: params.dueAt,
                last_score: null,
                last_attempt_id: null,
                review_count: 0,
                pass_count: 0,
                created_at: now,
                updated_at: now,
            })
            .onConflictDoNothing({ target: srsCard.card_key })
            .run();

        const card = await this.findByCardKey(params.cardKey);
        if (!card) {
            throw new Error(`创建复习卡片后无法读取: ${params.cardKey}`);
        }
        return { card, created: result.changes === 1 };
    }

    public async findById(id: number): Promise<SrsCard | null> {
        const row = db
            .select()
            .from(srsCard)
            .where(eq(srsCard.id, id))
            .get();
        return row ? mapRow(row) : null;
    }

    public async overview(
        now: number,
        dueLimit: number,
        upcomingLimit: number,
        newFrom: number,
    ): Promise<Omit<SrsOverview, 'dailyNewCardLimit'>> {
        const dueCondition = and(lte(srsCard.due_at, now), isNull(srsCard.mastered_at), REVIEWABLE);
        const dueRows = db
            .select()
            .from(srsCard)
            .where(dueCondition)
            .orderBy(asc(srsCard.due_at), asc(srsCard.id))
            .limit(dueLimit)
            .all();
        const upcomingRows = db
            .select()
            .from(srsCard)
            .where(and(gt(srsCard.due_at, now), isNull(srsCard.mastered_at), REVIEWABLE))
            .orderBy(asc(srsCard.due_at), asc(srsCard.id))
            .limit(upcomingLimit)
            .all();

        const countWhere = (condition: SQL | undefined): number => Number(
            db
                .select({ count: sql<number>`count(*)` })
                .from(srsCard)
                .where(condition)
                .get()?.count ?? 0,
        );
        const newCondition = and(
            gte(srsCard.created_at, newFrom),
            lte(srsCard.created_at, now),
            isNull(srsCard.mastered_at),
            REVIEWABLE,
        );
        const newRows = db
            .select()
            .from(srsCard)
            .where(newCondition)
            .orderBy(asc(srsCard.priority), asc(srsCard.id))
            .limit(50)
            .all();

        return {
            dueCards: dueRows.map(mapRow),
            upcomingCards: upcomingRows.map(mapRow),
            dueCount: countWhere(dueCondition),
            todayDueCount: countWhere(and(gte(srsCard.due_at, newFrom), dueCondition)),
            overdueCount: countWhere(and(lt(srsCard.due_at, newFrom), isNull(srsCard.mastered_at), REVIEWABLE)),
            masteredCount: countWhere(and(isNotNull(srsCard.mastered_at), REVIEWABLE)),
            totalCount: countWhere(REVIEWABLE),
            newCards: newRows.map(mapRow),
            newCount: countWhere(newCondition),
            generatedAt: now,
        };
    }

    public async updateAfterReview(params: UpdateSrsCardReviewParams): Promise<SrsCard> {
        const result = db
            .update(srsCard)
            .set({
                stage: params.stage,
                due_at: params.dueAt,
                last_score: params.lastScore,
                last_attempt_id: params.lastAttemptId,
                review_count: sql`${srsCard.review_count} + 1`,
                pass_count: sql`${srsCard.pass_count} + ${params.passed ? 1 : 0}`,
                mastered_at: params.masteredAt,
                last_error_tags: params.errorTags.join(','),
                updated_at: Date.now(),
            })
            .where(eq(srsCard.id, params.id))
            .run();
        if (result.changes !== 1) {
            throw new Error(`待更新的复习卡片不存在: ${params.id}`);
        }
        const card = await this.findById(params.id);
        if (!card) {
            throw new Error(`更新复习卡片后无法读取: ${params.id}`);
        }
        return card;
    }

    public async deleteById(id: number): Promise<void> {
        const result = db
            .delete(srsCard)
            .where(eq(srsCard.id, id))
            .run();
        if (result.changes !== 1) {
            throw new Error(`待删除的复习卡片不存在: ${id}`);
        }
    }

    public async countCreatedBetween(from: number, to: number): Promise<number> {
        const row = db
            .select({ count: sql<number>`count(*)` })
            .from(srsCard)
            .where(and(gte(srsCard.created_at, from), lt(srsCard.created_at, to)))
            .get();
        return Number(row?.count ?? 0);
    }

    public async listCreatedBetween(from: number, to: number, limit: number): Promise<SrsCard[]> {
        return db
            .select()
            .from(srsCard)
            .where(and(gte(srsCard.created_at, from), lt(srsCard.created_at, to)))
            .orderBy(asc(srsCard.priority), asc(srsCard.id))
            .limit(limit)
            .all()
            .map(mapRow);
    }

    public async mergeCardMeta(cardKey: string, modules: SrsSourceModule[], word?: string | null): Promise<void> {
        const row = db
            .select()
            .from(srsCard)
            .where(eq(srsCard.card_key, cardKey))
            .get();
        if (!row) {
            return;
        }
        const merged = mergeModules(parseModules(row.source_modules), modules);
        db.update(srsCard)
            .set({
                source_modules: merged.join(','),
                word: word ?? row.word,
                updated_at: Date.now(),
            })
            .where(eq(srsCard.card_key, cardKey))
            .run();
    }

    /**
     * 把待办队列表行映射为入池条目。
     * @param row 数据库行。
     */
    private mapIntakeRow(row: typeof reviewInbox.$inferSelect): IntakeItem {
        return {
            cardKey: row.card_key,
            referenceText: row.reference_text,
            source: {
                kind: row.source_kind as ShadowingSourceKind,
                videoKey: row.video_key ?? undefined,
                sentenceIndex: row.sentence_index ?? undefined,
                videoPath: row.video_path ?? undefined,
                subtitlePath: row.subtitle_path ?? undefined,
            },
            word: row.word,
            modules: parseModules(row.source_modules),
            priority: row.priority,
            createdAt: row.created_at,
        };
    }

    public async findIntake(cardKey: string): Promise<IntakeItem | null> {
        const row = db
            .select()
            .from(reviewInbox)
            .where(eq(reviewInbox.card_key, cardKey))
            .get();
        return row ? this.mapIntakeRow(row) : null;
    }

    public async enqueueIntake(item: IntakeItem): Promise<void> {
        const existing = await this.findIntake(item.cardKey);
        if (existing) {
            const merged = mergeModules(existing.modules, item.modules);
            db.update(reviewInbox)
                .set({
                    source_modules: merged.join(','),
                    priority: Math.min(existing.priority, item.priority),
                    word: item.word ?? existing.word,
                })
                .where(eq(reviewInbox.card_key, item.cardKey))
                .run();
            return;
        }
        db.insert(reviewInbox)
            .values({
                card_key: item.cardKey,
                reference_text: item.referenceText,
                source_kind: item.source.kind,
                video_key: item.source.videoKey ?? null,
                sentence_index: item.source.sentenceIndex ?? null,
                video_path: item.source.videoPath ?? null,
                subtitle_path: item.source.subtitlePath ?? null,
                word: item.word,
                source_modules: item.modules.join(','),
                priority: item.priority,
                created_at: item.createdAt,
            })
            .onConflictDoNothing({ target: reviewInbox.card_key })
            .run();
    }

    public async listIntake(limit: number): Promise<IntakeItem[]> {
        return db
            .select()
            .from(reviewInbox)
            .orderBy(asc(reviewInbox.priority), asc(reviewInbox.created_at), asc(reviewInbox.id))
            .limit(limit)
            .all()
            .map((row) => this.mapIntakeRow(row));
    }

    public async removeIntake(cardKey: string): Promise<void> {
        db.delete(reviewInbox)
            .where(eq(reviewInbox.card_key, cardKey))
            .run();
    }

    /**
     * 组装队列范围条件。
     * @param query 队列查询。
     * @returns SQL 条件。
     */
    private scopeCondition(query: SrsQueueQuery): SQL | undefined {
        const { scope, now, todayStart } = query;
        switch (scope) {
            case 'overdue':
                return and(lt(srsCard.due_at, todayStart), isNull(srsCard.mastered_at), REVIEWABLE);
            case 'new':
                return and(
                    gte(srsCard.created_at, todayStart),
                    lte(srsCard.created_at, now),
                    isNull(srsCard.mastered_at),
                    REVIEWABLE,
                );
            case 'mastered':
                return and(isNotNull(srsCard.mastered_at), REVIEWABLE);
            case 'today':
                return and(
                    gte(srsCard.due_at, todayStart),
                    lte(srsCard.due_at, now),
                    isNull(srsCard.mastered_at),
                    REVIEWABLE,
                );
            case 'all':
            default:
                return and(isNull(srsCard.mastered_at), REVIEWABLE);
        }
    }

    public async listQueue(query: SrsQueueQuery): Promise<SrsQueueResponse> {
        const tagCondition = query.tag
            ? sql`${srsCard.last_error_tags} LIKE ${`%${query.tag}%`}`
            : undefined;
        const condition = and(this.scopeCondition(query), formFilter(query.filter), tagCondition);
        const order = query.scope === 'mastered'
            ? [desc(srsCard.mastered_at), asc(srsCard.id)]
            : query.scope === 'new'
                ? [asc(srsCard.priority), asc(srsCard.id)]
                : [asc(srsCard.due_at), asc(srsCard.id)];
        const cards = db
            .select()
            .from(srsCard)
            .where(condition)
            .orderBy(...order)
            .limit(query.limit)
            .offset(query.offset)
            .all()
            .map(mapRow);
        const total = Number(
            db
                .select({ count: sql<number>`count(*)` })
                .from(srsCard)
                .where(condition)
                .get()?.count ?? 0,
        );
        return { cards, total };
    }

    public async insertReviewLog(entry: SrsReviewLogEntry): Promise<void> {
        db.insert(srsReviewLog)
            .values({
                card_id: entry.cardId,
                form: entry.form,
                score: entry.score,
                passed: entry.passed === null ? null : (entry.passed ? 1 : 0),
                verdict: entry.verdict,
                error_tags: entry.errorTags.join(','),
                created_at: entry.createdAt,
            })
            .run();
    }

    public async reviewCalendar(from: number): Promise<SrsHistoryDay[]> {
        const dayExpr = sql<string>`strftime('%Y-%m-%d', ${srsReviewLog.created_at} / 1000, 'unixepoch', 'localtime')`;
        return db
            .select({
                date: dayExpr,
                count: sql<number>`count(*)`,
                passed: sql<number>`sum(case when ${srsReviewLog.passed} = 1 then 1 else 0 end)`,
            })
            .from(srsReviewLog)
            .where(gte(srsReviewLog.created_at, from))
            .groupBy(dayExpr)
            .orderBy(asc(dayExpr))
            .all()
            .map((row) => ({
                date: row.date,
                count: Number(row.count),
                passed: Number(row.passed ?? 0),
            }));
    }

    public async listReviewLog(from: number, limit: number): Promise<SrsReviewLogEntry[]> {
        return db
            .select()
            .from(srsReviewLog)
            .where(gte(srsReviewLog.created_at, from))
            .orderBy(desc(srsReviewLog.created_at), desc(srsReviewLog.id))
            .limit(limit)
            .all()
            .map((row) => ({
                id: row.id,
                cardId: row.card_id,
                form: row.form as SrsReviewForm,
                score: row.score,
                passed: row.passed === null ? null : row.passed === 1,
                verdict: row.verdict as SrsVerdict,
                errorTags: parseErrorTags(row.error_tags),
                createdAt: row.created_at,
            }));
    }
}
