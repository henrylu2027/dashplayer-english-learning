import { useTranslation } from 'react-i18next';

import type { ShadowingScoreVO, ShadowingWordStatus } from '@/common/contracts/shadowing';
import { cn } from '@/fronted/lib/utils';

/** 综合得分分档的配色；分数越高越偏绿。 */
function scoreTone(score: number): { text: string; ring: string; bg: string } {
    if (score >= 85) {
        return {
            text: 'text-emerald-600 dark:text-emerald-400',
            ring: 'ring-emerald-500/30',
            bg: 'bg-emerald-500/10',
        };
    }
    if (score >= 70) {
        return {
            text: 'text-amber-600 dark:text-amber-400',
            ring: 'ring-amber-500/30',
            bg: 'bg-amber-500/10',
        };
    }
    return {
        text: 'text-red-500',
        ring: 'ring-red-500/30',
        bg: 'bg-red-500/10',
    };
}

/** 逐词状态的文字样式。 */
const WORD_STATUS_CLASS: Record<ShadowingWordStatus, string> = {
    correct: 'text-emerald-600 dark:text-emerald-400',
    mispronounced: 'text-amber-600 dark:text-amber-400 underline decoration-amber-500/60 decoration-dotted decoration-2 underline-offset-4',
    missing: 'text-red-500 line-through decoration-red-400 decoration-2',
    extra: 'text-muted-foreground/70 italic line-through decoration-dotted',
};

/** 图例：每种状态的圆点样式与文案。 */
const LEGEND: Array<{ status: ShadowingWordStatus; dotClass: string; labelKey: string }> = [
    { status: 'correct', dotClass: 'bg-emerald-500', labelKey: 'shadowing.legendCorrect' },
    { status: 'mispronounced', dotClass: 'bg-amber-500', labelKey: 'shadowing.legendMispronounced' },
    { status: 'missing', dotClass: 'bg-red-500', labelKey: 'shadowing.legendMissing' },
    { status: 'extra', dotClass: 'bg-muted-foreground/50', labelKey: 'shadowing.legendExtra' },
];

/**
 * 跟读评分结果面板：综合分、分项指标、逐词对比与识别原文。
 */
export default function ScorePanel({ result }: { result: ShadowingScoreVO }) {
    const { t } = useTranslation('pages');
    const tone = scoreTone(result.score);

    const metrics = [
        { label: t('shadowing.accuracy'), value: `${result.accuracy}%` },
        { label: t('shadowing.completeness'), value: `${result.completeness}%` },
        { label: t('shadowing.wpm'), value: `${result.wordsPerMinute}`, unit: t('shadowing.wpmUnit') },
    ];

    return (
        <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
                <div
                    className={cn(
                        'flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl ring-1',
                        tone.bg,
                        tone.ring,
                    )}
                >
                    <span className={cn('text-3xl font-semibold tabular-nums leading-none', tone.text)}>
                        {result.score}
                    </span>
                    <span className="mt-1.5 text-xs text-muted-foreground">{t('shadowing.overall')}</span>
                </div>

                <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
                    {metrics.map((metric) => (
                        <div
                            key={metric.label}
                            className="flex flex-col justify-center rounded-xl border border-border/50 bg-background/60 px-3 py-2"
                        >
                            <span className="text-lg font-semibold tabular-nums text-foreground">
                                {metric.value}
                                {metric.unit && (
                                    <span className="ml-0.5 text-xs font-normal text-muted-foreground">{metric.unit}</span>
                                )}
                            </span>
                            <span className="mt-0.5 text-xs text-muted-foreground">{metric.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="mt-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium text-foreground">{t('shadowing.detailTitle')}</h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {LEGEND.map((item) => (
                            <span key={item.status} className="flex items-center gap-1 text-xs text-muted-foreground">
                                <span className={cn('h-1.5 w-1.5 rounded-full', item.dotClass)} />
                                {t(item.labelKey)}
                            </span>
                        ))}
                    </div>
                </div>

                <p className="mt-2 text-lg leading-8 text-foreground">
                    {result.words.map((word, index) => {
                        const title = word.status === 'mispronounced' && word.actual
                            ? t('shadowing.heardAs', { word: word.actual })
                            : word.status === 'missing'
                                ? t('shadowing.missingHint')
                                : word.status === 'extra'
                                    ? t('shadowing.extraHint')
                                    : undefined;
                        return (
                            <span
                                // 逐词反馈是静态列表，用位置作 key 足够稳定
                                key={`${index}-${word.status}`}
                                title={title}
                                className={cn('mx-0.5', WORD_STATUS_CLASS[word.status])}
                            >
                                {word.expected ?? word.actual}
                            </span>
                        );
                    })}
                </p>
            </div>

            <div className="mt-4 border-t border-border/50 pt-3">
                <div className="text-xs text-muted-foreground">{t('shadowing.recognized')}</div>
                <p className="mt-1 text-sm text-foreground/90">
                    {result.recognizedText || t('shadowing.noRecognized')}
                </p>
            </div>

            <div className="mt-3 text-xs text-muted-foreground">
                {t('shadowing.summary', {
                    duration: result.durationSec.toFixed(1),
                    reference: result.referenceWordCount,
                    correct: result.correctWordCount,
                })}
            </div>
        </section>
    );
}
