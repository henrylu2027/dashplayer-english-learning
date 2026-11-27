import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ArrowLeft, BookOpen, CheckCheck, Loader2, Play, RotateCcw, Volume2 } from 'lucide-react';

import type {
    DialogueDifficulty,
    DialogueReview,
    DialogueScene,
    DialogueSessionSummary,
    DialogueTurnEvaluation,
    DialogueTurnVO,
} from '@/common/contracts/dialogue';
import { DIALOGUE_DIFFICULTIES } from '@/common/contracts/dialogue';
import { Button } from '@/fronted/components/ui/button';
import { practiceApi } from '@/fronted/features/practice/practiceApi';
import { srsApi } from '@/fronted/features/srs/srsApi';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { getTtsUrl, playAudioUrlAndWait } from '@/fronted/infrastructure/audio/AudioPlayer';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { dialogueApi } from '../dialogueApi';
import DialogueComposer from './DialogueComposer';
import SceneCardView from './SceneCardView';
import TurnEvaluationPanel from './TurnEvaluationPanel';

const logger = getRendererLogger('DialogueSessionView');

/** 难度下拉的文案 key 前缀。 */
const DIFFICULTY_LABEL = 'dialogue.difficulty';

/**
 * 进行中的场景对话：AI 扮演一个角色，逐轮回复并评测学习者的上一句。
 *
 * 说明：气泡里只有角色台词，所有点评、纠错、连读建议都进右侧评测面板；
 * 每轮请求都带着完整对话历史、场景背景、角色与难度，模型只在固定人设下发挥。
 *
 * @param props.session 会话摘要。
 * @param props.scene 场景卡。
 * @param props.scenes 最近对话的场景，供工具栏切换；当前会话也在里面。
 * @param props.onFinished 复盘完成回调。
 * @param props.onBack 返回会话列表。
 * @param props.onOpenHistory 打开某条历史会话。
 */
