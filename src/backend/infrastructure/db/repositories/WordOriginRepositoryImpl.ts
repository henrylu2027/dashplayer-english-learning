import { asc, eq, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import type { Db } from '@/backend/infrastructure/db/createDb';
import { wordOrigin, type WordOriginRow } from '@/backend/infrastructure/db/tables/wordOrigin';
import type { WordOrigin } from '@/common/contracts/vocabulary';
import type WordOriginRepository from '@/backend/services/repositories/WordOriginRepository';
import type { AddWordOriginParams } from '@/backend/services/repositories/WordOriginRepository';

/**
 * 把数据库行映射为跨层出处。
 * @param row 数据库行。
 */
function mapRow(row: WordOriginRow): WordOrigin {
    return {
        module: row.module as WordOrigin['module'],
        sentence: row.sentence,
        videoKey: row.video_key ?? undefined,
        sentenceIndex: row.sentence_index ?? undefined,
        videoPath: row.video_path ?? undefined,
        subtitlePath: row.subtitle_path ?? undefined,
        createdAt: row.created_at,
    };
}

/**
 * 使用 Drizzle 访问生词出处表。
 */
@injectable()
export default class WordOriginRepositoryImpl implements WordOriginRepository {
    /**
     * @param db 由依赖容器注入的 drizzle 实例；测试中可替换为内存库。
     */
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async add(params: AddWordOriginParams): Promise<void> {
        this.db.insert(wordOrigin)
            .values({
                word: params.word,
                module: params.module,
                sentence: params.sentence,
                sentence_key: params.sentenceKey,
                video_key: params.videoKey ?? null,
                sentence_index: params.sentenceIndex ?? null,
                video_path: params.videoPath ?? null,
                subtitle_path: params.subtitlePath ?? null,
                created_at: params.createdAt,
            })
            .onConflictDoNothing({ target: [wordOrigin.word, wordOrigin.sentence_key] })
            .run();
    }

    public async findPreferred(word: string): Promise<WordOrigin | null> {
        const row = this.db
            .select()
            .from(wordOrigin)
            .where(eq(wordOrigin.word, word))
            .orderBy(
                sql`case when ${wordOrigin.video_key} is null then 1 else 0 end`,
                sql`${wordOrigin.created_at} desc`,
            )
            .limit(1)
            .get();
        return row ? mapRow(row) : null;
    }

    public async listLatestByWord(): Promise<Map<string, WordOrigin>> {
        const rows = this.db
            .select()
            .from(wordOrigin)
            .orderBy(asc(wordOrigin.created_at), asc(wordOrigin.id))
            .all();
        // 按时间升序遍历，后写入的覆盖前面的，留下每个词最新的一条
        const latest = new Map<string, WordOrigin>();
        rows.forEach((row) => latest.set(row.word, mapRow(row)));
        return latest;
    }

    public async deleteByWord(word: string): Promise<void> {
        this.db.delete(wordOrigin)
            .where(eq(wordOrigin.word, word))
            .run();
    }

    public async renameWord(oldWord: string, newWord: string): Promise<void> {
        this.db.update(wordOrigin)
            .set({ word: newWord })
            .where(eq(wordOrigin.word, oldWord))
            .run();
    }
}
