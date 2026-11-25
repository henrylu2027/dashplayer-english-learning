import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Mic, Send, Square } from 'lucide-react';

import { Button } from '@/fronted/components/ui/button';
import { useAudioRecorder } from '@/fronted/features/shadowing/useAudioRecorder';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { dialogueApi } from '../dialogueApi';

const logger = getRendererLogger('DialogueComposer');

/** 单次录音上限：一段对话回应通常远短于 30 秒。 */
const MAX_RECORD_MS = 30_000;

/**
 * 把秒数格式化为 `分:秒`。
 * @param seconds 已录制秒数。
 */
const formatElapsed = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
};

/**
 * 对话输入区：语音识别回填、文字确认后发送。
 *
 * 说明：识别结果只作为输入草稿，学习者可以修改后再发送；
 * 草稿内容不会被当成评分依据，避免把识别错误算成学习者的错误。
 *
 * @param props.disabled 生成期间禁用输入。
 * @param props.onSend 发送文本。
 */
export default function DialogueComposer({
    disabled,
    busy,
    onSend,
    onStop,
}: {
    disabled: boolean;
    busy: boolean;
    onSend: (text: string) => void;
    onStop: () => void;
}) {
    const { t } = useTranslation('pages');
    const [input, setInput] = useState('');
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAudio = async (blob: Blob): Promise<void> => {
        if (blob.size === 0) {
            setError(t('dialogue.noSpeech'));
            return;
        }
        setProcessing(true);
        setError(null);
        try {
            const buffer = await blob.arrayBuffer();
            const result = await dialogueApi.transcribe({
                audio: new Uint8Array(buffer),
                mimeType: blob.type || 'audio/webm',
            });
            const recognized = result.text.trim();
            if (!recognized) {
                setError(t('dialogue.emptyRecognition'));
                return;
            }
            setInput((previous) => (previous.trim().length > 0 ? `${previous.trim()} ${recognized}` : recognized));
        } catch (transcribeError) {
            logger.error('对话语音识别失败', { error: transcribeError });
            setError(transcribeError instanceof Error ? transcribeError.message : t('dialogue.recognizeFailed'));
        } finally {
            setProcessing(false);
        }
    };

    const audio = useAudioRecorder({ maxDurationMs: MAX_RECORD_MS, onStop: handleAudio });
    const isRecording = audio.phase === 'recording';
    const inputBlocked = disabled || processing;

    const submit = (): void => {
        const text = input.trim();
        if (!text || inputBlocked) {
            return;
        }
        setInput('');
        setError(null);
        onSend(text);
    };

    const handleMicClick = (): void => {
        if (inputBlocked || busy) {
            return;
        }
        if (isRecording) {
            audio.stop();
            return;
        }
        setError(null);
        void audio.start();
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
                <button
                    type="button"
                    onClick={handleMicClick}
                    disabled={inputBlocked || busy}
                    aria-label={isRecording ? t('dialogue.stopRecording') : t('dialogue.startRecording')}
                    className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
                        isRecording
                            ? 'bg-red-500 text-white shadow-md shadow-red-500/30'
                            : 'bg-muted text-foreground hover:bg-muted/70',
                        (inputBlocked || busy) && 'cursor-wait opacity-60',
                    )}
                >
                    {processing
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : isRecording
                            ? <Square className="h-4 w-4 fill-current" />
                            : <Mic className="h-4 w-4" />}
                </button>

                <div className="min-w-0 flex-1">
                    <textarea
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                submit();
                            }
                        }}
                        rows={2}
                        disabled={inputBlocked || busy}
                        placeholder={t('dialogue.chatPlaceholder')}
                        className="w-full resize-none rounded-xl border border-border/60 bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60 disabled:opacity-60"
                    />
                </div>

                {busy ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-10 shrink-0 rounded-xl px-3"
                        onClick={onStop}
                    >
                        <Square className="mr-1 h-3.5 w-3.5 fill-current" />
                        {t('dialogue.stopGenerating')}
                    </Button>
                ) : (
                    <Button
                        type="button"
                        size="sm"
                        className="h-10 shrink-0 rounded-xl px-3"
                        disabled={disabled || input.trim().length === 0}
                        onClick={submit}
                    >
                        <Send className="mr-1 h-3.5 w-3.5" />
                        {t('dialogue.send')}
                    </Button>
                )}
            </div>

            <div className="flex min-h-4 items-center gap-2 text-xs text-muted-foreground">
                {isRecording && <span>{t('dialogue.recording', { time: formatElapsed(audio.elapsedSec) })}</span>}
                {processing && <span>{t('dialogue.transcribing')}</span>}
                {!isRecording && !processing && <span>{t('dialogue.recognitionHint')}</span>}
            </div>

            {(error || audio.error) && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
                    {error || audio.error}
                </div>
            )}
        </div>
    );
}
