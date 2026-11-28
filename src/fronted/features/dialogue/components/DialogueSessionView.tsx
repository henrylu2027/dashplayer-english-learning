import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ArrowLeft, BookOpen, CheckCheck, ChevronDown, Loader2, Play, RotateCcw, Volume2 } from 'lucide-react';

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
import ScenePracticeView from './ScenePracticeView';
import TurnEvaluationPanel from './TurnEvaluationPanel';

const logger = getRendererLogger('DialogueSessionView');

/** 难度下拉的文案 key 前缀。 */
const DIFFICULTY_LABEL = 'dialogue.difficulty';

/** 声线：女声用原声，男声用降速不保音高的近似。 */
type Voice = 'female' | 'male';

/** 男声的播放速率：0.88 约降两个半音，语速略慢。 */
const MALE_RATE = 0.88;

/** 右栏宽度范围（拖动分隔条时使用）。 */
const RIGHT_MIN = 280;
const RIGHT_MAX = 640;

/**
 * 工具栏下拉：自绘菜单，展开后点选项才收起。
 *
 * 说明：原生 select 在这个页面会被上层容器吞掉点击（一松手就缩回），
 * 改成按钮 + 下拉面板后交互完全可控。
 *
 * @param props.label 左侧小标签。
 * @param props.text 按钮上显示的文字。
 * @param props.options 选项列表。
 * @param props.onSelect 选中回调。
 * @param props.align 面板对齐方向。
 */
