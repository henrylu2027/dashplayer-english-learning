import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookmarkPlus, BookOpen, Loader2, Repeat } from 'lucide-react';

import type {
    SrsCard,
    SrsOverview,
    SrsQueueFilter,
    SrsQueueScope,
    SrsVerdict,
} from '@/common/contracts/srs';
import PageHeader from '@/fronted/components/shared/common/PageHeader';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/fronted/components/ui/alert-dialog';
import { Button } from '@/fronted/components/ui/button';
import useFile from '@/fronted/features/file-browser/fileStore';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { buildVideoShadowingSource } from '@/fronted/features/shadowing/shadowingSource';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import ReviewPanel, { type ReviewSubmission } from './components/ReviewPanel';
import SrsArchive, { type ArchiveItem } from './components/SrsArchive';
import SrsQueueItem from './components/SrsQueueItem';
import VerdictBar from './components/VerdictBar';
import { srsApi } from './srsApi';

const logger = getRendererLogger('SrsReviewPage');

/** 队列每页条数。 */
const PAGE_SIZE = 50;

/** 分组队列的三个来源。 */
type GroupKey = 'today' | 'overdue' | 'new';

/** 一组队列数据。 */
interface GroupState {
    /** 已加载卡片。 */
    cards: SrsCard[];
    /** 该组总数。 */
    total: number;
}

/** 空组。 */
const EMPTY_GROUP: GroupState = { cards: [], total: 0 };

/** 筛选选项。 */
const FILTERS: Array<{ value: SrsQueueFilter; labelKey: string }> = [
    { value: 'all', labelKey: 'srs.filterAll' },
    { value: 'shadowing', labelKey: 'srs.filterShadowing' },
    { value: 'dictation', labelKey: 'srs.filterDictation' },
    { value: 'word', labelKey: 'srs.filterWord' },
    { value: 'dialogue', labelKey: 'srs.filterDialogue' },
];

/**
 * 间隔复习页：左侧归集队列，右侧按形态切换复习台，底部判定驱动排期。
 *
 * 卡片数据、打分与调度全部在后端；本页只负责选卡、作答、展示与把判定交给后端。
 */
