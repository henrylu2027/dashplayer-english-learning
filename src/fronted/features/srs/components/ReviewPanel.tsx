import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Loader2, Mic, Square, Volume2 } from 'lucide-react';

import type { SrsCard, SrsReviewOutcome } from '@/common/contracts/srs';
import { SRS_PASS_SCORE } from '@/common/contracts/srs';
import UrlUtil from '@/common/utils/UrlUtil';
import { Button } from '@/fronted/components/ui/button';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import ScorePanel from '@/fronted/features/shadowing/components/ScorePanel';
import { shadowingSourceFromCard } from '@/fronted/features/shadowing/shadowingSource';
import { useShadowingRecorder } from '@/fronted/features/shadowing/useShadowingRecorder';
import { srsApi } from '../srsApi';

const logger = getRendererLogger('SrsReviewPanel');

/**
 * 单张卡片的复习面板：听原声 → 跟读录音 → 自动评分 → 提交复习判定。
 */
export interface ReviewPanelProps {
    /** 当前复习卡片；切换卡片时由父组件用 key 重建本组件。 */
    card: SrsCard;
    /** 今天是否还有别的待复习卡片。 */
    hasNextDue: boolean;
    /** 复习结果写入成功后通知父组件刷新列表。 */
    onReviewed: (outcome: SrsReviewOutcome) => void;
    /** 点击“下一张/完成今日复习”。 */
    onNext: () => void;
}

/** 复习面板里的原声播放阶段。 */
type AudioPhase = 'idle' | 'loading' | 'playing';

/**
 * 把秒数格式化为 `分:秒`。
 * @param seconds 已录制秒数。
 */
