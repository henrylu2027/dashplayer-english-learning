import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, Flame, Loader2, MessagesSquare, Mic, PencilLine, RefreshCw, Repeat } from 'lucide-react';

import type { DashboardSummary } from '@/common/contracts/dashboard';
import PageHeader from '@/fronted/components/shared/common/PageHeader';
import { Button } from '@/fronted/components/ui/button';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { dashboardApi } from './dashboardApi';

const logger = getRendererLogger('DashboardPage');

/**
 * 把本地日期字符串格式化为星期标签。
 * @param date 格式为 `YYYY-MM-DD` 的本地日期。
 */
function weekdayLabel(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

/** 最近跟读记录里分数徽标的配色。 */
function scoreChipTone(score: number): string {
    if (score >= 85) {
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    }
    if (score >= 70) {
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    }
    return 'bg-red-500/10 text-red-500';
}

/**
 * 学习台：今日任务、连续学习天数、最近 7 天活动与最近跟读。
 *
 * 页面不产生任何新数据，只展示后端对复习卡片与跟读记录的即时聚合；
 * 所有入口都指向已有的跟读页与间隔复习页，保证学习闭环只有一条路径。
 */
export default function DashboardPage() {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();

    const [summary, setSummary] = useState<DashboardSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (mode: 'initial' | 'refresh'): Promise<void> => {
        if (mode === 'refresh') {
            setRefreshing(true);
        }
        try {
            const data = await dashboardApi.summary();
            setSummary(data);
            setError(null);
        } catch (loadFailure) {
            logger.error('加载学习台失败', { error: loadFailure });
            setError(loadFailure instanceof Error ? loadFailure.message : t('dashboard.loadFailed'));
        } finally {
            if (mode === 'initial') {
                setLoading(false);
            } else {
                setRefreshing(false);
            }
        }
    }, [t]);

    useEffect(() => {
        // 显式 await：dashboardApi.summary 是异步的，setState 发生在 await 之后，
        // 避免被判定为“effect 内同步 setState 引发级联渲染”
        void (async () => {
            await load('initial');
        })();
    }, [load]);

    if (loading) {
        return (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
            </div>
        );
    }

    const maxDailyCount = summary
        ? Math.max(1, ...summary.dailyActivity.map((day) => day.count))
        : 1;
    const reviewDone = summary ? summary.dueReviewCount === 0 : false;
    const shadowDone = summary ? summary.todayAttemptCount > 0 : false;
    const practiceDone = summary ? summary.todayPracticeCount > 0 : false;
    const dialogueDone = summary ? summary.todayDialogueTurnCount > 0 : false;

    return (
        <div className="w-full h-full flex flex-col overflow-hidden select-text bg-background text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-2">
                <PageHeader title={t('dashboard.title')} description={t('dashboard.description')} />
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg px-3 text-xs"
                    disabled={refreshing}
                    onClick={() => void load('refresh')}
                >
                    <RefreshCw className={cn('mr-1 h-3.5 w-3.5', refreshing && 'animate-spin')} />
                    {t('dashboard.refresh')}
                </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-2">
                <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
                    {error && (
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                            <span>{error}</span>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 rounded-lg text-xs"
                                onClick={() => void load('refresh')}
                            >
                                {t('dashboard.retry')}
                            </Button>
                        </div>
                    )}

                    {summary && (
                        <>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <div className="flex flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-3xl font-semibold tabular-nums text-foreground">
                                            {summary.dueReviewCount}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{t('dashboard.dueStat')}</span>
                                    </div>
                                    <div className="mt-3">
                                        {reviewDone ? (
                                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                                {t('dashboard.taskReviewDone')}
                                            </span>
                                        ) : (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-7 rounded-lg px-2.5 text-xs"
                                                onClick={() => navigate('/review')}
                                            >
                                                {t('dashboard.goReview')}
                                                <ArrowRight className="ml-1 h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-3xl font-semibold tabular-nums text-foreground">
                                            {summary.todayTotalCount}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{t('dashboard.todayPracticeStat')}</span>
                                    </div>
                                    <div className="mt-3 text-[11px] leading-5 text-muted-foreground">
                                        {t('dashboard.todayBreakdown', {
                                            shadow: summary.todayAttemptCount,
                                            practice: summary.todayPracticeCount,
                                            dialogue: summary.todayDialogueTurnCount,
                                        })}
                                    </div>
                                </div>

                                <div className="flex flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                                    <div className="flex items-baseline gap-2">
                                        <Flame className="mb-0.5 h-5 w-5 text-orange-500" />
                                        <span className="text-3xl font-semibold tabular-nums text-foreground">
                                            {summary.streakDays}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {t('dashboard.streakUnit')} · {t('dashboard.streakStat')}
                                        </span>
                                    </div>
                                    <div className="mt-3 text-xs text-muted-foreground">{t('dashboard.streakHint')}</div>
                                </div>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                                <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                                    <div className="flex items-baseline justify-between">
                                        <h2 className="text-sm font-medium text-foreground">{t('dashboard.tasksTitle')}</h2>
                                        <span className="text-xs text-muted-foreground">
                                            {summary.todayAverageScore === null
                                                ? t('dashboard.noAverage')
                                                : t('dashboard.todayAverage', { score: summary.todayAverageScore })}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex flex-col gap-1">
                                        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                                            {reviewDone ? (
                                                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                                            ) : (
                                                <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm text-foreground">{t('dashboard.taskReview')}</div>
                                                <div className="mt-0.5 text-xs text-muted-foreground">
                                                    {reviewDone
                                                        ? t('dashboard.taskReviewDone')
                                                        : t('dashboard.taskReviewPending', { remaining: summary.dueReviewCount })}
                                                </div>
                                            </div>
                                            {!reviewDone && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-7 shrink-0 rounded-lg px-2.5 text-xs"
                                                    onClick={() => navigate('/review')}
                                                >
                                                    <Repeat className="mr-1 h-3.5 w-3.5" />
                                                    {t('dashboard.goReview')}
                                                </Button>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                                            {shadowDone ? (
                                                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                                            ) : (
                                                <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm text-foreground">{t('dashboard.taskShadow')}</div>
                                                <div className="mt-0.5 text-xs text-muted-foreground">
                                                    {shadowDone
                                                        ? t('dashboard.taskShadowDone', { times: summary.todayAttemptCount })
                                                        : t('dashboard.taskShadowPending')}
                                                </div>
                                            </div>
                                            {!shadowDone && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-7 shrink-0 rounded-lg px-2.5 text-xs"
                                                    onClick={() => navigate('/shadowing')}
                                                >
                                                    <Mic className="mr-1 h-3.5 w-3.5" />
                                                    {t('dashboard.goShadowing')}
                                                </Button>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                                            {practiceDone ? (
                                                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                                            ) : (
                                                <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm text-foreground">{t('dashboard.taskPractice')}</div>
                                                <div className="mt-0.5 text-xs text-muted-foreground">
                                                    {practiceDone
                                                        ? t('dashboard.taskPracticeDone', { times: summary.todayPracticeCount })
                                                        : t('dashboard.taskPracticePending')}
                                                </div>
                                            </div>
                                            {!practiceDone && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-7 shrink-0 rounded-lg px-2.5 text-xs"
                                                    onClick={() => navigate('/practice')}
                                                >
                                                    <PencilLine className="mr-1 h-3.5 w-3.5" />
                                                    {t('dashboard.goPractice')}
                                                </Button>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                                            {dialogueDone ? (
                                                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                                            ) : (
                                                <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm text-foreground">{t('dashboard.taskDialogue')}</div>
                                                <div className="mt-0.5 text-xs text-muted-foreground">
                                                    {dialogueDone
                                                        ? t('dashboard.taskDialogueDone', { times: summary.todayDialogueTurnCount })
                                                        : t('dashboard.taskDialoguePending')}
                                                </div>
                                            </div>
                                            {!dialogueDone && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-7 shrink-0 rounded-lg px-2.5 text-xs"
                                                    onClick={() => navigate('/dialogue')}
                                                >
                                                    <MessagesSquare className="mr-1 h-3.5 w-3.5" />
                                                    {t('dashboard.goDialogue')}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </section>

                                <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                                    <div className="flex items-baseline justify-between">
                                        <h2 className="text-sm font-medium text-foreground">{t('dashboard.weekTitle')}</h2>
                                        <span className="text-xs tabular-nums text-muted-foreground">
                                            {summary.dailyActivity.reduce((sum, day) => sum + day.count, 0)}
                                        </span>
                                    </div>
                                    <div className="mt-3 flex h-28 items-end gap-2">
                                        {summary.dailyActivity.map((day) => (
                                            <div
                                                key={day.date}
                                                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                                                title={`${day.date} · ${day.count}`}
                                            >
                                                <div className="flex h-20 w-full items-end justify-center">
                                                    <div
                                                        className={cn(
                                                            'w-full max-w-7 rounded-md',
                                                            day.count > 0 ? 'bg-primary/70' : 'bg-muted',
                                                        )}
                                                        style={{
                                                            height: day.count > 0
                                                                ? `${Math.max(10, Math.round((day.count / maxDailyCount) * 100))}%`
                                                                : '4px',
                                                        }}
                                                    />
                                                </div>
                                                <span className="text-xs text-muted-foreground">{weekdayLabel(day.date)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {summary.dailyActivity.every((day) => day.count === 0) && (
                                        <div className="mt-1 text-center text-xs text-muted-foreground">
                                            {t('dashboard.weekEmpty')}
                                        </div>
                                    )}
                                </section>
                            </div>

                            <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                                <div className="flex items-baseline justify-between">
                                    <h2 className="text-sm font-medium text-foreground">{t('dashboard.recentTitle')}</h2>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 rounded-lg px-2 text-xs"
                                        onClick={() => navigate('/shadowing')}
                                    >
                                        {t('dashboard.goShadowing')}
                                        <ArrowRight className="ml-1 h-3.5 w-3.5" />
                                    </Button>
                                </div>
                                {summary.recentAttempts.length === 0 ? (
                                    <div className="mt-3 rounded-xl bg-muted/50 px-4 py-6 text-center text-xs text-muted-foreground">
                                        {t('dashboard.recentEmpty')}
                                    </div>
                                ) : (
                                    <div className="mt-2 flex flex-col gap-1">
                                        {summary.recentAttempts.map((attempt) => (
                                            <div
                                                key={attempt.id}
                                                className="flex items-center gap-3 rounded-xl px-2 py-2"
                                            >
                                                <span
                                                    className={cn(
                                                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums',
                                                        scoreChipTone(attempt.score),
                                                    )}
                                                >
                                                    {attempt.score}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                                    {attempt.referenceText}
                                                </span>
                                                <span className="shrink-0 text-xs text-muted-foreground">
                                                    {attempt.sourceKind === 'video'
                                                        ? t('dashboard.sourceVideo')
                                                        : t('dashboard.sourceFree')}
                                                </span>
                                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                                    {new Date(attempt.createdAt).toLocaleString()}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