function ToolbarMenu<T extends string | number>({
    label,
    text,
    activeValue,
    options,
    onSelect,
    align = 'right',
}: {
    label?: string;
    text: string;
    activeValue?: T;
    options: Array<{ value: T; label: string }>;
    onSelect: (value: T) => void;
    align?: 'left' | 'right';
}) {
    const [open, setOpen] = useState(false);
    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex h-8 max-w-60 items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 text-xs text-foreground"
            >
                {label && <span className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</span>}
                <span className="truncate">{text}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
            {open && (
                <>
                    <button
                        type="button"
                        aria-label="close"
                        className="fixed inset-0 z-30 cursor-default"
                        onClick={() => setOpen(false)}
                    />
                    <div
                        className={cn(
                            'absolute z-40 mt-1 max-h-72 w-60 overflow-y-auto rounded-xl border border-border/60 bg-popover p-1 shadow-lg',
                            align === 'right' ? 'right-0' : 'left-0',
                        )}
                    >
                        {options.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                    onSelect(option.value);
                                    setOpen(false);
                                }}
                                className={cn(
                                    'block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                                    option.value === activeValue && 'bg-muted/60',
                                )}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

/**
 * 进行中的场景对话：AI 扮演一个角色，逐轮回复并评测学习者的上一句。
 *
 * @param props.session 会话摘要。
 * @param props.scene 场景卡。
 * @param props.scenes 最近对话的场景，供工具栏切换。
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
    const [turns, setTurns] = useState<DialogueTurnVO[]>([]);
    const [loading, setLoading] = useState(true);
    const [evaluation, setEvaluation] = useState<DialogueTurnEvaluation | null>(null);
    const [pronunciation, setPronunciation] = useState<number | null>(null);
    const [evaluations, setEvaluations] = useState<DialogueTurnEvaluation[]>([]);
    const [sending, setSending] = useState(false);
    const [finishing, setFinishing] = useState(false);
    const [savingWords, setSavingWords] = useState(false);
    const [savingBatch, setSavingBatch] = useState(false);
    const [difficulty, setDifficulty] = useState<DialogueDifficulty>(session.difficulty);
    /** AI 用女声、学习者用男声，默认就能听出是两个人。 */
    const [aiVoice, setAiVoice] = useState<Voice>('female');
    const [learnerVoice, setLearnerVoice] = useState<Voice>('male');
    /** 右栏宽度：拖动分隔条时变化。 */
    const [rightWidth, setRightWidth] = useState(380);
    const bubbleListRef = useRef<HTMLDivElement | null>(null);
    const savedWordsRef = useRef<Set<string>>(new Set());
    const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
    const mountedRef = useRef(true);

    useEffect(() => () => {
        mountedRef.current = false;
    }, []);

    /**
     * 把一句台词排进朗读队列；前一句读完才会开口。
     * @param text 要朗读的英文。
     * @param voice 声线。
     * @returns 这句读完（或失败）后 resolve 的 promise。
     */
    const speak = useCallback((text: string, voice: Voice): Promise<void> => {
        if (!text.trim()) {
            return Promise.resolve();
        }
        speechQueueRef.current = speechQueueRef.current
            .then(async () => {
                const url = await getTtsUrl(text);
                await playAudioUrlAndWait(
                    url,
                    voice === 'male' ? { rate: MALE_RATE, preservePitch: false } : undefined,
                );
            })
            .catch((error) => {
                logger.warn('朗读失败', { error });
            });
        return speechQueueRef.current;
    }, []);

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
    }, [scene.openingLineEn, session.id]);

    useEffect(() => {
        const list = bubbleListRef.current;
        if (list) {
            list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
        }
    }, [turns, sending]);

    /**
     * 拖动分隔条调整右栏宽度。
     * @param event 鼠标按下事件。
     */
    const startResize = (event: React.MouseEvent<HTMLElement>): void => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = rightWidth;
        const move = (moveEvent: MouseEvent): void => {
            const next = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, startWidth - (moveEvent.clientX - startX)));
            setRightWidth(next);
        };
        const up = (): void => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

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
     * 发送学习者这一句：先朗读学习者的句子，读完才出 AI 字幕和声音。
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
        setTurns((previous) => [...previous, {
            id: -Date.now(),
            role: 'user',
            content: text,
            cardId: null,
            correction: null,
            evaluation: null,
            createdAt: Date.now(),
        }]);
        // 说话人 A（学习者）先出声，读完才轮到 AI
        const learnerSpeech = speak(text, learnerVoice);
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
            // 用落库后的回合替换临时气泡
            setTurns((previous) => previous.map((turn) => (
                turn.id < 0 && turn.role === 'user' && turn.content === text ? result.userTurn : turn
            )));
            const turnEvaluation = result.userTurn.evaluation;
            setEvaluation(turnEvaluation);
            if (turnEvaluation) {
                setEvaluations((previous) => [...previous, turnEvaluation]);
                const autoWords = [
                    ...turnEvaluation.vocab,
                    ...turnEvaluation.errorList
                        .map((item) => item.word.trim())
                        .filter((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word)),
                ];
                void saveVocab(autoWords).then((added) => {
                    if (added > 0) {
                        toast.success(t('dialogue.vocabAutoSaved', { count: added }));
                    }
                });
            }
            // 学习者这句播完，才出 AI 字幕，再接 AI 声音
            await learnerSpeech;
            if (!mountedRef.current) {
                return;
            }
            setTurns((previous) => [...previous, result.assistantTurn]);
            void speak(result.assistantTurn.content, aiVoice);
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

    const handleBatchWords = async (): Promise<void> => {
        const words = new Set<string>();
        for (const turn of evaluations) {
            for (const word of turn.vocab) {
                if (word.trim()) {
                    words.add(word.trim());
                }
            }
            for (const item of turn.errorList) {
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
    const voiceOptions: Array<{ value: Voice; label: string }> = [
        { value: 'female', label: t('dialogue.voiceFemale') },
        { value: 'male', label: t('dialogue.voiceMale') },
    ];
    const sceneOptions = [
        {
            value: session.id,
            label: `${session.title || scene.title} · ${session.anchorText.slice(0, 24)}`,
        },
        ...scenes
            .filter((item) => item.id !== session.id)
            .map((item) => ({ value: item.id, label: `${item.title} · ${item.anchorText.slice(0, 24)}` })),
    ];
    const difficultyOptions = DIALOGUE_DIFFICULTIES.map((value) => ({
        value,
        label: t(`${DIFFICULTY_LABEL}.${value}`),
    }));

    return (
        <div className="flex flex-col gap-4">
            {/* 工具栏 */}
            <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-xl bg-background/95 px-1 py-1 backdrop-blur">
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <ToolbarMenu
                        label={t('dialogue.sceneLabel')}
                        text={sceneOptions[0].label}
                        activeValue={session.id}
                        options={sceneOptions}
                        onSelect={(value) => {
                            if (value !== session.id) {
                                onOpenHistory(value);
                            }
                        }}
                    />
                    <ToolbarMenu
                        text={t(`${DIFFICULTY_LABEL}.${difficulty}`)}
                        activeValue={difficulty}
                        options={difficultyOptions}
                        onSelect={setDifficulty}
                    />
                    <ToolbarMenu
                        label={t('dialogue.voiceAi')}
                        text={t(aiVoice === 'male' ? 'dialogue.voiceMale' : 'dialogue.voiceFemale')}
                        activeValue={aiVoice}
                        options={voiceOptions}
                        onSelect={setAiVoice}
                    />
                    <ToolbarMenu
                        label={t('dialogue.voiceLearner')}
                        text={t(learnerVoice === 'male' ? 'dialogue.voiceMale' : 'dialogue.voiceFemale')}
                        activeValue={learnerVoice}
                        options={voiceOptions}
                        onSelect={setLearnerVoice}
                    />
                </div>
            </div>

            <div className="flex min-h-0 items-stretch gap-1">
                {/* 左：对话练习 */}
                <section className="flex min-w-0 flex-1 flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-sm font-medium text-foreground">{t('dialogue.chatTitle')}</h2>
                        <span className="text-xs text-muted-foreground">
                            {t('dialogue.youPlay', { name: scene.userRole })}
                        </span>
                    </div>

                    <SceneCardView
                        scene={scene}
                        showPractice={false}
                        onSpeak={(text) => void speak(text, aiVoice)}
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
                        className="flex h-[22rem] flex-col gap-3 overflow-y-auto pr-1"
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
                                        onClick={() => void speak(turn.content, aiVoice)}
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
                                        onClick={() => void speak(turn.content, learnerVoice)}
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

                {/* 分隔条：拖动改变左右宽度 */}
                <button
                    type="button"
                    aria-label={t('dialogue.resizeBar')}
                    onMouseDown={startResize}
                    className="w-1.5 shrink-0 cursor-col-resize rounded-full bg-border/50 transition-colors hover:bg-primary/40"
                />

                {/* 右：参考句式与练习点在上，评测在下 */}
                <div style={{ width: rightWidth }} className="flex min-h-0 shrink-0 flex-col gap-4 overflow-y-auto">
                    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                        <h2 className="text-sm font-medium text-foreground">{t('dialogue.targets')}</h2>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {scene.targetExpressions.map((item) => (
                                <button
                                    key={item.en}
                                    type="button"
                                    onClick={() => void speak(item.en, aiVoice)}
                                    className="group flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-border hover:text-foreground"
                                >
                                    <span>{item.en}</span>
                                    {item.zh.trim() !== '' && (
                                        <span className="text-muted-foreground">{item.zh}</span>
                                    )}
                                    <Volume2 className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                                </button>
                            ))}
                        </div>
                    </section>
                    {scene.practice && (
                        <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                            <ScenePracticeView
                                practice={scene.practice}
                                onSpeak={(text) => void speak(text, aiVoice)}
                            />
                        </section>
                    )}
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
        </div>
    );
}