function formatElapsed(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * 单卡复习面板。
 *
 * 评分仍走跟读页同一套链路（录音 → 本地识别 → 逐词打分 → 落库），
 * 拿到跟读记录 ID 后再提交给 SRS 服务判定是否通过；前端不自行计算通过与否。
 */
export default function ReviewPanel({ card, hasNextDue, onReviewed, onNext }: ReviewPanelProps) {
    const { t } = useTranslation('pages');
    const recorder = useShadowingRecorder(card.referenceText, shadowingSourceFromCard(card));

    const [outcome, setOutcome] = useState<SrsReviewOutcome | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [audioPhase, setAudioPhase] = useState<AudioPhase>('idle');
    const audioRef = useRef<HTMLAudioElement | null>(null);
    /** 已提交过的跟读记录，避免组件重渲染导致同一次成绩重复提交。 */
    const submittedAttemptRef = useRef<number | null>(null);

    const stopAudio = (): void => {
        audioRef.current?.pause();
        audioRef.current = null;
        setAudioPhase('idle');
    };

    // 卸载时停止原声，避免离开页面后还在后台播放
    useEffect(() => {
        return () => {
            audioRef.current?.pause();
            audioRef.current = null;
        };
    }, []);

    // 拿到新的跟读成绩后自动提交复习判定
    useEffect(() => {
        const attempt = recorder.lastAttempt;
        if (!attempt || submittedAttemptRef.current === attempt.id) {
            return;
        }
        submittedAttemptRef.current = attempt.id;
        setSubmitting(true);
        setSubmitError(null);
        (async () => {
            try {
                const reviewed = await srsApi.submitReview({ cardId: card.id, attemptId: attempt.id });
                setOutcome(reviewed);
                onReviewed(reviewed);
            } catch (submitFailure) {
                logger.error('提交复习结果失败', { error: submitFailure, cardId: card.id });
                setSubmitError(submitFailure instanceof Error ? submitFailure.message : t('srs.submitFailed'));
            } finally {
                setSubmitting(false);
            }
        })();
    }, [recorder.lastAttempt, card.id, onReviewed, t]);

    const isRecording = recorder.phase === 'recording';
    const isScoring = recorder.phase === 'scoring';
    /** 通过后锁定录音，防止重复提交把阶段又推进一格。 */
    const passed = outcome?.passed === true;
    /** 视频句且保留着视频/字幕路径时才能提取原声。 */
    const canListen = card.sourceKind === 'video' && Boolean(card.videoPath) && Boolean(card.subtitlePath);

    const toggleAudio = async (): Promise<void> => {
        if (audioPhase === 'playing') {
            stopAudio();
            return;
        }
        if (audioPhase === 'loading' || !canListen) {
            return;
        }
        setAudioPhase('loading');
        try {
            const filePath = await srsApi.sentenceAudio(card.id);
            const audio = new Audio(UrlUtil.toUrl(filePath));
            audioRef.current = audio;
            audio.onended = () => {
                audioRef.current = null;
                setAudioPhase('idle');
            };
            await audio.play();
            setAudioPhase('playing');
        } catch (audioError) {
            logger.error('播放原声失败', { error: audioError, cardId: card.id });
            toast.error(audioError instanceof Error ? audioError.message : t('srs.listenFailed'));
            setAudioPhase('idle');
        }
    };

    const handleMicClick = (): void => {
        if (passed) {
            return;
        }
        if (isRecording) {
            recorder.stop();
            return;
        }
        // 开始新一轮朗读前清掉上一轮判定与原声，避免界面残留旧结果
        setOutcome(null);
        setSubmitError(null);
        stopAudio();
        void recorder.start();
    };

    return (
        <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                        {card.sourceKind === 'video' ? t('srs.sourceVideo') : t('srs.sourceFree')}
                        <span className="mx-1.5">·</span>
                        {t('srs.stage', { stage: card.stage })}
                    </span>
                    <span>{t('srs.passLine', { score: SRS_PASS_SCORE })}</span>
                </div>
                <p className="mt-2 text-xl leading-9 text-foreground">{card.referenceText}</p>
                {card.lastScore !== null && (
                    <p className="mt-1 text-xs text-muted-foreground">
                        {t('srs.lastScore', { score: card.lastScore })}
                    </p>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg px-3 text-xs"
                    disabled={!canListen || audioPhase === 'loading' || isRecording || isScoring}
                    onClick={() => void toggleAudio()}
                >
                    {audioPhase === 'loading' ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Volume2 className="mr-1 h-3.5 w-3.5" />
                    )}
                    {audioPhase === 'playing' ? t('srs.stopAudio') : t('srs.listen')}
                </Button>
                {!canListen && (
                    <span className="text-xs text-muted-foreground">
                        {card.sourceKind === 'video' ? t('srs.missingAudioHint') : t('srs.freeAudioHint')}
                    </span>
                )}
            </div>

            <div className="flex flex-col items-center gap-2 border-t border-border/50 pt-4">
                <button
                    type="button"
                    onClick={handleMicClick}
                    disabled={isScoring || submitting || passed}
                    aria-label={isRecording ? t('shadowing.stopRecording') : t('shadowing.startRecording')}
                    className={cn(
                        'relative flex h-16 w-16 items-center justify-center rounded-full transition-all',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                        isRecording
                            ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                            : 'bg-primary text-primary-foreground hover:scale-105',
                        (isScoring || submitting || passed) && 'cursor-not-allowed opacity-60',
                    )}
                >
                    {isRecording && (
                        <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-red-500/20" />
                    )}
                    {isRecording ? (
                        <Square className="h-5 w-5 fill-current" />
                    ) : isScoring || submitting ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                        <Mic className="h-6 w-6" />
                    )}
                </button>
                <div className="h-5 text-sm text-muted-foreground">
                    {isRecording
                        ? t('shadowing.recording', { time: formatElapsed(recorder.elapsedSec) })
                        : isScoring
                            ? t('shadowing.scoring')
                            : submitting
                                ? t('srs.submitting')
                                : passed
                                    ? t('srs.passedMicLocked')
                                    : t('srs.reviewPrompt')}
                </div>
            </div>

            {recorder.error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                    {recorder.error}
                </div>
            )}
            {submitError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                    {submitError}
                </div>
            )}

            {outcome && (
                <div
                    className={cn(
                        'rounded-xl border px-4 py-3 text-sm',
                        outcome.passed
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
                    )}
                >
                    <div className="font-medium">
                        {outcome.passed
                            ? t('srs.passedTitle', { score: outcome.score })
                            : t('srs.failedTitle', { score: outcome.score })}
                    </div>
                    <div className="mt-0.5 text-xs opacity-90">
                        {outcome.passed
                            ? t('srs.passedDetail', { days: outcome.intervalDays })
                            : t('srs.failedDetail')}
                    </div>
                </div>
            )}

            {recorder.result && <ScorePanel result={recorder.result} />}

            {passed && (
                <div className="flex justify-end">
                    <Button type="button" size="sm" className="rounded-lg" onClick={onNext}>
                        {hasNextDue ? t('srs.nextCard') : t('srs.finishToday')}
                    </Button>
                </div>
            )}
        </section>
    );
}
