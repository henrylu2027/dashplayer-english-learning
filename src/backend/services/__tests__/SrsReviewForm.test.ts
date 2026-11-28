import { describe, expect, it, vi } from 'vitest';

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
    }),
}));

import type { SrsCard } from '@/common/contracts/srs';
import { resolveSrsReviewForm } from '@/common/utils/srsReviewForm';
import { SrsServiceImpl } from '../SrsService';

/**
 * 复习形态、打分与掌握度判定的测试。
 *
 * 形态规则是纯函数，直接断言；提交与判定链路用仓储替身验证
 * 「形态不符就拒绝」「机器分封顶」「忘记回到阶段 0」。
 */

/** 构造一张视频句卡片。 */
function videoCard(overrides: Partial<SrsCard> = {}): SrsCard {
    return {
        id: 1,
        referenceText: 'Hello world',
        word: null,
        sourceModules: [],
        sourceKind: 'video',
        videoKey: 'hash',
        sentenceIndex: 3,
        videoPath: 'D:/v.mp4',
        subtitlePath: 'D:/v.srt',
        stage: 0,
        dueAt: 0,
        lastScore: null,
        lastAttemptId: null,
        reviewCount: 0,
        passCount: 0,
        masteredAt: null,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

/** 构造一张有语境句的目标词卡。 */
function contextWordCard(overrides: Partial<SrsCard> = {}): SrsCard {
    return videoCard({ word: 'recipe', referenceText: 'Here is the recipe.', ...overrides });
}

describe('复习形态规则', () => {
    it('无原声无原句的裸词走认词（队列层已不再推送这类卡）', () => {
        const card = videoCard({ referenceText: 'abandon', word: 'abandon', sourceKind: 'free', videoPath: null, subtitlePath: null, sentenceIndex: null, videoKey: null });
        expect(resolveSrsReviewForm(card)).toBe('recall');
    });

    it('带语境句的目标词卡固定走词汇形态', () => {
        expect(resolveSrsReviewForm(contextWordCard({ stage: 0 }))).toBe('vocab');
        expect(resolveSrsReviewForm(contextWordCard({ stage: 4 }))).toBe('vocab');
    });

    it('有原声的句子卡按阶段轮换：跟读 → 听写 → 听音回忆', () => {
        expect(resolveSrsReviewForm(videoCard({ stage: 0 }))).toBe('shadowing');
        expect(resolveSrsReviewForm(videoCard({ stage: 1 }))).toBe('shadowing');
        expect(resolveSrsReviewForm(videoCard({ stage: 2 }))).toBe('dictation');
        expect(resolveSrsReviewForm(videoCard({ stage: 3 }))).toBe('dictation');
        expect(resolveSrsReviewForm(videoCard({ stage: 4 }))).toBe('recall');
        expect(resolveSrsReviewForm(videoCard({ stage: 5 }))).toBe('recall');
    });

    it('没有原声的句子卡始终跟读', () => {
        const card = videoCard({ stage: 2, sourceKind: 'free', videoPath: null, subtitlePath: null, videoKey: null, sentenceIndex: null });
        expect(resolveSrsReviewForm(card)).toBe('shadowing');
    });
});

describe('复习取证与判定', () => {
    /** 跟读记录替身。 */
    interface FakeShadowingAttempt {
        id: number;
        score: number;
        sourceKind: 'video' | 'free';
        videoKey: string | null;
        sentenceIndex: number | null;
        referenceText: string;
    }

    /**
     * 构造只覆盖判定链路所需方法的服务实例。
     * @param card 卡片。
     * @param options 跟读/听写记录替身。
     */
    function createService(
        card: SrsCard,
        options: { shadowingAttempt?: FakeShadowingAttempt; practiceAttempt?: Record<string, unknown> | null } = {},
    ) {
        const updates: Array<Record<string, unknown>> = [];
        const logs: Array<Record<string, unknown>> = [];
        const srsCardRepository = {
            findById: async (id: number) => (id === card.id ? card : null),
            updateAfterReview: async (params: Record<string, unknown>) => {
                updates.push(params);
                return { ...card, stage: params.stage, dueAt: params.dueAt };
            },
            insertReviewLog: async (entry: Record<string, unknown>) => {
                logs.push(entry);
            },
        };
        const shadowingAttemptRepository = {
            findById: async (id: number) => (
                options.shadowingAttempt && options.shadowingAttempt.id === id
                    ? options.shadowingAttempt
                    : null
            ),
        };
        const practiceAttemptRepository = {
            findById: async () => options.practiceAttempt ?? null,
        };
        const settingsStore = { get: () => '50', set: () => true };

        const service = new SrsServiceImpl();
        Object.assign(service as unknown as Record<string, unknown>, {
            srsCardRepository,
            shadowingAttemptRepository,
            practiceAttemptRepository,
            settingsStore,
        });
        return { service, updates, logs };
    }

    /** 与卡片同源的跟读记录。 */
    function attemptFor(card: SrsCard, score: number): FakeShadowingAttempt {
        return {
            id: 7,
            score,
            sourceKind: 'video',
            videoKey: card.videoKey,
            sentenceIndex: card.sentenceIndex,
            referenceText: card.referenceText,
        };
    }

    it('打分只读成绩，不改排期，也不写日志', async () => {
        const card = videoCard({ stage: 1 });
        const { service, updates, logs } = createService(card, { shadowingAttempt: attemptFor(card, 92) });

        const result = await service.check({ cardId: card.id, evidence: { type: 'shadowing', attemptId: 7 } });

        expect(result.score).toBe(92);
        expect(result.passed).toBe(true);
        expect(updates).toHaveLength(0);
        expect(logs).toHaveLength(0);
    });

    it('跟读通过后点掌握推进一阶并写日志', async () => {
        const card = videoCard({ stage: 1 });
        const { service, updates, logs } = createService(card, { shadowingAttempt: attemptFor(card, 92) });

        const result = await service.verdict({
            cardId: card.id,
            verdict: 'known',
            evidence: { type: 'shadowing', attemptId: 7 },
        });

        expect(result.card.stage).toBe(2);
        expect(result.intervalDays).toBe(3);
        expect(updates[0]?.passed).toBe(true);
        expect(logs[0]?.verdict).toBe('known');
        expect(logs[0]?.score).toBe(92);
    });

    it('机器分低于通过线时点掌握也不升级', async () => {
        const card = videoCard({ stage: 1 });
        const { service, updates } = createService(card, { shadowingAttempt: attemptFor(card, 61) });

        const result = await service.verdict({
            cardId: card.id,
            verdict: 'known',
            evidence: { type: 'shadowing', attemptId: 7 },
        });

        expect(result.card.stage).toBe(1);
        expect(result.intervalDays).toBe(1);
        expect(updates[0]?.passed).toBe(false);
    });

    it('点忘记回到阶段 0，一天后重来', async () => {
        const card = videoCard({ stage: 4 });
        const { service, updates } = createService(card, { shadowingAttempt: attemptFor(card, 95) });

        const result = await service.verdict({
            cardId: card.id,
            verdict: 'forgot',
            evidence: { type: 'shadowing', attemptId: 7 },
        });

        expect(result.card.stage).toBe(0);
        expect(result.intervalDays).toBe(1);
        expect(updates[0]?.masteredAt).toBeNull();
    });

    it('最高阶段再点掌握标记为已掌握', async () => {
        const card = videoCard({ stage: 5 });
        const { service, updates } = createService(card, { shadowingAttempt: attemptFor(card, 95) });

        const result = await service.verdict({
            cardId: card.id,
            verdict: 'known',
            evidence: { type: 'shadowing', attemptId: 7 },
        });

        expect(result.mastered).toBe(true);
        expect(updates[0]?.masteredAt).toBeGreaterThan(0);
    });

    it('词汇形态不需要提交记录，判定直接生效', async () => {
        const card = contextWordCard({ stage: 2 });
        const { service } = createService(card);

        const result = await service.verdict({ cardId: card.id, verdict: 'known' });

        expect(result.form).toBe('vocab');
        expect(result.score).toBeNull();
        expect(result.card.stage).toBe(3);
    });

    it('形态是听写时提交跟读证据会被拒绝', async () => {
        const card = videoCard({ stage: 2 });
        const { service } = createService(card);

        await expect(service.verdict({
            cardId: card.id,
            verdict: 'known',
            evidence: { type: 'shadowing', attemptId: 1 },
        })).rejects.toThrow('听写记录');
    });

    it('听写必须提交听写记录，复述记录会被拒绝', async () => {
        const card = videoCard({ stage: 2 });
        const { service } = createService(card, {
            practiceAttempt: {
                id: 9,
                mode: 'retell',
                referenceText: card.referenceText,
                userText: '',
                score: 90,
                sourceKind: 'video',
                videoKey: 'hash',
                sentenceIndex: 3,
                createdAt: 0,
            },
        });

        await expect(service.verdict({
            cardId: card.id,
            verdict: 'known',
            evidence: { type: 'dictation', attemptId: 9 },
        })).rejects.toThrow('听写记录');
    });
});
