import { useTranslation } from 'react-i18next';
import { Check, History } from 'lucide-react';

import type { DialogueSessionSummary } from '@/common/contracts/dialogue';
import { cn } from '@/fronted/lib/utils';

/**
 * 最近对话列表。
 *
 * @param props.sessions 会话摘要。
 * @param props.onOpen 打开某条对话的详情。
 */
export default function HistoryList({
    sessions,
    onOpen,
}: {
    sessions: DialogueSessionSummary[];
    onOpen: (sessionId: number) => void;
}) {
    const { t } = useTranslation('pages');
    return (
        <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-medium text-foreground">{t('dialogue.history')}</h2>
                <span className="text-xs text-muted-foreground">{t('dialogue.historyHint')}</span>
            </div>
            {sessions.length === 0 ? (
                <div className="mt-3 flex flex-col items-center gap-1 rounded-xl bg-muted/40 px-4 py-6 text-center text-xs text-muted-foreground">
                    <History className="h-5 w-5 text-muted-foreground/50" />
                    {t('dialogue.historyEmpty')}
                </div>
            ) : (
                <div className="mt-2 flex flex-col gap-1">
                    {sessions.map((session) => (
                        <button
                            key={session.id}
                            type="button"
                            onClick={() => onOpen(session.id)}
                            className="flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted/50"
                        >
                            <span
                                className={cn(
                                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px]',
                                    session.finishedAt
                                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                        : 'bg-muted text-muted-foreground',
                                )}
                            >
                                {session.finishedAt ? <Check className="h-3.5 w-3.5" /> : '…'}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-foreground">{session.title}</span>
                                <span className="block truncate text-xs text-muted-foreground">{session.anchorText}</span>
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {t('dialogue.historyTurns', { count: session.turnCount })}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {new Date(session.createdAt).toLocaleString()}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}
