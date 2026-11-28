import { and, asc, eq, gt, gte, lt, lte, sql } from 'drizzle-orm';
import { injectable } from 'inversify';

import db from '@/backend/infrastructure/db';
import { srsCard, type SrsCardRow } from '@/backend/infrastructure/db/tables/srsCard';
import { reviewInbox } from '@/backend/infrastructure/db/tables/reviewInbox';
import type { ShadowingSourceKind } from '@/common/contracts/shadowing';
import type { SrsCard, SrsOverview, SrsSourceModule } from '@/common/contracts/srs';
import type SrsCardRepository from '@/backend/services/repositories/SrsCardRepository';
import type {
    CreateSrsCardParams,
    IntakeItem,
    UpdateSrsCardReviewParams,
} from '@/backend/services/repositories/SrsCardRepository';

/** 合法的来源类型；读取时据此拒绝损坏数据。 */
const SOURCE_KINDS: readonly ShadowingSourceKind[] = ['free', 'video'];

/** 合法的学习来源模块；未知值读取时丢弃，避免旧数据撑爆界面。 */
const SOURCE_MODULES: readonly SrsSourceModule[] = ['player', 'original', 'practice', 'dialogue', 'vocabulary'];

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

    public async overview(now: number, dueLimit: number, upcomingLimit: number, newFrom: number): Promise<SrsOverview> {
        const dueCondition = lte(srsCard.due_at, now);
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
            .where(gt(srsCard.due_at, now))
            .orderBy(asc(srsCard.due_at), asc(srsCard.id))
            .limit(upcomingLimit)
            .all();

        const dueCountRow = db
            .select({ count: sql<number>`count(*)` })
            .from(srsCard)
            .where(dueCondition)
            .get();
        const totalCountRow = db
            .select({ count: sql<number>`count(*)` })
            .from(srsCard)
            .get();
        const newRows = db
            .select()
            .from(srsCard)
            .where(and(gte(srsCard.created_at, newFrom), lte(srsCard.created_at, now)))
            .orderBy(asc(srsCard.priority), asc(srsCard.id))
            .limit(50)
            .all();

        return {
            dueCards: dueRows.map(mapRow),
            upcomingCards: upcomingRows.map(mapRow),
            dueCount: Number(dueCountRow?.count ?? 0),
            totalCount: Number(totalCountRow?.count ?? 0),
            newCards: newRows.map(mapRow),
            newCount: newRows.length,
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
}
