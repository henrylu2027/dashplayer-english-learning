import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Loader2, Mic, Square, Volume2 } from 'lucide-react';

import type {
    SrsCard,
    SrsReviewEvidence,
    SrsReviewForm,
    SrsReviewOutcome,
} from '@/common/contracts/srs';
import { SRS_PASS_SCORE } from '@/common/contracts/srs';
import type { ShadowingWordFeedback } from '@/common/contracts/shadowing';
import { resolveSrsReviewForm } from '@/common/utils/srsReviewForm';
import UrlUtil from '@/common/utils/UrlUtil';
import { Button } from '@/fronted/components/ui/button';
import { Textarea } from '@/fronted/components/ui/textarea';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import ScorePanel from '@/fronted/features/shadowing/components/ScorePanel';
import { shadowingSourceFromCard } from '@/fronted/features/shadowing/shadowingSource';
import { useShadowingRecorder } from '@/fronted/features/shadowing/useShadowingRecorder';
import { practiceApi } from '@/fronted/features/practice/practiceApi';
import { srsApi } from '../srsApi';

const logger = getRendererLogger('SrsReviewPanel');

/** 复习面板里的原声播放阶段。 */
type AudioPhase = 'idle' | 'loading' | 'playing';

/** 形态对应的界面文案键。 */
const FORM_LABEL: Record<SrsReviewForm, string> = {
    shadowing: 'srs.formShadowing',
    dictation: 'srs.formDictation',
    recall: 'srs.formRecall',
};

/** 听写逐词配色：错词红、漏词灰、多余词蓝。 */
const WORD_CLASS: Record<ShadowingWordFeedback['status'], string> = {
    correct: 'text-foreground',
    mispronounced: 'rounded bg-red-500/15 px-0.5 text-red-600 dark:text-red-400',
    missing: 'rounded bg-muted px-0.5 text-muted-foreground line-through',
    extra: 'rounded bg-sky-500/15 px-0.5 text-sky-600 dark:text-sky-400 line-through',
};

/**
 * 单张卡片的复习面板。
 *
 * 形态由卡片原料与阶段决定（见 `resolveSrsReviewForm`）：
 * - 跟读：录音 → 本地识别打分 → 提交跟读记录；
 * - 听写：听原声 → 键盘输入 → 提交听写记录；
 * - 认词：看词自评，只用于没有语境的词卡。
 *
 * 判定与排期全部在后端；本组件不自行计算通过与否。
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

/**
 * 把秒数格式化为 `分:秒`。
 * @param seconds 已录制秒数。
 */
