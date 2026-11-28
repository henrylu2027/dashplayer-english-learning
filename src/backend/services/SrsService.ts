import { createHash } from 'crypto';
import path from 'path';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type {
    SrsAddCardRequest,
    SrsAddCardResponse,
    SrsCard,
    SrsCardLocation,
    SrsCardThumbnail,
    SrsCheckRequest,
    SrsCheckResult,
    SrsErrorTag,
    SrsHistoryItem,
    SrsHistoryRequest,
    SrsHistoryResponse,
    SrsIngestRequest,
    SrsIngestResponse,
    SrsOverview,
    SrsQueueRequest,
    SrsQueueResponse,
    SrsReviewEvidence,
    SrsReviewForm,
    SrsReviewOutcome,
    SrsSourceModule,
    SrsSubmitReviewRequest,
    SrsVerdict,
    SrsVerdictRequest,
    SrsVerdictResult,
    SrsWordDefinition,
} from '@/common/contracts/srs';
import {
    SRS_DEFAULT_DAILY_NEW_CARD_LIMIT,
    SRS_INTERVAL_DAYS,
    SRS_MAX_DAILY_NEW_CARD_LIMIT,
    SRS_PASS_SCORE,
} from '@/common/contracts/srs';
import type { ShadowingAttemptSource, ShadowingWordFeedback } from '@/common/contracts/shadowing';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';
import type SentenceAudioService from '@/backend/services/SentenceAudioService';
import type SrsCardRepository from '@/backend/services/repositories/SrsCardRepository';
import type WatchHistoryRepository from '@/backend/services/repositories/WatchHistoryRepository';
import type WordsRepository from '@/backend/services/repositories/WordsRepository';
import { WatchHistoryProjectType } from '@/backend/services/repositories/WatchHistoryRepository';
import type SubtitleService from '@/backend/services/SubtitleService';
import type FfmpegService from '@/backend/services/FfmpegService';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type ShadowingAttemptRepository from '@/backend/services/repositories/ShadowingAttemptRepository';
import type PracticeAttemptRepository from '@/backend/services/repositories/PracticeAttemptRepository';
import { resolveSrsReviewForm } from '@/common/utils/srsReviewForm';
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
     * 统一入池：把学习模块刚学过的句子交给间隔复习。
     *
     * 新卡统一排到次日第一次复习；未达标直接进到期区并标记薄弱；
     * 当日新卡超过上限时进入待办队列，按优先级顺延。
     *
     * @param request 句子、来源、学习模块与是否未达标。
     * @returns 入池结果；排队中时 card 为 null。
     */
    ingest(request: SrsIngestRequest): Promise<SrsIngestResponse>;

    /**
     * 查询待复习与未来卡片。
     *
     * @returns 概览；列表各最多 20 条，计数为全量。
     */
    overview(): Promise<SrsOverview>;

    /**
     * 提交一次复习结果，并推进或回退复习阶段。
     *
     * 原音跟读页等「自动判定」场景使用：通过即判定为掌握，未通过即判定为忘记。
     * 复习页使用 `check` + `verdict` 两步，让用户先看分、再点掌握度。
     *
     * @param request 卡片 ID 与取证方式。
     * @returns 是否通过、本次得分与更新后的卡片。
     * @throws 卡片/记录不存在、取证方式不匹配，或记录与卡片不是同一句时抛出。
     */
    submitReview(request: SrsSubmitReviewRequest): Promise<SrsReviewOutcome>;

    /**
     * 只打分，不改排期。
     *
     * 跟读/听写形态必须提交记录 ID；听音回忆与词汇形态没有机器分，返回 null。
     *
     * @param request 卡片 ID 与取证方式。
     * @returns 形态、机器分与是否达到通过线。
     * @throws 卡片/记录不存在、取证方式与形态不符，或记录与卡片不是同一句时抛出。
     */
    check(request: SrsCheckRequest): Promise<SrsCheckResult>;

    /**
     * 按用户判定推进排期，并写一条复习日志。
     *
     * 方向由按钮决定；跟读/听写形态机器分低于通过线时，无论点什么都不得升级。
     *
     * @param request 卡片 ID、判定与取证方式。
     * @returns 更新后的卡片、得分、间隔与是否掌握。
     * @throws 卡片/记录不存在、取证方式与形态不符，或记录与卡片不是同一句时抛出。
     */
    verdict(request: SrsVerdictRequest): Promise<SrsVerdictResult>;

    /**
     * 分页查询左侧复习队列。
     *
     * 查询层已排除没有原声原句的裸词，计数与列表口径一致。
     *
     * @param request 范围、筛选与分页参数。
     * @returns 当前页卡片与总数。
     */
    queue(request: SrsQueueRequest): Promise<SrsQueueResponse>;

    /**
     * 读取卡片目标词在词表里的释义。
     *
     * @param cardId 卡片 ID。
     * @returns 目标词与中文释义；词表里没有释义时为 null。
     * @throws 卡片不存在时抛出。
     */
    getWordDefinition(cardId: number): Promise<SrsWordDefinition>;

    /**
     * 定位卡片对应的原片与句子起始时间。
     *
     * @param cardId 卡片 ID。
     * @returns 观看记录 ID 与句子起始秒数。
     * @throws 卡片没有原声、找不到观看记录或字幕定位失败时抛出。
     */
    getCardLocation(cardId: number): Promise<SrsCardLocation>;

    /**
     * 生成卡片对应句子的视频截图（缓存为 jpg）。
     *
     * @param cardId 卡片 ID。
     * @returns 截图文件绝对路径。
     * @throws 卡片没有原声或截帧失败时抛出。
     */
    getCardThumbnail(cardId: number): Promise<SrsCardThumbnail>;

    /**
     * 读取最近的复习日志，供存档区的历史视图使用。
     *
     * @param request 返回条数。
     * @returns 按时间倒序的记录；卡片已删除时文本为空。
     */
    history(request: SrsHistoryRequest): Promise<SrsHistoryResponse>;

    /**
     * 修改每日新卡上限；0 表示暂停入池。
     *
     * @param limit 目标上限，范围 0~200。
     * @returns 实际保存的上限。
     * @throws 非整数或超出范围时抛出。
     */
    setDailyNewCardLimit(limit: number): Promise<number>;

    /**
     * 读取当前每日新卡上限，供学习台等只读场景展示。
     *
     * @returns 当前上限；0 表示暂停入池。
     */
    getDailyNewCardLimit(): Promise<number>;

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

