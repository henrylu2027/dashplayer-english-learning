import { useTranslation } from 'react-i18next';
import { BookOpen, Loader2, Mic, Play } from 'lucide-react';

import type { DialogueTurnEvaluation, DialogueTurnProblem } from '@/common/contracts/dialogue';
import { Button } from '@/fronted/components/ui/button';
import { cn } from '@/fronted/lib/utils';

/** 纠错类型的徽标配色。 */
const KIND_CLASS: Record<DialogueTurnProblem['kind'], string> = {
    grammar: 'bg-red-500/10 text-red-600 dark:text-red-400',
    wording: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    pronunciation: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    linking: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

/** 纠错类型的文案 key。 */
const KIND_LABEL: Record<DialogueTurnProblem['kind'], string> = {
    grammar: 'dialogue.kindGrammar',
    wording: 'dialogue.kindWording',
    pronunciation: 'dialogue.kindPronunciation',
    linking: 'dialogue.kindLinking',
};

/**
 * 分数配色。
 * @param score 分数；null 表示没有依据。
 */
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
 * 场景对话右侧的评测面板：综合、发音、语法、错词 + 纠错与建议 + 点评。
 *
 * 说明：面板只展示 AI 评测，不发散到气泡里；没有评测时按同一版式显示占位，
 * 对话推进时版面不跳动。
 *
 * @param props.evaluation 最近一轮学习者的评测结果。
 * @param props.pending 正在生成回复与评测。
 * @param props.savingWords 正在把生词写进词汇工坊。
 * @param props.onAddWords 手动把本轮生词再存一次。
 * @param props.onRetry 重说一次。
 * @param props.onContinue 继续对话。
 */
export default function TurnEvaluationPanel({
    evaluation,
    pending,
    savingWords,
    onAddWords,
    onRetry,
    onContinue,
}: {
    evaluation: DialogueTurnEvaluation | null;
    pending: boolean;
    savingWords: boolean;
    onAddWords: () => void;
    onRetry: () => void;
    onContinue: () => void;
}) {
    const { t } = useTranslation('pages');

    const problemCount = evaluation?.problems.filter((item) => item.kind !== 'linking').length ?? 0;
    const tiles = [
        { label: t('dialogue.scoreOverall'), value: evaluation?.overall ?? null },
        { label: t('dialogue.scorePronunciation'), value: evaluation?.pronunciation ?? null },
        { label: t('dialogue.scoreGrammar'), value: evaluation?.grammar ?? null },
        {
            label: t('dialogue.scoreWords'),
            value: evaluation ? 100 - Math.min(100, problemCount * 10) : null,
        },
    ];

    return (
        <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-foreground">{t('dialogue.evaluationTitle')}</h2>
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
                <div className="text-[11px] text-muted-foreground">{t('dialogue.evalProblems')}</div>
                {evaluation && evaluation.problems.length > 0 ? (
                    <ul className="mt-1.5 flex flex-col gap-2">
                        {evaluation.problems.map((item) => (
                            <li key={`${item.kind}-${item.original}`} className="text-xs leading-5">
                                <span className={cn('mr-1.5 rounded px-1.5 py-0.5 text-[10px]', KIND_CLASS[item.kind])}>
                                    {t(KIND_LABEL[item.kind])}
                                </span>
                                <span className="text-muted-foreground line-through">{item.original}</span>
                                <span className="mx-1 text-muted-foreground">→</span>
                                <span className="text-foreground">{item.better}</span>
                                <div className="mt-0.5 text-muted-foreground">{item.whyZh}</div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                        {evaluation ? t('dialogue.evalProblemsEmpty') : t('dialogue.evalEmpty')}
                    </p>
                )}
            </div>

            <div className="rounded-xl bg-sky-500/10 px-3 py-2 text-xs leading-5 text-sky-700 dark:text-sky-300">
                {evaluation?.commentZh || t('dialogue.evalCommentHint')}
            </div>

            <div className="rounded-xl bg-muted/40 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">{t('dialogue.evalVocab')}</div>
                {evaluation && evaluation.vocab.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                        {evaluation.vocab.map((word) => (
                            <span key={word} className="rounded-full bg-background px-2 py-0.5 text-xs text-foreground/90">
                                {word}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="mt-1 text-xs text-muted-foreground">{t('dialogue.evalVocabEmpty')}</p>
                )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-full px-3 text-xs"
                    disabled={!evaluation || savingWords}
                    onClick={onAddWords}
                >
                    {savingWords
                        ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        : <BookOpen className="mr-1 h-3.5 w-3.5" />}
                    {t('dialogue.addToVocab')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-full px-3 text-xs"
                    disabled={pending}
                    onClick={onRetry}
                >
                    <Mic className="mr-1 h-3.5 w-3.5" />
                    {t('dialogue.retryLine')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs"
                    disabled={pending}
                    onClick={onContinue}
                >
                    <Play className="mr-1 h-3.5 w-3.5" />
                    {t('dialogue.continueChat')}
                </Button>
            </div>
        </section>
    );
}
