import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Volume2 } from 'lucide-react';
import type { UIMessage } from 'ai';

import { cn } from '@/fronted/lib/utils';
import { getMessageText } from '../useDialogueChat';

/**
 * 朗读只读英文部分：入门档的回复可能在英文后追加「（提示：……）」，
 * 本地 TTS 读中文会跑调，因此从提示标记处截断。
 * @param text 助手回复原文。
 * @returns 可朗读文本；没有提示时原样返回。
 */
const toSpeakable = (text: string): string => {
    const index = text.search(/[（(]\s*提示[：:]/);
    const english = (index >= 0 ? text.slice(0, index) : text).trim();
    return english.length > 0 ? english : text.trim();
};

/**
 * 对话消息列表。
 *
 * 说明：开场白来自场景卡而不是消息流，单独作为第一条助手气泡展示；
 * 助手台词可点朗读，朗读内容只包含英文原文。
 *
 * @param props.sceneOpening 开场白。
 * @param props.openingHint 开场白的中文提示。
 * @param props.messages 流式对话消息。
 * @param props.isBusy 是否正在生成。
 * @param props.onSpeak 朗读回调。
 */
export default function DialogueThread({
    sceneOpening,
    openingHint,
    messages,
    isBusy,
    onSpeak,
}: {
    sceneOpening: string;
    openingHint: string;
    messages: UIMessage[];
    isBusy: boolean;
    onSpeak: (text: string) => void;
}) {
    const { t } = useTranslation('pages');
    const bottomRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages, isBusy]);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col items-start">
                <div className="mb-1 text-[11px] text-muted-foreground">{t('dialogue.aiLabel')}</div>
                <div className="group relative max-w-[85%] rounded-2xl rounded-tl-sm bg-muted/70 px-3.5 py-2.5 text-sm leading-6 text-foreground">
                    {sceneOpening}
                    <button
                        type="button"
                        onClick={() => onSpeak(toSpeakable(sceneOpening))}
                        aria-label={t('dialogue.speak')}
                        className="absolute -right-8 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                    >
                        <Volume2 className="h-3.5 w-3.5" />
                    </button>
                </div>
                {openingHint && (
                    <div className="mt-1 max-w-[85%] text-xs leading-5 text-muted-foreground">
                        {openingHint}
                    </div>
                )}
            </div>

            {messages.map((message) => {
                const text = getMessageText(message);
                if (!text) {
                    return null;
                }
                const isUser = message.role === 'user';
                return (
                    <div
                        key={message.id}
                        className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}
                    >
                        <div className="mb-1 text-[11px] text-muted-foreground">
                            {isUser ? t('dialogue.userLabel') : t('dialogue.aiLabel')}
                        </div>
                        <div
                            className={cn(
                                'group relative max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6',
                                isUser
                                    ? 'rounded-tr-sm bg-primary text-primary-foreground'
                                    : 'rounded-tl-sm bg-muted/70 text-foreground',
                            )}
                        >
                            {text}
                            {!isUser && (
                                <button
                                    type="button"
                                    onClick={() => onSpeak(toSpeakable(text))}
                                    aria-label={t('dialogue.speak')}
                                    className="absolute -right-8 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                                >
                                    <Volume2 className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}

            {isBusy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('dialogue.thinking')}
                </div>
            )}
            <div ref={bottomRef} />
        </div>
    );
}
