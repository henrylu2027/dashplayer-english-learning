import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookmarkPlus, BookOpen, Loader2, Repeat, Trash2, Volume2 } from 'lucide-react';

import type { SrsCard, SrsOverview, SrsReviewOutcome, SrsSourceModule } from '@/common/contracts/srs';
import { SRS_MAX_DAILY_NEW_CARD_LIMIT, SRS_PASS_SCORE } from '@/common/contracts/srs';
import UrlUtil from '@/common/utils/UrlUtil';
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
import ReviewPanel from './components/ReviewPanel';
import { srsApi } from './srsApi';

const logger = getRendererLogger('SrsReviewPage');

/** 一天对应的毫秒数，用于到期文案。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 来源模块显示文案的翻译键。 */
const MODULE_LABEL: Record<SrsSourceModule, string> = {
    player: 'srs.modulePlayer',
    original: 'srs.moduleOriginal',
    practice: 'srs.modulePractice',
    dialogue: 'srs.moduleDialogue',
    vocabulary: 'srs.moduleVocabulary',
};

/**
 * 到期时间的展示文案。
 * @param dueAt 到期时间，epoch 毫秒。
 * @param now 当前时间，epoch 毫秒。
 * @param t 翻译函数。
 */
function formatDue(dueAt: number, now: number, t: TFunction): string {
    if (dueAt <= now) {
        return t('srs.dueNow');
    }
    const days = Math.ceil((dueAt - now) / DAY_MS);
    return t('srs.dueInDays', { days });
}

/** 卡片分数徽标配色；新卡用中性色。 */
function scoreChipTone(score: number | null): string {
    if (score === null) {
        return 'bg-muted text-muted-foreground';
    }
    if (score >= SRS_PASS_SCORE) {
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    }
    return 'bg-red-500/10 text-red-500';
}

/**
 * 单张卡片行。
 *
 * @param props.card 卡片。
 * @param props.active 是否为当前选中的卡片。
 * @param props.dueLabel 到期文案。
 * @param props.onSelect 选中卡片。
 * @param props.onDelete 请求删除卡片。
 */
function SrsCardRow({
    card,
    active,
    dueLabel,
    onSelect,
    onDelete,
}: {
    card: SrsCard;
    active: boolean;
    dueLabel: string;
    onSelect: () => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation('pages');
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect();
                }
            }}
            className={cn(
                'group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                active
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-transparent hover:bg-muted/60',
            )}
        >
            <span
                className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums',
                    scoreChipTone(card.lastScore),
                )}
            >
                {card.lastScore ?? t('srs.newCard')}
            </span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground">{card.referenceText}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                    {card.sourceKind === 'video'
                        ? t('srs.sourceVideo')
                        : /\s/.test(card.referenceText.trim())
                            ? t('srs.sourceFree')
                            : t('srs.sourceWord')}
                    <span className="mx-1.5">·</span>
                    {t('srs.stage', { stage: card.stage })}
                    <span className="mx-1.5">·</span>
                    {dueLabel}
                </div>
            </div>
            <button
                type="button"
                aria-label={t('srs.remove')}
                onClick={(event) => {
                    event.stopPropagation();
                    onDelete();
                }}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
            >
                <Trash2 className="h-4 w-4" />
            </button>
        </div>
    );
}

/**
 * 今日新学的一行：只做预览，不计分、不推进排期。
 *
 * @param card 今天刚入池的卡片。
 * @param t 翻译函数。
 * @param canPlay 是否有可播放的原声。
 * @param onPlay 播放原声。
 */
