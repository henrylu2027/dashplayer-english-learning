import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { BookmarkPlus, Loader2, Mic, Square } from 'lucide-react';

import type { PracticeAttemptSummary, RetellResult } from '@/common/contracts/practice';
import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';
import { Button } from '@/fronted/components/ui/button';
import { srsApi } from '@/fronted/features/srs/srsApi';
import { useAudioRecorder } from '@/fronted/features/shadowing/useAudioRecorder';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { extractRetellKeywords } from '@/common/utils/retellKeywords';
import { practiceApi } from '../practiceApi';
import PracticeAudioButton from './PracticeAudioButton';

const logger = getRendererLogger('RetellPanel');

/** 复述提示级别。 */
type ScaffoldLevel = 'full' | 'keywords' | 'hidden';

/** 覆盖率徽标配色。 */
function coverageTone(score: number): string {
    if (score >= 80) {
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    }
    if (score >= 50) {
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    }
    return 'bg-red-500/10 text-red-500';
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

/**
 * 复述面板：三级提示（完整原文 → 关键词 → 隐藏）下录音复述，按关键词覆盖评测。
 *
 * 复述不要求逐字一致，因此不使用跟读的逐词评分；只检查参考句的关键信息有没有说到。
 */
export default function RetellPanel({
    referenceText,
    source,
    canPlayAudio,
    onSaved,
}: {
    referenceText: string;
    source: ShadowingAttemptSource;
    canPlayAudio: boolean;
    onSaved: (attempt: PracticeAttemptSummary) => void;
}) {
    const { t } = useTranslation('pages');
    const keywords = extractRetellKeywords(referenceText);
    const [level, setLevel] = useState<ScaffoldLevel>('keywords');
    const [result, setResult] = useState<RetellResult | null>(null);
    const [processing, setProcessing] = useState(false);
    const [requestError, setRequestError] = useState<string | null>(null);

    const handleRecording = async (blob: Blob): Promise<void> => {
        if (blob.size === 0) {
            setRequestError(t('practice.noSpeech'));
            return;
        }
        setProcessing(true);
        setRequestError(null);
        try {
            const buffer = await blob.arrayBuffer();
            const checked = await practiceApi.retell({
                referenceText,
                source,
                audio: new Uint8Array(buffer),
                mimeType: blob.type || 'audio/webm',
            });
            setResult(checked);
            onSaved(checked.attempt);
        } catch (checkError) {
            logger.error('复述评测失败', { error: checkError });
            setRequestError(checkError instanceof Error ? checkError.message : t('practice.retellFailed'));
        } finally {
            setProcessing(false);
        }
    };

    const audio = useAudioRecorder({ onStop: handleRecording });
    const isRecording = audio.phase === 'recording';
    const error = audio.error ?? requestError;

    const handleMicClick = (): void => {
        if (isRecording) {
            audio.stop();
            return;
        }
        if (processing) {
            return;
        }
        setResult(null);
        setRequestError(null);
        void audio.start();
    };

    const handleAddToReview = async (): Promise<void> => {
        try {
            const response = await srsApi.addCard({ referenceText, source });
            toast.success(response.created ? t('practice.addedToReview') : t('practice.alreadyInReview'));
        } catch (addError) {
            logger.error('加入复习失败', { error: addError });
            toast.error(addError instanceof Error ? addError.message : t('practice.addToReviewFailed'));
        }
    };

    const handleRetry = (): void => {
        setResult(null);
        setRequestError(null);
    };

    return (
        <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-medium text-foreground">{t('practice.modeRetell')}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t('practice.retellPrompt')}</p>
                </div>
                <PracticeAudioButton
                    source={source}
                    canPlay={canPlayAudio}
                    disabled={isRecording || processing}
                />
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
                {([
                    { level: 'full' as const, label: t('practice.scaffoldFull') },
                    { level: 'keywords' as const, label: t('practice.scaffoldKeywords') },
                    { level: 'hidden' as const, label: t('practice.scaffoldHidden') },
                ]).map((item) => (
                    <button
                        key={item.level}
                        type="button"
                        onClick={() => setLevel(item.level)}
                        className={cn(
                            'rounded-md px-2.5 py-1 text-xs transition-colors',
                            level === item.level
                                ? 'bg-background text-foreground shadow-xs'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {level === 'full' && (
                <div className="rounded-xl bg-muted/50 px-3 py-2 text-sm leading-6 text-foreground">
                    {referenceText}
                </div>
            )}
            {level === 'keywords' && (
                <div className="flex flex-wrap gap-1.5">
                    {keywords.map((word) => (
                        <span
                            key={word}
                            className="rounded-full border border-border/60 px-2.5 py-1 text-xs text-foreground/80"
                        >
                            {word}
                        </span>
                    ))}
                </div>
            )}
            {level === 'hidden' && (
                <div className="rounded-xl border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                    {t('practice.hiddenHint')}
                </div>
            )}

            <div className="flex flex-col items-center gap-2 border-t border-border/50 pt-4">
                <button
                    type="button"
                    onClick={handleMicClick}
                    disabled={processing}
                    aria-label={isRecording ? t('practice.stopRecording') : t('practice.startRecording')}
                    className={cn(
                        'relative flex h-16 w-16 items-center justify-center rounded-full transition-all',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                        isRecording
                            ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                            : 'bg-primary text-primary-foreground hover:scale-105',
                        processing && 'cursor-wait opacity-60',
                    )}
                >
                    {isRecording && (
                        <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-red-500/20" />
                    )}
                    {isRecording ? (
                        <Square className="h-5 w-5 fill-current" />
                    ) : processing ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                        <Mic className="h-6 w-6" />
                    )}
                </button>
                <div className="h-5 text-sm text-muted-foreground">
                    {isRecording
                        ? t('practice.recording', { time: formatElapsed(audio.elapsedSec) })
                        : processing
                            ? t('practice.retellProcessing')
                            : t('practice.retellIdle')}
                </div>
            </div>

            {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                    {error}
                </div>
            )}

            {result && (
                <div className="flex flex-col gap-3 border-t border-border/50 pt-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <span
                            className={cn(
                                'flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl',
                                coverageTone(result.coverage),
                            )}
                        >
                            <span className="text-xl font-semibold tabular-nums leading-none">{result.coverage}%</span>
                            <span className="mt-1 text-[10px]">{t('practice.coverage')}</span>
                        </span>
                        <span className="text-sm text-muted-foreground">
                            {t('practice.coveredCount', {
                                covered: result.keywords.filter((keyword) => keyword.covered).length,
                                total: result.keywords.length,
                            })}
                        </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                        {result.keywords.map((keyword) => (
                            <span
                                key={keyword.word}
                                title={keyword.covered ? t('practice.keywordCovered') : t('practice.keywordMissed')}
                                className={cn(
                                    'rounded-full px-2.5 py-1 text-xs',
                                    keyword.covered
                                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                        : 'bg-muted text-muted-foreground line-through',
                                )}
                            >
                                {keyword.word}
                            </span>
                        ))}
                    </div>

                    <div className="rounded-xl bg-muted/50 px-3 py-2">
                        <div className="text-xs text-muted-foreground">{t('practice.recognized')}</div>
                        <p className="mt-0.5 text-sm text-foreground">
                            {result.recognizedText || t('practice.noRecognized')}
                        </p>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-3 text-xs"
                            onClick={() => void handleAddToReview()}
                        >
                            <BookmarkPlus className="mr-1 h-3.5 w-3.5" />
                            {t('practice.addToReview')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-3 text-xs"
                            onClick={handleRetry}
                        >
                            {t('practice.retry')}
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}
