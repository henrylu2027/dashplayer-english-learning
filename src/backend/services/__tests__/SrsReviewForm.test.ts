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
 * 复习形态与取证方式的测试。
 *
 * 形态规则是纯函数，直接断言；提交链路用仓储替身验证「形态不符就拒绝」。
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
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

describe('复习形态规则', () => {
    it('词卡走认词', () => {
        const card = videoCard({ referenceText: 'abandon', word: 'abandon', sourceKind: 'free', videoPath: null, subtitlePath: null, sentenceIndex: null, videoKey: null });
        expect(resolveSrsReviewForm(card)).toBe('recall');
    });

    it('有原声的句子卡在阶段 2~3 走听写', () => {
        expect(resolveSrsReviewForm(videoCard({ stage: 1 }))).toBe('shadowing');
        expect(resolveSrsReviewForm(videoCard({ stage: 2 }))).toBe('dictation');
        expect(resolveSrsReviewForm(videoCard({ stage: 3 }))).toBe('dictation');
        expect(resolveSrsReviewForm(videoCard({ stage: 4 }))).toBe('shadowing');
    });

    it('没有原声的句子卡始终跟读', () => {
        const card = videoCard({ stage: 2, sourceKind: 'free', videoPath: null, subtitlePath: null, videoKey: null, sentenceIndex: null });
        expect(resolveSrsReviewForm(card)).toBe('shadowing');
    });
});

describe('复习取证', () => {
    /** 构造只覆盖提交链路所需方法的服务实例。 */
    function createService(card: SrsCard, practiceAttempt: Record<string, unknown> | null = null) {
        const updates: Array<Record<string, unknown>> = [];
        const srsCardRepository = {
            findById: async (id: number) => (id === card.id ? card : null),
            updateAfterReview: async (params: Record<string, unknown>) => {
                updates.push(params);
                return { ...card, stage: params.stage, dueAt: params.dueAt };
            },
        };
        const shadowingAttemptRepository = {
            findById: async () => null,
        };
        const practiceAttemptRepository = {
            findById: async () => practiceAttempt,
        };
        const settingsStore = { get: () => '50', set: () => true };

        const service = new SrsServiceImpl();
        Object.assign(service as unknown as Record<string, unknown>, {
            srsCardRepository,
            shadowingAttemptRepository,
            practiceAttemptRepository,
            settingsStore,
        });
        return { service, updates };
    }

    it('认词自评通过后推进一阶，不写跟读记录 ID', async () => {
        const card = videoCard({
            referenceText: 'abandon',
            word: 'abandon',
            sourceKind: 'free',
            videoPath: null,
            subtitlePath: null,
            videoKey: null,
            sentenceIndex: null,
            stage: 1,
        });
        const { service, updates } = createService(card);

        const outcome = await service.submitReview({
            cardId: card.id,
            evidence: { type: 'recall', remembered: true },
        });

        expect(outcome.passed).toBe(true);
        expect(outcome.form).toBe('recall');
        expect(updates[0]?.stage).toBe(2);
        expect(updates[0]?.lastAttemptId).toBeNull();
        expect(outcome.intervalDays).toBe(3);
    });

    it('认词不记得时退一阶并立即回到待复习', async () => {
        const card = videoCard({
            referenceText: 'abandon',
            word: 'abandon',
            sourceKind: 'free',
            videoPath: null,
            subtitlePath: null,
            videoKey: null,
            sentenceIndex: null,
            stage: 2,
        });
        const { service, updates } = createService(card);

        const outcome = await service.submitReview({
            cardId: card.id,
            evidence: { type: 'recall', remembered: false },
        });

        expect(outcome.passed).toBe(false);
        expect(updates[0]?.stage).toBe(1);
        expect(Number(updates[0]?.dueAt)).toBeGreaterThan(0);
        expect(outcome.intervalDays).toBe(0);
    });

    it('形态是听写时提交跟读证据会被拒绝', async () => {
        const card = videoCard({ stage: 2 });
        const { service } = createService(card);

        await expect(service.submitReview({
            cardId: card.id,
            evidence: { type: 'shadowing', attemptId: 1 },
        })).rejects.toThrow('复习形态已变化');
    });

    it('听写必须提交听写记录，复述记录会被拒绝', async () => {
        const card = videoCard({ stage: 2 });
        const { service } = createService(card, {
            id: 9,
            mode: 'retell',
            referenceText: card.referenceText,
            userText: '',
            score: 90,
            sourceKind: 'video',
            videoKey: 'hash',
            sentenceIndex: 3,
            createdAt: 0,
        });

        await expect(service.submitReview({
            cardId: card.id,
            evidence: { type: 'dictation', attemptId: 9 },
        })).rejects.toThrow('听写记录');
    });
});