function formatElapsed(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
}

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

    // 听写形态的输入与逐词反馈
    const [typed, setTyped] = useState('');
    const [dictationWords, setDictationWords] = useState<ShadowingWordFeedback[]>([]);
    const [dictationScore, setDictationScore] = useState<number | null>(null);

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

    /**
     * 通过的瞬间后端已把阶段推进，下一形态可能立刻变化；
     * 此时锁定为本次实际使用的形态，只展示结果，不把界面切成新题。
     * 未通过时按卡片当前阶段重算，保证重试用的就是后端要求的形态。
     */
    const form = outcome?.passed ? outcome.form : resolveSrsReviewForm(card);

    /** 提交一种取证方式；分数与判定由后端读取记录后决定。 */
    const submitEvidence = useCallback(async (evidence: SrsReviewEvidence): Promise<void> => {
        setSubmitting(true);
        setSubmitError(null);
        try {
            const reviewed = await srsApi.submitReview({ cardId: card.id, evidence });
            setOutcome(reviewed);
            onReviewed(reviewed);
        } catch (submitFailure) {
            logger.error('提交复习结果失败', {
                error: submitFailure,
                cardId: card.id,
                evidenceType: evidence.type,
            });
            setSubmitError(submitFailure instanceof Error ? submitFailure.message : t('srs.submitFailed'));
        } finally {
            setSubmitting(false);
        }
    }, [card.id, onReviewed, t]);

    // 跟读拿到新成绩后自动提交；其它形态没有跟读记录
    useEffect(() => {
        const attempt = recorder.lastAttempt;
        if (form !== 'shadowing' || !attempt || submittedAttemptRef.current === attempt.id) {
            return;
        }
        submittedAttemptRef.current = attempt.id;
        void submitEvidence({ type: 'shadowing', attemptId: attempt.id });
    }, [recorder.lastAttempt, form, submitEvidence]);

    const isRecording = recorder.phase === 'recording';
    const isScoring = recorder.phase === 'scoring';
    /** 通过后锁定作答，防止重复提交把阶段又推进一格。 */
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

    /** 听写：先本地校对拿记录，再用记录 ID 提交判定。 */
    const handleDictation = async (): Promise<void> => {
        if (!typed.trim() || submitting || passed) {
            return;
        }
        setSubmitting(true);
        setSubmitError(null);
        try {
            const result = await practiceApi.dictation({
                referenceText: card.referenceText,
                typedText: typed.trim(),
                source: shadowingSourceFromCard(card),
                forReview: true,
            });
            setDictationWords(result.words);
            setDictationScore(result.accuracy);
            const reviewed = await srsApi.submitReview({
                cardId: card.id,
                evidence: { type: 'dictation', attemptId: result.attempt.id },
            });
            setOutcome(reviewed);
            onReviewed(reviewed);
        } catch (dictationError) {
            logger.error('听写复习失败', { error: dictationError, cardId: card.id });
            setSubmitError(dictationError instanceof Error ? dictationError.message : t('srs.submitFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    const handleRecall = (remembered: boolean): void => {
        if (submitting || passed) {
            return;
        }
        void submitEvidence({ type: 'recall', remembered });
    };

    return (
        <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                        {card.sourceKind === 'video' ? t('srs.sourceVideo') : t('srs.sourceFree')}
                        <span>·</span>
                        {t('srs.stage', { stage: card.stage })}
                        <span
                            className={cn(
                                'rounded-full px-1.5 py-0.5 font-medium',
                                form === 'recall'
                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                    : 'bg-primary/10 text-primary',
                            )}
                        >
                            {t(FORM_LABEL[form])}
                        </span>
                    </span>
                    {form !== 'recall' && <span>{t('srs.passLine', { score: SRS_PASS_SCORE })}</span>}
                </div>
                {card.lastScore !== null && (
                    <p className="mt-1 text-xs text-muted-foreground">
                        {t('srs.lastScore', { score: card.lastScore })}
                    </p>
                )}
            </div>

            {form === 'shadowing' && (
                <>
                    <p className="text-xl leading-9 text-foreground">{card.referenceText}</p>
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
                </>
            )}

            {form === 'dictation' && (
                <>
                    <p className="text-xs text-muted-foreground">{t('srs.dictationPrompt')}</p>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-3 text-xs"
                            disabled={audioPhase === 'loading' || submitting}
                            onClick={() => void toggleAudio()}
                        >
                            {audioPhase === 'loading' ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Volume2 className="mr-1 h-3.5 w-3.5" />
                            )}
                            {audioPhase === 'playing' ? t('srs.stopAudio') : t('srs.listen')}
                        </Button>
                    </div>
                    <Textarea
                        value={typed}
                        onChange={(event) => setTyped(event.target.value)}
                        placeholder={t('srs.dictationPlaceholder')}
                        disabled={submitting || passed}
                        className="min-h-[84px] resize-none text-sm"
                    />
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">
                            {dictationScore === null ? '' : t('srs.dictationResult', { score: dictationScore })}
                        </span>
                        <Button
                            type="button"
                            size="sm"
                            className="rounded-lg"
                            disabled={!typed.trim() || submitting || passed}
                            onClick={() => void handleDictation()}
                        >
                            {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                            {t('srs.dictationSubmit')}
                        </Button>
                    </div>
                    {dictationWords.length > 0 && (
                        <div className="flex flex-wrap gap-x-1 gap-y-0.5 border-t border-border/50 pt-3 text-sm">
                            {dictationWords
                                .filter((word) => word.status !== 'extra')
                                .map((word, index) => (
                                    <span key={`${index}-${word.expected ?? word.actual}`} className={WORD_CLASS[word.status]}>
                                        {word.expected ?? word.actual}
                                    </span>
                                ))}
                        </div>
                    )}
                    {passed && (
                        <p className="text-sm text-foreground">{card.referenceText}</p>
                    )}
                </>
            )}

            {form === 'recall' && (
                <>
                    <p className="text-2xl font-semibold tracking-tight text-foreground">{card.referenceText}</p>
                    <p className="text-xs text-muted-foreground">{t('srs.recallHint')}</p>
                    <div className="flex items-center gap-2 border-t border-border/50 pt-4">
                        <Button
                            type="button"
                            className="h-9 flex-1 rounded-lg"
                            disabled={submitting || passed}
                            onClick={() => handleRecall(true)}
                        >
                            {t('srs.recallRemembered')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-9 flex-1 rounded-lg"
                            disabled={submitting || passed}
                            onClick={() => handleRecall(false)}
                        >
                            {t('srs.recallForgot')}
                        </Button>
                    </div>
                </>
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

            {form === 'shadowing' && recorder.result && <ScorePanel result={recorder.result} />}

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