export default function SrsReviewPage() {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const currentSentence = usePlayer((s) => s.currentSentence);
    const videoPath = useFile((s) => s.videoPath);
    const subtitlePath = useFile((s) => s.subtitlePath);

    const [overview, setOverview] = useState<SrsOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [filter, setFilter] = useState<SrsQueueFilter>('all');
    /** 分组视图，或单列表视图（已掌握 / 全部）。 */
    const [view, setView] = useState<'grouped' | 'mastered' | 'all'>('grouped');
    const [groups, setGroups] = useState<Record<GroupKey, GroupState>>({
        today: EMPTY_GROUP,
        overdue: EMPTY_GROUP,
        new: EMPTY_GROUP,
    });
    const [flat, setFlat] = useState<GroupState>(EMPTY_GROUP);
    const [flatLoading, setFlatLoading] = useState(false);
    const [selectedCard, setSelectedCard] = useState<SrsCard | null>(null);
    const [pending, setPending] = useState<ReviewSubmission | null>(null);
    const [submittingVerdict, setSubmittingVerdict] = useState(false);
    const [archive, setArchive] = useState<ArchiveItem[]>([]);
    const [pendingDelete, setPendingDelete] = useState<SrsCard | null>(null);
    const [adding, setAdding] = useState(false);

    /** 首次加载成功时自动选中第一张可复习卡，之后不再干预用户选择。 */
    const didAutoSelectRef = useRef(false);
    const todayRef = useRef<HTMLElement | null>(null);
    const overdueRef = useRef<HTMLElement | null>(null);
    const newRef = useRef<HTMLElement | null>(null);

    /** 拉取统计与三个分组的第一页。 */
    const fetchOverviewAndGroups = useCallback(async () => {
        const [data, todayQueue, overdueQueue, newQueue] = await Promise.all([
            srsApi.overview(),
            srsApi.queue({ scope: 'today', filter, offset: 0, limit: PAGE_SIZE }),
            srsApi.queue({ scope: 'overdue', filter, offset: 0, limit: PAGE_SIZE }),
            srsApi.queue({ scope: 'new', filter, offset: 0, limit: PAGE_SIZE }),
        ]);
        setOverview(data);
        setGroups({
            today: { cards: todayQueue.cards, total: todayQueue.total },
            overdue: { cards: overdueQueue.cards, total: overdueQueue.total },
            new: { cards: newQueue.cards, total: newQueue.total },
        });
        return {
            overview: data,
            today: todayQueue.cards,
            overdue: overdueQueue.cards,
            new: newQueue.cards,
        };
    }, [filter]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await fetchOverviewAndGroups();
                if (cancelled) {
                    return;
                }
                setLoadError(null);
                if (!didAutoSelectRef.current) {
                    didAutoSelectRef.current = true;
                    const first = data.overdue[0] ?? data.today[0];
                    if (first) {
                        setSelectedCard(first);
                    }
                }
            } catch (error) {
                logger.error('加载复习计划失败', { error });
                if (!cancelled) {
                    setLoadError(error instanceof Error ? error.message : t('srs.loadFailed'));
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [fetchOverviewAndGroups, t]);

    // 单列表视图按当前筛选重新拉取
    useEffect(() => {
        if (view === 'grouped') {
            return undefined;
        }
        let cancelled = false;
        const scope: SrsQueueScope = view === 'mastered' ? 'mastered' : 'all';
        void (async () => {
            // 放到微任务里再改状态，避免在 effect 体内同步触发级联渲染
            await Promise.resolve();
            if (cancelled) {
                return;
            }
            setFlatLoading(true);
            try {
                const result = await srsApi.queue({ scope, filter, offset: 0, limit: PAGE_SIZE });
                if (!cancelled) {
                    setFlat({ cards: result.cards, total: result.total });
                }
            } catch (error) {
                logger.error('加载复习列表失败', { error });
                if (!cancelled) {
                    toast.error(error instanceof Error ? error.message : t('srs.loadFailed'));
                }
            } finally {
                if (!cancelled) {
                    setFlatLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [view, filter, t]);

    // 从学习台带过来的聚焦目标
    const focus = searchParams.get('focus');
    useEffect(() => {
        if (!overview || !focus) {
            return undefined;
        }
        // 学习台的「未来」在新布局里对应「全部未掌握」
        if (focus === 'upcoming') {
            const timer = window.setTimeout(() => setView('all'), 0);
            return () => window.clearTimeout(timer);
        }
        const target = focus === 'due'
            ? todayRef.current
            : focus === 'overdue'
                ? overdueRef.current
                : focus === 'new'
                    ? newRef.current
                    : null;
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return undefined;
    }, [overview, focus]);

    /** 选择卡片；已作答未判定时不允许切换。 */
    const selectCard = useCallback((card: SrsCard): void => {
        if (pending) {
            toast(t('srs.finishVerdictFirst'));
            return;
        }
        setSelectedCard(card);
    }, [pending, t]);

    /** 加载某一组的下一页。 */
    const loadMore = async (scope: SrsQueueScope): Promise<void> => {
        if (view === 'grouped') {
            const group = groups[scope as GroupKey];
            const result = await srsApi.queue({
                scope,
                filter,
                offset: group.cards.length,
                limit: PAGE_SIZE,
            });
            setGroups((previous) => ({
                ...previous,
                [scope]: {
                    cards: [...previous[scope as GroupKey].cards, ...result.cards],
                    total: result.total,
                },
            }));
            return;
        }
        const result = await srsApi.queue({
            scope,
            filter,
            offset: flat.cards.length,
            limit: PAGE_SIZE,
        });
        setFlat((previous) => ({ cards: [...previous.cards, ...result.cards], total: result.total }));
    };

    /** 判定：后端重读分数并推进排期，随后刷新队列并自动选下一张。 */
    const handleVerdict = async (verdict: SrsVerdict): Promise<void> => {
        if (!selectedCard || !pending || submittingVerdict) {
            return;
        }
        setSubmittingVerdict(true);
        try {
            const result = await srsApi.verdict({
                cardId: selectedCard.id,
                verdict,
                evidence: pending.evidence,
            });
            setArchive((previous) => [
                ...previous,
                {
                    cardId: selectedCard.id,
                    text: selectedCard.referenceText,
                    form: result.form,
                    score: result.score,
                    verdict: result.verdict,
                    intervalDays: result.intervalDays,
                    mastered: result.mastered,
                    at: Date.now(),
                },
            ]);
            toast.success(
                result.mastered
                    ? t('srs.verdictMastered')
                    : t('srs.verdictNext', { days: result.intervalDays }),
            );
            setPending(null);
            didAutoSelectRef.current = true;

            const data = await fetchOverviewAndGroups();
            if (view === 'grouped') {
                const next = [...data.overdue, ...data.today].find((card) => card.id !== selectedCard.id) ?? null;
                setSelectedCard(next);
            } else {
                setFlat((previous) => ({
                    ...previous,
                    cards: previous.cards.filter((card) => card.id !== selectedCard.id),
                    total: Math.max(0, previous.total - 1),
                }));
                setSelectedCard(null);
            }
        } catch (error) {
            logger.error('提交掌握度失败', { error, cardId: selectedCard.id });
            toast.error(error instanceof Error ? error.message : t('srs.submitFailed'));
        } finally {
            setSubmittingVerdict(false);
        }
    };

    /** 加入播放器当前句。 */
    const handleAddCurrent = async (): Promise<void> => {
        if (!currentSentence) {
            toast.error(t('srs.noCurrentSentence'));
            return;
        }
        setAdding(true);
        try {
            const response = await srsApi.addCard({
                referenceText: currentSentence.text,
                source: buildVideoShadowingSource(currentSentence, videoPath, subtitlePath),
            });
            toast.success(response.created ? t('srs.added') : t('srs.alreadyAdded'));
            await fetchOverviewAndGroups();
        } catch (error) {
            logger.error('加入复习失败', { error });
            toast.error(error instanceof Error ? error.message : t('srs.addFailed'));
        } finally {
            setAdding(false);
        }
    };

    /** 移出复习。 */
    const handleRemove = async (card: SrsCard): Promise<void> => {
        try {
            await srsApi.removeCard(card.id);
            toast.success(t('srs.removed'));
            if (selectedCard?.id === card.id) {
                setSelectedCard(null);
                setPending(null);
            }
            setGroups((previous) => ({
                today: { ...previous.today, cards: previous.today.cards.filter((item) => item.id !== card.id) },
                overdue: { ...previous.overdue, cards: previous.overdue.cards.filter((item) => item.id !== card.id) },
                new: { ...previous.new, cards: previous.new.cards.filter((item) => item.id !== card.id) },
            }));
            setFlat((previous) => ({
                ...previous,
                cards: previous.cards.filter((item) => item.id !== card.id),
            }));
            await fetchOverviewAndGroups();
        } catch (error) {
            logger.error('移出复习失败', { error, cardId: card.id });
            toast.error(error instanceof Error ? error.message : t('srs.removeFailed'));
        } finally {
            setPendingDelete(null);
        }
    };

    if (loading) {
        return (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
            </div>
        );
    }

    const totalCount = overview?.totalCount ?? 0;
    const todayCount = overview?.todayDueCount ?? 0;
    const overdueCount = overview?.overdueCount ?? 0;
    const masteredCount = overview?.masteredCount ?? 0;

    /** 渲染一组队列。 */
    const renderGroup = (
        key: GroupKey,
        titleKey: string,
        status: 'today' | 'overdue' | 'new',
        ref: RefObject<HTMLElement | null>,
        tone?: 'warning',
    ) => {
        const group = groups[key];
        if (status === 'overdue' && group.total === 0) {
            return null;
        }
        return (
            <section
                ref={ref}
                className={cn(
                    'rounded-2xl border bg-card p-3 shadow-xs',
                    tone === 'warning' ? 'border-red-500/30' : 'border-border/60',
                )}
            >
                <div className="flex items-baseline justify-between px-1">
                    <h2 className={cn('text-sm font-medium', tone === 'warning' ? 'text-red-500' : 'text-foreground')}>
                        {t(titleKey)}
                    </h2>
                    <span className="text-xs tabular-nums text-muted-foreground">{group.total}</span>
                </div>
                {status === 'new' && (
                    <p className="mt-1 px-1 text-xs text-muted-foreground">{t('srs.newHint')}</p>
                )}
                {group.cards.length > 0 ? (
                    <div className="mt-2 flex flex-col gap-1">
                        {group.cards.map((card) => (
                            <SrsQueueItem
                                key={card.id}
                                card={card}
                                active={selectedCard?.id === card.id}
                                status={status}
                                onSelect={() => {
                                    if (status === 'new') {
                                        toast(t('srs.newCardPreview'));
                                        return;
                                    }
                                    selectCard(card);
                                }}
                                onDelete={() => setPendingDelete(card)}
                            />
                        ))}
                        {group.total > group.cards.length && (
                            <button
                                type="button"
                                onClick={() => void loadMore(key)}
                                className="mt-1 rounded-lg py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                                {t('srs.loadMore', { remaining: group.total - group.cards.length })}
                            </button>
                        )}
                    </div>
                ) : (
                    <p className="mt-2 px-1 py-1 text-xs text-muted-foreground">{t('srs.groupEmpty')}</p>
                )}
            </section>
        );
    };

    return (
        <div className="flex h-full w-full flex-col overflow-hidden select-text bg-background text-foreground">
            <header className="shrink-0 space-y-3 px-6 pt-4 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <PageHeader title={t('srs.title')} description={t('srs.description')} />
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-3 text-xs"
                            onClick={() => navigate('/vocabulary')}
                        >
                            <BookOpen className="mr-1 h-3.5 w-3.5" />
                            {t('srs.goVocabulary')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-3 text-xs"
                            disabled={!currentSentence || adding}
                            title={currentSentence ? undefined : t('srs.noCurrentSentence')}
                            onClick={() => void handleAddCurrent()}
                        >
                            {adding
                                ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                : <BookmarkPlus className="mr-1 h-3.5 w-3.5" />}
                            {t('srs.addCurrentSentence')}
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-4 gap-3">
                    <button
                        type="button"
                        onClick={() => {
                            setView('grouped');
                            todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-left shadow-xs transition-colors hover:border-primary/40"
                    >
                        <div className="text-2xl font-semibold tabular-nums text-foreground">{todayCount}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{t('srs.statToday')}</div>
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setView('grouped');
                            overdueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-left shadow-xs transition-colors hover:border-primary/40"
                    >
                        <div
                            className={cn(
                                'text-2xl font-semibold tabular-nums',
                                overdueCount > 0 ? 'text-red-500' : 'text-foreground',
                            )}
                        >
                            {overdueCount}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{t('srs.statOverdue')}</div>
                    </button>
                    <button
                        type="button"
                        onClick={() => setView('mastered')}
                        className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-left shadow-xs transition-colors hover:border-primary/40"
                    >
                        <div className="text-2xl font-semibold tabular-nums text-foreground">{masteredCount}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{t('srs.statMastered')}</div>
                    </button>
                    <button
                        type="button"
                        onClick={() => setView('all')}
                        className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-left shadow-xs transition-colors hover:border-primary/40"
                    >
                        <div className="text-2xl font-semibold tabular-nums text-foreground">{totalCount}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{t('srs.statTotal')}</div>
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    {FILTERS.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            onClick={() => setFilter(item.value)}
                            className={cn(
                                'rounded-full border px-3 py-1 text-xs transition-colors',
                                filter === item.value
                                    ? 'border-primary/40 bg-primary/10 text-primary'
                                    : 'border-transparent text-muted-foreground hover:bg-muted',
                            )}
                        >
                            {t(item.labelKey)}
                        </button>
                    ))}
                </div>

                {loadError && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                        <span>{loadError}</span>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 rounded-lg text-xs"
                            onClick={() => void fetchOverviewAndGroups()}
                        >
                            {t('srs.retry')}
                        </Button>
                    </div>
                )}
            </header>

            <div className="flex min-h-0 flex-1 gap-4 px-6 pb-3">
                <aside className="flex min-h-0 w-[38%] min-w-[340px] max-w-[560px] flex-col rounded-2xl border border-border/60 bg-card/50">
                    <div className="flex-1 space-y-3 overflow-y-auto p-3">
                        {totalCount === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
                                <Repeat className="h-8 w-8 text-muted-foreground/40" />
                                <h3 className="text-base font-medium text-foreground/80">{t('srs.emptyAllTitle')}</h3>
                                <p className="max-w-sm text-xs leading-5 text-muted-foreground">{t('srs.emptyAllGuide')}</p>
                            </div>
                        ) : view === 'grouped' ? (
                            <>
                                {renderGroup('overdue', 'srs.groupOverdue', 'overdue', overdueRef, 'warning')}
                                {renderGroup('today', 'srs.groupToday', 'today', todayRef)}
                                {renderGroup('new', 'srs.groupNew', 'new', newRef)}
                            </>
                        ) : (
                            <section className="rounded-2xl border border-border/60 bg-card p-3 shadow-xs">
                                <div className="flex items-baseline justify-between px-1">
                                    <h2 className="text-sm font-medium text-foreground">
                                        {t(view === 'mastered' ? 'srs.groupMastered' : 'srs.groupAll')}
                                    </h2>
                                    <span className="text-xs tabular-nums text-muted-foreground">{flat.total}</span>
                                </div>
                                {flatLoading ? (
                                    <div className="flex justify-center py-6 text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    </div>
                                ) : flat.cards.length > 0 ? (
                                    <div className="mt-2 flex flex-col gap-1">
                                        {flat.cards.map((card) => (
                                            <SrsQueueItem
                                                key={card.id}
                                                card={card}
                                                active={selectedCard?.id === card.id}
                                                status={view === 'mastered' ? 'mastered' : 'today'}
                                                onSelect={() => selectCard(card)}
                                                onDelete={() => setPendingDelete(card)}
                                            />
                                        ))}
                                        {flat.total > flat.cards.length && (
                                            <button
                                                type="button"
                                                onClick={() => void loadMore(view === 'mastered' ? 'mastered' : 'all')}
                                                className="mt-1 rounded-lg py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                            >
                                                {t('srs.loadMore', { remaining: flat.total - flat.cards.length })}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <p className="mt-2 px-1 py-1 text-xs text-muted-foreground">{t('srs.groupEmpty')}</p>
                                )}
                            </section>
                        )}
                    </div>
                </aside>

                <section className="min-h-0 min-w-0 flex-1">
                    {selectedCard ? (
                        <ReviewPanel
                            key={selectedCard.id}
                            card={selectedCard}
                            onSubmit={setPending}
                        />
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card/40 px-6 py-10 text-center">
                            <Repeat className="h-7 w-7 text-muted-foreground/40" />
                            <p className="text-sm text-muted-foreground">{t('srs.selectHint')}</p>
                        </div>
                    )}
                </section>
            </div>

            <VerdictBar
                disabled={!selectedCard || !pending}
                submitting={submittingVerdict}
                hint={pending ? t('srs.verdictReady') : t('srs.verdictIdleHint')}
                onVerdict={(verdict) => void handleVerdict(verdict)}
            />

            <SrsArchive items={archive} />

            <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('srs.removeTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('srs.removeDescription', { text: pendingDelete?.referenceText ?? '' })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('srs.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-600 text-white hover:bg-red-600/90"
                            onClick={() => pendingDelete && void handleRemove(pendingDelete)}
                        >
                            {t('srs.removeConfirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
