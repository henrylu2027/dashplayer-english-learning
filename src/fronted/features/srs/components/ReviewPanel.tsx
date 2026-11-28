import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, Mic, Play, Square, Volume2 } from 'lucide-react';

import type {
    SrsCard,
    SrsCheckResult,
    SrsReviewEvidence,
    SrsReviewForm,
    SrsSourceModule,
} from '@/common/contracts/srs';
import { SRS_PASS_SCORE } from '@/common/contracts/srs';
import type { ShadowingWordFeedback } from '@/common/contracts/shadowing';
import { hasSrsAudio, resolveSrsReviewForm } from '@/common/utils/srsReviewForm';
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
    vocab: 'srs.formVocab',
};

/** 来源模块文案键。 */
const MODULE_LABEL: Record<SrsSourceModule, string> = {
    player: 'srs.modulePlayer',
    original: 'srs.moduleOriginal',
    practice: 'srs.modulePractice',
    dialogue: 'srs.moduleDialogue',
    vocabulary: 'srs.moduleVocabulary',
};

/** 听写逐词配色：错词红、漏词灰、多余词蓝。 */
const WORD_CLASS: Record<ShadowingWordFeedback['status'], string> = {
    correct: 'text-foreground',
    mispronounced: 'rounded bg-red-500/15 px-0.5 text-red-600 dark:text-red-400',
    missing: 'rounded bg-muted px-0.5 text-muted-foreground line-through',
    extra: 'rounded bg-sky-500/15 px-0.5 text-sky-600 dark:text-sky-400 line-through',
};

/**
 * 提交给页面的作答结果；判定条据此发 verdict。
 */
export interface ReviewSubmission {
    /** 本次形态。 */
    form: SrsReviewForm;
    /** 机器分结果；听音回忆与词汇形态为 null。 */
    check: SrsCheckResult | null;
    /** 取证方式；听音回忆与词汇形态不需要。 */
    evidence?: SrsReviewEvidence;
}

/**
 * 单张卡片的复习台。
 *
 * 只负责作答与打分，不决定排期：打分结果交给页面，用户点底部判定条后由后端计算阶段。
 */
export interface ReviewPanelProps {
    /** 当前复习卡片；切换卡片时由父组件用 key 重建本组件。 */
    card: SrsCard;
    /** 作答完成（含重新录音/重写）。 */
    onSubmit: (submission: ReviewSubmission) => void;
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

export default function ReviewPanel({ card, onSubmit }: ReviewPanelProps) {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();
    const form = resolveSrsReviewForm(card);
    const recorder = useShadowingRecorder(card.referenceText, shadowingSourceFromCard(card));

    const [check, setCheck] = useState<SrsCheckResult | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [audioPhase, setAudioPhase] = useState<AudioPhase>('idle');
    const [revealed, setRevealed] = useState(false);
    /** 词汇卡展开后的词表释义；没有释义或未加载时为 null。 */
    const [definition, setDefinition] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    /** 已提交过的跟读记录，避免组件重渲染导致同一次成绩重复提交。 */
    const submittedAttemptRef = useRef<number | null>(null);

    // 听写形态的输入与逐词反馈
    const [typed, setTyped] = useState('');
    const [dictationWords, setDictationWords] = useState<ShadowingWordFeedback[]>([]);

    const canListen = hasSrsAudio(card);
    /** 定位「回到原片」请求进行中。 */
    const [locating, setLocating] = useState(false);

    /** 跳到播放器并 seek 到本句开头。 */
    const goToSource = async (): Promise<void> => {
        if (locating) {
            return;
        }
        setLocating(true);
        try {
            const location = await srsApi.cardLocation(card.id);
            navigate(`/player/${location.historyId}?srsSeek=${Math.max(0, Math.floor(location.startSeconds))}`);
        } catch (error) {
            logger.error('定位原片失败', { error, cardId: card.id });
            toast.error(error instanceof Error ? error.message : t('srs.locateFailed'));
        } finally {
            setLocating(false);
        }
    };

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

    const reportReady = useCallback((result: SrsCheckResult | null, evidence?: SrsReviewEvidence): void => {
        onSubmit({ form, check: result, evidence });
    }, [form, onSubmit]);

    /** 跟读：拿到成绩后自动打分，交给页面等待判定。 */
    useEffect(() => {
        const attempt = recorder.lastAttempt;
        if (form !== 'shadowing' || !attempt || submittedAttemptRef.current === attempt.id) {
            return;
        }
        submittedAttemptRef.current = attempt.id;
        setSubmitting(true);
        setSubmitError(null);
        const evidence: SrsReviewEvidence = { type: 'shadowing', attemptId: attempt.id };
        srsApi.check({ cardId: card.id, evidence })
            .then((result) => {
                setCheck(result);
                reportReady(result, evidence);
            })
            .catch((error) => {
                logger.error('复习打分失败', { error, cardId: card.id });
                setSubmitError(error instanceof Error ? error.message : t('srs.submitFailed'));
            })
            .finally(() => setSubmitting(false));
    }, [recorder.lastAttempt, form, card.id, reportReady, t]);

    const isRecording = recorder.phase === 'recording';
    const isScoring = recorder.phase === 'scoring';

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
        if (isScoring || submitting) {
            return;
        }
        if (isRecording) {
            recorder.stop();
            return;
        }
        setCheck(null);
        setSubmitError(null);
        stopAudio();
        void recorder.start();
    };