export default function DialogueSessionView({
    session,
    scene,
    scenes,
    onFinished,
    onBack,
    onOpenHistory,
}: {
    session: DialogueSessionSummary;
    scene: DialogueScene;
    /** 最近对话的场景，供工具栏切换；当前会话也在里面。 */
    scenes: DialogueSessionSummary[];
    onFinished: (session: DialogueSessionSummary, review: DialogueReview) => void;
    onBack: () => void;
    /** 打开某条历史会话。 */
    onOpenHistory: (sessionId: number) => void;
}) {
    const { t } = useTranslation('pages');
    /** 已落库的回合；加载完成前只有内存里的开场白。 */
    const [turns, setTurns] = useState<DialogueTurnVO[]>([]);
    const [loading, setLoading] = useState(true);
    /** 最近一轮学习者的评测，显示在右栏。 */
    const [evaluation, setEvaluation] = useState<DialogueTurnEvaluation | null>(null);
    /** 独立发音模块给出的最近一次发音分；没有录音时为 null。 */
    const [pronunciation, setPronunciation] = useState<number | null>(null);
    /** 本轮所有学习者评测，用于批量提取生词。 */
    const [evaluations, setEvaluations] = useState<DialogueTurnEvaluation[]>([]);
    const [sending, setSending] = useState(false);
    const [finishing, setFinishing] = useState(false);
    const [savingWords, setSavingWords] = useState(false);
    const [savingBatch, setSavingBatch] = useState(false);
    /** 难度：只影响这一轮提示词里的句式复杂度。 */
    const [difficulty, setDifficulty] = useState<DialogueDifficulty>(session.difficulty);
    /** 气泡区自己的滚动容器：新回合只把气泡区滚到底，不带动整页。 */
    const bubbleListRef = useRef<HTMLDivElement | null>(null);
    /** 已经自动入库的词，避免同一个词反复写库。 */
    const savedWordsRef = useRef<Set<string>>(new Set());
    /** 朗读队列：说话人 A 读完才轮到 AI，避免两个声音叠在一起。 */
    const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
    const mountedRef = useRef(true);

    useEffect(() => () => {
        mountedRef.current = false;
    }, []);

    /**
     * 把一句台词排进朗读队列；前一句读完才会开口。
     * @param text 要朗读的英文。
     * @returns 这句读完（或失败）后 resolve 的 promise。
     */
    const speak = useCallback((text: string): Promise<void> => {
        if (!text.trim()) {
            return Promise.resolve();
        }
        speechQueueRef.current = speechQueueRef.current
            .then(async () => {
                const url = await getTtsUrl(text);
                await playAudioUrlAndWait(url);
            })
            .catch((error) => {
                logger.warn('朗读失败', { error });
            });
        return speechQueueRef.current;
    }, []);

    /** 读取已落库的回合；刚创建时只有开场白。 */
    useEffect(() => {
        let cancelled = false;
        dialogueApi.detail(session.id)
            .then((detail) => {
                if (cancelled) {
                    return;
                }
                setTurns(detail.turns);
                const userTurns = detail.turns.filter((turn) => turn.role === 'user');
                const lastEvaluation = [...userTurns].reverse()
                    .find((turn) => turn.evaluation !== null)?.evaluation ?? null;
                setEvaluation(lastEvaluation);
                setEvaluations(userTurns.flatMap((turn) => (turn.evaluation ? [turn.evaluation] : [])));
            })
            .catch((error) => {
                logger.error('读取对话回合失败', { error, sessionId: session.id });
                // 读不到历史时至少把开场白显示出来，不让用户对着空白页
                setTurns([{
                    id: -1,
                    role: 'assistant',
                    content: scene.openingLineEn,
                    cardId: null,
                    correction: null,
                    evaluation: null,
                    createdAt: Date.now(),
                }]);
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [scene.openingHintZh, scene.openingLineEn, session.id]);

    useEffect(() => {
        const list = bubbleListRef.current;
        if (list) {
            list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
        }
    }, [turns, sending]);

    /**
     * 把生词写进词汇工坊；已经写过的词跳过。
     * @param words 待入库的词。
     * @returns 实际写入的条数。
     */
    const saveVocab = useCallback(async (words: string[]): Promise<number> => {
        let added = 0;
        for (const word of words) {
            const trimmed = word.trim();
            if (!trimmed || savedWordsRef.current.has(trimmed.toLowerCase())) {
                continue;
            }
            try {
                const response = await videoLearningApi.favoriteWord(trimmed);
                if (response.success) {
                    added += 1;
                }
                savedWordsRef.current.add(trimmed.toLowerCase());
            } catch (error) {
                logger.warn('生词入库失败', { error, word: trimmed });
            }
        }
        return added;
    }, []);

    /**
     * 发送学习者这一句：后端落库两条回合并返回评测。
     * @param text 学习者输入。
     * @param meta 录音线索。
     */
    const handleSend = async (
        text: string,
        meta?: { lowConfidenceWords: string[]; audio?: Uint8Array; mimeType?: string },
    ): Promise<void> => {
        if (sending) {
            return;
        }
        setSending(true);
        // 说话人 A（学习者）先出声；AI 的台词排在队列后面，等这句读完才开口
        void speak(text);
        // 发音分由独立发音评测模块给出；没有录音就留空
        setPronunciation(null);
        if (meta?.audio && meta.audio.byteLength > 0) {
            void practiceApi.retell({
                referenceText: text,
                source: { kind: 'free' },
                audio: meta.audio,
                mimeType: meta.mimeType ?? 'audio/webm',
            }).then((result) => {
                if (mountedRef.current) {
                    setPronunciation(result.pronunciationScore ?? null);
                }
            }).catch((error) => {
                logger.warn('发音评测失败', { error });
            });
        }
        try {
            const result = await dialogueApi.replyTurn({
                sessionId: session.id,
                text,
                difficulty,
            });
            if (!mountedRef.current) {
                return;
            }
            setTurns((previous) => [...previous, result.userTurn, result.assistantTurn]);
            const turnEvaluation = result.userTurn.evaluation;
            setEvaluation(turnEvaluation);
            if (turnEvaluation) {
                setEvaluations((previous) => [...previous, turnEvaluation]);
                // 生词统一入库：模型提取的生词 + 单词级的错词，右侧面板展示的同时写进词汇工坊
                const autoWords = [
                    ...turnEvaluation.vocab,
                    ...turnEvaluation.errorList
                        .map((item) => item.word.trim())
                        .filter((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word)),
                ];
                const added = await saveVocab(autoWords);
                if (added > 0) {
                    toast.success(t('dialogue.vocabAutoSaved', { count: added }));
                }
            }
            void speak(result.assistantTurn.content);
        } catch (error) {
            logger.error('对话回复失败', { error, sessionId: session.id });
            toast.error(error instanceof Error ? error.message : t('dialogue.turnFailed'));
        } finally {
            if (mountedRef.current) {
                setSending(false);
            }
        }
    };

    const handleFinish = async (): Promise<void> => {
        setFinishing(true);
        try {
            const result = await dialogueApi.finish({ sessionId: session.id });
            onFinished(result.session, result.review);
        } catch (error) {
            logger.error('对话复盘失败', { error });
            toast.error(error instanceof Error ? error.message : t('dialogue.finishFailed'));
        } finally {
            setFinishing(false);
        }
    };

    /** 手动把本轮生词再写一遍；自动入库已经写过的不会重复。 */
    const handleAddWords = async (): Promise<void> => {
        const words = evaluation?.vocab ?? [];
        if (words.length === 0) {
            toast.success(t('practice.noProblemWords'));
            return;
        }
        setSavingWords(true);
        try {
            const added = await saveVocab(words);
            toast.success(added > 0
                ? t('practice.wordsAdded', { count: added })
                : t('dialogue.wordsAlreadySaved'));
        } finally {
            setSavingWords(false);
        }
    };

    /**
     * 批量提取本轮生词：汇总每轮评测里的生词与错词，写进词汇工坊，
     * 同时逐条加入间隔复习队列。
     */
    const handleBatchWords = async (): Promise<void> => {
        const words = new Set<string>();
        for (const turn of evaluations) {
            for (const word of turn.vocab) {
                if (word.trim()) {
                    words.add(word.trim());
                }
            }
            for (const item of turn.errorList) {
                // 只把单词级的错误吸收进生词本；整句片段进 SRS 没有复习价值
                const word = item.word.trim();
                if (/^[A-Za-z][A-Za-z'-]*$/.test(word)) {
                    words.add(word);
                }
            }
        }
        if (words.size === 0) {
            toast.success(t('practice.noProblemWords'));
            return;
        }
        setSavingBatch(true);
        let added = 0;
        try {
            for (const word of words) {
                const response = await videoLearningApi.favoriteWord(word);
                if (response.success) {
                    added += 1;
                }
                await srsApi.addCard({ referenceText: word, source: { kind: 'free' } });
            }
            toast.success(t('dialogue.batchWordsDone', { count: added }));
        } catch (error) {
            logger.error('批量提取生词失败', { error });
            toast.error(error instanceof Error ? error.message : t('practice.wordsAddFailed'));
        } finally {
            setSavingBatch(false);
        }
    };

    /** 重置对话：清空本地演出记录，从开场白重演（不影响已落库的历史）。 */
    const handleReset = (): void => {
        setTurns([{
            id: -1,
            role: 'assistant',
            content: scene.openingLineEn,
            cardId: null,
            correction: null,
            evaluation: null,
            createdAt: Date.now(),
        }]);
        setEvaluation(null);
        setPronunciation(null);
        setEvaluations([]);
        savedWordsRef.current.clear();
    };

    const learnerTurnCount = useMemo(() => turns.filter((turn) => turn.role === 'user').length, [turns]);

    return (
        <div className="flex flex-col gap-4">
            {/* 顶部工具栏 */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card pl-3 pr-1 py-1 text-xs text-muted-foreground">
                        {t('dialogue.sceneLabel')}
                        <select
                            value={session.id}
                            onChange={(event) => {
                                const nextId = Number(event.target.value);
                                if (nextId !== session.id) {
                                    onOpenHistory(nextId);
                                }
                            }}
                            className="max-w-52 truncate rounded-full bg-transparent py-1 pr-2 text-xs text-foreground outline-none"
                        >
                            <option value={session.id}>
                                {session.title || scene.title} · {session.anchorText.slice(0, 24)}
                            </option>
                            {scenes
                                .filter((item) => item.id !== session.id)
                                .map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.title} · {item.anchorText.slice(0, 24)}
                                    </option>
                                ))}
                        </select>
                    </label>
                    <select
                        value={difficulty}
                        onChange={(event) => setDifficulty(event.target.value as DialogueDifficulty)}
                        className="h-8 rounded-full border border-border/60 bg-card px-3 text-xs text-foreground outline-none"
                    >
                        {DIALOGUE_DIFFICULTIES.map((item) => (
                            <option key={item} value={item}>{t(`${DIFFICULTY_LABEL}.${item}`)}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                {/* 左：对话练习 */}
                <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-sm font-medium text-foreground">{t('dialogue.chatTitle')}</h2>
                        <span className="text-xs text-muted-foreground">
                            {t('dialogue.youPlay', { name: scene.userRole })}
                        </span>
                    </div>

                    <SceneCardView
                        scene={scene}
                        onSpeak={speak}
                        actions={(
                            <>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 rounded-full px-2.5 text-xs"
                                    onClick={handleReset}
                                >
                                    <RotateCcw className="mr-1 h-3 w-3" />
                                    {t('dialogue.resetChat')}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 rounded-full px-2.5 text-xs"
                                    onClick={onBack}
                                >
                                    <ArrowLeft className="mr-1 h-3 w-3" />
                                    {t('dialogue.backToList')}
                                </Button>
                            </>
                        )}
                    />

                    <div
                        ref={bubbleListRef}
                        className="flex h-[13.5rem] flex-col gap-3 overflow-y-auto pr-1"
                    >
                        {loading && (
                            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {t('dialogue.turnsLoading')}
                            </div>
                        )}
                        {!loading && turns.map((turn) => (
                            <div
                                key={turn.id}
                                className={cn('flex items-center gap-2', turn.role === 'user' ? 'justify-end' : 'justify-start')}
                            >
                                {turn.role === 'assistant' && (
                                    <button
                                        type="button"
                                        onClick={() => void speak(turn.content)}
                                        aria-label={t('dialogue.speak')}
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        <Play className="h-3.5 w-3.5" />
                                    </button>
                                )}
                                <div className="flex max-w-[80%] flex-col">
                                    <div
                                        className={cn(
                                            'text-[11px]',
                                            turn.role === 'user' ? 'text-right text-muted-foreground' : 'text-muted-foreground',
                                        )}
                                    >
                                        {turn.role === 'assistant'
                                            ? t('dialogue.bubbleAi', { name: scene.aiRole })
                                            : t('dialogue.bubbleUser', { name: scene.userRole })}
                                    </div>
                                    <div
                                        className={cn(
                                            'select-text whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6',
                                            turn.role === 'user'
                                                ? 'rounded-tr-sm bg-primary text-primary-foreground'
                                                : 'rounded-tl-sm bg-sky-500/15 text-foreground',
                                        )}
                                    >
                                        {turn.content}
                                    </div>
                                    {turn.role === 'user' && turn.evaluation && (
                                        <div className="mt-1 text-right text-[11px] text-muted-foreground">
                                            {turn.evaluation.errorList.length === 0
                                                ? t('dialogue.bubbleClean')
                                                : t('dialogue.bubbleSuggestions', { count: turn.evaluation.errorList.length })}
                                        </div>
                                    )}
                                </div>
                                {turn.role === 'user' && (
                                    <button
                                        type="button"
                                        onClick={() => void speak(turn.content)}
                                        aria-label={t('dialogue.speak')}
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        <Volume2 className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        ))}
                        {sending && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {t('dialogue.thinking')}
                            </div>
                        )}
                    </div>

                    <div className="border-t border-border/50 pt-4">
                        <DialogueComposer
                            disabled={finishing || loading || sending}
                            onSend={(text, meta) => {
                                void handleSend(text, meta);
                            }}
                        />
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 rounded-xl px-4 text-sm"
                            disabled={evaluations.length === 0 || savingBatch}
                            onClick={() => void handleBatchWords()}
                        >
                            {savingBatch
                                ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                : <BookOpen className="mr-1 h-3.5 w-3.5" />}
                            {t('dialogue.batchWords')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant={learnerTurnCount > 0 ? 'default' : 'outline'}
                            className="h-9 rounded-xl px-4 text-sm"
                            disabled={finishing}
                            onClick={() => void handleFinish()}
                        >
                            {finishing
                                ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                : <CheckCheck className="mr-1 h-3.5 w-3.5" />}
                            {finishing ? t('dialogue.finishing') : t('dialogue.finish')}
                        </Button>
                    </div>
                </section>

                {/* 右：AI 评测 */}
                <TurnEvaluationPanel
                    evaluation={evaluation}
                    pronunciation={pronunciation}
                    pending={sending}
                    savingWords={savingWords}
                    onAddWords={() => void handleAddWords()}
                    onRetry={() => {
                        toast.success(t('dialogue.retryHint'));
                    }}
                    onContinue={() => {
                        setPronunciation(null);
                    }}
                />
            </div>
        </div>
    );
}