function NewCardRow({
    card,
    t,
    canPlay,
    onPlay,
}: {
    card: SrsCard;
    t: TFunction;
    canPlay: boolean;
    onPlay: (card: SrsCard) => void;
}) {
    return (
        <div className="flex items-start gap-2 rounded-xl px-2 py-2">
            {canPlay ? (
                <button
                    type="button"
                    aria-label={t('srs.listen')}
                    onClick={() => onPlay(card)}
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
                >
                    <Volume2 className="h-3.5 w-3.5" />
                </button>
            ) : (
                <span className="h-7 w-7 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
                <div className="text-sm leading-6 text-foreground">{card.referenceText}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {card.word && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-primary">
                            {t('srs.targetWord')} {card.word}
                        </span>
                    )}
                    {card.sourceModules.map((module) => (
                        <span key={module} className="rounded-full bg-muted px-1.5 py-0.5">
                            {t(MODULE_LABEL[module])}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

/**
 * 间隔复习页：以句子为单位，听原声 → 跟读 → 达标后自动延后。
 *
 * 卡片数据与判定全部在后端；本页只负责选卡、播放原声、录音和展示结果。
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
    const [selectedCard, setSelectedCard] = useState<SrsCard | null>(null);
    const [pendingDelete, setPendingDelete] = useState<SrsCard | null>(null);
    const [adding, setAdding] = useState(false);
    /** 每日新卡上限的输入草稿；null 表示显示概览里的当前值。 */
    const [limitDraft, setLimitDraft] = useState<string | null>(null);
    const [savingLimit, setSavingLimit] = useState(false);
    /** 首次加载成功时自动选中第一张待复习卡，之后不再干预用户选择。 */
    const didAutoSelectRef = useRef(false);
    /** 今日新学预览的播放器；离开页面时停掉。 */
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    /** 学习台带过来的聚焦目标：今日到期 / 今日新学 / 未来。 */
    const focus = searchParams.get('focus');
    const dueSectionRef = useRef<HTMLElement | null>(null);
    const newSectionRef = useRef<HTMLElement | null>(null);
    const upcomingSectionRef = useRef<HTMLElement | null>(null);
    const [flashedSection, setFlashedSection] = useState<string | null>(null);

    const loadOverview = useCallback(async (): Promise<void> => {
        try {
            const data = await srsApi.overview();
            setOverview(data);
            setLoadError(null);
            if (!didAutoSelectRef.current && data.dueCards.length > 0) {
                didAutoSelectRef.current = true;
                setSelectedCard((previous) => previous ?? data.dueCards[0]);
            }
        } catch (error) {
            logger.error('加载复习计划失败', { error });
            setLoadError(error instanceof Error ? error.message : t('srs.loadFailed'));
        }
    }, [t]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await loadOverview();
            if (!cancelled) {
                setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [loadOverview]);

    const dailyLimit = overview?.dailyNewCardLimit;
    // 输入框优先显示草稿；没有草稿时跟随概览，不额外用 effect 同步
    const limitValue = limitDraft ?? (dailyLimit === undefined ? '' : String(dailyLimit));

    /** 保存每日新卡上限；0 表示暂停入池。 */
    const saveDailyLimit = useCallback(async (): Promise<void> => {
        const parsed = Number.parseInt(limitValue, 10);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > SRS_MAX_DAILY_NEW_CARD_LIMIT) {
            toast.error(t('srs.limitInvalid', { max: SRS_MAX_DAILY_NEW_CARD_LIMIT }));
            setLimitDraft(null);
            return;
        }
        if (parsed === dailyLimit) {
            setLimitDraft(null);
            return;
        }
        setSavingLimit(true);
        try {
            const saved = await srsApi.setDailyLimit(parsed);
            toast.success(t('srs.limitSaved', { limit: saved }));
            await loadOverview();
            setLimitDraft(null);
        } catch (error) {
            logger.error('保存每日新卡上限失败', { error });
            toast.error(error instanceof Error ? error.message : t('srs.limitSaveFailed'));
            setLimitDraft(null);
        } finally {
            setSavingLimit(false);
        }
    }, [limitValue, dailyLimit, loadOverview, t]);

    // 从学习台点「今日新学 / 未来」进来时，滚到对应区块并短暂高亮
    useEffect(() => {
        if (!overview || !focus) {
            return undefined;
        }
        const target = focus === 'due'
            ? dueSectionRef.current
            : focus === 'new'
                ? newSectionRef.current
                : focus === 'upcoming'
                    ? upcomingSectionRef.current
                    : null;
        if (!target) {
            return undefined;
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setFlashedSection(focus);
        const timer = window.setTimeout(() => setFlashedSection(null), 1600);
        return () => window.clearTimeout(timer);
    }, [overview, focus]);

    const handleReviewed = useCallback((outcome: SrsReviewOutcome): void => {
        setSelectedCard(outcome.card);
        void loadOverview();
    }, [loadOverview]);

    /** 下一张待复习卡：排除当前选中的这张，避免通过后仍停在原地。 */
    const nextDue = overview?.dueCards.find((card) => card.id !== selectedCard?.id) ?? null;

    const handleNext = (): void => {
        setSelectedCard(nextDue ?? null);
    };

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
            await loadOverview();
            setSelectedCard(response.card);
        } catch (error) {
            logger.error('加入复习失败', { error });
            toast.error(error instanceof Error ? error.message : t('srs.addFailed'));
        } finally {
            setAdding(false);
        }
    };

    const handleRemove = async (card: SrsCard): Promise<void> => {
        try {
            await srsApi.removeCard(card.id);
            toast.success(t('srs.removed'));
            if (selectedCard?.id === card.id) {
                setSelectedCard(null);
            }
            await loadOverview();
        } catch (error) {
            logger.error('移出复习失败', { error, cardId: card.id });
            toast.error(error instanceof Error ? error.message : t('srs.removeFailed'));
        } finally {
            setPendingDelete(null);
        }
    };

    // 离开页面时停掉预览音频，避免后台继续播放
    useEffect(() => {
        return () => {
            previewAudioRef.current?.pause();
            previewAudioRef.current = null;
        };
    }, []);

    /** 预览今日新学的原声：只播放，不计分、不推进排期。 */
    const playPreview = useCallback(async (card: SrsCard): Promise<void> => {
        try {
            previewAudioRef.current?.pause();
            const filePath = await srsApi.sentenceAudio(card.id);
            const audio = new Audio(UrlUtil.toUrl(filePath));
            previewAudioRef.current = audio;
            audio.onended = () => {
                if (previewAudioRef.current === audio) {
                    previewAudioRef.current = null;
                }
            };
            await audio.play();
        } catch (error) {
            logger.error('预览原声失败', { error, cardId: card.id });
            toast.error(error instanceof Error ? error.message : t('srs.listenFailed'));
        }
    }, [t]);

    if (loading) {
        return (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
            </div>
        );
    }

    const totalCount = overview?.totalCount ?? 0;
    const dueCount = overview?.dueCount ?? 0;
    const now = overview?.generatedAt ?? 0;

    return (
        <div className="w-full h-full flex flex-col overflow-hidden select-text bg-background text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-2">
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
                    {adding ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="mr-1 h-3.5 w-3.5" />}
                    {t('srs.addCurrentSentence')}
                </Button>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-2">
                <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
                    <div className="grid grid-cols-4 gap-3">
                        <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-xs">
                            <div className="text-2xl font-semibold tabular-nums text-foreground">{dueCount}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">{t('srs.dueStat')}</div>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-xs">
                            <div className="text-2xl font-semibold tabular-nums text-foreground">{totalCount}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">{t('srs.totalStat')}</div>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-xs">
                            <div className="text-2xl font-semibold tabular-nums text-foreground">{SRS_PASS_SCORE}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">{t('srs.passStat')}</div>
                        </div>
                        <div
                            className="rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-xs"
                            title={t('srs.limitPausedHint')}
                        >
                            <div className="flex items-baseline gap-1.5">
                                <input
                                    type="number"
                                    min={0}
                                    max={SRS_MAX_DAILY_NEW_CARD_LIMIT}
                                    value={limitValue}
                                    disabled={savingLimit || dailyLimit === undefined}
                                    onChange={(event) => setLimitDraft(event.target.value)}
                                    onBlur={() => void saveDailyLimit()}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.currentTarget.blur();
                                        }
                                    }}
                                    aria-label={t('srs.limitStat')}
                                    className="h-9 w-20 rounded-lg border border-border/60 bg-transparent px-2 text-2xl font-semibold tabular-nums text-foreground outline-none transition-colors focus:border-primary/50 disabled:opacity-60"
                                />
                                {savingLimit && (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                )}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">{t('srs.limitStat')}</div>
                        </div>
                    </div>

                    {loadError && (
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                            <span>{loadError}</span>
                            <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg text-xs" onClick={() => void loadOverview()}>
                                {t('srs.retry')}
                            </Button>
                        </div>
                    )}

                    {overview === null ? null : totalCount === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-card px-6 py-14 text-center shadow-xs">
                            <Repeat className="h-8 w-8 text-muted-foreground/40" />
                            <h3 className="text-base font-medium text-foreground/80">{t('srs.emptyAllTitle')}</h3>
                            <p className="max-w-sm text-xs leading-5 text-muted-foreground">{t('srs.emptyAllGuide')}</p>
                        </div>
                    ) : (
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                            <div className="flex min-w-0 flex-col gap-3">
                                <section
                                    ref={dueSectionRef}
                                    className={cn(
                                        'rounded-2xl border border-border/60 bg-card p-4 shadow-xs transition-shadow',
                                        flashedSection === 'due' && 'ring-2 ring-primary/40',
                                    )}
                                >
                                    <div className="flex items-baseline justify-between">
                                        <h2 className="text-sm font-medium text-foreground">{t('srs.dueTitle')}</h2>
                                        <span className="text-xs tabular-nums text-muted-foreground">{dueCount}</span>
                                    </div>
                                    {overview && overview.dueCards.length > 0 ? (
                                        <div className="mt-2 flex flex-col gap-1">
                                            {overview.dueCards.map((card) => (
                                                <SrsCardRow
                                                    key={card.id}
                                                    card={card}
                                                    active={selectedCard?.id === card.id}
                                                    dueLabel={formatDue(card.dueAt, now, t)}
                                                    onSelect={() => setSelectedCard(card)}
                                                    onDelete={() => setPendingDelete(card)}
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-3">
                                            <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                                {t('srs.emptyDueTitle')}
                                            </div>
                                            <div className="mt-0.5 text-xs text-muted-foreground">{t('srs.emptyDueGuide')}</div>
                                        </div>
                                    )}
                                    {overview && overview.dueCount > overview.dueCards.length && (
                                        <div className="mt-2 text-xs text-muted-foreground">
                                            {t('srs.moreDue', { remaining: overview.dueCount - overview.dueCards.length })}
                                        </div>
                                    )}
                                </section>

                                {overview && overview.upcomingCards.length > 0 && (
                                    <section
                                        ref={upcomingSectionRef}
                                        className={cn(
                                            'rounded-2xl border border-border/60 bg-card p-4 shadow-xs transition-shadow',
                                            flashedSection === 'upcoming' && 'ring-2 ring-primary/40',
                                        )}
                                    >
                                        <div className="flex items-baseline justify-between">
                                            <h2 className="text-sm font-medium text-foreground">{t('srs.upcomingTitle')}</h2>
                                            <span className="text-xs tabular-nums text-muted-foreground">
                                                {overview.upcomingCards.length}
                                            </span>
                                        </div>
                                        <div className="mt-2 flex flex-col gap-1">
                                            {overview.upcomingCards.map((card) => (
                                                <SrsCardRow
                                                    key={card.id}
                                                    card={card}
                                                    active={selectedCard?.id === card.id}
                                                    dueLabel={formatDue(card.dueAt, now, t)}
                                                    onSelect={() => setSelectedCard(card)}
                                                    onDelete={() => setPendingDelete(card)}
                                                />
                                            ))}
                                        </div>
                                    </section>
                                )}

                                {overview && overview.newCards.length > 0 && (
                                    <section
                                        ref={newSectionRef}
                                        className={cn(
                                            'rounded-2xl border border-border/60 bg-card p-4 shadow-xs transition-shadow',
                                            flashedSection === 'new' && 'ring-2 ring-primary/40',
                                        )}
                                    >
                                        <div className="flex items-baseline justify-between">
                                            <h2 className="text-sm font-medium text-foreground">{t('srs.newTitle')}</h2>
                                            <span className="text-xs tabular-nums text-muted-foreground">
                                                {overview.newCount}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">{t('srs.newHint')}</p>
                                        <div className="mt-2 flex flex-col gap-1">
                                            {overview.newCards.map((card) => (
                                                <NewCardRow
                                                    key={card.id}
                                                    card={card}
                                                    t={t}
                                                    canPlay={card.sourceKind === 'video' && Boolean(card.videoPath) && Boolean(card.subtitlePath)}
                                                    onPlay={(item) => void playPreview(item)}
                                                />
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </div>

                            <div className="min-w-0">
                                {selectedCard ? (
                                    <ReviewPanel
                                        key={selectedCard.id}
                                        card={selectedCard}
                                        hasNextDue={nextDue !== null}
                                        onReviewed={handleReviewed}
                                        onNext={handleNext}
                                    />
                                ) : (
                                    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card/40 px-6 py-10 text-center">
                                        <Repeat className="h-7 w-7 text-muted-foreground/40" />
                                        <p className="text-sm text-muted-foreground">{t('srs.selectHint')}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

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
