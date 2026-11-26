import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { CheckCheck, Loader2 } from 'lucide-react';

import type {
    DialogueReview,
    DialogueScene,
    DialogueScript,
    DialogueSessionSummary,
} from '@/common/contracts/dialogue';
import { Button } from '@/fronted/components/ui/button';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { dialogueApi } from '../dialogueApi';
import { useDialogueChat } from '../useDialogueChat';
import ClipTranscriptRail from './ClipTranscriptRail';
import DialogueComposer from './DialogueComposer';
import DialogueThread from './DialogueThread';
import SceneCardView from './SceneCardView';

const logger = getRendererLogger('DialogueSessionView');

/**
 * 进行中的场景对话：场景卡、消息流、输入区与结束复盘。
 *
 * 说明：用户消息发送前落库、助手消息完成后落库；复盘前会等待所有落库写完，
 * 避免最后一句还没记录就生成复盘。
 *
 * @param props.session 会话摘要。
 * @param props.scene 场景卡。
 * @param props.script 原片剧本；为空时不显示右侧台词轨道。
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
    const [finishing, setFinishing] = useState(false);
    /** 串行化回合落库；复盘前用它等待最后一条助手消息写入。 */
    const writeChainRef = useRef<Promise<void>>(Promise.resolve());
    /** 是否有回合写入失败；复盘前提示学习者记录可能不完整。 */
    const writeErrorRef = useRef(false);

    const enqueueWrite = (task: () => Promise<unknown>): Promise<void> => {
        const next = writeChainRef.current
            .then(task, task)
            .then(() => undefined);
        writeChainRef.current = next.catch((error) => {
            writeErrorRef.current = true;
            logger.error('对话回合落库失败', { error });
        });
        return next;
    };

    const chat = useDialogueChat({
        chatSessionId: session.chatSessionId,
        onAssistantComplete: (text) => {
            void enqueueWrite(() => dialogueApi.appendTurn({
                sessionId: session.id,
                role: 'assistant',
                content: text,
            })).catch((error) => {
                logger.error('助手消息落库失败', { error });
            });
        },
    });

    const handleSend = async (text: string): Promise<void> => {
        try {
            await enqueueWrite(() => dialogueApi.appendTurn({
                sessionId: session.id,
                role: 'user',
                content: text,
            }));
        } catch (error) {
            logger.error('学习者消息落库失败', { error });
            toast.error(t('dialogue.turnSaveFailed'));
            return;
        }
        await chat.send(text);
    };

    const handleFinish = async (): Promise<void> => {
        setFinishing(true);
        try {
            await writeChainRef.current;
            if (writeErrorRef.current) {
                // 有回合没写进去时仍允许复盘，但要如实提示记录不完整
                toast.error(t('dialogue.partialTranscript'));
            }
            const result = await dialogueApi.finish({ sessionId: session.id });
            onFinished(result.session, result.review);
        } catch (error) {
            logger.error('对话复盘失败', { error });
            toast.error(error instanceof Error ? error.message : t('dialogue.finishFailed'));
        } finally {
            setFinishing(false);
        }
    };

    /** 学习者已发言轮数：台词轨道按它推进滚动位置。 */
    const userTurnCount = chat.messages.filter((message) => message.role === 'user').length;

    const conversationPane = (
        <div className="flex min-w-0 flex-col gap-4">
            <SceneCardView scene={scene} onSpeak={onSpeak} />

            <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                <DialogueThread
                    sceneOpening={scene.openingLineEn}
                    openingHint={scene.openingHintZh}
                    messages={chat.messages}
                    isBusy={chat.isBusy}
                    onSpeak={onSpeak}
                />

                {chat.error && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
                        {chat.error.message}
                    </div>
                )}

                <div className="border-t border-border/50 pt-4">
                    <DialogueComposer
                        disabled={chat.isBusy || finishing}
                        busy={chat.isBusy}
                        onStop={chat.stop}
                        onSend={(text) => {
                            void handleSend(text);
                        }}
                    />
                </div>

                <div className="flex justify-end">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-xl px-4 text-sm"
                        disabled={finishing || chat.isBusy}
                        onClick={() => void handleFinish()}
                    >
                        {finishing
                            ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            : <CheckCheck className="mr-1 h-3.5 w-3.5" />}
                        {finishing ? t('dialogue.finishing') : t('dialogue.finish')}
                    </Button>
                </div>
            </section>
        </div>
    );

    if (!script) {
        return <div className="flex flex-col gap-4">{conversationPane}</div>;
    }

    return (
        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            {conversationPane}
            <div className="min-h-0 lg:sticky lg:top-0 lg:max-h-[calc(100vh-180px)]">
                <div className="flex h-full min-h-0 flex-col">
                    <ClipTranscriptRail script={script} userTurnCount={userTurnCount} />
                </div>
            </div>
        </div>
    );
}
