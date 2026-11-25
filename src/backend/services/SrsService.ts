import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type {
    SrsAddCardRequest,
    SrsAddCardResponse,
    SrsCard,
    SrsOverview,
    SrsReviewOutcome,
    SrsSubmitReviewRequest,
} from '@/common/contracts/srs';
import { SRS_INTERVAL_DAYS, SRS_PASS_SCORE } from '@/common/contracts/srs';
import type SentenceAudioService from '@/backend/services/SentenceAudioService';
import type SrsCardRepository from '@/backend/services/repositories/SrsCardRepository';
import type ShadowingAttemptRepository from '@/backend/services/repositories/ShadowingAttemptRepository';
import type { ShadowingAttemptDetail } from '@/backend/services/repositories/ShadowingAttemptRepository';
import { tokenizeForScoring } from '@/common/utils/wordTokens';
import {
    buildSrsCardKey,
    normalizedTextKey,
    normalizeShadowingSource,
} from '@/backend/services/shadowing/ShadowingSource';

/**
 * 间隔复习业务契约。
 *
 * 复习动作以跟读记录为准：前端先完成一次跟读评分，再提交记录 ID；
 * 后端读取该记录的真实得分判定通过与否，前端不能自行声明通过。
 */
export default interface SrsService {
    /**
     * 把一句话加入复习队列；同一视频句或同一自由文本只会有一张卡。
     *
     * @param request 句子文本与来源。
     * @returns 卡片与是否新建。
     * @throws 文本为空/过长或来源非法时抛出。
     */
    addCard(request: SrsAddCardRequest): Promise<SrsAddCardResponse>;

    /**
     * 查询待复习与未来卡片。
     *
     * @returns 概览；列表各最多 20 条，计数为全量。
     */
    overview(): Promise<SrsOverview>;

    /**
     * 用一条跟读记录提交复习结果，并推进或回退复习阶段。
     *
     * @param request 卡片 ID 与跟读记录 ID。
     * @returns 是否通过、本次得分与更新后的卡片。
     * @throws 卡片/记录不存在，或记录与卡片不是同一句时抛出。
     */
    submitReview(request: SrsSubmitReviewRequest): Promise<SrsReviewOutcome>;

    /**
     * 从复习队列删除一张卡片；不影响已有的跟读记录。
     *
     * @param cardId 卡片 ID。
     */
    removeCard(cardId: number): Promise<void>;

    /**
     * 提取卡片对应视频句的原声（缓存为 mp3）。
     *
     * @param cardId 卡片 ID。
     * @returns 音频文件绝对路径，供渲染进程播放。
     * @throws 卡片不存在、自由文本卡片、缺少视频/字幕路径或句子定位失败时抛出。
     */
    getSentenceAudio(cardId: number): Promise<string>;
}

/** 待复习与未来列表各自最多返回的条数。 */
const OVERVIEW_LIST_LIMIT = 20;

/** 一天对应的毫秒数。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 复习文本的最大词数，与跟读评测保持一致。 */
const MAX_REVIEW_WORDS = 200;

/**
 * 间隔复习服务。
 */
@injectable()
export class SrsServiceImpl implements SrsService {
    private readonly logger = getMainLogger('SrsService');

    @inject(TYPES.SrsCardRepository)
    private srsCardRepository!: SrsCardRepository;

    @inject(TYPES.ShadowingAttemptRepository)
    private shadowingAttemptRepository!: ShadowingAttemptRepository;

    @inject(TYPES.SentenceAudioService)
    private sentenceAudioService!: SentenceAudioService;

    public async addCard(request: SrsAddCardRequest): Promise<SrsAddCardResponse> {
        const referenceText = request.referenceText.trim();
        const wordCount = tokenizeForScoring(referenceText).length;
        if (wordCount === 0) {
            throw new Error('请先输入要复习的句子');
        }
        if (wordCount > MAX_REVIEW_WORDS) {
            throw new Error(`复习句子过长，请控制在 ${MAX_REVIEW_WORDS} 词以内`);
        }
        const source = normalizeShadowingSource(request.source);
        const cardKey = buildSrsCardKey(referenceText, source);
        const { card, created } = await this.srsCardRepository.createIfAbsent({
            cardKey,
            referenceText,
            source,
            dueAt: Date.now(),
        });
        this.logger.info('srs card added', {
            cardId: card.id,
            created,
            sourceKind: source.kind,
        });
        return { card, created };
    }

