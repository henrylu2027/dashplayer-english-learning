import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { BookmarkPlus, Check, RotateCcw } from 'lucide-react';

import type { DialogueReview } from '@/common/contracts/dialogue';
import { Button } from '@/fronted/components/ui/button';
import { srsApi } from '@/fronted/features/srs/srsApi';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';

const logger = getRendererLogger('DialogueReviewPanel');

/**
 * 对话复盘：客观统计、目标表达、逐句建议与好句入库。
 *
 * 说明：统计数字由代码计算；文字点评来自模型，界面必须标明模型来源，
 * 避免学习者把它当成考试分数。发音不在评测范围内，这里也不出现相关字样。
 *
 * @param props.review 完整复盘。
 * @param props.onSpeak 朗读回调。
 * @param props.onRestart 再练一个场景。
 */
export default function ReviewPanel({
    review,
    onSpeak,
    onRestart,
}: {
    review: DialogueReview;
    onSpeak: (text: string) => void;
    onRestart: () => void;
}) {
    const { t } = useTranslation('pages');
    const [added, setAdded] = useState<Set<string>>(new Set());

    const addToReview = async (text: string): Promise<void> => {
        try {
            const response = await srsApi.addCard({ referenceText: text, source: { kind: 'free' } });
            setAdded((previous) => new Set(previous).add(text));
            toast.success(response.created ? t('dialogue.addedToReview') : t('dialogue.alreadyInReview'));
        } catch (addError) {
            logger.error('好句加入复习失败', { error: addError });
            toast.error(addError instanceof Error ? addError.message : t('dialogue.addToReviewFailed'));
        }
    };

    const stats = [
        { label: t('dialogue.statTurns'), value: String(review.stats.userTurnCount) },
        { label: t('dialogue.statWords'), value: String(review.stats.userWordCount) },
        { label: t('dialogue.statAvg'), value: String(review.stats.avgWordsPerTurn) },
        {
            label: t('dialogue.statTargets'),
            value: `${review.stats.targetUsedCount}/${review.stats.targetTotalCount}`,
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('dialogue.stats')}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {stats.map((item) => (
                        <div key={item.label} className="rounded-xl bg-muted/50 px-3 py-2">
                            <div className="text-lg font-semibold tabular-nums leading-none text-foreground">{item.value}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{item.label}</div>
                        </div>
                    ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {review.usedExpressions.map((item) => (
                        <span
                            key={item.en}
                            className={cn(
                                'rounded-full px-2.5 py-1 text-xs',
                                item.used
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-muted text-muted-foreground',
                            )}
                        >
                            {item.en}
                        </span>
                    ))}
                </div>
            </section>

            <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('dialogue.summary')}</div>
                <p className="mt-1.5 text-sm leading-6 text-foreground/90">{review.summaryZh}</p>
            </section>

            {review.suggestions.length > 0 && (
                <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('dialogue.suggestions')}</div>
                    <ul className="mt-2 flex flex-col gap-2.5">
                        {review.suggestions.map((item, index) => (
                            <li key={`${item.original}-${index}`} className="rounded-xl bg-muted/40 px-3 py-2.5">
                                <div className="text-sm text-muted-foreground line-through decoration-muted-foreground/40">
                                    {item.original}
                                </div>
                                <div className="mt-1 flex items-start gap-1.5 text-sm text-foreground">
                                    <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                    <button
                                        type="button"
                                        onClick={() => onSpeak(item.better)}
                                        className="text-left hover:underline"
                                    >
                                        {item.better}
                                    </button>
                                </div>
                                <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.whyZh}</div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                <div className="flex items-baseline justify-between">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('dialogue.goodLines')}</div>
                    <span className="text-[11px] text-muted-foreground">{t('dialogue.goodLinesHint')}</span>
                </div>
                {review.goodLines.length === 0 ? (
                    <div className="mt-2 rounded-xl bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
                        {t('dialogue.goodLinesEmpty')}
                    </div>
                ) : (
                    <ul className="mt-2 flex flex-col gap-2">
                        {review.goodLines.map((line) => (
                            <li key={line.en} className="flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5">
                                <div className="min-w-0 flex-1">
                                    <button
                                        type="button"
                                        onClick={() => onSpeak(line.en)}
                                        className="text-left text-sm leading-6 text-foreground hover:underline"
                                    >
                                        {line.en}
                                    </button>
                                    <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{line.reasonZh}</div>
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                                    disabled={added.has(line.en)}
                                    onClick={() => void addToReview(line.en)}
                                >
                                    <BookmarkPlus className="mr-1 h-3.5 w-3.5" />
                                    {added.has(line.en) ? t('dialogue.added') : t('dialogue.addToReview')}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                    {t('dialogue.reviewer', {
                        backend: review.reviewer.backend === 'local'
                            ? t('dialogue.reviewerLocal')
                            : t('dialogue.reviewerCloud'),
                        model: review.reviewer.model,
                    })}
                    {' · '}
                    {t('dialogue.reviewerNote')}
                </span>
                <Button
                    type="button"
                    size="sm"
                    className="h-9 rounded-xl px-4 text-sm"
                    onClick={onRestart}
                >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                    {t('dialogue.restart')}
                </Button>
            </div>
        </div>
    );
}
