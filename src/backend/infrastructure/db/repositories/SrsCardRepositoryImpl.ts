import { asc, eq, gt, lte, sql } from 'drizzle-orm';
import { injectable } from 'inversify';

import db from '@/backend/infrastructure/db';
import { srsCard, type SrsCardRow } from '@/backend/infrastructure/db/tables/srsCard';
import type { ShadowingSourceKind } from '@/common/contracts/shadowing';
import type { SrsCard, SrsOverview } from '@/common/contracts/srs';
import type SrsCardRepository from '@/backend/services/repositories/SrsCardRepository';
import type {
    CreateSrsCardParams,
    UpdateSrsCardReviewParams,
} from '@/backend/services/repositories/SrsCardRepository';

/** 合法的来源类型；读取时据此拒绝损坏数据。 */
const SOURCE_KINDS: readonly ShadowingSourceKind[] = ['free', 'video'];

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
    private async findByCardKey(cardKey: string): Promise<SrsCard | null> {
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

    public async overview(now: number, dueLimit: number, upcomingLimit: number): Promise<SrsOverview> {
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

        return {
            dueCards: dueRows.map(mapRow),
            upcomingCards: upcomingRows.map(mapRow),
            dueCount: Number(dueCountRow?.count ?? 0),
            totalCount: Number(totalCountRow?.count ?? 0),
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
}
