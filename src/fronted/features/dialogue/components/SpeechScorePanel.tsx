import { useTranslation } from 'react-i18next';
import { BookOpen, Loader2, Mic, Play } from 'lucide-react';

import type { RetellResult } from '@/common/contracts/practice';
import type { ShadowingWordStatus } from '@/common/contracts/shadowing';
import { Button } from '@/fronted/components/ui/button';
import { cn } from '@/fronted/lib/utils';

/** 逐词着色：错词红、漏词灰、多余词蓝。 */
const WORD_CLASS: Record<ShadowingWordStatus, string> = {
    correct: 'text-foreground',
    mispronounced: 'rounded bg-red-500/15 px-0.5 text-red-600 dark:text-red-400',
    missing: 'rounded bg-muted px-0.5 text-muted-foreground line-through',
    extra: 'rounded bg-sky-500/15 px-0.5 text-sky-600 dark:text-sky-400 line-through',
};

/** 分数配色。 */
function scoreTone(score: number | null): string {
    if (score === null) {
        return 'text-muted-foreground';
    }
    if (score >= 85) {
        return 'text-emerald-600 dark:text-emerald-400';
    }
    if (score >= 70) {
        return 'text-amber-600 dark:text-amber-400';
    }
    return 'text-red-500';
}

/**
 * 场景对话右侧的发音评测面板：综合、发音、语法、错词 + 逐词标记 + 评语。
 *
 * @param props.result 最近一次评测结果；没有时显示占位。
 * @param props.pending 正在评测。
 * @param props.disabled 没有可评测的台词时置灰。
 * @param props.canAddWords 是否有可加入生词本的词。
 * @param props.onAddWords 加入生词本。
 * @param props.onRetry 重说一次。
 * @param props.onContinue 继续对话。
 */
export default function SpeechScorePanel({
    result,
    pending,
    disabled,
    savingWords,
    onAddWords,
    onRetry,
    onContinue,
}: {
    result: RetellResult | null;
    pending: boolean;
    disabled: boolean;
    savingWords: boolean;
    onAddWords: () => void;
    onRetry: () => void;
    onContinue: () => void;
}) {
    const { t } = useTranslation('pages');

    const wrongCount = result?.words.filter((word) => word.status === 'mispronounced').length ?? 0;
    const overall = result?.coverage ?? null;
    const tiles = [
        { label: t('dialogue.scoreOverall'), value: overall },
        { label: t('dialogue.scorePronunciation'), value: result?.pronunciationScore ?? null },
        { label: t('dialogue.scoreGrammar'), value: result?.grammarScore ?? null },
        { label: t('dialogue.scoreWords'), value: result ? 100 - Math.min(100, wrongCount * 10) : null },
    ];

    return (
        <section
            className={cn(
                'flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs',
                disabled && 'opacity-50',
            )}
        >
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-foreground">{t('dialogue.scoreTitle')}</h2>
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>

            <div className="grid grid-cols-4 gap-2">
                {tiles.map((tile) => (
                    <div key={tile.label} className="rounded-xl bg-muted/40 px-2 py-2 text-center">
                        <div className="text-[10px] text-muted-foreground">{tile.label}</div>
                        <div className={cn('text-xl font-semibold tabular-nums leading-tight', scoreTone(tile.value))}>
                            {tile.value ?? '—'}
                        </div>
                    </div>
                ))}
            </div>

            <div className="rounded-xl bg-muted/40 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">{t('dialogue.scoreMarks')}</div>
                {result ? (
                    <p className="mt-1 text-sm leading-7">
                        {result.words.map((word, index) => (
                            <span key={`${index}-${word.status}`} className={cn('mx-0.5', WORD_CLASS[word.status])}>
                                {word.expected ?? word.actual}
                            </span>
                        ))}
                    </p>
                ) : (
                    <p className="mt-1 text-xs text-muted-foreground">{t('dialogue.scoreEmpty')}</p>
                )}
            </div>

            <div className="rounded-xl bg-sky-500/10 px-3 py-2 text-xs leading-5 text-sky-700 dark:text-sky-300">
                {result?.graderNote ?? (result?.graderError
                    ? `${t('practice.graderUnavailable')}：${result.graderError}`
                    : t('dialogue.scoreHint'))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-full px-3 text-xs"
                    disabled={!result || savingWords}
                    onClick={onAddWords}
                >
                    {savingWords ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <BookOpen className="mr-1 h-3.5 w-3.5" />}
                    {t('dialogue.addToVocab')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-full px-3 text-xs"
                    disabled={disabled}
                    onClick={onRetry}
                >
                    <Mic className="mr-1 h-3.5 w-3.5" />
                    {t('dialogue.retryLine')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs"
                    disabled={disabled}
                    onClick={onContinue}
                >
                    <Play className="mr-1 h-3.5 w-3.5" />
                    {t('dialogue.continueChat')}
                </Button>
            </div>
        </section>
    );
}
