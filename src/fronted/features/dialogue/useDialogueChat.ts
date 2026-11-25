import { useEffect, useMemo, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';

import { ElectronChatTransport } from '@/fronted/features/chat/chatTransport';

/**
 * 从一条消息里取出纯文本。
 * @param message AI SDK 消息。
 * @returns 拼接后的文本，已去除首尾空白。
 */
export const getMessageText = (message: UIMessage): string => message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();

/**
 * 管理一段场景对话的流式消息。
 *
 * 说明：复用整句学习的 Electron transport，按 chatSessionId 分流；
 * 助手消息在流结束后交给 onAssistantComplete 落库，避免中途关闭丢掉已完成的内容。
 *
 * @param options.chatSessionId 后端聊天会话 ID；组件只在会话就绪后挂载。
 * @param options.onAssistantComplete 助手回复完成后的回调。
 */
export function useDialogueChat(options: {
    chatSessionId: string;
    onAssistantComplete: (text: string) => void;
}) {
    const { chatSessionId, onAssistantComplete } = options;
    const transport = useMemo(() => new ElectronChatTransport(), []);
    const chat = useChat({
        id: chatSessionId,
        transport,
        throttle: 40,
    });
    const { messages, status, error, sendMessage, stop } = chat;
    const persistedRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (status !== 'ready') {
            return;
        }
        const last = messages.at(-1);
        if (!last || last.role !== 'assistant' || persistedRef.current.has(last.id)) {
            return;
        }
        const text = getMessageText(last);
        if (!text) {
            return;
        }
        persistedRef.current.add(last.id);
        onAssistantComplete(text);
    }, [messages, onAssistantComplete, status]);

    const isBusy = status === 'submitted' || status === 'streaming';

    return {
        messages,
        status,
        error,
        isBusy,
        stop,
        send: (text: string) => sendMessage({ text }),
    };
}
