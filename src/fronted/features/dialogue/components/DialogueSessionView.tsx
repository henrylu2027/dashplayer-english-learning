import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { CheckCheck, Loader2, Volume2 } from 'lucide-react';

import type {
    DialogueCorrection,
    DialogueDifficulty,
    DialogueReview,
    DialogueScene,
    DialogueScript,
    DialogueSessionSummary,
    DialogueSpeaker,
} from '@/common/contracts/dialogue';
import { Button } from '@/fronted/components/ui/button';
import { getTtsUrl, playAudioUrlAndWait } from '@/fronted/infrastructure/audio/AudioPlayer';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { dialogueApi } from '../dialogueApi';
import ClipTranscriptRail from './ClipTranscriptRail';
import CorrectionCard from './CorrectionCard';
import DialogueComposer from './DialogueComposer';
import SceneCardView from './SceneCardView';

const logger = getRendererLogger('DialogueSessionView');

/** AI 吐出下一句原台词前的停顿，让轮次看起来像对话而不是瞬间刷屏。 */
const AI_LINE_DELAY_MS = 900;

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
 * 说明：AI 不再自由发挥——轮到它时直接说剧本里的下一句原台词，
 * 这样对话顺序、内容和原片一致；模型只负责逐句纠错与最后的复盘。
 *
 * @param props.session 会话摘要。
 * @param props.scene 场景卡。
 * @param props.script 原片剧本；为空时无法继续。
 * @param props.onFinished 复盘完成回调。
 * @param props.onSpeak 朗读回调。
 */
export default function DialogueSessionView({
    session,
    scene,
    script,
    onFinished,
    onSpeak,
}: {
    session: DialogueSessionSummary;
    scene: DialogueScene;
    script: DialogueScript | null;
    onFinished: (session: DialogueSessionSummary, review: DialogueReview) => void;
    onSpeak: (text: string) => void;
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
    const [finishing, setFinishing] = useState(false);
    /** 学习者扮演哪一方；可以在对话中随时互换。 */
    const [learnerRole, setLearnerRole] = useState<DialogueSpeaker>(script?.learnerRole ?? 'a');
    /** 右侧台词面板是否展开。 */
    const [railOpen, setRailOpen] = useState(true);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    /** 已经落库的行，避免 effect 重跑时重复写入。 */
    const persistedRef = useRef<Set<string>>(new Set());
    /** 朗读队列：上一句读完再读下一句，避免互相打断。 */
    const speechQueueRef = useRef<Promise<void>>(Promise.resolve());

    const enqueueSpeech = useCallback((text: string): void => {
        if (!text.trim()) {
            return;
        }
        speechQueueRef.current = speechQueueRef.current
            .then(async () => {
                const url = await getTtsUrl(text);
                await playAudioUrlAndWait(url);
            })
            .catch((error) => {
                logger.warn('朗读失败', { error });
            });
    }, []);

    const currentLine = cursor < lines.length ? lines[cursor] : null;
    const waitingForLearner = currentLine?.speaker === learnerRole;
    const finishedScript = lines.length > 0 && cursor >= lines.length;
    /**
     * 右侧轨道高亮哪一句。
     *
     * 谁说到哪一句就亮哪一句：AI 说完停在它那句，学习者说完停在他说那句；
     * 开始前停在本场第一句。这样右边始终对应"刚才在演的那句"。
     */
    const [activeLineIndex, setActiveLineIndex] = useState(startPosition);

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
            // 右侧停在这句：AI 正在说的就是它
            setActiveLineIndex(cursor);
            setCursor((value) => value + 1);
            // 台词出现的同一时刻读出来
            enqueueSpeech(line.en);
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

    const handleSend = async (text: string, meta?: { lowConfidenceWords: string[] }): Promise<void> => {
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
        // 学习者这句也读一遍：作为标准发音示范
        enqueueSpeech(text);
        // 右侧停到学习者刚说的那句
        setActiveLineIndex(cursor);
        // 说一句就往下走一句，不卡在学习者这一轮
        setCursor((value) => value + 1);
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

    if (!script) {
        return (
            <section className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                {t('dialogue.scriptMissing')}
            </section>
        );
    }

    const conversationPane = (
        <div className="flex min-w-0 flex-col gap-4">
            <SceneCardView scene={scene} onSpeak={onSpeak} />

            <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-3">
                    <div className="text-xs text-muted-foreground">
                        {t('dialogue.youPlay', { name: learnerRole === 'a' ? script.roleAName : script.roleBName })}
                    </div>
                    <div className="flex items-center gap-1">
                        {!railOpen && (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 rounded-lg px-2 text-xs"
                                onClick={() => setRailOpen(true)}
                            >
                                {t('dialogue.railShow')}
                            </Button>
                        )}
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 rounded-lg px-2 text-xs"
                            onClick={() => setLearnerRole((current) => (current === 'a' ? 'b' : 'a'))}
                        >
                            {t('dialogue.swapRoles')}
                        </Button>
                    </div>
                </div>
                <div className="flex flex-col gap-3">
                    {items.map((item) => (
                        <div
                            key={item.id}
                            className={cn('flex flex-col', item.role === 'user' ? 'items-end' : 'items-start')}
                        >
                            <div className="mb-1 text-[11px] text-muted-foreground">
                                {item.role === 'user' ? t('dialogue.userLabel') : t('dialogue.aiLabel')}
                            </div>
                            <div
                                className={cn(
                                    'group relative max-w-[85%] select-text whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6',
                                    item.role === 'user'
                                        ? 'rounded-tr-sm bg-primary text-primary-foreground'
                                        : 'rounded-tl-sm bg-muted/70 text-foreground',
                                )}
                            >
                                {item.text}
                                {item.role === 'assistant' && (
                                    <button
                                        type="button"
                                        onClick={() => onSpeak(item.text)}
                                        aria-label={t('dialogue.speak')}
                                        className="absolute -right-8 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                                    >
                                        <Volume2 className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                            {item.hintZh && (
                                <div className="mt-1 max-w-[85%] text-xs leading-5 text-muted-foreground">
                                    {item.hintZh}
                                </div>
                            )}
                            {item.role === 'user' && (
                                <CorrectionCard
                                    correction={item.correction ?? null}
                                    pending={correctingUserIndex === item.userIndex}
                                />
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
                                    {buildCue(currentLine, session.difficulty)}
                                </div>
                            </div>
                            <DialogueComposer
                                disabled={finishing}
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
            <div ref={bottomRef} />
        </div>
    );

    return (
        <div className={cn(
            'grid min-h-0 gap-4',
            railOpen && 'lg:grid-cols-[minmax(0,1fr)_320px]',
        )}>
            {conversationPane}
            {railOpen && (
                <div className="min-h-0 lg:sticky lg:top-0 lg:max-h-[calc(100vh-180px)]">
                    <ClipTranscriptRail
                        script={script}
                        focusIndex={activeLineIndex}
                        onCollapse={() => setRailOpen(false)}
                    />
                </div>
            )}
        </div>
    );
}
