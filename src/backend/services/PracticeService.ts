import { randomUUID } from 'crypto';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';
import type {
    DictationRequest,
    DictationResult,
    PracticeAttemptQuery,
    PracticeAttemptSummary,
    PracticeMode,
    RetellKeywordFeedback,
    RetellRequest,
    RetellResult,
} from '@/common/contracts/practice';
import type RecordedSpeechService from '@/backend/services/speech/RecordedSpeechService';
import type SentenceAudioService from '@/backend/services/SentenceAudioService';
import type PracticeAttemptRepository from '@/backend/services/repositories/PracticeAttemptRepository';
import { alignText } from '@/backend/services/shadowing/ShadowingScorer';
import { normalizeShadowingSource } from '@/backend/services/shadowing/ShadowingSource';
import { normalizeWord, tokenizeForScoring } from '@/common/utils/wordTokens';
import { extractRetellKeywords } from '@/common/utils/retellKeywords';

/**
 * 精听练习业务契约。
 */
export default interface PracticeService {
    /**
     * 听写校对：把用户键入文本与参考文本逐词对齐并保存记录。
     *
     * @param request 参考文本、键入文本与来源。
     * @returns 逐词反馈与词准确率。
     * @throws 参考文本为空/过长或来源非法时抛出。
     */
    dictation(request: DictationRequest): Promise<DictationResult>;

    /**
     * 复述评测：转写录音并检查关键词覆盖，不要求逐字一致。
     *
     * @param request 参考文本、来源与录音。
     * @returns 识别文本、关键词覆盖与覆盖率。
     * @throws 参考文本为空/过长、来源非法或转写失败时抛出。
     */
    retell(request: RetellRequest): Promise<RetellResult>;

    /**
     * 查询练习记录。
     *
     * @param query 条数与可选模式过滤；未给条数时默认最近 10 条。
     * @returns 记录摘要列表。
     * @throws 条数或模式非法时抛出。
     */
    listAttempts(query?: PracticeAttemptQuery): Promise<PracticeAttemptSummary[]>;

    /**
     * 提取句子原声，供听写/复述播放。
     *
     * @param source 视频句来源。
     * @returns 音频文件绝对路径。
     * @throws 自由文本来源、缺少视频/字幕路径或句子定位失败时抛出。
     */
    getSentenceAudio(source: ShadowingAttemptSource): Promise<string>;
}

/** 参考文本的最大词数，与跟读测评保持一致。 */
const MAX_REFERENCE_WORDS = 200;

/** 练习记录默认返回条数。 */
const DEFAULT_ATTEMPT_LIMIT = 10;

/** 练习记录单次最多返回条数。 */
const MAX_ATTEMPT_LIMIT = 50;

/** 合法的练习模式。 */
const PRACTICE_MODES: readonly PracticeMode[] = ['dictation', 'retell'];

/**
 * 精听练习服务：听写校对与复述关键词覆盖。
 */
@injectable()
export class PracticeServiceImpl implements PracticeService {
    private readonly logger = getMainLogger('PracticeService');

    @inject(TYPES.PracticeAttemptRepository)
    private practiceAttemptRepository!: PracticeAttemptRepository;

    @inject(TYPES.RecordedSpeechService)
    private recordedSpeechService!: RecordedSpeechService;

    @inject(TYPES.SentenceAudioService)
    private sentenceAudioService!: SentenceAudioService;

    public async dictation(request: DictationRequest): Promise<DictationResult> {
        const referenceText = this.validateReferenceText(request.referenceText);
        const typedText = request.typedText.trim();
        const source = normalizeShadowingSource(request.source);
        const alignment = alignText(referenceText, typedText);
        const accuracy = Math.round(
            (alignment.correctWordCount / alignment.referenceWordCount) * 100,
        );
        const attempt = await this.practiceAttemptRepository.create({
            mode: 'dictation',
            source,
            referenceText,
            userText: typedText,
            score: accuracy,
            wordFeedback: alignment.words,
        });
        this.logger.info('dictation checked', {
            attemptId: attempt.id,
            sourceKind: source.kind,
            referenceWordCount: alignment.referenceWordCount,
            correctWordCount: alignment.correctWordCount,
            accuracy,
        });
        return {
            attempt,
            words: alignment.words,
            referenceWordCount: alignment.referenceWordCount,
            correctWordCount: alignment.correctWordCount,
            accuracy,
        };
    }