/** 入池优先级：数值越小越优先（薄弱 0、收藏 1、学习生词 2、对话 3）。 */
const MODULE_PRIORITY: Record<SrsSourceModule, number> = {
    player: 1,
    original: 2,
    practice: 2,
    vocabulary: 2,
    dialogue: 3,
};

/** 队列默认分页大小。 */
const QUEUE_DEFAULT_LIMIT = 50;

/** 队列单页上限。 */
const QUEUE_MAX_LIMIT = 200;

/**
 * 某一阶段对应的间隔天数；stage 0 按第一档算，避免出现 0 天。
 * @param stage 复习阶段。
 */
function intervalForStage(stage: number): number {
    const index = Math.min(Math.max(stage, 1), SRS_INTERVAL_DAYS.length) - 1;
    return SRS_INTERVAL_DAYS[index];
}

/**
 * 是否为「无原声原句」的裸词：没有视频出处，且文本里没有空格。
 *
 * 这类卡片复习时既放不了原声，也没有可跟读的原句，口径要求不进入复习池。
 *
 * @param source 句子来源。
 * @param referenceText 归一化前的复习文本。
 */
function isSourcelessWord(
    source: ShadowingAttemptSource,
    referenceText: string,
): boolean {
    const hasVideo = source.kind === 'video'
        && Boolean(source.videoPath)
        && Boolean(source.subtitlePath);
    return !hasVideo && !referenceText.includes(' ');
}

