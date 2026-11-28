import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
    ShadowingAttemptSource,
    ShadowingAttemptSummary,
    ShadowingScoreVO,
} from '@/common/contracts/shadowing';
import type { SrsSourceModule } from '@/common/contracts/srs';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { shadowingApi } from '@/fronted/features/shadowing/shadowingApi';
import { useAudioRecorder } from '@/fronted/features/shadowing/useAudioRecorder';

const logger = getRendererLogger('useRecordedAttempt');

/** 录音与提交阶段；`ready` 表示录音已结束、等待用户点提交评测。 */
export type RecordedAttemptPhase = 'idle' | 'recording' | 'ready' | 'scoring';

/**
 * 原音跟读的单句录音与评测状态。
 */
export interface RecordedAttempt {
    /** 当前阶段。 */
    phase: RecordedAttemptPhase;
    /** 已录制时长（秒）。 */
    elapsedSec: number;
    /** 本轮录音的可播放地址；每次重新录音都会换新，供“我的录音”回放。 */
    recordingUrl: string | null;
    /** 最近一次评测结果。 */
    result: ShadowingScoreVO | null;
    /** 最近一次评分落库后的记录，供间隔复习提交判定。 */
    attempt: ShadowingAttemptSummary | null;
    /** 麦克风或评分失败原因。 */
    error: string | null;
    /** 开始录音。 */
    start: () => Promise<void>;
    /** 停止录音，录音结束后进入 `ready`。 */
    stop: () => void;
    /**
     * 提交本轮录音做评测。
     * @param referenceText 参考文本。
     * @param source 句子来源。
     * @param ingestModule 学习来源模块；提供时自动送入间隔复习。
     * @returns 评测结果与记录；无录音或评测失败时为 null。
     */
    submit: (
        referenceText: string,
        source: ShadowingAttemptSource,
        ingestModule?: SrsSourceModule,
    ) => Promise<{
        result: ShadowingScoreVO;
        attempt: ShadowingAttemptSummary;
    } | null>;
    /** 清空录音与结果，切句时调用。 */
    reset: () => void;
}

/**
 * 单句“录音 → 提交评测”的流程封装。
 *
 * 与跟读打分页不同，这里不在录音结束时自动评分：页面流程固定为
 * 播放原声 → 麦克风跟读 → 点提交评测，录音结束后先停在 `ready` 等待用户确认。
 */
export function useRecordedAttempt(): RecordedAttempt {
    const { t } = useTranslation('pages');

    const [blob, setBlob] = useState<Blob | null>(null);
    const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
    const [scoring, setScoring] = useState(false);
    const [result, setResult] = useState<ShadowingScoreVO | null>(null);
    const [attempt, setAttempt] = useState<ShadowingAttemptSummary | null>(null);
    const [scoreError, setScoreError] = useState<string | null>(null);

    /** 当前录音的 object URL，替换或清空时释放，避免内存泄漏。 */
    const urlRef = useRef<string | null>(null);

    const releaseUrl = (): void => {
        if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
        }
    };

    const audio = useAudioRecorder({
        onStop: (recorded) => {
            if (recorded.size === 0) {
                setScoreError(t('shadowing.noSpeech'));
                return;
            }
            releaseUrl();
            const url = URL.createObjectURL(recorded);
            urlRef.current = url;
            setBlob(recorded);
            setRecordingUrl(url);
        },
    });

    // 卸载时释放最后一段录音
    useEffect(() => {
        return () => {
            releaseUrl();
        };
    }, []);

    const reset = (): void => {
        releaseUrl();
        setBlob(null);
        setRecordingUrl(null);
        setResult(null);
        setAttempt(null);
        setScoreError(null);
    };

    const phase: RecordedAttemptPhase = audio.phase === 'recording'
        ? 'recording'
        : scoring
            ? 'scoring'
            : blob
                ? 'ready'
                : 'idle';

    const start = async (): Promise<void> => {
        if (phase === 'recording' || phase === 'scoring') {
            return;
        }
        reset();
        await audio.start();
    };

    const stop = (): void => {
        if (audio.phase === 'recording') {
            audio.stop();
        }
    };

    const submit = async (
        referenceText: string,
        source: ShadowingAttemptSource,
        ingestModule?: SrsSourceModule,
    ): Promise<{ result: ShadowingScoreVO; attempt: ShadowingAttemptSummary } | null> => {
        if (!blob || scoring) {
            return null;
        }
        setScoring(true);
        setScoreError(null);
        try {
            const buffer = await blob.arrayBuffer();
            const response = await shadowingApi.score({
                referenceText,
                audio: new Uint8Array(buffer),
                mimeType: blob.type || 'audio/webm',
                source,
                ...(ingestModule ? { ingestModule } : {}),
            });
            setResult(response.result);
            setAttempt(response.attempt);
            return response;
        } catch (failure) {
            logger.error('提交评测失败', { error: failure });
            setScoreError(failure instanceof Error ? failure.message : t('shadowing.scoreFailed'));
            return null;
        } finally {
            setScoring(false);
        }
    };

    return {
        phase,
        elapsedSec: audio.elapsedSec,
        recordingUrl,
        result,
        attempt,
        error: audio.error ?? scoreError,
        start,
        stop,
        submit,
        reset,
    };
}
