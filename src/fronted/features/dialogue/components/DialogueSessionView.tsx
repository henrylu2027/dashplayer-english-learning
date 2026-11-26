import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCheck, Loader2, Play, RotateCcw, Volume2 } from 'lucide-react';

import type {
    DialogueCorrection,
    DialogueDifficulty,
    DialogueReview,
    DialogueScene,
    DialogueScript,
    DialogueSessionSummary,
    DialogueSpeaker,
} from '@/common/contracts/dialogue';
import type { RetellResult } from '@/common/contracts/practice';
import { DIALOGUE_DIFFICULTIES } from '@/common/contracts/dialogue';
import { Button } from '@/fronted/components/ui/button';
import { practiceApi } from '@/fronted/features/practice/practiceApi';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { getTtsUrl, playAudioUrlAndWait } from '@/fronted/infrastructure/audio/AudioPlayer';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { dialogueApi } from '../dialogueApi';
import CorrectionCard from './CorrectionCard';
import DialogueComposer from './DialogueComposer';
import SceneCardView from './SceneCardView';
import SpeechScorePanel from './SpeechScorePanel';

const logger = getRendererLogger('DialogueSessionView');

/** 轮到 AI 时的起手停顿；真正的节奏由"上一句读完"决定。 */
const AI_LINE_DELAY_MS = 400;

/** 难度下拉的文案 key 前缀；具体文案在 pages.json 的 dialogue.difficulty 下。 */
const DIFFICULTY_LABEL = 'dialogue.difficulty';

/**
 * 对话中的一条消息。
 */
interface ScriptedItem {
    /** 渲染用的稳定标识。 */
    id: string;
    /** 说话方。 */
    role: 'assistant' | 'user';
    /** 英文内容。 */
    text: string;
    /** 中文提示；只有 AI 台词带。 */
    hintZh?: string;
    /** 学习者发言在对话里的序号，从 0 开始；AI 台词为空。 */
    userIndex?: number;
    /** 逐句纠错；还没出结果时为空。 */
    correction?: DialogueCorrection | null;
}

/**
 * 按剧本给学习者展示自己的台词。
 *
 * 说明：难度只控制"提示多少"，不改变台词本身——演的还是原片那一句。
 *
 * @param line 角色自己的台词。
 * @param difficulty 难度。
 * @returns 显示给学习者的提示文本。
 */
const buildCue = (line: { en: string; zh?: string }, difficulty: DialogueDifficulty): string => {
    if (difficulty === 'challenge') {
        return line.zh ?? '…';
    }
    if (difficulty === 'intermediate') {
        const words = line.en.split(/\s+/);
        const head = words.slice(0, Math.max(1, Math.ceil(words.length / 2))).join(' ');
        return `${head}…`;
    }
    return line.en;
};

/**
 * 进行中的场景对话：照着视频里这段真实台词，一句一句演下去。
 *
 * 左侧是对话气泡与录音区，右侧是学习者最近一次发言的发音评测面板；
 * 记录本身仍以剧本为准，AI 只负责逐句纠错与最后的复盘。
 *
 * @param props.session 会话摘要。
 * @param props.scene 场景卡。
 * @param props.script 原片剧本；为空时无法继续。
 * @param props.onFinished 复盘完成回调。
 * @param props.onSpeak 朗读回调。
 * @param props.onBack 返回历史列表。
 */
