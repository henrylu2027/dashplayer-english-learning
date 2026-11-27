import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
    BookOpen,
    CheckCheck,
    Loader2,
    Mic,
    PencilLine,
    Play,
    RotateCcw,
    Square,
    Volume2,
} from 'lucide-react';

import type {
    DictationResult,
    PracticeAttemptSummary,
    PracticeMode,
    RetellResult,
} from '@/common/contracts/practice';
import type { ShadowingAttemptSource, ShadowingWordStatus } from '@/common/contracts/shadowing';
import UrlUtil from '@/common/utils/UrlUtil';
import PageHeader from '@/fronted/components/shared/common/PageHeader';
import { Button } from '@/fronted/components/ui/button';
import { Textarea } from '@/fronted/components/ui/textarea';
import useFile from '@/fronted/features/file-browser/fileStore';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { buildVideoShadowingSource } from '@/fronted/features/shadowing/shadowingSource';
import { useAudioRecorder } from '@/fronted/features/shadowing/useAudioRecorder';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { practiceApi } from './practiceApi';
import { usePracticeAudio } from './usePracticeAudio';

const logger = getRendererLogger('PracticePage');

/** 最近练习展示条数。 */
const RECENT_ATTEMPT_LIMIT = 8;

/** 队列里的一句。 */
interface QueueItem {
    /** 稳定键：`fileHash-index`。 */
    id: string;
    /** 参考文本。 */
    text: string;
    /** 句子来源。 */
    source: ShadowingAttemptSource;
}

/** 逐词着色：错词红、漏词灰、多余词蓝。 */
const WORD_CLASS: Record<ShadowingWordStatus, string> = {
    correct: 'text-foreground',
    mispronounced: 'rounded bg-red-500/15 px-0.5 text-red-600 dark:text-red-400',
    missing: 'rounded bg-muted px-0.5 text-muted-foreground line-through',
    extra: 'rounded bg-sky-500/15 px-0.5 text-sky-600 dark:text-sky-400 line-through',
};