/**
 * 由逐词反馈生成错误标签。
 *
 * 只标注机器能确定的问题；分低但没有具体错词时，跟读记为流利度不足、听写记为拼写错误。
 *
 * @param form 本次形态。
 * @param score 机器分。
 * @param words 逐词对齐结果。
 */
function deriveErrorTags(
    form: 'shadowing' | 'dictation',
    score: number,
    words: ShadowingWordFeedback[],
): SrsErrorTag[] {
    const tags: SrsErrorTag[] = [];
    const has = (status: ShadowingWordFeedback['status']): boolean =>
        words.some((word) => word.status === status);

    if (has('mispronounced')) {
        tags.push(form === 'dictation' ? 'spelling' : 'pronunciation');
    }
    if (has('missing')) {
        tags.push('missing');
    }
    if (has('extra')) {
        tags.push('extra');
    }
    if (score < 60 && tags.length === 0) {
        tags.push(form === 'dictation' ? 'spelling' : 'fluency');
    }
    return tags;
}

/**
 * 由复述的逐词对齐生成错误标签。
 *
 * @param score 关键词覆盖率。
 * @param words 逐词对齐结果。
 */
function deriveRetellTags(score: number, words: ShadowingWordFeedback[]): SrsErrorTag[] {
    const tags: SrsErrorTag[] = [];
    if (words.some((word) => word.status === 'missing')) {
        tags.push('missing');
    }
    if (words.some((word) => word.status === 'extra')) {
        tags.push('extra');
    }
    if (score < 60 && tags.length === 0) {
        tags.push('structure');
    }
    return tags;
}

/** 需要提交机器评分的形态。 */
const SCORED_FORMS: readonly SrsReviewForm[] = ['shadowing', 'dictation', 'scenario'];

/**
 * 一次判定后的排期结果。
 */
interface ScheduleDecision {
    /** 新阶段。 */
    stage: number;
    /** 新到期时间，epoch 毫秒。 */
    dueAt: number;
    /** 间隔天数。 */
    intervalDays: number;
    /** 是否标记为已掌握。 */
    mastered: boolean;
}

/**
 * 按「按钮定方向 + 机器分封顶」计算新阶段。
 *
 * - 忘记：回到阶段 0，一天后重来；
 * - 模糊：阶段不变，按当前阶段间隔顺延；
 * - 掌握：阶段 +1；已在最高阶段时标记为已掌握；
 * - 封顶：跟读/听写机器分低于通过线时，点掌握也不升级，按模糊处理。
 *
 * @param card 当前卡片。
 * @param form 本次形态。
 * @param verdict 用户判定。
 * @param machinePassed 机器分是否通过；无机器分为 null。
 * @param now 当前时间，epoch 毫秒。
 */
function decideSchedule(
    card: SrsCard,
    form: SrsReviewForm,
    verdict: SrsVerdict,
    machinePassed: boolean | null,
    now: number,
): ScheduleDecision {
    const capped = form !== 'recall' && form !== 'vocab' && machinePassed === false;

    if (verdict === 'forgot') {
        const days = intervalForStage(1);
        return { stage: 0, dueAt: now + days * DAY_MS, intervalDays: days, mastered: false };
    }
    if (verdict === 'fuzzy' || capped) {
        const days = intervalForStage(card.stage);
        return { stage: card.stage, dueAt: now + days * DAY_MS, intervalDays: days, mastered: false };
    }
    if (card.stage >= SRS_INTERVAL_DAYS.length) {
        const days = intervalForStage(SRS_INTERVAL_DAYS.length);
        return {
            stage: SRS_INTERVAL_DAYS.length,
            dueAt: now + days * DAY_MS,
            intervalDays: days,
            mastered: true,
        };
    }
    const stage = card.stage + 1;
    const days = intervalForStage(stage);
    return { stage, dueAt: now + days * DAY_MS, intervalDays: days, mastered: false };
}

/**
 * 取本地当天零点。
 * @param now 当前时间，epoch 毫秒。
 */