export default function DialogueSessionView({
    session,
    scene,
    script,
    onFinished,
    onSpeak,
    onBack,
}: {
    session: DialogueSessionSummary;
    scene: DialogueScene;
    script: DialogueScript | null;
    onFinished: (session: DialogueSessionSummary, review: DialogueReview) => void;
    onSpeak: (text: string) => void;
    onBack: () => void;
}) {
    const { t } = useTranslation('pages');
    const lines = useMemo(() => script?.lines ?? [], [script]);
    /** 排练起点：锚点句在整部台词里的位置。 */
    const startPosition = useMemo(() => {
        if (!script) {
            return 0;
        }
        const index = lines.findIndex((line) => line.index >= script.startIndex);
        return index < 0 ? 0 : index;
    }, [lines, script]);

    const [items, setItems] = useState<ScriptedItem[]>([]);
    /** 剧本里下一条要处理的行；等于行数表示台词演完了。 */
    const [cursor, setCursor] = useState(startPosition);
    /** 正在纠错的学习者发言序号。 */
    const [correctingUserIndex, setCorrectingUserIndex] = useState<number | null>(null);
    /** 是否有一句台词正在朗读；朗读期间不接受新的输入，避免连发。 */
    const [speechPending, setSpeechPending] = useState(false);
    const [finishing, setFinishing] = useState(false);
    /** 学习者扮演哪一方；可以在对话中随时互换。 */
    const [learnerRole, setLearnerRole] = useState<DialogueSpeaker>(script?.learnerRole ?? 'a');
    /** 难度：只影响提示多少，默认跟随会话。 */
    const [difficulty, setDifficulty] = useState<DialogueDifficulty>(session.difficulty);
    /** 最近一次发言的评测结果，显示在右栏。 */
    const [score, setScore] = useState<RetellResult | null>(null);
    const [scoring, setScoring] = useState(false);
    const [savingWords, setSavingWords] = useState(false);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    /** 已经落库的行，避免 effect 重跑时重复写入。 */
    const persistedRef = useRef<Set<string>>(new Set());
    /** 朗读队列：上一句读完再读下一句，避免互相打断。 */
    const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
    /** 组件是否还挂着；朗读结束回调里避免对已卸载组件 setState。 */
    const mountedRef = useRef(true);

    /**
     * 把一句台词排进朗读队列。
     * @param text 待朗读文本。
     * @returns 这句读完（或失败）后 resolve 的 promise；调用方据此控制台词推进节奏。
     */
    const enqueueSpeech = useCallback((text: string): Promise<void> => {
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

    const currentLine = cursor < lines.length ? lines[cursor] : null;
    const waitingForLearner = currentLine?.speaker === learnerRole;
    const finishedScript = lines.length > 0 && cursor >= lines.length;

    // 轮到 AI：停顿一下，把下一句原台词说出来并落库
    useEffect(() => {
        if (!script || cursor >= lines.length) {
            return;
        }
        const line = lines[cursor];
        if (line.speaker === learnerRole) {
            return;
        }
        const timer = setTimeout(() => {
            const id = `ai-${cursor}`;
            setItems((previous) => [...previous, { id, role: 'assistant', text: line.en, hintZh: line.zh }]);
            setSpeechPending(true);
            const spoken = enqueueSpeech(line.en);
            void spoken.then(() => {
                if (mountedRef.current) {
                    setSpeechPending(false);
                    setCursor((value) => value + 1);
                }
            });
            if (!persistedRef.current.has(id)) {
                persistedRef.current.add(id);
                void dialogueApi.appendTurn({
                    sessionId: session.id,
                    role: 'assistant',
                    content: line.en,
                }).catch((error) => {
                    logger.error('AI 台词落库失败', { error });
                });
            }
        }, AI_LINE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [cursor, lines, learnerRole, script, session.id, enqueueSpeech]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [items, finishing]);

    useEffect(() => () => {
        mountedRef.current = false;
    }, []);

    /**
     * 对学习者这次发言做发音与语法评测。
     *
     * @param referenceText 本轮应说的台词原文。
     * @param audio 录音字节；打字输入时不传，面板只提示不计发音。
     * @param mimeType 录音 MIME。
     */
    const scoreTurn = async (referenceText: string, audio: Uint8Array, mimeType: string): Promise<void> => {
        setScoring(true);
        setScore(null);
        try {
            const result = await practiceApi.retell({
                referenceText,
                source: { kind: 'free' },
                audio,
                mimeType,
            });
            if (mountedRef.current) {
                setScore(result);
            }
        } catch (error) {
            logger.error('对话发音评测失败', { error });
            toast.error(error instanceof Error ? error.message : t('dialogue.scoreFailed'));
        } finally {
            if (mountedRef.current) {
                setScoring(false);
            }
        }
    };

    const handleSend = async (
        text: string,
        meta?: { lowConfidenceWords: string[]; audio?: Uint8Array; mimeType?: string },
    ): Promise<void> => {
        const referenceText = currentLine?.en ?? text;
        const userIndex = items.filter((item) => item.role === 'user').length;
        let turnId: number;
        try {
            const saved = await dialogueApi.appendTurn({
                sessionId: session.id,
                role: 'user',
                content: text,
            });
            turnId = saved.turn.id;
        } catch (error) {
            logger.error('学习者消息落库失败', { error });
            toast.error(t('dialogue.turnSaveFailed'));
            return;
        }
        setItems((previous) => [...previous, {
            id: `user-${userIndex}`,
            role: 'user',
            text,
            userIndex,
            correction: null,
        }]);
        // 学习者这句也读一遍：作为标准发音示范；这句读完才轮到 AI 接话
        setSpeechPending(true);
        void enqueueSpeech(text).then(() => {
            if (mountedRef.current) {
                setSpeechPending(false);
                setCursor((value) => value + 1);
            }
        });
        // 有录音才做发音评测；打字输入没有音频
        if (meta?.audio && meta.audio.byteLength > 0) {
            void scoreTurn(referenceText, meta.audio, meta.mimeType ?? 'audio/webm');
        }
        setCorrectingUserIndex(userIndex);
        dialogueApi.correctTurn({
            sessionId: session.id,
            turnId,
            lowConfidenceWords: meta?.lowConfidenceWords ?? [],
        })
            .then((result) => {
                setItems((previous) => previous.map((item) => (
                    item.userIndex === userIndex ? { ...item, correction: result.correction } : item
                )));
            })
            .catch((error) => {
                logger.error('逐句纠错失败', { error, turnId });
            })
            .finally(() => {
                setCorrectingUserIndex((current) => (current === userIndex ? null : current));
            });
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

    /** 把评测里读错/漏读的词与模型挑的生词送进词汇工坊。 */
    const handleAddWords = async (): Promise<void> => {
        if (!score) {
            return;
        }
        const words = new Set<string>();
        for (const word of score.words) {
            if (word.status !== 'correct') {
                const text = (word.expected ?? word.actual ?? '').trim();
                if (text) {
                    words.add(text);
                }
            }
        }
        for (const word of score.vocab) {
            if (word.trim()) {
                words.add(word.trim());
            }
        }
        if (words.size === 0) {
            toast.success(t('practice.noProblemWords'));
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
            toast.success(t('practice.wordsAdded', { count: added }));
        } catch (error) {
            logger.error('加入生词本失败', { error });
            toast.error(t('practice.wordsAddFailed'));
        } finally {
            setSavingWords(false);
        }
    };

    /** 重置对话：清空本地演出记录，从起点重演（不影响已落库的历史）。 */
    const handleReset = (): void => {
        setItems([]);
        setCursor(startPosition);
        setScore(null);
        persistedRef.current.clear();
    };

    if (!script) {
        return (
            <section className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                {t('dialogue.scriptMissing')}
            </section>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* 顶部工具栏 */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs text-muted-foreground">
                        {t('dialogue.sceneLabel')}
                        <span className="max-w-40 truncate text-foreground">{session.title || scene.title}</span>
                    </label>
                    <select
                        value={learnerRole}
                        onChange={(event) => setLearnerRole(event.target.value as DialogueSpeaker)}
                        className="h-8 rounded-full border border-border/60 bg-card px-3 text-xs text-foreground outline-none"
                    >
                        <option value="a">{t('dialogue.aiRoleLabel')}：{script.roleBName}</option>
                        <option value="b">{t('dialogue.aiRoleLabel')}：{script.roleAName}</option>
                    </select>
                    <select
                        value={difficulty}
                        onChange={(event) => setDifficulty(event.target.value as DialogueDifficulty)}
                        className="h-8 rounded-full border border-border/60 bg-card px-3 text-xs text-foreground outline-none"
                    >
                        {DIALOGUE_DIFFICULTIES.map((item) => (
                            <option key={item} value={item}>{t(`${DIFFICULTY_LABEL}.${item}`)}</option>
                        ))}
                    </select>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-full px-3 text-xs"
                        onClick={handleReset}
                    >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        {t('dialogue.resetChat')}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-full px-3 text-xs"
                        onClick={onBack}
                    >
                        <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                        {t('dialogue.backToList')}
                    </Button>
                </div>
            </div>

            <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                {/* 左：对话练习 */}
                <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-sm font-medium text-foreground">{t('dialogue.chatTitle')}</h2>
                        <span className="text-xs text-muted-foreground">
                            {t('dialogue.youPlay', { name: learnerRole === 'a' ? script.roleAName : script.roleBName })}
                        </span>
                    </div>

                    <SceneCardView scene={scene} onSpeak={onSpeak} />

                    <div className="flex flex-col gap-3">
                        {items.map((item) => (
                            <div
                                key={item.id}
                                className={cn('flex items-center gap-2', item.role === 'user' ? 'justify-end' : 'justify-start')}
                            >
                                {item.role === 'assistant' && (
                                    <button
                                        type="button"
                                        onClick={() => onSpeak(item.text)}
                                        aria-label={t('dialogue.speak')}
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        <Play className="h-3.5 w-3.5" />
                                    </button>
                                )}
                                <div className="flex max-w-[80%] flex-col">
                                    <div
                                        className={cn(
                                            'select-text whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6',
                                            item.role === 'user'
                                                ? 'rounded-tr-sm bg-primary text-primary-foreground'
                                                : 'rounded-tl-sm bg-sky-500/15 text-foreground',
                                        )}
                                    >
                                        {item.role === 'assistant' ? `${t('dialogue.aiLabel')}: ${item.text}` : item.text}
                                    </div>
                                    {item.hintZh && (
                                        <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.hintZh}</div>
                                    )}
                                    {item.role === 'user' && (
                                        <CorrectionCard
                                            correction={item.correction ?? null}
                                            pending={correctingUserIndex === item.userIndex}
                                        />
                                    )}
                                </div>
                                {item.role === 'user' && (
                                    <button
                                        type="button"
                                        onClick={() => onSpeak(item.text)}
                                        aria-label={t('dialogue.speak')}
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        <Volume2 className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-border/50 pt-4">
                        {waitingForLearner && currentLine ? (
                            <>
                                <div className="mb-2 rounded-xl bg-primary/5 px-3 py-2">
                                    <div className="text-[11px] text-muted-foreground">
                                        {t('dialogue.yourLine')} · {lines[cursor].speaker === 'a' ? script.roleAName : script.roleBName}
                                    </div>
                                    <div className="mt-0.5 text-sm leading-6 text-foreground">
                                        {buildCue(currentLine, difficulty)}
                                    </div>
                                </div>
                                <DialogueComposer
                                    disabled={finishing || speechPending}
                                    busy={false}
                                    onStop={() => undefined}
                                    onSend={(text, meta) => {
                                        void handleSend(text, meta);
                                    }}
                                />
                            </>
                        ) : (
                            <div className="py-2 text-center text-xs text-muted-foreground">
                                {finishedScript ? t('dialogue.scriptDone') : t('dialogue.scriptPlaying')}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end">
                        <Button
                            type="button"
                            size="sm"
                            variant={finishedScript ? 'default' : 'outline'}
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

                {/* 右：发音评测 */}
                <SpeechScorePanel
                    result={score}
                    pending={scoring}
                    disabled={false}
                    savingWords={savingWords}
                    onAddWords={() => void handleAddWords()}
                    onRetry={() => {
                        setScore(null);
                        toast.success(t('dialogue.retryHint'));
                    }}
                    onContinue={() => {
                        setScore(null);
                    }}
                />
            </div>
            <div ref={bottomRef} />
        </div>
    );
}