    public overview(): Promise<SrsOverview> {
        return this.srsCardRepository.overview(Date.now(), OVERVIEW_LIST_LIMIT, OVERVIEW_LIST_LIMIT);
    }

    public async submitReview(request: SrsSubmitReviewRequest): Promise<SrsReviewOutcome> {
        this.assertPositiveInteger(request.cardId, '复习卡片 ID');
        this.assertPositiveInteger(request.attemptId, '跟读记录 ID');
        const card = await this.srsCardRepository.findById(request.cardId);
        if (!card) {
            throw new Error(`复习卡片不存在: ${request.cardId}`);
        }
        const attempt = await this.shadowingAttemptRepository.findById(request.attemptId);
        if (!attempt) {
            throw new Error(`跟读记录不存在: ${request.attemptId}`);
        }
        this.assertSameTarget(card, attempt);

        const passed = attempt.score >= SRS_PASS_SCORE;
        const now = Date.now();
        let stage: number;
        let intervalDays: number;
        let dueAt: number;
        if (passed) {
            stage = Math.min(card.stage + 1, SRS_INTERVAL_DAYS.length);
            intervalDays = SRS_INTERVAL_DAYS[stage - 1];
            dueAt = now + intervalDays * DAY_MS;
        } else {
            // 未达标：退一阶并立即回到待复习，让用户当场重读，而不是等明天
            stage = Math.max(0, card.stage - 1);
            intervalDays = 0;
            dueAt = now;
        }

        const updated = await this.srsCardRepository.updateAfterReview({
            id: card.id,
            stage,
            dueAt,
            lastScore: attempt.score,
            lastAttemptId: attempt.id,
            passed,
        });
        this.logger.info('srs reviewed', {
            cardId: card.id,
            attemptId: attempt.id,
            score: attempt.score,
            passed,
            previousStage: card.stage,
            stage,
            intervalDays,
        });
        return { card: updated, passed, score: attempt.score, intervalDays };
    }

    public async removeCard(cardId: number): Promise<void> {
        this.assertPositiveInteger(cardId, '复习卡片 ID');
        await this.srsCardRepository.deleteById(cardId);
        this.logger.info('srs card removed', { cardId });
    }

    public async getSentenceAudio(cardId: number): Promise<string> {
        this.assertPositiveInteger(cardId, '复习卡片 ID');
        const card = await this.srsCardRepository.findById(cardId);
        if (!card) {
            throw new Error(`复习卡片不存在: ${cardId}`);
        }
        const videoPath = card.videoPath;
        const subtitlePath = card.subtitlePath;
        if (card.sourceKind !== 'video' || !videoPath || !subtitlePath || card.sentenceIndex === null) {
            throw new Error('这张卡片没有可播放的原声');
        }
        return this.sentenceAudioService.extract({
            videoPath,
            subtitlePath,
            sentenceIndex: card.sentenceIndex,
            job: `srs-card:${cardId}`,
        });
    }

    /**
     * 校验跟读记录与卡片指向同一句，避免用别的句子的录音把卡片“刷”过去。
     *
     * @param card 复习卡片。
     * @param attempt 跟读记录。
     * @throws 两者来源或文本不一致时抛出。
     */
    private assertSameTarget(card: SrsCard, attempt: ShadowingAttemptDetail): void {
        if (card.sourceKind === 'video') {
            if (
                attempt.sourceKind !== 'video'
                || attempt.videoKey !== card.videoKey
                || attempt.sentenceIndex !== card.sentenceIndex
            ) {
                throw new Error('这次跟读与复习卡片不是同一句，请重新朗读');
            }
            return;
        }
        if (
            attempt.sourceKind !== 'free'
            || normalizedTextKey(attempt.referenceText) !== normalizedTextKey(card.referenceText)
        ) {
            throw new Error('这次跟读与复习卡片不是同一句，请重新朗读');
        }
    }

    /**
     * 校验 ID 为正整数。
     * @param value 待校验值。
     * @param label 错误信息中的字段名。
     * @throws 非正整数时抛出。
     */
    private assertPositiveInteger(value: number, label: string): void {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error(`${label} 必须是正整数`);
        }
    }
}