    public async retell(request: RetellRequest): Promise<RetellResult> {
        const referenceText = this.validateReferenceText(request.referenceText);
        const source = normalizeShadowingSource(request.source);
        const job = `practice-retell:${randomUUID()}`;
        const speech = await this.recordedSpeechService.transcribe({
            audio: request.audio,
            mimeType: request.mimeType,
            job,
        });

        const keywords = extractRetellKeywords(referenceText);
        const recognizedWords = new Set(
            tokenizeForScoring(speech.text).map(normalizeWord).filter((word) => word.length > 0),
        );
        const feedback: RetellKeywordFeedback[] = keywords.map((word) => ({
            word,
            covered: recognizedWords.has(word),
        }));
        const coveredCount = feedback.filter((item) => item.covered).length;
        const coverage = keywords.length === 0
            ? 0
            : Math.round((coveredCount / keywords.length) * 100);

        const attempt = await this.practiceAttemptRepository.create({
            mode: 'retell',
            source,
            referenceText,
            userText: speech.text,
            score: coverage,
            wordFeedback: feedback,
        });
        this.logger.info('retell checked', {
            attemptId: attempt.id,
            job,
            sourceKind: source.kind,
            keywordCount: keywords.length,
            coveredCount,
            coverage,
            durationSec: Math.round(speech.durationSec * 100) / 100,
        });
        return {
            attempt,
            referenceText,
            recognizedText: speech.text,
            keywords: feedback,
            coverage,
        };
    }

    public async listAttempts(query: PracticeAttemptQuery = {}): Promise<PracticeAttemptSummary[]> {
        const limit = query.limit ?? DEFAULT_ATTEMPT_LIMIT;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ATTEMPT_LIMIT) {
            throw new Error(`练习记录条数必须在 1~${MAX_ATTEMPT_LIMIT} 之间`);
        }
        if (query.mode !== undefined && !PRACTICE_MODES.includes(query.mode)) {
            throw new Error(`未知的练习模式：${String(query.mode)}`);
        }
        return this.practiceAttemptRepository.list({ limit, mode: query.mode });
    }

    public async getSentenceAudio(source: ShadowingAttemptSource): Promise<string> {
        const normalized = normalizeShadowingSource(source);
        if (
            normalized.kind !== 'video'
            || !normalized.videoPath
            || !normalized.subtitlePath
            || normalized.sentenceIndex === undefined
        ) {
            throw new Error('自由输入的句子没有原声，请先绑定视频句');
        }
        return this.sentenceAudioService.extract({
            videoPath: normalized.videoPath,
            subtitlePath: normalized.subtitlePath,
            sentenceIndex: normalized.sentenceIndex,
            job: `practice-audio:${normalized.videoKey}:${normalized.sentenceIndex}`,
        });
    }

    /**
     * 校验参考文本并返回去除首尾空白后的文本。
     *
     * @param referenceText 原始参考文本。
     * @returns 可用的参考文本。
     * @throws 为空或词数超限时抛出。
     */
    private validateReferenceText(referenceText: string): string {
        const trimmed = referenceText.trim();
        const wordCount = tokenizeForScoring(trimmed).length;
        if (wordCount === 0) {
            throw new Error('请先输入要练习的句子');
        }
        if (wordCount > MAX_REFERENCE_WORDS) {
            throw new Error(`练习句子过长，请控制在 ${MAX_REFERENCE_WORDS} 词以内`);
        }
        return trimmed;
    }
}