/** 分数配色。 */
function scoreTone(score: number): string {
    if (score >= 85) {
        return 'text-emerald-600 dark:text-emerald-400';
    }
    if (score >= 70) {
        return 'text-amber-600 dark:text-amber-400';
    }
    return 'text-red-500';
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
 * 听写复述页：顶部视频句信息栏、右侧句子队列，主体听写/复述切换。
 *
 * 听写走键盘输入 + 逐词校对；复述走录音 + 关键词覆盖。
 * 两种模式的原文都来自当前视频分句，保证每次练习都能回到具体语境。
 */
export default function PracticePage() {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();

    const sentences = usePlayer((s) => s.sentences);
    const currentSentence = usePlayer((s) => s.currentSentence);
    const videoPath = useFile((s) => s.videoPath);
    const subtitlePath = useFile((s) => s.subtitlePath);
    const videoId = useFile((s) => s.videoId);

    const [mode, setMode] = useState<PracticeMode>('dictation');
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [cursor, setCursor] = useState(0);
    const [typedText, setTypedText] = useState('');
    const [dictation, setDictation] = useState<DictationResult | null>(null);
    const [retell, setRetell] = useState<RetellResult | null>(null);
    const [checking, setChecking] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<PracticeAttemptSummary[]>([]);
    const [savingWords, setSavingWords] = useState(false);

    const current = queue[cursor] ?? null;
    const audio = usePracticeAudio(current?.source ?? null);

    /** 队列容器，用于把当前句滚进可视区。 */
    const queueListRef = useRef<HTMLDivElement | null>(null);

    /** 队列行内试听：正在播放/加载的句子 ID。 */
    const [rowPlayingId, setRowPlayingId] = useState<string | null>(null);
    const [rowLoadingId, setRowLoadingId] = useState<string | null>(null);
    const rowAudioRef = useRef<HTMLAudioElement | null>(null);

    /** 停掉队列行里的试听。 */
    const stopRowAudio = useCallback((): void => {
        rowAudioRef.current?.pause();
        rowAudioRef.current = null;
        setRowPlayingId(null);
    }, []);

    /**
     * 试听队列里某一句的原声；再点一次停止。
     * @param item 目标句子。
     */
    const playRow = async (item: QueueItem): Promise<void> => {
        if (rowPlayingId === item.id) {
            stopRowAudio();
            return;
        }
        stopRowAudio();
        audio.stop();
        setRowLoadingId(item.id);
        try {
            const filePath = await practiceApi.sentenceAudio(item.source);
            const element = new Audio(UrlUtil.toUrl(filePath));
            rowAudioRef.current = element;
            element.onended = () => {
                rowAudioRef.current = null;
                setRowPlayingId(null);
            };
            await element.play();
            setRowPlayingId(item.id);
        } catch (playError) {
            logger.error('试听原声失败', { error: playError, itemId: item.id });
            toast.error(playError instanceof Error ? playError.message : t('practice.listenFailed'));
        } finally {
            setRowLoadingId(null);
        }
    };

    // 离开页面时停掉行内试听
    useEffect(() => {
        return () => {
            rowAudioRef.current?.pause();
            rowAudioRef.current = null;
        };
    }, []);

    // 当前句始终滚进队列可视区，切句后不用手动翻
    useEffect(() => {
        const active = queueListRef.current?.querySelector('[data-current="true"]');
        active?.scrollIntoView({ block: 'nearest' });
    }, [cursor, queue.length]);

    /** 已经导入过一次就不再自动覆盖用户的选择。 */
    const didAutoImportRef = useRef(false);

    const importSentences = useCallback((options?: { silent?: boolean; atSentenceId?: string }): number => {
        const usable = sentences.filter((sentence) => sentence.text.trim().length > 0);
        if (usable.length === 0) {
            if (!options?.silent) {
                toast.error(t('practice.noVideoSentences'));
            }
            return 0;
        }
        const items: QueueItem[] = usable.map((sentence) => ({
            id: `${sentence.fileHash}-${sentence.index}`,
            text: sentence.text.trim(),
            source: buildVideoShadowingSource(sentence, videoPath, subtitlePath),
        }));
        setQueue(items);
        const anchor = options?.atSentenceId
            ? items.findIndex((item) => item.id === options.atSentenceId)
            : 0;
        setCursor(anchor >= 0 ? anchor : 0);
        if (!options?.silent) {
            toast.success(t('practice.imported', { count: items.length }));
        }
        return items.length;
    }, [sentences, subtitlePath, t, videoPath]);

    // 首次进入且播放器里有句子时，自动导入队列并把光标停在当前句
    useEffect(() => {
        if (didAutoImportRef.current || queue.length > 0 || sentences.length === 0) {
            return;
        }
        didAutoImportRef.current = true;
        importSentences({
            silent: true,
            atSentenceId: currentSentence ? `${currentSentence.fileHash}-${currentSentence.index}` : undefined,
        });
    }, [currentSentence, importSentences, queue.length, sentences.length]);

    // 练习记录：进页面拉一次
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const recent = await practiceApi.listAttempts({ limit: RECENT_ATTEMPT_LIMIT });
                if (!cancelled) {
                    setHistory(recent);
                }
            } catch (historyError) {
                logger.error('加载练习记录失败', { error: historyError });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    /** 切换句子前清空本轮结果。 */
    const resetRound = useCallback((): void => {
        audio.stop();
        setTypedText('');
        setDictation(null);
        setRetell(null);
        setError(null);
    }, [audio]);

    const goTo = useCallback((nextCursor: number): void => {
        if (queue.length === 0) {
            return;
        }
        resetRound();
        setCursor(((nextCursor % queue.length) + queue.length) % queue.length);
    }, [queue.length, resetRound]);

    const goNext = useCallback((): void => {
        goTo(cursor + 1);
    }, [cursor, goTo]);

    const handleSaved = (attempt: PracticeAttemptSummary): void => {
        setHistory((prev) => [
            attempt,
            ...prev.filter((item) => item.id !== attempt.id),
        ].slice(0, RECENT_ATTEMPT_LIMIT));
    };

    /** 听写校对。 */
    const handleCheck = async (): Promise<void> => {
        if (!current || !typedText.trim() || checking) {
            return;
        }
        setChecking(true);
        setError(null);
        try {
            const checked = await practiceApi.dictation({
                referenceText: current.text,
                typedText,
                source: current.source,
            });
            setDictation(checked);
            handleSaved(checked.attempt);
        } catch (checkError) {
            logger.error('听写校对失败', { error: checkError });
            setError(checkError instanceof Error ? checkError.message : t('practice.checkFailed'));
        } finally {
            setChecking(false);
        }
    };

    /** 复述录音结束后自动评测。 */
    const handleRecording = async (blob: Blob): Promise<void> => {
        if (!current) {
            return;
        }
        if (blob.size === 0) {
            setError(t('practice.noSpeech'));
            return;
        }
        setProcessing(true);
        setError(null);
        try {
            const buffer = await blob.arrayBuffer();
            const checked = await practiceApi.retell({
                referenceText: current.text,
                source: current.source,
                audio: new Uint8Array(buffer),
                mimeType: blob.type || 'audio/webm',
            });
            setRetell(checked);
            handleSaved(checked.attempt);
        } catch (retellError) {
            logger.error('复述评测失败', { error: retellError });
            setError(retellError instanceof Error ? retellError.message : t('practice.retellFailed'));
        } finally {
            setProcessing(false);
        }
    };

    const recorder = useAudioRecorder({ onStop: handleRecording });
    const isRecording = recorder.phase === 'recording';
    const canPlay = current?.source.kind === 'video' && Boolean(videoPath) && Boolean(subtitlePath);

    const handleMicClick = (): void => {
        if (processing || !current) {
            return;
        }
        if (isRecording) {
            recorder.stop();
            return;
        }
        audio.stop();
        setRetell(null);
        setError(null);
        void recorder.start();
    };

    /** 需要练的词：对齐出的错词/漏词/多余词 + 模型挑出的生词。 */
    const problemWords = useMemo((): string[] => {
        const resultWords = dictation?.words ?? retell?.words ?? [];
        const modelVocab = dictation?.vocab ?? retell?.vocab ?? [];
        const seen = new Set<string>();
        const words: string[] = [];
        const push = (raw: string): void => {
            const text = raw.trim();
            if (!text) {
                return;
            }
            const key = text.toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            words.push(text);
        };
        for (const word of resultWords) {
            if (word.status !== 'correct') {
                push(word.expected ?? word.actual ?? '');
            }
        }
        for (const word of modelVocab) {
            push(word);
        }
        return words;
    }, [dictation, retell]);

    /** 当前结果里的逐词标记来源。 */
    const resultWords = dictation?.words ?? retell?.words ?? [];
    /** 模型给的语法问题与相似度。 */
    const grammarIssues = dictation?.grammarIssues ?? retell?.grammarIssues ?? [];
    const similarity = dictation?.similarityScore ?? retell?.similarityScore ?? null;
    /** 声学发音评分里最弱的词（低于 80 分）与重音不对的词，最多各取 5 个。 */
    const pronunciationWeak = (retell?.pronunciationWords ?? [])
        .filter((item) => item.score < 80)
        .sort((left, right) => left.score - right.score)
        .slice(0, 5);
    const stressMismatch = (retell?.pronunciationWords ?? [])
        .filter((item) => item.stress !== null && !item.stress.ok)
        .slice(0, 5);

    /** 一键加入生词本（词汇工坊）。 */
    const handleAddWords = async (): Promise<void> => {
        if (problemWords.length === 0 || savingWords) {
            return;
        }
        setSavingWords(true);
        let added = 0;
        try {
            for (const word of problemWords) {
                const response = await videoLearningApi.favoriteWord(word);
                if (response.success) {
                    added += 1;
                }
            }
            toast.success(t('practice.wordsAdded', { count: added }));
        } catch (vocabError) {
            logger.error('加入生词本失败', { error: vocabError });
            toast.error(t('practice.wordsAddFailed'));
        } finally {
            setSavingWords(false);
        }
    };

    const goPlayer = (): void => {
        navigate(videoId ? `/player/${videoId}?sideBarAnimation=false` : '/home');
    };

    const hasResult = Boolean(dictation || retell);
    const overallScore = dictation?.accuracy ?? retell?.coverage ?? null;
    const coveredCount = retell?.keywords.filter((keyword) => keyword.covered).length ?? 0;

    return (
        <div className="w-full h-full flex flex-col overflow-hidden select-none bg-background text-foreground">
            <div className="px-6 pt-5 pb-2">
                <PageHeader title={t('practice.title')} description={t('practice.description')} />
            </div>

            <div className="flex-1 min-h-0 px-6 pb-6 pt-2">
                <div className="mx-auto grid w-full max-w-5xl gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_240px]">
                    <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                        {/* 听写 / 复述 */}
                        <div className="flex gap-1 rounded-xl bg-muted p-1">
                            {(['dictation', 'retell'] as const).map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    onClick={() => {
                                        if (item === mode) {
                                            return;
                                        }
                                        setMode(item);
                                        setError(null);
                                        setDictation(null);
                                        setRetell(null);
                                        audio.stop();
                                    }}
                                    className={cn(
                                        'flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors',
                                        mode === item
                                            ? 'bg-background text-foreground shadow-xs'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {item === 'dictation' ? t('practice.modeDictation') : t('practice.modeRetell')}
                                </button>
                            ))}
                        </div>

                        {/* 主操作区 */}
                        <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                    {mode === 'dictation' ? (
                                        <>
                                            <PencilLine className="h-4 w-4 text-muted-foreground" />
                                            {t('practice.dictationPanelTitle')}
                                        </>
                                    ) : (
                                        <>
                                            <Mic className="h-4 w-4 text-muted-foreground" />
                                            {t('practice.retellPanelTitle')}
                                        </>
                                    )}
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8 rounded-full px-3 text-xs"
                                    disabled={!canPlay || audio.phase === 'loading' || isRecording || processing}
                                    onClick={() => void audio.toggle()}
                                >
                                    {audio.phase === 'loading' ? (
                                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Volume2 className="mr-1 h-3.5 w-3.5" />
                                    )}
                                    {audio.phase === 'playing' ? t('practice.stopAudio') : t('practice.listen')}
                                </Button>
                            </div>

                            {/* 波形装饰：纯视觉，跟随播放态 */}
                            <div className="mt-3 flex h-8 items-center gap-[3px] overflow-hidden rounded-lg">
                                {Array.from({ length: 64 }).map((_, index) => {
                                    const height = 6 + ((index * 37) % 22);
                                    const active = audio.phase === 'playing';
                                    return (
                                        <span
                                            key={index}
                                            className={cn(
                                                'w-[3px] shrink-0 rounded-full transition-all',
                                                audio.phase === 'playing' ? 'bg-sky-400' : 'bg-muted-foreground/20',
                                            )}
                                            style={{ height: active ? height : height * 0.6 }}
                                        />
                                    );
                                })}
                            </div>

                            {mode === 'dictation' ? (
                                <>
                                    <Textarea
                                        value={typedText}
                                        onChange={(event) => setTypedText(event.target.value)}
                                        rows={3}
                                        disabled={checking || !current}
                                        placeholder={t('practice.dictationPlaceholder')}
                                        className="mt-3 resize-none select-text rounded-xl bg-background text-sm leading-6"
                                    />
                                    <div className="mt-3 flex justify-end">
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="h-8 rounded-full px-4 text-xs"
                                            disabled={checking || !typedText.trim() || !current}
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
                                </>
                            ) : (
                                <div className="mt-4 flex flex-col items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleMicClick}
                                        disabled={processing || !current}
                                        aria-label={isRecording ? t('practice.stopRecording') : t('practice.startRecording')}
                                        className={cn(
                                            'relative flex h-16 w-16 items-center justify-center rounded-full transition-all',
                                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                            isRecording
                                                ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                                                : 'bg-primary text-primary-foreground hover:scale-105',
                                            (processing || !current) && 'cursor-not-allowed opacity-60',
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
                                            ? t('practice.recording', { time: formatElapsed(recorder.elapsedSec) })
                                            : processing
                                                ? t('practice.retellProcessing')
                                                : t('practice.retellIdle')}
                                    </div>
                                </div>
                            )}

                            {!canPlay && current && (
                                <p className="mt-2 text-xs text-muted-foreground">{t('practice.noAudioHint')}</p>
                            )}
                            {!current && (
                                <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 px-4 py-8 text-center">
                                    <p className="text-xs text-muted-foreground">{t('practice.noSentenceQueue')}</p>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 rounded-lg px-2.5 text-xs"
                                        onClick={goPlayer}
                                    >
                                        {t('practice.goPlayer')}
                                    </Button>
                                </div>
                            )}

                            {error && (
                                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                                    {error}
                                </div>
                            )}
                        </section>

                        {/* 评测结果：常驻，未评测时显示占位 */}
                        <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h2 className="text-sm font-medium text-foreground">{t('practice.resultTitle')}</h2>
                                    <span className="text-xs text-muted-foreground">{t('practice.resultHint')}</span>
                                </div>

                                <div className="mt-4 flex flex-wrap items-stretch gap-4">
                                    <div className="flex flex-col items-center justify-center rounded-2xl bg-muted/50 px-6 py-4">
                                        <span className={cn('text-4xl font-semibold tabular-nums leading-none', overallScore !== null ? scoreTone(overallScore) : '')}>
                                            {overallScore ?? '—'}
                                        </span>
                                        <span className="mt-1.5 text-xs text-muted-foreground">
                                            {t('practice.overall')}
                                        </span>
                                    </div>

                                    <div className="grid flex-1 grid-cols-3 gap-2">
                                        {!hasResult && (
                                            <>
                                                <Metric label={t('practice.pronunciation')} value="—" />
                                                <Metric label={t('practice.grammar')} value="—" />
                                                <Metric label={t('practice.wrongWords')} value="—" />
                                            </>
                                        )}
                                        {dictation && (
                                            <>
                                                <Metric
                                                    label={t('practice.pronunciation')}
                                                    value={dictation.pronunciationScore === null ? '—' : `${dictation.pronunciationScore}`}
                                                    hint={dictation.pronunciationScore === null ? t('practice.pronunciationNoAudio') : undefined}
                                                />
                                                <Metric
                                                    label={t('practice.grammar')}
                                                    value={dictation.grammarScore === null ? '—' : `${dictation.grammarScore}`}
                                                />
                                                <Metric
                                                    label={t('practice.wrongWords')}
                                                    value={`${countStatus(dictation, 'mispronounced') + countStatus(dictation, 'missing')}`}
                                                    hint={t('practice.wrongWordsHint', { wrong: countStatus(dictation, 'mispronounced'), missing: countStatus(dictation, 'missing') })}
                                                />
                                            </>
                                        )}
                                        {retell && (
                                            <>
                                                <Metric
                                                    label={t('practice.pronunciation')}
                                                    value={retell.pronunciationScore === null ? '—' : `${retell.pronunciationScore}`}
                                                />
                                                <Metric
                                                    label={t('practice.grammar')}
                                                    value={retell.grammarScore === null ? '—' : `${retell.grammarScore}`}
                                                />
                                                <Metric
                                                    label={t('practice.keywordHit')}
                                                    value={`${coveredCount}/${retell.keywords.length}`}
                                                />
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-4 rounded-xl bg-muted/40 px-4 py-3">
                                    {resultWords.length > 0 ? (
                                        <p className="text-lg leading-8">
                                            {resultWords.map((word, index) => (
                                                <span
                                                    key={`${index}-${word.status}`}
                                                    title={word.status === 'mispronounced' && word.actual
                                                        ? t('practice.writtenAs', { word: word.actual })
                                                        : undefined}
                                                    className={cn('mx-0.5', WORD_CLASS[word.status])}
                                                >
                                                    {word.expected ?? word.actual}
                                                </span>
                                            ))}
                                        </p>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">{t('practice.noRecognized')}</p>
                                    )}
                                </div>

                                {pronunciationWeak.length > 0 && (
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                                        <span className="text-muted-foreground">{t('practice.weakWords')}</span>
                                        {pronunciationWeak.map((item) => (
                                            <span
                                                key={item.word}
                                                className={cn(
                                                    'rounded-md px-1.5 py-0.5 tabular-nums',
                                                    item.score < 60
                                                        ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                                                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                                                )}
                                            >
                                                {item.word} · {item.score}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {stressMismatch.length > 0 && (
                                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                                        <span className="text-muted-foreground">{t('practice.stressWrong')}</span>
                                        {stressMismatch.map((item) => (
                                            <span
                                                key={`stress-${item.word}`}
                                                title={t('practice.stressDetail', {
                                                    expected: (item.stress?.expected ?? 0) + 1,
                                                    heard: (item.stress?.heard ?? 0) + 1,
                                                })}
                                                className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-violet-700 dark:text-violet-300"
                                            >
                                                {item.word}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {(grammarIssues.length > 0 || similarity !== null) && (
                                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                        {similarity !== null && (
                                            <span>{t('practice.similarity', { score: similarity })}</span>
                                        )}
                                        {grammarIssues.map((issue) => (
                                            <span
                                                key={issue}
                                                className="rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300"
                                            >
                                                {issue}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <span>{t('practice.reference')}</span>
                                    <span className="text-sm text-foreground">{current?.text}</span>
                                </div>

                                {retell?.recognizedText && (
                                    <div className="mt-2 text-xs text-muted-foreground">
                                        {t('practice.recognized')}：{retell.recognizedText}
                                    </div>
                                )}

                                {(dictation?.graderNote || retell?.graderNote) && (
                                    <div className="mt-2 rounded-xl bg-sky-500/10 px-3 py-2 text-xs leading-5 text-sky-700 dark:text-sky-300">
                                        {dictation?.graderNote ?? retell?.graderNote}
                                    </div>
                                )}
                                {(dictation?.graderError || retell?.graderError) && (
                                    <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                                        {t('practice.graderUnavailable')}：{dictation?.graderError ?? retell?.graderError}
                                    </div>
                                )}

                                <div className="mt-4 flex flex-wrap justify-end gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8 rounded-full px-3 text-xs"
                                        disabled={problemWords.length === 0 || savingWords}
                                        onClick={() => void handleAddWords()}
                                    >
                                        {savingWords ? (
                                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <BookOpen className="mr-1 h-3.5 w-3.5" />
                                        )}
                                        {t('practice.addToVocab')}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8 rounded-full px-3 text-xs"
                                        disabled={!canPlay}
                                        onClick={() => {
                                            resetRound();
                                            void audio.toggle();
                                        }}
                                    >
                                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                        {t('practice.listenAgain')}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 rounded-full px-3 text-xs"
                                        onClick={() => navigate('/review')}
                                    >
                                        {t('practice.goReview')}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="h-8 rounded-full px-3 text-xs"
                                        disabled={queue.length === 0}
                                        onClick={goNext}
                                    >
                                        {t('practice.nextSentence')}
                                        <Play className="ml-1 h-3.5 w-3.5" />
                                    </Button>
                                </div>
                        </section>

                        {/* 最近练习 */}
                        <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                            <div className="flex items-baseline justify-between">
                                <h2 className="text-sm font-medium text-foreground">{t('practice.historyTitle')}</h2>
                                <span className="text-xs text-muted-foreground">{t('practice.historyHint')}</span>
                            </div>
                            {history.length === 0 ? (
                                <div className="mt-3 rounded-xl bg-muted/50 px-4 py-6 text-center text-xs text-muted-foreground">
                                    {t('practice.historyEmpty')}
                                </div>
                            ) : (
                                <div className="mt-2 flex flex-col gap-1">
                                    {history.map((attempt) => (
                                        <div key={attempt.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                                            <span
                                                className={cn(
                                                    'shrink-0 rounded-md px-1.5 py-0.5 text-[10px]',
                                                    attempt.mode === 'dictation'
                                                        ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                                        : 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
                                                )}
                                            >
                                                {attempt.mode === 'dictation'
                                                    ? t('practice.modeDictation')
                                                    : t('practice.modeRetell')}
                                            </span>
                                            <span className={cn('shrink-0 text-sm font-semibold tabular-nums', scoreTone(attempt.score))}>
                                                {attempt.score}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-sm text-foreground/80">
                                                {attempt.referenceText === current?.text
                                                    ? t('practice.currentSentenceRecord')
                                                    : attempt.referenceText}
                                            </span>
                                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                                {new Date(attempt.createdAt).toLocaleString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>

                    {/* 右侧：句子队列（每句一条原声） */}
                    <aside className="flex min-w-0 flex-col gap-3 lg:min-h-0">
                        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border/60 bg-card p-3 shadow-xs lg:max-h-full">
                            <Button
                                type="button"
                                size="sm"
                                className="h-8 w-full rounded-full px-3 text-xs"
                                onClick={() => importSentences()}
                            >
                                {t('practice.importSentences')}
                            </Button>
                            <div className="mt-3 flex items-baseline justify-between text-xs text-muted-foreground">
                                <span>{t('practice.sentenceQueue')}</span>
                                <span className="tabular-nums">
                                    {queue.length === 0 ? '0/0' : `${cursor + 1}/${queue.length}`}
                                </span>
                            </div>

                            {queue.length === 0 ? (
                                <p className="mt-3 rounded-xl border border-dashed border-border/60 px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
                                    {t('practice.queueEmptyShort')}
                                </p>
                            ) : (
                                <div
                                    ref={queueListRef}
                                    className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1"
                                >
                                    {queue.map((item, index) => (
                                        <div
                                            key={item.id}
                                            data-current={index === cursor ? 'true' : undefined}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => goTo(index)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    goTo(index);
                                                }
                                            }}
                                            className={cn(
                                                'flex w-full cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors',
                                                index === cursor
                                                    ? 'border-amber-400/70 bg-amber-400/10'
                                                    : 'border-transparent hover:bg-muted/60',
                                            )}
                                        >
                                            <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                                                {index + 1}
                                            </span>
                                            <span className="flex h-5 flex-1 items-end gap-[2px] overflow-hidden">
                                                {Array.from({ length: 14 }).map((_, bar) => (
                                                    <span
                                                        key={bar}
                                                        className={cn(
                                                            'w-[2px] rounded-full',
                                                            rowPlayingId === item.id
                                                                ? 'bg-sky-400'
                                                                : 'bg-muted-foreground/25',
                                                        )}
                                                        style={{ height: 4 + ((index * 13 + bar * 7) % 12) }}
                                                    />
                                                ))}
                                            </span>
                                            <button
                                                type="button"
                                                aria-label={t('practice.playThisLine')}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void playRow(item);
                                                }}
                                                className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                            >
                                                {rowLoadingId === item.id ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : rowPlayingId === item.id ? (
                                                    <Square className="h-3.5 w-3.5 fill-current" />
                                                ) : (
                                                    <Play className="h-3.5 w-3.5" />
                                                )}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    );
}

/**
 * 统计听写结果里某种状态的词数。
 * @param result 听写结果。
 * @param status 目标状态。
 */
function countStatus(result: DictationResult, status: ShadowingWordStatus): number {
    return result.words.filter((word) => word.status === status).length;
}

/**
 * 结果面板里的小指标。
 * @param props.label 指标名。
 * @param props.value 指标值。
 * @param props.hint 悬停说明，用于解释「—」这类缺省值。
 */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div
            title={hint}
            className="flex flex-col justify-center rounded-xl border border-border/50 bg-background/60 px-3 py-2"
        >
            <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
            <span className="mt-0.5 text-xs text-muted-foreground">{label}</span>
        </div>
    );
}
