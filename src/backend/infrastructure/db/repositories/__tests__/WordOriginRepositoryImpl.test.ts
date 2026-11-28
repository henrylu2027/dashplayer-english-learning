import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { words } from '@/backend/infrastructure/db/tables/words';
import { createMemoryDb, type MemoryDb } from '@/test/database';
import WordOriginRepositoryImpl from '../WordOriginRepositoryImpl';

/**
 * 生词出处仓储的内存库测试。
 *
 * 同时验证迁移 0016：`dp_word_origin` 表与 `dp_words.learned_at` 列都能真实读写。
 */
describe('生词出处仓储', () => {
    let memoryDb: MemoryDb;
    let repository: WordOriginRepositoryImpl;

    beforeEach(() => {
        memoryDb = createMemoryDb();
        repository = new WordOriginRepositoryImpl(memoryDb.db);
    });

    afterEach(() => {
        memoryDb.close();
    });

    const freeOrigin = {
        word: 'run',
        module: 'dialogue',
        sentence: 'I run every morning.',
        sentenceKey: 'free:aaa',
        createdAt: 1_000,
    };

    it('迁移后可以写入并读回出处', async () => {
        await repository.add(freeOrigin);

        const origin = await repository.findPreferred('run');

        expect(origin).toEqual({
            module: 'dialogue',
            sentence: 'I run every morning.',
            videoKey: undefined,
            sentenceIndex: undefined,
            videoPath: undefined,
            subtitlePath: undefined,
            createdAt: 1_000,
        });
    });

    it('同一词同一句只保留一条出处', async () => {
        await repository.add(freeOrigin);
        await repository.add({ ...freeOrigin, createdAt: 2_000, module: 'practice' });

        const latest = await repository.listLatestByWord();

        expect(latest.get('run')?.createdAt).toBe(1_000);
    });

    it('优先选视频句作为语境卡出处', async () => {
        await repository.add({ ...freeOrigin, createdAt: 3_000 });
        await repository.add({
            word: 'run',
            module: 'player',
            sentence: 'They run a small shop.',
            sentenceKey: 'video:hash:7',
            videoKey: 'hash',
            sentenceIndex: 7,
            videoPath: 'D:/v.mp4',
            subtitlePath: 'D:/v.srt',
            createdAt: 1_000,
        });

        const origin = await repository.findPreferred('run');

        expect(origin?.module).toBe('player');
        expect(origin?.sentenceIndex).toBe(7);
    });

    it('列表取每个词最新的一条出处', async () => {
        await repository.add({ ...freeOrigin, createdAt: 1_000 });
        await repository.add({ ...freeOrigin, sentenceKey: 'free:bbb', sentence: 'Run faster.', createdAt: 5_000 });

        const latest = await repository.listLatestByWord();

        expect(latest.get('run')?.sentence).toBe('Run faster.');
    });

    it('改名迁移出处，删除词时清空出处', async () => {
        await repository.add(freeOrigin);
        await repository.renameWord('run', 'running');
        expect(await repository.findPreferred('run')).toBeNull();
        expect((await repository.findPreferred('running'))?.sentence).toBe('I run every morning.');

        await repository.deleteByWord('running');
        expect(await repository.listLatestByWord()).toEqual(new Map());
    });

    it('dp_words 支持 learned_at 列', async () => {
        memoryDb.db.run(sql`insert into dp_words (word, translate, learned_at) values ('run', '跑', 123)`);

        const rows = memoryDb.db.select().from(words).all();

        expect(rows[0]?.learned_at).toBe(123);
    });
});
