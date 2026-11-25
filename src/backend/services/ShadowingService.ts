import { randomUUID } from 'crypto';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type {
    ShadowingAttemptQuery,
    ShadowingAttemptSummary,
    ShadowingScoreRequest,
    ShadowingScoreResponse,
} from '@/common/contracts/shadowing';
import type RecordedSpeechService from '@/backend/services/speech/RecordedSpeechService';
import type ShadowingAttemptRepository from '@/backend/services/repositories/ShadowingAttemptRepository';
import { scoreShadowing } from '@/backend/services/shadowing/ShadowingScorer';
import { normalizeShadowingSource } from '@/backend/services/shadowing/ShadowingSource';
import { tokenizeForScoring } from '@/common/utils/wordTokens';

/**
 * 跟读评测业务契约。
 */
export default interface ShadowingService {
    /**
     * 对一段跟读录音做识别与逐词评测，并把结果落库。
     *
     * 流程：校验入参与音频 → 写临时文件 → ffmpeg 转 16kHz 单声道 WAV →
     * 用当前设置的识别引擎转写 → 与参考文本逐词对齐打分 → 保存跟读记录 → 清理临时文件。
     *
     * @param request 参考文本、录音字节、录音 MIME 与句子来源。
     * @returns 逐词反馈、各项得分与已落库的记录摘要。
     * @throws 参考文本为空/过长、来源非法、录音为空/过大/格式不支持，或转码、识别、落库失败时抛出。
     */
    score(request: ShadowingScoreRequest): Promise<ShadowingScoreResponse>;

    /**
     * 按时间倒序查询跟读记录。
     *
     * @param query 条数与可选过滤条件；未给条数时默认最近 10 条。
     * @returns 跟读记录摘要列表。
     * @throws 条数超出 1~50、过滤条件类型非法时抛出。
     */
    listAttempts(query?: ShadowingAttemptQuery): Promise<ShadowingAttemptSummary[]>;
}

/** 参考文本的最大词数：一句话练习足够，过长的整段文本对齐反馈会失去可读性。 */
const MAX_REFERENCE_WORDS = 200;

/** 跟读记录默认返回条数。 */
const DEFAULT_ATTEMPT_LIMIT = 10;

/** 跟读记录单次最多返回条数。 */
const MAX_ATTEMPT_LIMIT = 50;

/**
 * 本地跟读评测服务。
 *
 * 每次评测使用独立临时目录，识别结束（无论成功失败）都会清理，
 * 不把录音留在用户磁盘上；评测结果写入跟读记录表，供复习与学习台聚合。
 */
@injectable()
export class ShadowingServiceImpl implements ShadowingService {
    private readonly logger = getMainLogger('ShadowingService');

    @inject(TYPES.RecordedSpeechService)
    private recordedSpeechService!: RecordedSpeechService;

    @inject(TYPES.ShadowingAttemptRepository)
    private shadowingAttemptRepository!: ShadowingAttemptRepository;

    public async score(request: ShadowingScoreRequest): Promise<ShadowingScoreResponse> {
        const referenceText = request.referenceText.trim();
        const referenceWordCount = tokenizeForScoring(referenceText).length;
        if (referenceWordCount === 0) {
            throw new Error('请先输入要跟读的句子');
        }
        if (referenceWordCount > MAX_REFERENCE_WORDS) {
            throw new Error(`跟读句子过长，请控制在 ${MAX_REFERENCE_WORDS} 词以内`);
        }
        const source = normalizeShadowingSource(request.source);

        const job = `shadowing:${randomUUID()}`;
        const startedAt = Date.now();
        const speech = await this.recordedSpeechService.transcribe({
            audio: request.audio,
            mimeType: request.mimeType,
            job,
        });
        const result = scoreShadowing(referenceText, speech.text, speech.durationSec);
        const attempt = await this.shadowingAttemptRepository.create({
            source,
            referenceText,
            recognizedText: result.recognizedText,
            score: result.score,
            accuracy: result.accuracy,
            completeness: result.completeness,
            wordsPerMinute: result.wordsPerMinute,
            durationSec: result.durationSec,
            wordFeedback: result.words,
        });
        this.logger.info('shadowing scored', {
            job,
            attemptId: attempt.id,
            sourceKind: source.kind,
            elapsedMs: Date.now() - startedAt,
            durationSec: result.durationSec,
            referenceWordCount: result.referenceWordCount,
            correctWordCount: result.correctWordCount,
            score: result.score,
        });
        return { result, attempt };
    }

    public async listAttempts(query: ShadowingAttemptQuery = {}): Promise<ShadowingAttemptSummary[]> {
        const limit = query.limit ?? DEFAULT_ATTEMPT_LIMIT;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ATTEMPT_LIMIT) {
            throw new Error(`跟读记录条数必须在 1~${MAX_ATTEMPT_LIMIT} 之间`);
        }
        if (query.videoKey !== undefined) {
            if (typeof query.videoKey !== 'string' || query.videoKey.trim().length === 0) {
                throw new Error('视频字幕哈希不能为空');
            }
        }
        if (query.sentenceIndex !== undefined) {
            if (typeof query.sentenceIndex !== 'number' || !Number.isInteger(query.sentenceIndex) || query.sentenceIndex < 0) {
                throw new Error('句子序号必须是非负整数');
            }
        }
        return this.shadowingAttemptRepository.list({
            limit,
            videoKey: query.videoKey?.trim(),
            sentenceIndex: query.sentenceIndex,
        });
    }
}
