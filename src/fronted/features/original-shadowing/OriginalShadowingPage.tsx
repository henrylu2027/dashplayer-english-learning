import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
    ArrowLeft,
    Check,
    Loader2,
    Mic,
    Play,
    Repeat,
    Square,
    Volume2,
} from 'lucide-react';

import type { ShadowingAttemptSource, ShadowingScoreVO } from '@/common/contracts/shadowing';
import type { SrsOverview } from '@/common/contracts/srs';
import { SRS_PASS_SCORE } from '@/common/contracts/srs';
import UrlUtil from '@/common/utils/UrlUtil';
import PageHeader from '@/fronted/components/shared/common/PageHeader';
import { Button } from '@/fronted/components/ui/button';
import useFile from '@/fronted/features/file-browser/fileStore';
import { usePlayer } from '@/fronted/features/player/playerStore';
import ScorePanel from '@/fronted/features/shadowing/components/ScorePanel';
import { buildVideoShadowingSource } from '@/fronted/features/shadowing/shadowingSource';
import { practiceApi } from '@/fronted/features/practice/practiceApi';
import { srsApi } from '@/fronted/features/srs/srsApi';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { useRecordedAttempt } from './useRecordedAttempt';

const logger = getRendererLogger('OriginalShadowingPage');

/** 通过后停留多久再自动跳到下一句，让用户看清得分。 */
const AUTO_NEXT_DELAY_MS = 1200;

/** 队列模式：按视频原顺序跟读，或由 SRS 推送难句。 */
type QueueMode = 'sequence' | 'srs';

/** 队列条目的练习状态。 */
type EntryStatus = 'pending' | 'passed' | 'failed';

/**
 * 队列里的一句话。
 */
interface QueueEntry {
    /** 稳定键：视频句用 `fileHash-index`，复习卡用 `card-ID`。 */
    id: string;
    /** 参考文本。 */
    text: string;
    /** 句子来源，评测与复习提交都以它为准。 */
    source: ShadowingAttemptSource;
    /** 练习状态。 */
    status: EntryStatus;
    /** 最近一次得分。 */
    score: number | null;
    /** 间隔复习卡片 ID；顺序跟读模式为 undefined。 */
    cardId?: number;
}

/** 状态徽标文案的 i18n key。 */
const STATUS_LABEL: Record<EntryStatus, string> = {
    pending: 'originalShadowing.statusPending',
    passed: 'originalShadowing.statusPassed',
    failed: 'originalShadowing.statusFailed',
};