function startOfToday(now: number): number {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

/**
 * 取本地次日零点，作为新卡第一次复习时间。
 * @param now 当前时间，epoch 毫秒。
 */
function startOfTomorrow(now: number): number {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 1);
    return date.getTime();
}

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

    @inject(TYPES.PracticeAttemptRepository)
    private practiceAttemptRepository!: PracticeAttemptRepository;

    @inject(TYPES.SentenceAudioService)
    private sentenceAudioService!: SentenceAudioService;

    @inject(TYPES.SettingsStore)
    private settingsStore!: SettingsStore;

    @inject(TYPES.WordsRepository)
    private wordsRepository!: WordsRepository;

    @inject(TYPES.WatchHistoryRepository)
    private watchHistoryRepository!: WatchHistoryRepository;

    @inject(TYPES.SubtitleService)
    private subtitleService!: SubtitleService;

    @inject(TYPES.FfmpegService)
    private ffmpegService!: FfmpegService;

    @inject(TYPES.StorageDirectoryProvider)
    private storageDirectoryProvider!: StorageDirectoryProvider;

    @inject(TYPES.FileSystemGateway)
    private fileSystemGateway!: FileSystemGateway;

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

    public async ingest(request: SrsIngestRequest): Promise<SrsIngestResponse> {
        const referenceText = request.referenceText.trim();
        const wordCount = tokenizeForScoring(referenceText).length;
        if (wordCount === 0) {
            throw new Error('请先输入要复习的句子');
        }
        if (wordCount > MAX_REVIEW_WORDS) {
            throw new Error(`复习句子过长，请控制在 ${MAX_REVIEW_WORDS} 词以内`);
        }
        const source = normalizeShadowingSource(request.source);
        if (isSourcelessWord(source, referenceText)) {
            // 没有原声原句的裸词不进复习池，也不占每日新卡上限
            this.logger.info('srs ingest rejected', { module: request.module, reason: 'no-source-word' });
            return { card: null, created: false, queued: false, rejected: true };
        }
        const cardKey = buildSrsCardKey(referenceText, source);
        const word = request.word?.trim() ? request.word.trim() : null;
        const now = Date.now();

        const existing = await this.srsCardRepository.findByCardKey(cardKey);
        if (existing) {
            // 同一句从多个模块进来：只补来源与目标词，不改排期
            await this.srsCardRepository.mergeCardMeta(cardKey, [request.module], word);
            return { card: existing, created: false, queued: false, rejected: false };
        }

        const priority = request.failed ? 0 : (MODULE_PRIORITY[request.module] ?? 2);
        const base = {
            cardKey,
            referenceText,
            source,
            word,
            modules: [request.module],
            priority,
        };

        // 未达标的直接进到期区，不受每日上限约束
        if (request.failed) {
            const { card, created } = await this.srsCardRepository.createIfAbsent({ ...base, dueAt: now });
            await this.srsCardRepository.removeIntake(cardKey);
            return { card, created, queued: false, rejected: false };
        }

        const todayStart = startOfToday(now);
        const dailyLimit = this.readDailyNewCardLimit();
        const createdToday = await this.srsCardRepository.countCreatedBetween(todayStart, startOfTomorrow(now));
        if (createdToday >= dailyLimit) {
            await this.srsCardRepository.enqueueIntake({ ...base, createdAt: now });
            this.logger.info('srs ingest queued', { module: request.module, cardKey, dailyLimit });
            return { card: null, created: false, queued: true, rejected: false };
        }

        const { card, created } = await this.srsCardRepository.createIfAbsent({
            ...base,
            dueAt: startOfTomorrow(now),
        });
        await this.srsCardRepository.removeIntake(cardKey);
        this.logger.info('srs ingested', {
            cardId: card.id,
            created,
            module: request.module,
            failed: false,
        });
        return { card, created, queued: false, rejected: false };
    }

    /**
     * 把待办队列按优先级转成正式卡片，直到用完当天的入池额度。
     * @param now 当前时间，epoch 毫秒。
     */
    private async promoteIntake(now: number): Promise<void> {
        const todayStart = startOfToday(now);
        const tomorrowStart = startOfTomorrow(now);
        const dailyLimit = this.readDailyNewCardLimit();
        if (dailyLimit <= 0) {
            return;
        }
        let createdToday = await this.srsCardRepository.countCreatedBetween(todayStart, tomorrowStart);
        if (createdToday >= dailyLimit) {
            return;
        }
        const pending = await this.srsCardRepository.listIntake(dailyLimit - createdToday);
        for (const item of pending) {
            if (createdToday >= dailyLimit) {
                break;
            }
            await this.srsCardRepository.createIfAbsent({
                cardKey: item.cardKey,
                referenceText: item.referenceText,
                source: item.source,
                dueAt: tomorrowStart,
                word: item.word,
                modules: item.modules,
                priority: item.priority,
            });
            await this.srsCardRepository.removeIntake(item.cardKey);
            createdToday += 1;
        }
    }

    public async overview(): Promise<SrsOverview> {
        const now = Date.now();
        await this.promoteIntake(now);
        const data = await this.srsCardRepository.overview(
            now,
            OVERVIEW_LIST_LIMIT,
            OVERVIEW_LIST_LIMIT,
            startOfToday(now),
        );
        return { ...data, dailyNewCardLimit: this.readDailyNewCardLimit() };
    }

    public async setDailyNewCardLimit(limit: number): Promise<number> {
        if (!Number.isInteger(limit) || limit < 0 || limit > SRS_MAX_DAILY_NEW_CARD_LIMIT) {
            throw new Error(`每日新卡上限需为 0~${SRS_MAX_DAILY_NEW_CARD_LIMIT} 的整数`);
        }
        if (!this.settingsStore.set('learning.dailyNewCardLimit', String(limit))) {
            throw new Error('保存每日新卡上限失败');
        }
        this.logger.info('srs daily limit updated', { limit });
        return limit;
    }

    public async getDailyNewCardLimit(): Promise<number> {
        return this.readDailyNewCardLimit();
    }

    /**
     * 读取每日新卡上限；未设置或值非法时回退默认值并夹到合法区间。
     */
    private readDailyNewCardLimit(): number {
        const raw = this.settingsStore.get('learning.dailyNewCardLimit');
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed)) {
            return SRS_DEFAULT_DAILY_NEW_CARD_LIMIT;
        }
        return Math.min(SRS_MAX_DAILY_NEW_CARD_LIMIT, Math.max(0, parsed));
    }

    public async submitReview(request: SrsSubmitReviewRequest): Promise<SrsReviewOutcome> {
        const card = await this.requireCard(request.cardId);
        const form = resolveSrsReviewForm(card);
        const evidence = await this.collectEvidence(card, form, request.evidence);

        const passed = evidence.passed;
        const now = Date.now();
        let stage: number;
        let intervalDays: number;
        let dueAt: number;
        if (passed) {
            stage = Math.min(card.stage + 1, SRS_INTERVAL_DAYS.length);
            intervalDays = intervalForStage(stage);
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
            lastScore: evidence.score,
            lastAttemptId: evidence.attemptId,
            passed,
            masteredAt: card.masteredAt,
        });
        await this.writeReviewLog(
            card.id,
            form,
            evidence.score,
            passed,
            passed ? 'known' : 'forgot',
            evidence.errorTags,
            now,
        );
        this.logger.info('srs reviewed', {
            cardId: card.id,
            form,
            attemptId: evidence.attemptId,
            score: evidence.score,
            passed,
            previousStage: card.stage,
            stage,
            intervalDays,
        });
        return { card: updated, form, passed, score: evidence.score, intervalDays };
    }

    public async check(request: SrsCheckRequest): Promise<SrsCheckResult> {
        const card = await this.requireCard(request.cardId);
        const form = resolveSrsReviewForm(card);
        if (!SCORED_FORMS.includes(form)) {
            return {
                cardId: card.id,
                form,
                score: null,
                passed: null,
                passLine: SRS_PASS_SCORE,
                errorTags: [],
            };
        }
        const evidence = await this.collectEvidence(card, form, request.evidence);
        return {
            cardId: card.id,
            form,
            score: evidence.score,
            passed: evidence.passed,
            passLine: SRS_PASS_SCORE,
            errorTags: evidence.errorTags,
        };
    }

    public async verdict(request: SrsVerdictRequest): Promise<SrsVerdictResult> {
        const card = await this.requireCard(request.cardId);
        const form = resolveSrsReviewForm(card);
        this.assertVerdict(request.verdict);

        const evidence = SCORED_FORMS.includes(form)
            ? await this.collectEvidence(card, form, request.evidence)
            : { passed: null, score: null, attemptId: null, errorTags: [] as SrsErrorTag[] };

        const now = Date.now();
        const decision = decideSchedule(card, form, request.verdict, evidence.passed, now);
        const updated = await this.srsCardRepository.updateAfterReview({
            id: card.id,
            stage: decision.stage,
            dueAt: decision.dueAt,
            lastScore: evidence.score,
            lastAttemptId: evidence.attemptId,
            passed: evidence.passed ?? request.verdict === 'known',
            masteredAt: decision.mastered ? now : null,
        });
        await this.writeReviewLog(
            card.id,
            form,
            evidence.score,
            evidence.passed,
            request.verdict,
            evidence.errorTags,
            now,
        );
        this.logger.info('srs verdict', {
            cardId: card.id,
            form,
            verdict: request.verdict,
            score: evidence.score,
            previousStage: card.stage,
            stage: decision.stage,
            intervalDays: decision.intervalDays,
            mastered: decision.mastered,
        });
        return {
            card: updated,
            form,
            verdict: request.verdict,
            score: evidence.score,
            passed: evidence.passed,
            intervalDays: decision.intervalDays,
            mastered: decision.mastered,
            errorTags: evidence.errorTags,
        };
    }

    public async queue(request: SrsQueueRequest): Promise<SrsQueueResponse> {
        const now = Date.now();
        const limit = Math.min(
            QUEUE_MAX_LIMIT,
            Math.max(1, Math.floor(request.limit ?? QUEUE_DEFAULT_LIMIT)),
        );
        const offset = Math.max(0, Math.floor(request.offset ?? 0));
        return this.srsCardRepository.listQueue({
            now,
            todayStart: startOfToday(now),
            scope: request.scope ?? 'today',
            filter: request.filter ?? 'all',
            offset,
            limit,
        });
    }

    public async getCardLocation(cardId: number): Promise<SrsCardLocation> {
        const card = await this.requireCard(cardId);
        const { videoPath, start } = await this.locateSentence(card);
        const basePath = path.dirname(videoPath);
        const fileName = path.basename(videoPath);
        // 独立文件与目录入库的记录都按「目录 + 文件名」存，先按文件类型找，再回退目录类型
        const history = await this.watchHistoryRepository.findOneByBasePathFileNameType(
            basePath,
            fileName,
            WatchHistoryProjectType.FILE,
        ) ?? await this.watchHistoryRepository.findOneByBasePathFileNameType(
            basePath,
            fileName,
            WatchHistoryProjectType.DIRECTORY,
        );
        if (!history) {
            throw new Error('找不到这段视频的观看记录，请先在播放器里打开一次');
        }
        return { historyId: history.id, startSeconds: start };
    }

    public async getCardThumbnail(cardId: number): Promise<SrsCardThumbnail> {
        const card = await this.requireCard(cardId);
        const { videoPath, start } = await this.locateSentence(card);
        const tempRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.TEMP);
        const folder = path.join(tempRoot, 'srs-thumbnails');
        const fileName = `${createHash('sha1').update(`${videoPath}|${start}`).digest('hex')}.jpg`;
        const filePath = path.join(folder, fileName);
        if (!(await this.fileSystemGateway.fileExists(filePath))) {
            await this.ffmpegService.thumbnail({
                inputFile: videoPath,
                outputFileName: fileName,
                outputFolder: folder,
                // 往后偏半秒，避开转场黑帧
                time: start + 0.5,
                options: { quality: 'low', width: 320 },
            });
        }
        return { filePath };
    }

    /**
     * 解析卡片对应的视频、字幕与句子起点。
     *
     * @param card 复习卡片。
     * @returns 视频路径、字幕路径与句首秒数。
     * @throws 卡片没有原声或字幕定位失败时抛出。
     */
    private async locateSentence(card: SrsCard): Promise<{
        videoPath: string;
        subtitlePath: string;
        start: number;
    }> {
        const videoPath = card.videoPath;
        const subtitlePath = card.subtitlePath;
        if (card.sourceKind !== 'video' || !videoPath || !subtitlePath || card.sentenceIndex === null) {
            throw new Error('这张卡片没有可定位的原片');
        }
        const parsed = await this.subtitleService.parseSrt(subtitlePath);
        const sentence = parsed.sentences.find((item) => item.index === card.sentenceIndex);
        if (!sentence) {
            throw new Error('字幕里找不到这一句，无法定位原片');
        }
        return {
            videoPath,
            subtitlePath,
            start: sentence.adjustedStart ?? sentence.start,
        };
    }

    public async getWordDefinition(cardId: number): Promise<SrsWordDefinition> {
        const card = await this.requireCard(cardId);
        const word = card.word?.trim() ?? '';
        if (!word) {
            return { word: '', translate: null };
        }
        const row = await this.wordsRepository.findByWord(word);
        return { word, translate: row?.translate?.trim() || null };
    }

    public async history(request: SrsHistoryRequest): Promise<SrsHistoryResponse> {
        const limit = Math.min(500, Math.max(1, Math.floor(request.limit ?? 100)));
        const entries = await this.srsCardRepository.listReviewLog(0, limit);
        const items: SrsHistoryItem[] = [];
        for (const entry of entries) {
            const card = await this.srsCardRepository.findById(entry.cardId);
            items.push({
                id: entry.id ?? 0,
                cardId: entry.cardId,
                text: card?.referenceText ?? '',
                form: entry.form,
                score: entry.score,
                passed: entry.passed,
                verdict: entry.verdict,
                errorTags: entry.errorTags,
                createdAt: entry.createdAt,
            });
        }
        return { items };
    }

    /**
     * 按取证方式读取真实结果；前端提交的分数一概不采信。
     *
     * @param card 复习卡片。
     * @param form 本次形态；只有跟读与听写需要记录。
     * @param evidence 取证方式。
     * @returns 是否通过、得分与跟读记录 ID。
     * @throws 缺少记录、记录不存在、模式不符或与卡片不是同一句时抛出。
     */
    private async collectEvidence(
        card: SrsCard,
        form: SrsReviewForm,
        evidence?: SrsReviewEvidence,
    ): Promise<{ passed: boolean; score: number; attemptId: number | null; errorTags: SrsErrorTag[] }> {
        if (form === 'shadowing') {
            if (!evidence || evidence.type !== 'shadowing') {
                throw new Error('这张卡需要提交跟读记录');
            }
            this.assertPositiveInteger(evidence.attemptId, '跟读记录 ID');
            const attempt = await this.shadowingAttemptRepository.findById(evidence.attemptId);
            if (!attempt) {
                throw new Error(`跟读记录不存在: ${evidence.attemptId}`);
            }
            this.assertSameTarget(card, attempt);
            return {
                passed: attempt.score >= SRS_PASS_SCORE,
                score: attempt.score,
                attemptId: attempt.id,
                errorTags: deriveErrorTags('shadowing', attempt.score, attempt.wordFeedback),
            };
        }
        if (form === 'dictation') {
            if (!evidence || evidence.type !== 'dictation') {
                throw new Error('这张卡需要提交听写记录');
            }
            this.assertPositiveInteger(evidence.attemptId, '练习记录 ID');
            const attempt = await this.practiceAttemptRepository.findById(evidence.attemptId);
            if (!attempt) {
                throw new Error(`练习记录不存在: ${evidence.attemptId}`);
            }
            if (attempt.mode !== 'dictation') {
                throw new Error('听写复习必须提交听写记录');
            }
            this.assertSameTarget(card, attempt);
            const words = await this.practiceAttemptRepository.findWordFeedback(attempt.id);
            return {
                passed: attempt.score >= SRS_PASS_SCORE,
                score: attempt.score,
                // 听写记录属于练习表，不写进 last_attempt_id，避免和跟读记录混用
                attemptId: null,
                errorTags: deriveErrorTags('dictation', attempt.score, words),
            };
        }
        if (form === 'scenario') {
            if (!evidence || evidence.type !== 'retell') {
                throw new Error('这张卡需要提交复述记录');
            }
            this.assertPositiveInteger(evidence.attemptId, '练习记录 ID');
            const attempt = await this.practiceAttemptRepository.findById(evidence.attemptId);
            if (!attempt) {
                throw new Error(`练习记录不存在: ${evidence.attemptId}`);
            }
            if (attempt.mode !== 'retell') {
                throw new Error('情景复述必须提交复述记录');
            }
            this.assertSameTarget(card, attempt);
            const words = await this.practiceAttemptRepository.findWordFeedback(attempt.id);
            return {
                passed: attempt.score >= SRS_PASS_SCORE,
                score: attempt.score,
                attemptId: null,
                errorTags: deriveRetellTags(attempt.score, words),
            };
        }
        throw new Error('当前复习形态不需要提交记录');
    }

    /**
     * 读取卡片，不存在时抛出。
     * @param cardId 卡片 ID。
     */
    private async requireCard(cardId: number): Promise<SrsCard> {
        this.assertPositiveInteger(cardId, '复习卡片 ID');
        const card = await this.srsCardRepository.findById(cardId);
        if (!card) {
            throw new Error(`复习卡片不存在: ${cardId}`);
        }
        return card;
    }

    /**
     * 校验判定取值。
     * @param verdict 用户判定。
     * @throws 取值非法时抛出。
     */
    private assertVerdict(verdict: string): asserts verdict is SrsVerdict {
        if (verdict !== 'forgot' && verdict !== 'fuzzy' && verdict !== 'known') {
            throw new Error(`未知的掌握度判定: ${verdict}`);
        }
    }

    /**
     * 写一条复习日志；失败只记警告，不回滚排期。
     */
    private async writeReviewLog(
        cardId: number,
        form: SrsReviewForm,
        score: number | null,
        passed: boolean | null,
        verdict: SrsVerdict,
        errorTags: SrsErrorTag[],
        createdAt: number,
    ): Promise<void> {
        try {
            await this.srsCardRepository.insertReviewLog({
                cardId,
                form,
                score,
                passed,
                verdict,
                errorTags,
                createdAt,
            });
        } catch (error) {
            this.logger.warn('srs review log failed', { cardId, error });
        }
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
     * 校验记录与卡片指向同一句，避免用别的句子的成绩把卡片“刷”过去。
     *
     * 跟读记录与听写记录都满足这个结构，来源与文本判定完全一致。
     *
     * @param card 复习卡片。
     * @param attempt 跟读或听写记录。
     * @throws 两者来源或文本不一致时抛出。
     */
    private assertSameTarget(
        card: SrsCard,
        attempt: {
            sourceKind: 'free' | 'video';
            videoKey: string | null;
            sentenceIndex: number | null;
            referenceText: string;
        },
    ): void {
        if (card.sourceKind === 'video') {
            if (
                attempt.sourceKind !== 'video'
                || attempt.videoKey !== card.videoKey
                || attempt.sentenceIndex !== card.sentenceIndex
            ) {
                throw new Error('这次作答与复习卡片不是同一句，请重新作答');
            }
            return;
        }
        if (
            attempt.sourceKind !== 'free'
            || normalizedTextKey(attempt.referenceText) !== normalizedTextKey(card.referenceText)
        ) {
            throw new Error('这次作答与复习卡片不是同一句，请重新作答');
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
