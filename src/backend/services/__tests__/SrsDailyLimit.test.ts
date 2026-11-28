import { describe, expect, it, vi } from 'vitest';

// 服务模块只用到日志接口；mock 掉可避免测试环境去读 Electron 的 app 路径
vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
    }),
}));

import { SrsServiceImpl } from '../SrsService';

/**
 * 每日新卡上限的行为测试。
 *
 * 用最小化的仓储替身验证「读设置 → 判定是否排队」这条链路，
 * 不依赖真实数据库与音频服务。
 */

interface FakeState {
    /** 今天已创建的卡片数。 */
    createdToday: number;
    /** 设置仓库里存的上限值。 */
    stored: string;
    /** 进入待办队列的卡片键。 */
    queued: string[];
}

/** 构造只实现本组用例所需方法的服务实例。 */
function createService(state: FakeState): SrsServiceImpl {
    const repository = {
        findByCardKey: async () => null,
        countCreatedBetween: async () => state.createdToday,
        createIfAbsent: async (params: {
            referenceText: string;
            word?: string | null;
            modules?: string[];
            source: { kind: string; videoKey?: string; sentenceIndex?: number; videoPath?: string; subtitlePath?: string };
            dueAt: number;
        }) => ({
            card: {
                id: 1,
                referenceText: params.referenceText,
                word: params.word ?? null,
                sourceModules: params.modules ?? [],
                sourceKind: params.source.kind,
                videoKey: params.source.videoKey ?? null,
                sentenceIndex: params.source.sentenceIndex ?? null,
                videoPath: params.source.videoPath ?? null,
                subtitlePath: params.source.subtitlePath ?? null,
                stage: 0,
                dueAt: params.dueAt,
                lastScore: null,
                lastAttemptId: null,
                reviewCount: 0,
                passCount: 0,
                masteredAt: null,
                createdAt: 0,
                updatedAt: 0,
            },
            created: true,
        }),
        enqueueIntake: async (item: { cardKey: string }) => {
            state.queued.push(item.cardKey);
        },
        removeIntake: async () => undefined,
        listIntake: async () => [],
        overview: async () => ({
            dueCards: [],
            upcomingCards: [],
            dueCount: 0,
            todayDueCount: 0,
            overdueCount: 0,
            masteredCount: 0,
            totalCount: 0,
            newCards: [],
            newCount: 0,
            generatedAt: 0,
        }),
    };
    const settingsStore = {
        get: () => state.stored,
        set: (_key: string, value: string) => {
            state.stored = String(value);
            return true;
        },
    };

    const service = new SrsServiceImpl();
    Object.assign(service as unknown as Record<string, unknown>, {
        srsCardRepository: repository,
        settingsStore,
    });
    return service;
}

/** 本地次日零点，用于断言新卡的首次到期时间。 */
function startOfTomorrow(): number {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 1);
    return date.getTime();
}

describe('每日新卡上限', () => {
    it('未达上限时正常建卡，首次到期为次日零点', async () => {
        const state: FakeState = { createdToday: 3, stored: '50', queued: [] };
        const service = createService(state);

        const result = await service.ingest({
            referenceText: 'Hello world',
            source: { kind: 'free' },
            module: 'vocabulary',
            word: 'hello',
        });

        expect(result.queued).toBe(false);
        expect(result.card?.dueAt).toBe(startOfTomorrow());
        expect(state.queued).toEqual([]);
    });

    it('无原声原句的裸词直接拒绝，不建卡也不占上限', async () => {
        const state: FakeState = { createdToday: 0, stored: '50', queued: [] };
        const service = createService(state);

        const result = await service.ingest({
            referenceText: 'abandon',
            source: { kind: 'free' },
            module: 'vocabulary',
            word: 'abandon',
        });

        expect(result.rejected).toBe(true);
        expect(result.card).toBeNull();
        expect(result.queued).toBe(false);
        expect(state.queued).toEqual([]);
    });

    it('达到上限后进入待办队列，不建卡', async () => {
        const state: FakeState = { createdToday: 50, stored: '50', queued: [] };
        const service = createService(state);

        const result = await service.ingest({
            referenceText: 'Hello world',
            source: { kind: 'free' },
            module: 'vocabulary',
        });

        expect(result.queued).toBe(true);
        expect(result.card).toBeNull();
        expect(state.queued).toHaveLength(1);
    });

    it('上限为 0 时暂停入池', async () => {
        const state: FakeState = { createdToday: 0, stored: '0', queued: [] };
        const service = createService(state);

        const result = await service.ingest({
            referenceText: 'Hello world',
            source: { kind: 'free' },
            module: 'practice',
        });

        expect(result.queued).toBe(true);
        expect(state.queued).toHaveLength(1);
    });

    it('保存上限时校验范围并写回设置', async () => {
        const state: FakeState = { createdToday: 0, stored: '50', queued: [] };
        const service = createService(state);

        await expect(service.setDailyNewCardLimit(-1)).rejects.toThrow();
        await expect(service.setDailyNewCardLimit(201)).rejects.toThrow();
        await expect(service.setDailyNewCardLimit(1.5)).rejects.toThrow();

        await expect(service.setDailyNewCardLimit(0)).resolves.toBe(0);
        expect(state.stored).toBe('0');
    });

    it('概览带出当前上限，供复习页展示', async () => {
        const state: FakeState = { createdToday: 7, stored: '7', queued: [] };
        const service = createService(state);

        const overview = await service.overview();

        expect(overview.dailyNewCardLimit).toBe(7);
    });
});
