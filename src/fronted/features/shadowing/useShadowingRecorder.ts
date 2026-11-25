import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type {
    ShadowingAttemptSource,
    ShadowingAttemptSummary,
    ShadowingScoreVO,
} from '@/common/contracts/shadowing';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { shadowingApi } from './shadowingApi';
import { useAudioRecorder } from './useAudioRecorder';

const logger = getRendererLogger('useShadowingRecorder');

/** 页面上展示的最近跟读条数。 */
const RECENT_ATTEMPT_LIMIT = 5;

/** 录音与评分阶段。 */
export type ShadowingPhase = 'idle' | 'recording' | 'scoring';

/**
 * 跟读录音与评分状态。
 */
export interface ShadowingRecorder {
    /** 当前阶段。 */
    phase: ShadowingPhase;
    /** 已录制时长（秒）；离开录音阶段后归零。 */
    elapsedSec: number;
    /** 最近一次评测结果；开始新录音时清空。 */
    result: ShadowingScoreVO | null;
    /** 最近一次评分落库后的记录；开始新录音时清空，供复习页提交判定。 */
    lastAttempt: ShadowingAttemptSummary | null;
    /** 最近一次评分实际使用的来源快照；开始新录音时清空，供加入复习使用。 */
    scoredSource: ShadowingAttemptSource | null;
    /** 最近跟读记录，按时间倒序；评分成功后立即插入最新一条。 */
    attempts: ShadowingAttemptSummary[];
    /** 最近一次失败原因；开始新录音时清空。 */
    error: string | null;
    /** 参考文本是否为空。 */
    hasReferenceText: boolean;
    /** 开始录音；参考文本为空或麦克风不可用时给出提示并保持空闲。 */
    start: () => Promise<void>;
    /** 停止录音并进入评分。 */
    stop: () => void;
}

/**
 * 跟读录音与评分：录音交给通用录音器，本 Hook 负责评分、落库与历史。
 *
 * @param referenceText 当前输入的参考文本；录音开始时会被快照，录音期间改文本不影响本次评分。
 * @param source 当前句子来源；录音开始时同样快照，评分记录据此绑定视频句子或标记为自由输入。
 */
export function useShadowingRecorder(
    referenceText: string,
    source: ShadowingAttemptSource,
): ShadowingRecorder {
    const { t } = useTranslation('pages');

    const [scoring, setScoring] = useState(false);
    const [result, setResult] = useState<ShadowingScoreVO | null>(null);
    const [lastAttempt, setLastAttempt] = useState<ShadowingAttemptSummary | null>(null);
    const [scoredSource, setScoredSource] = useState<ShadowingAttemptSource | null>(null);
    const [attempts, setAttempts] = useState<ShadowingAttemptSummary[]>([]);
    const [scoreError, setScoreError] = useState<string | null>(null);

    /** 录音开始时的参考文本快照，评分只认它，避免录音期间改文本导致比对错位。 */
    const activeReferenceRef = useRef('');
    /** 录音开始时的句子来源快照，评分记录按它绑定视频句子。 */
    const activeSourceRef = useRef<ShadowingAttemptSource>({ kind: 'free' });
    /** 最新参考文本，事件回调里读取，避免闭包拿到旧值。 */
    const referenceTextRef = useRef(referenceText);
    /** 最新句子来源，录音开始时快照。 */
    const sourceRef = useRef<ShadowingAttemptSource>(source);

    useEffect(() => {
        referenceTextRef.current = referenceText;
    }, [referenceText]);

    useEffect(() => {
        sourceRef.current = source;
    }, [source]);

    // 挂载时读取最近记录，让用户一进页面就能看到历史；条数固定，与后端上限对齐
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const recent = await shadowingApi.listAttempts({ limit: RECENT_ATTEMPT_LIMIT });
                if (!cancelled) {
                    setAttempts(recent);
                }
            } catch (historyError) {
                logger.error('加载跟读记录失败', { error: historyError });
                if (!cancelled) {
                    toast.error(t('shadowing.historyFailed'));
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [t]);

    /**
     * 录音结束后的评分流程。
     *
     * 空录音属正常结果（用户没开口），只给中性提示，不进错误通道。
     * @param blob 完整录音。
     */
    const scoreRecording = async (blob: Blob): Promise<void> => {
        if (blob.size === 0) {
            setScoreError(t('shadowing.noSpeech'));
            return;
        }
        setScoring(true);
        setScoreError(null);
        try {
            const buffer = await blob.arrayBuffer();
            const response = await shadowingApi.score({
                referenceText: activeReferenceRef.current,
                audio: new Uint8Array(buffer),
                mimeType: blob.type || 'audio/webm',
                source: activeSourceRef.current,
            });
            setResult(response.result);
            setLastAttempt(response.attempt);
            setScoredSource(activeSourceRef.current);
            // 后端是记录的唯一真相源；这里只把刚保存的一条插到最前，避免整表重取
            setAttempts((prev) => [
                response.attempt,
                ...prev.filter((attempt) => attempt.id !== response.attempt.id),
            ].slice(0, RECENT_ATTEMPT_LIMIT));
        } catch (scoreFailure) {
            logger.error('跟读评分失败', { error: scoreFailure });
            setScoreError(scoreFailure instanceof Error ? scoreFailure.message : t('shadowing.scoreFailed'));
        } finally {
            setScoring(false);
        }
    };

    const audio = useAudioRecorder({ onStop: scoreRecording });

    const phase: ShadowingPhase = audio.phase === 'recording'
        ? 'recording'
        : scoring
            ? 'scoring'
            : 'idle';

    const start = async (): Promise<void> => {
        if (phase !== 'idle') {
            return;
        }
        const text = referenceTextRef.current.trim();
        if (!text) {
            toast.error(t('shadowing.emptyText'));
            return;
        }
        setScoreError(null);
        setResult(null);
        setLastAttempt(null);
        setScoredSource(null);
        activeReferenceRef.current = text;
        activeSourceRef.current = sourceRef.current;
        await audio.start();
    };

    const stop = (): void => {
        if (audio.phase === 'recording') {
            audio.stop();
        }
    };

    return {
        phase,
        elapsedSec: audio.elapsedSec,
        result,
        lastAttempt,
        scoredSource,
        attempts,
        error: audio.error ?? scoreError,
        hasReferenceText: referenceText.trim().length > 0,
        start,
        stop,
    };
}