/** 状态徽标配色。 */
const STATUS_CLASS: Record<EntryStatus, string> = {
    pending: 'bg-muted text-muted-foreground',
    passed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    failed: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

/** 原声播放阶段。 */
type AudioPhase = 'idle' | 'loading' | 'playing';

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
 * 从评测结果里挑出需要进词汇工坊的词：漏读、读错、多读都算需要练。
 * @param result 评测结果。
 * @returns 去重后的单词列表，按出现顺序。
 */
function collectProblemWords(result: ShadowingScoreVO): string[] {
    const seen = new Set<string>();
    const words: string[] = [];
    for (const word of result.words) {
        if (word.status === 'correct') {
            continue;
        }
        const text = (word.expected ?? word.actual ?? '').trim();
        if (!text) {
            continue;
        }
        const key = text.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        words.push(text);
    }
    return words;
}

/**
 * 原音跟读页：左侧为视频原句队列，右侧为“听原声 → 麦克风跟读 → 提交评测”。
 *
 * 两种队列模式共用同一个练习面板：顺序跟读按视频原有顺序推进，
 * 间隔复习由 SRS 推送到期难句；达标自动下一句，未达标自动流入复习池。
 */
export default function OriginalShadowingPage() {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();

    const sentences = usePlayer((s) => s.sentences);
    const currentSentence = usePlayer((s) => s.currentSentence);
    const videoPath = useFile((s) => s.videoPath);
    const subtitlePath = useFile((s) => s.subtitlePath);
    const videoId = useFile((s) => s.videoId);

    const [mode, setMode] = useState<QueueMode>('sequence');
    // 两种队列各自常驻：切换模式只换显示，不销毁对方的列表与选中句
    const [sequenceEntries, setSequenceEntries] = useState<QueueEntry[]>([]);
    const [srsEntries, setSrsEntries] = useState<QueueEntry[]>([]);
    const [sequenceSelectedId, setSequenceSelectedId] = useState<string | null>(null);
    const [srsSelectedId, setSrsSelectedId] = useState<string | null>(null);
    const [audioPhase, setAudioPhase] = useState<AudioPhase>('idle');
    const [evaluating, setEvaluating] = useState(false);
    const [savingWords, setSavingWords] = useState(false);
    const [result, setResult] = useState<ShadowingScoreVO | null>(null);
    const [outcome, setOutcome] = useState<{ passed: boolean; score: number } | null>(null);
    // 结果常驻：记住这份结果属于哪一句，切换句子时不抹掉，只在新的评测后覆盖
    const [resultText, setResultText] = useState<string | null>(null);
    const [resultEntryId, setResultEntryId] = useState<string | null>(null);
    const [loadingQueue, setLoadingQueue] = useState(false);

    const recorded = useRecordedAttempt();
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const autoNextTimerRef = useRef<number | null>(null);

    const entries = mode === 'sequence' ? sequenceEntries : srsEntries;
    const selectedId = mode === 'sequence' ? sequenceSelectedId : srsSelectedId;
    const setSelectedId = mode === 'sequence' ? setSequenceSelectedId : setSrsSelectedId;

    const selected = entries.find((entry) => entry.id === selectedId) ?? null;

    /** 停掉正在播放的音频（原声或自己的录音）。 */
    const stopAudio = useCallback((): void => {
        audioRef.current?.pause();
        audioRef.current = null;
        setAudioPhase('idle');
    }, []);

    /** 清掉自动下一句的定时器。 */
    const clearAutoNext = useCallback((): void => {
        if (autoNextTimerRef.current !== null) {
            window.clearTimeout(autoNextTimerRef.current);
            autoNextTimerRef.current = null;
        }
    }, []);

    // 离开页面时停止一切声音与定时器
    useEffect(() => {
        return () => {
            audioRef.current?.pause();
            audioRef.current = null;
            if (autoNextTimerRef.current !== null) {
                window.clearTimeout(autoNextTimerRef.current);
            }
        };
    }, []);

    /**
     * 播放一段音频地址。
     * @param url 音频地址。
     * @param failureText 播放失败时的提示。
     */
    const playUrl = async (url: string, failureText: string): Promise<void> => {
        stopAudio();
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
            audioRef.current = null;
            setAudioPhase('idle');
        };
        try {
            await audio.play();
            setAudioPhase('playing');
        } catch (playError) {
            logger.error('播放音频失败', { error: playError });
            audioRef.current = null;
            setAudioPhase('idle');
            toast.error(playError instanceof Error ? playError.message : failureText);
        }
    };

    /** 播放当前句原声：按 videoPath + subtitlePath + sentenceIndex 现场截取，命中缓存时直接播放。 */
    const playOriginal = async (entry: QueueEntry): Promise<void> => {
        if (audioPhase === 'playing') {
            stopAudio();
            return;
        }
        if (entry.source.kind !== 'video' || audioPhase === 'loading') {
            return;
        }
        setAudioPhase('loading');
        try {
            const filePath = await practiceApi.sentenceAudio(entry.source);
            setAudioPhase('idle');
            await playUrl(UrlUtil.toUrl(filePath), t('originalShadowing.playFailed'));
        } catch (audioError) {
            logger.error('提取原声失败', { error: audioError, entryId: entry.id });
            setAudioPhase('idle');
            toast.error(audioError instanceof Error ? audioError.message : t('originalShadowing.playFailed'));
        }
    };

    /** 播放自己刚才那遍录音。 */
    const playRecording = async (): Promise<void> => {
        if (audioPhase === 'playing') {
            stopAudio();
            return;
        }
        if (!recorded.recordingUrl) {
            return;
        }
        await playUrl(recorded.recordingUrl, t('originalShadowing.playFailed'));
    };

    /**
     * 切换选中句：停音频、清录音与结果。
     * @param entryId 目标条目。
     */
    const selectEntry = (entryId: string): void => {
        if (entryId === selectedId) {
            return;
        }
        clearAutoNext();
        stopAudio();
        recorded.reset();
        // 结果反馈与逐词对比常驻：切句时保留上一次的评测，提交新录音后才覆盖
        setSelectedId(entryId);
    };

    /** 选中下一条未达标（或未练习）的句子；没有就停在原地。 */
    const advanceToNext = useCallback((): void => {
        setSelectedId((previous) => {
            const fromIndex = entries.findIndex((entry) => entry.id === previous);
            const ordered = fromIndex >= 0 ? entries.slice(fromIndex + 1) : entries;
            const next = ordered.find((entry) => entry.status !== 'passed');
            return next?.id ?? previous;
        });
        recorded.reset();
    }, [entries, recorded, setSelectedId]);

    /** 顺序跟读：把当前视频全部分句一次性加入队列，保持视频原有顺序。 */
    const importWholeVideo = (): void => {
        const usable = sentences.filter((sentence) => sentence.text.trim().length > 0);
        if (usable.length === 0) {
            toast.error(t('originalShadowing.noVideoSentences'));
            return;
        }
        const next: QueueEntry[] = usable.map((sentence) => ({
            id: `${sentence.fileHash}-${sentence.index}`,
            text: sentence.text.trim(),
            source: buildVideoShadowingSource(sentence, videoPath, subtitlePath),
            status: 'pending',
            score: null,
        }));
        clearAutoNext();
        stopAudio();
        recorded.reset();
        setSequenceEntries(next);
        setSequenceSelectedId(next[0]?.id ?? null);
        toast.success(t('originalShadowing.imported', { count: next.length }));
    };

    /** 把播放器当前高亮句追加进队列；已在队列里则不重复添加。 */
    const addCurrentSentence = (): void => {
        if (!currentSentence) {
            toast.error(t('shadowing.noCurrentSentence'));
            return;
        }
        const id = `${currentSentence.fileHash}-${currentSentence.index}`;
        // 视频句只进顺序队列；间隔复习队列由 SRS 推送，不掺入视频句
        const already = sequenceEntries.some((entry) => entry.id === id);
        if (!already) {
            const entry: QueueEntry = {
                id,
                text: currentSentence.text.trim(),
                source: buildVideoShadowingSource(currentSentence, videoPath, subtitlePath),
                status: 'pending',
                score: null,
            };
            setSequenceEntries((prev) => [...prev, entry]);
        }
        if (mode !== 'sequence') {
            // 从间隔复习切回顺序跟读，把刚加入的句子选上
            clearAutoNext();
            stopAudio();
            recorded.reset();
            setMode('sequence');
        }
        setSequenceSelectedId(id);
        toast.success(already ? t('originalShadowing.alreadyQueued') : t('originalShadowing.addedOne'));
    };

    /** 间隔复习：拉取到期卡片作为队列。 */
    const loadSrsQueue = useCallback(async (): Promise<void> => {
        setLoadingQueue(true);
        try {
            const overview: SrsOverview = await srsApi.overview();
            const next: QueueEntry[] = overview.dueCards.map((card) => ({
                id: `card-${card.id}`,
                text: card.referenceText,
                source: card.sourceKind === 'video'
                    ? {
                        kind: 'video',
                        videoKey: card.videoKey ?? undefined,
                        sentenceIndex: card.sentenceIndex ?? undefined,
                        videoPath: card.videoPath ?? undefined,
                        subtitlePath: card.subtitlePath ?? undefined,
                    }
                    : { kind: 'free' },
                status: 'pending',
                score: card.lastScore,
                cardId: card.id,
            }));
            clearAutoNext();
            stopAudio();
            recorded.reset();
            setSrsEntries(next);
            setSrsSelectedId(next[0]?.id ?? null);
        } catch (error) {
            logger.error('加载复习队列失败', { error });
            toast.error(error instanceof Error ? error.message : t('srs.loadFailed'));
        } finally {
            setLoadingQueue(false);
        }
    }, [clearAutoNext, recorded, stopAudio, t]);

    /**
     * 切换模式：顺序跟读重新按视频排，间隔复习拉 SRS 到期句。
     * @param next 目标模式。
     */
    const switchMode = (next: QueueMode): void => {
        if (next === mode) {
            return;
        }
        // 两种队列各自保留：切换只换显示与选中句，不清空视频原句队列
        clearAutoNext();
        stopAudio();
        recorded.reset();
        setMode(next);
        if (next === 'srs') {
            void loadSrsQueue();
        }
    };

    /** 把评测结果写回队列条目；两种队列 ID 前缀不同，同时更新互不影响。 */
    const applyEntryResult = (entryId: string, score: number, passed: boolean): void => {
        const patch = (prev: QueueEntry[]): QueueEntry[] => prev.map((entry) => (
            entry.id === entryId
                ? { ...entry, status: passed ? 'passed' : 'failed', score }
                : entry
        ));
        setSequenceEntries(patch);
        setSrsEntries(patch);
    };

    /**
     * 提交评测：录音 → 评分 → 达标推进 / 未达标入复习池。
     */
    const handleSubmit = async (): Promise<void> => {
        if (!selected || evaluating || recorded.phase !== 'ready') {
            return;
        }
        stopAudio();
        setEvaluating(true);
        try {
            const response = await recorded.submit(selected.text, selected.source);
            if (!response) {
                return;
            }
            const passed = response.result.score >= SRS_PASS_SCORE;
            setResult(response.result);
            setOutcome({ passed, score: response.result.score });
            // 记住这份结果属于哪一句：后面切句时面板继续显示它
            setResultText(selected.text);
            setResultEntryId(selected.id);
            applyEntryResult(selected.id, response.result.score, passed);

            if (selected.cardId !== undefined) {
                // 间隔复习：由后端按跟读记录判定并推进阶段
                try {
                    const reviewed = await srsApi.submitReview({
                        cardId: selected.cardId,
                        attemptId: response.attempt.id,
                    });
                    setOutcome({ passed: reviewed.passed, score: reviewed.score });
                    applyEntryResult(selected.id, reviewed.score, reviewed.passed);
                    if (reviewed.passed) {
                        clearAutoNext();
                        autoNextTimerRef.current = window.setTimeout(advanceToNext, AUTO_NEXT_DELAY_MS);
                    }
                } catch (submitError) {
                    logger.error('提交复习结果失败', { error: submitError, entryId: selected.id });
                    toast.error(submitError instanceof Error ? submitError.message : t('srs.submitFailed'));
                }
                return;
            }

            if (passed) {
                clearAutoNext();
                autoNextTimerRef.current = window.setTimeout(advanceToNext, AUTO_NEXT_DELAY_MS);
                return;
            }
            // 顺序跟读未达标：自动流入复习池，下次由间隔复习推送
            try {
                const added = await srsApi.addCard({
                    referenceText: selected.text,
                    source: selected.source,
                });
                toast.success(added.created ? t('originalShadowing.flowedToSrs') : t('originalShadowing.alreadyInSrs'));
            } catch (flowError) {
                logger.error('未达标句子入复习池失败', { error: flowError, entryId: selected.id });
                toast.error(flowError instanceof Error ? flowError.message : t('originalShadowing.flowFailed'));
            }
        } finally {
            setEvaluating(false);
        }
    };

    /** 把本轮评测里读错/漏读的词一键加入词汇工坊。 */
    const handleAddWords = async (): Promise<void> => {
        if (!result) {
            return;
        }
        const words = collectProblemWords(result);
        if (words.length === 0) {
            toast.success(t('originalShadowing.noProblemWords'));
            return;
        }
        setSavingWords(true);
        let added = 0;
        try {
            for (const word of words) {
                const response = await videoLearningApi.favoriteWord(word);
                if (response.success) {
                    added += 1;
                }
            }
            toast.success(t('originalShadowing.wordsAdded', { count: added }));
        } catch (error) {
            logger.error('加入词汇工坊失败', { error });
            toast.error(error instanceof Error ? error.message : t('originalShadowing.wordsAddFailed'));
        } finally {
            setSavingWords(false);
        }
    };

    const isRecording = recorded.phase === 'recording';
    const isScoring = recorded.phase === 'scoring' || evaluating;
    const pendingCount = useMemo(() => entries.filter((entry) => entry.status !== 'passed').length, [entries]);
    const canPlayOriginal = selected?.source.kind === 'video';
    /** 面板里的结果是否属于另一句：属于其它句时提示「提交后更新」，不假装是这句的分数。 */
    const resultStale = result !== null && resultEntryId !== null && resultEntryId !== selectedId;

    const handleMicClick = (): void => {
        if (!selected || isScoring) {
            return;
        }
        if (isRecording) {
            recorded.stop();
            return;
        }
        stopAudio();
        // 保留上一次的评测结果，重新录音不改动面板；提交后才会被新结果覆盖
        void recorded.start();
    };

    const goPlayer = (): void => {
        navigate(videoId ? `/player/${videoId}?sideBarAnimation=false` : '/home');
    };

    return (
        <div className="w-full h-full flex flex-col overflow-hidden select-none bg-background text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-2">
                <PageHeader
                    title={t('originalShadowing.title')}
                    description={t('originalShadowing.description')}
                />
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 rounded-lg px-3 text-xs"
                    onClick={addCurrentSentence}
                >
                    <Play className="mr-1 h-3.5 w-3.5" />
                    {t('originalShadowing.addCurrent')}
                </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-2">
                <div className="mx-auto grid w-full max-w-6xl gap-4 lg:h-full lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
                    {/* 左：队列 */}
                    <section className="flex min-w-0 flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-xs lg:min-h-0">
                        <div className="flex flex-col gap-2">
                            <Button
                                type="button"
                                className="h-9 w-full rounded-xl text-sm"
                                disabled={loadingQueue}
                                onClick={() => {
                                    if (mode === 'srs') {
                                        void loadSrsQueue();
                                        return;
                                    }
                                    importWholeVideo();
                                }}
                            >
                                {loadingQueue ? (
                                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                ) : mode === 'srs' ? (
                                    <Repeat className="mr-1.5 h-4 w-4" />
                                ) : (
                                    <Volume2 className="mr-1.5 h-4 w-4" />
                                )}
                                {mode === 'srs'
                                    ? t('originalShadowing.pullSrs')
                                    : t('originalShadowing.importWhole')}
                            </Button>
                            <p className="text-center text-xs text-muted-foreground">
                                {mode === 'srs'
                                    ? t('originalShadowing.pullSrsHint')
                                    : t('originalShadowing.importWholeHint')}
                            </p>
                            <div className="flex gap-1 rounded-xl bg-muted p-1">
                                {(['sequence', 'srs'] as const).map((item) => (
                                    <button
                                        key={item}
                                        type="button"
                                        onClick={() => switchMode(item)}
                                        className={cn(
                                            'flex-1 rounded-lg px-3 py-1.5 text-xs transition-colors',
                                            mode === item
                                                ? 'bg-background text-foreground shadow-xs'
                                                : 'text-muted-foreground hover:text-foreground',
                                        )}
                                    >
                                        {item === 'sequence'
                                            ? t('originalShadowing.modeSequence')
                                            : t('originalShadowing.modeSrs')}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="mt-4 flex items-baseline justify-between">
                            <h2 className="text-sm font-medium text-foreground">
                                {t('originalShadowing.queueTitle')}
                            </h2>
                            <span className="text-xs tabular-nums text-muted-foreground">
                                {t('originalShadowing.queueCount', { count: entries.length })}
                            </span>
                        </div>

                        {entries.length === 0 ? (
                            <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 px-4 py-10 text-center">
                                <Volume2 className="h-6 w-6 text-muted-foreground/40" />
                                <p className="text-xs leading-5 text-muted-foreground">
                                    {t('originalShadowing.queueEmpty')}
                                </p>
                                {!videoId && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="mt-1 h-7 rounded-lg px-2.5 text-xs"
                                        onClick={goPlayer}
                                    >
                                        <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                                        {t('originalShadowing.goPlayer')}
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="mt-2 flex flex-col gap-1.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                                {entries.map((entry, index) => (
                                    <button
                                        key={entry.id}
                                        type="button"
                                        onClick={() => selectEntry(entry.id)}
                                        className={cn(
                                            'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                                            entry.id === selectedId
                                                ? 'border-amber-400/70 bg-amber-400/10'
                                                : 'border-transparent hover:bg-muted/60',
                                        )}
                                    >
                                        <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                                            {index + 1}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm text-foreground">
                                                {entry.text}
                                            </span>
                                        </span>
                                        {entry.score !== null && (
                                            <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground/70">
                                                {entry.score}
                                            </span>
                                        )}
                                        <span
                                            className={cn(
                                                'shrink-0 rounded-md px-1.5 py-0.5 text-[10px]',
                                                STATUS_CLASS[entry.status],
                                            )}
                                        >
                                            {t(STATUS_LABEL[entry.status])}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {entries.length > 0 && (
                            <div className="mt-3 text-xs text-muted-foreground">
                                {t('originalShadowing.remaining', { count: pendingCount })}
                            </div>
                        )}
                    </section>

                    {/* 右：当前练习 + 结果 */}
                    <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                        <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{t('originalShadowing.currentTitle')}</span>
                                <span>{t('originalShadowing.passLine', { score: SRS_PASS_SCORE })}</span>
                            </div>
                            <p className="mt-2 min-h-9 text-xl leading-9 text-foreground">
                                {selected ? selected.text : t('originalShadowing.noSelection')}
                            </p>

                            <div className="mt-5 flex items-center justify-center gap-4">
                                <div className="flex w-28 flex-col items-center gap-1.5">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-9 rounded-lg px-3 text-xs"
                                        disabled={!canPlayOriginal || audioPhase === 'loading' || !selected}
                                        onClick={() => selected && void playOriginal(selected)}
                                    >
                                        {audioPhase === 'loading' ? (
                                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Volume2 className="mr-1 h-3.5 w-3.5" />
                                        )}
                                        {t('originalShadowing.listen')}
                                    </Button>
                                    <span className="text-[11px] text-muted-foreground">
                                        {t('originalShadowing.stepListen')}
                                    </span>
                                </div>

                                <span className="text-muted-foreground/40">→</span>

                                <div className="flex w-28 flex-col items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={handleMicClick}
                                        disabled={!selected || isScoring}
                                        aria-label={isRecording ? t('shadowing.stopRecording') : t('shadowing.startRecording')}
                                        className={cn(
                                            'relative flex h-16 w-16 items-center justify-center rounded-full transition-all',
                                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                            isRecording
                                                ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                                                : 'bg-primary text-primary-foreground hover:scale-105',
                                            (!selected || isScoring) && 'cursor-not-allowed opacity-60',
                                        )}
                                    >
                                        {isRecording && (
                                            <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-red-500/20" />
                                        )}
                                        {isRecording ? (
                                            <Square className="h-5 w-5 fill-current" />
                                        ) : isScoring ? (
                                            <Loader2 className="h-6 w-6 animate-spin" />
                                        ) : (
                                            <Mic className="h-6 w-6" />
                                        )}
                                    </button>
                                    <span className="text-[11px] text-muted-foreground">
                                        {isRecording
                                            ? t('shadowing.recording', { time: formatElapsed(recorded.elapsedSec) })
                                            : t('originalShadowing.stepRecord')}
                                    </span>
                                </div>

                                <span className="text-muted-foreground/40">→</span>

                                <div className="flex w-28 flex-col items-center gap-1.5">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-9 rounded-lg px-3 text-xs"
                                        disabled={recorded.phase !== 'ready' || isScoring}
                                        onClick={() => void handleSubmit()}
                                    >
                                        {isScoring ? (
                                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Check className="mr-1 h-3.5 w-3.5" />
                                        )}
                                        {t('originalShadowing.submit')}
                                    </Button>
                                    <span className="text-[11px] text-muted-foreground">
                                        {t('originalShadowing.stepScore')}
                                    </span>
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 rounded-lg px-2.5 text-xs"
                                    disabled={!recorded.recordingUrl || isRecording || isScoring}
                                    onClick={() => void playRecording()}
                                >
                                    <Play className="mr-1 h-3.5 w-3.5" />
                                    {t('originalShadowing.playMine')}
                                </Button>
                                {audioPhase === 'playing' && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 rounded-lg px-2.5 text-xs"
                                        onClick={stopAudio}
                                    >
                                        <Square className="mr-1 h-3 w-3 fill-current" />
                                        {t('originalShadowing.stopAudio')}
                                    </Button>
                                )}
                                {!canPlayOriginal && selected && (
                                    <span className="text-[11px] text-muted-foreground">
                                        {t('originalShadowing.noOriginalAudio')}
                                    </span>
                                )}
                            </div>

                            {recorded.error && (
                                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                                    {recorded.error}
                                </div>
                            )}
                        </section>

                        <section
                            className={cn(
                                'rounded-2xl border p-5 shadow-xs',
                                outcome === null
                                    ? 'border-border/60 bg-card'
                                    : outcome.passed
                                        ? 'border-emerald-500/30 bg-emerald-500/10'
                                        : 'border-amber-500/30 bg-amber-500/10',
                            )}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-baseline gap-2">
                                    <h2 className="shrink-0 text-sm font-medium text-foreground">
                                        {t('originalShadowing.resultTitle')}
                                    </h2>
                                    {result && resultText && (
                                        <span className="truncate text-xs text-muted-foreground">· {resultText}</span>
                                    )}
                                </div>
                                {result && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 rounded-lg px-2.5 text-xs"
                                        disabled={savingWords}
                                        onClick={() => void handleAddWords()}
                                    >
                                        {savingWords && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                                        {t('originalShadowing.addWords')}
                                    </Button>
                                )}
                            </div>

                            <div className="mt-3 grid grid-cols-3 items-center gap-3">
                                <div>
                                    <div className="text-xs text-muted-foreground">
                                        {t('originalShadowing.score')}
                                    </div>
                                    <div className="text-3xl font-semibold tabular-nums leading-tight text-foreground">
                                        {outcome?.score ?? '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-muted-foreground">
                                        {t('originalShadowing.passLineLabel')}
                                    </div>
                                    <div className="text-3xl font-semibold tabular-nums leading-tight text-foreground/70">
                                        {SRS_PASS_SCORE}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-muted-foreground">
                                        {t('originalShadowing.verdictLabel')}
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xl font-semibold leading-tight">
                                        {outcome === null ? (
                                            <span className="text-muted-foreground">—</span>
                                        ) : outcome.passed ? (
                                            <>
                                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                                                    <Check className="h-3.5 w-3.5" />
                                                </span>
                                                <span className="text-emerald-600 dark:text-emerald-400">
                                                    {t('originalShadowing.passed')}
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-amber-600 dark:text-amber-400">
                                                {t('originalShadowing.failed')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">
                                {resultStale
                                    ? t('originalShadowing.resultStaleHint', { text: resultText ?? '' })
                                    : outcome === null
                                        ? t('originalShadowing.resultHint')
                                        : outcome.passed
                                            ? t('originalShadowing.resultPassedHint')
                                            : t('originalShadowing.resultFailedHint')}
                            </p>
                        </section>

                        {/* 逐词对比常驻：无结果时按同一版式显示占位 */}
                        <ScorePanel result={result} />
                    </div>
                </div>
            </div>
        </div>
    );
}
