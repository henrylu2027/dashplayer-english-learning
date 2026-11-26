import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { DialogueScript, DialogueSpeaker } from '@/common/contracts/dialogue';
import { cn } from '@/fronted/lib/utils';

/**
 * 原片台词轨道：把视频里截取的这段对话只读地列在对话右侧。
 *
 * 说明：字幕文件没有说话人信息，台词归属是前端按顺序交替分配的近似结果；
 * 轨道只做对照，不参与评分。滚动进度按学习者已发言轮数推进，
 * 目前还没有做到「这一轮对应哪一条台词」（第二期接逐句纠错时一起做）。
 *
 * @param props.script 剧本。
 * @param props.userTurnCount 学习者已发言轮数，用于推进滚动位置。
 */
export default function ClipTranscriptRail({
    script,
    userTurnCount,
}: {
    script: DialogueScript;
    userTurnCount: number;
}) {
    const { t } = useTranslation('pages');
    const listRef = useRef<HTMLDivElement | null>(null);
    /** 当前高亮的台词下标：随学习者发言推进，最多停在最后一句。 */
    const focusIndex = Math.min(Math.max(userTurnCount, 0), Math.max(script.lines.length - 1, 0));

    useEffect(() => {
        const list = listRef.current;
        if (!list) {
            return;
        }
        const target = list.querySelector<HTMLElement>(`[data-line-index="${focusIndex}"]`);
        if (!target) {
            return;
        }
        // 只滚台词轨道自身，不带动整个页面
        const listRect = list.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const offset = targetRect.top - listRect.top - listRect.height / 2 + targetRect.height / 2;
        list.scrollTo({ top: list.scrollTop + offset, behavior: 'smooth' });
    }, [focusIndex]);

    const nameOf = (speaker: DialogueSpeaker): string => (
        speaker === 'a' ? script.roleAName : script.roleBName
    );

    return (
        <aside className="flex min-h-0 flex-col rounded-2xl border border-border/60 bg-card shadow-xs">
            <div className="border-b border-border/50 px-4 py-3">
                <div className="text-sm font-medium text-foreground">{t('dialogue.scriptTitle')}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                    {t('dialogue.scriptRange', {
                        start: script.startIndex,
                        end: script.endIndex,
                        count: script.lines.length,
                    })}
                </div>
            </div>
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                <div className="flex flex-col gap-2">
                    {script.lines.map((line, index) => {
                        const isLearner = line.speaker === script.learnerRole;
                        const isFocus = index === focusIndex;
                        return (
                            <div
                                key={line.index}
                                data-line-index={index}
                                className={cn(
                                    'rounded-xl px-3 py-2 transition-colors',
                                    isFocus ? 'bg-primary/8 ring-1 ring-primary/30' : 'bg-muted/40',
                                )}
                            >
                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <span className="truncate">{nameOf(line.speaker)}</span>
                                    {isLearner && (
                                        <span className="rounded bg-primary/15 px-1 py-0.5 text-[10px] text-primary">
                                            {t('dialogue.you')}
                                        </span>
                                    )}
                                </div>
                                <div className="mt-1 text-xs leading-5 text-foreground/90">{line.en}</div>
                                {line.zh && (
                                    <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{line.zh}</div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="border-t border-border/50 px-4 py-2 text-[11px] leading-4 text-muted-foreground">
                {t('dialogue.scriptHint')}
            </div>
        </aside>
    );
}
