import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { BookmarkPlus, CheckCheck, Loader2 } from 'lucide-react';

import type { DictationResult, PracticeAttemptSummary } from '@/common/contracts/practice';
import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';
import { Button } from '@/fronted/components/ui/button';
import { Textarea } from '@/fronted/components/ui/textarea';
import { srsApi } from '@/fronted/features/srs/srsApi';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { practiceApi } from '../practiceApi';
import PracticeAudioButton from './PracticeAudioButton';
import PracticeWordDiff from './PracticeWordDiff';

const logger = getRendererLogger('DictationPanel');

/** 词准确率徽标配色。 */
function scoreTone(score: number): string {
    if (score >= 85) {
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    }
    if (score >= 70) {
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    }
    return 'bg-red-500/10 text-red-500';
}

/**
 * 听写面板：听原声 → 键入听到的句子 → 逐词校对。
 */
export default function DictationPanel({
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
    const [typedText, setTypedText] = useState('');
    const [result, setResult] = useState<DictationResult | null>(null);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleCheck = async (): Promise<void> => {
        if (!typedText.trim() || checking) {
            return;
        }
        setChecking(true);
        setError(null);
        try {
            const checked = await practiceApi.dictation({ referenceText, typedText, source });
            setResult(checked);
            onSaved(checked.attempt);
        } catch (checkError) {
            logger.error('听写校对失败', { error: checkError });
            setError(checkError instanceof Error ? checkError.message : t('practice.checkFailed'));
        } finally {
            setChecking(false);
        }
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
        setTypedText('');
        setError(null);
    };

    return (
        <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-medium text-foreground">{t('practice.modeDictation')}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t('practice.dictationPrompt')}</p>
                </div>
                <PracticeAudioButton source={source} canPlay={canPlayAudio} disabled={checking} />
            </div>

            {!canPlayAudio && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
                    {t('practice.noAudioHint')}
                </div>
            )}

            <Textarea
                value={typedText}
                onChange={(event) => setTypedText(event.target.value)}
                rows={3}
                disabled={checking || !canPlayAudio}
                placeholder={t('practice.dictationPlaceholder')}
                className="resize-none select-text rounded-xl bg-background text-sm leading-6"
            />

            <div className="flex items-center justify-end gap-2">
                {result && (
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
                )}
                <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg px-3 text-xs"
                    disabled={checking || !typedText.trim() || !canPlayAudio}
                    onClick={() => void handleCheck()}
                >
                    {checking ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <CheckCheck className="mr-1 h-3.5 w-3.5" />
                    )}
                    {checking ? t('practice.checking') : t('practice.check')}
                </Button>
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
                                scoreTone(result.accuracy),
                            )}
                        >
                            <span className="text-xl font-semibold tabular-nums leading-none">{result.accuracy}%</span>
                            <span className="mt-1 text-[10px]">{t('practice.accuracy')}</span>
                        </span>
                        <span className="text-sm text-muted-foreground">
                            {t('practice.correctCount', {
                                correct: result.correctWordCount,
                                total: result.referenceWordCount,
                            })}
                        </span>
                    </div>

                    <PracticeWordDiff words={result.words} />

                    <div className="rounded-xl bg-muted/50 px-3 py-2">
                        <div className="text-xs text-muted-foreground">{t('practice.reference')}</div>
                        <p className="mt-0.5 text-sm text-foreground">{referenceText}</p>
                    </div>

                    <div className="flex justify-end">
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