    /** 听写：先本地校对拿记录，再打分交给页面。 */
    const handleDictation = async (): Promise<void> => {
        if (!typed.trim() || submitting) {
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
            const evidence: SrsReviewEvidence = { type: 'dictation', attemptId: result.attempt.id };
            const scored = await srsApi.check({ cardId: card.id, evidence });
            setCheck(scored);
            reportReady(scored, evidence);
        } catch (dictationError) {
            logger.error('听写复习失败', { error: dictationError, cardId: card.id });
            setSubmitError(dictationError instanceof Error ? dictationError.message : t('srs.submitFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    /** 听音回忆与词汇：展开原文即视为已作答。 */
    const reveal = (): void => {
        setRevealed(true);
        reportReady(null);
        if (form === 'vocab' && definition === null && card.word) {
            srsApi.wordDefinition(card.id)
                .then((result) => setDefinition(result.translate))
                .catch((error) => {
                    logger.error('读取词表释义失败', { error, cardId: card.id });
                });
        }
    };

    return (
        <section className="flex h-full min-h-0 flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div className="shrink-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        {t('srs.sourceLabel', {
                            module: card.sourceModules.length > 0
                                ? card.sourceModules.map((module) => t(MODULE_LABEL[module])).join(' / ')
                                : card.sourceKind === 'video'
                                    ? t('srs.sourceVideo')
                                    : t('srs.sourceFree'),
                        })}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5">{t(FORM_LABEL[form])}</span>
                    <span>{t('srs.stage', { stage: card.stage })}</span>
                    {form !== 'recall' && form !== 'vocab' && (
                        <span>{t('srs.passLine', { score: SRS_PASS_SCORE })}</span>
                    )}
                    {card.lastScore !== null && (
                        <span>{t('srs.lastScore', { score: card.lastScore })}</span>
                    )}
                    {canListen && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="ml-auto h-7 rounded-lg px-2.5 text-[11px]"
                            disabled={locating}
                            onClick={() => void goToSource()}
                        >
                            {locating
                                ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                : <Play className="mr-1 h-3 w-3" />}
                            {t('srs.goToSource')}
                        </Button>
                    )}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {form === 'shadowing' && (
                    <div className="flex flex-col gap-4">
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
                                disabled={isScoring || submitting}
                                aria-label={isRecording ? t('shadowing.stopRecording') : t('shadowing.startRecording')}
                                className={cn(
                                    'relative flex h-16 w-16 items-center justify-center rounded-full transition-all',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                    isRecording
                                        ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                                        : 'bg-primary text-primary-foreground hover:scale-105',
                                    (isScoring || submitting) && 'cursor-not-allowed opacity-60',
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
                                            : check !== null
                                                ? t('srs.verdictHint')
                                                : t('srs.reviewPrompt')}
                            </div>
                        </div>
                        {recorder.error && (
                            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                                {recorder.error}
                            </div>
                        )}
                        {recorder.result && <ScorePanel result={recorder.result} />}
                    </div>
                )}

                {form === 'dictation' && (
                    <div className="flex flex-col gap-3">
                        <p className="text-xs text-muted-foreground">{t('srs.dictationPrompt')}</p>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-lg px-3 text-xs"
                                disabled={!canListen || audioPhase === 'loading' || submitting}
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
                            disabled={submitting}
                            className="min-h-[96px] resize-none text-sm"
                        />
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-muted-foreground">
                                {check?.score === null || check?.score === undefined
                                    ? ''
                                    : t('srs.dictationResult', { score: check.score })}
                            </span>
                            <Button
                                type="button"
                                size="sm"
                                className="rounded-lg"
                                disabled={!typed.trim() || submitting}
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
                        {dictationWords.length > 0 && (
                            <p className="text-sm text-foreground">{card.referenceText}</p>
                        )}
                    </div>
                )}

                {form === 'recall' && (
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-lg px-3 text-xs"
                                disabled={!canListen || audioPhase === 'loading'}
                                onClick={() => void toggleAudio()}
                            >
                                {audioPhase === 'loading' ? (
                                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Volume2 className="mr-1 h-3.5 w-3.5" />
                                )}
                                {audioPhase === 'playing' ? t('srs.stopAudio') : t('srs.listen')}
                            </Button>
                            <span className="text-xs text-muted-foreground">{t('srs.recallHint2')}</span>
                        </div>
                        {revealed ? (
                            <p className="text-xl leading-9 text-foreground">{card.referenceText}</p>
                        ) : (
                            <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                                {t('srs.recallHidden')}
                            </div>
                        )}
                        {!revealed && (
                            <Button type="button" size="sm" variant="outline" className="w-fit rounded-lg" onClick={reveal}>
                                <Eye className="mr-1 h-3.5 w-3.5" />
                                {t('srs.showAnswer')}
                            </Button>
                        )}
                        {revealed && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <EyeOff className="h-3.5 w-3.5" />
                                {t('srs.verdictHint')}
                            </span>
                        )}
                    </div>
                )}

                {form === 'vocab' && (
                    <div className="flex flex-col gap-4">
                        <div className="rounded-xl bg-muted/40 px-4 py-5 text-center">
                            <div className="text-2xl font-semibold tracking-tight text-foreground">{card.word}</div>
                            <p className="mt-1 text-xs text-muted-foreground">{t('srs.vocabHint')}</p>
                        </div>
                        {revealed ? (
                            <>
                                {definition && (
                                    <p className="rounded-xl bg-primary/5 px-3 py-2 text-sm text-primary">
                                        {definition}
                                    </p>
                                )}
                                <p className="text-lg leading-8 text-foreground">{card.referenceText}</p>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8 rounded-lg px-3 text-xs"
                                        disabled={!canListen || audioPhase === 'loading'}
                                        onClick={() => void toggleAudio()}
                                    >
                                        {audioPhase === 'loading' ? (
                                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Volume2 className="mr-1 h-3.5 w-3.5" />
                                        )}
                                        {audioPhase === 'playing' ? t('srs.stopAudio') : t('srs.listen')}
                                    </Button>
                                    <span className="text-xs text-muted-foreground">{t('srs.verdictHint')}</span>
                                </div>
                            </>
                        ) : (
                            <Button type="button" size="sm" variant="outline" className="w-fit rounded-lg" onClick={reveal}>
                                <Eye className="mr-1 h-3.5 w-3.5" />
                                {t('srs.vocabShow')}
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {submitError && (
                <div className="shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                    {submitError}
                </div>
            )}

            {check !== null && check.score !== null && (
                <div
                    className={cn(
                        'shrink-0 rounded-xl border px-4 py-2 text-sm',
                        check.passed
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
                    )}
                >
                    {t('srs.checkResult', { score: check.score, passLine: check.passLine })}
                </div>
            )}
        </section>
    );
}
