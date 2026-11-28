import { useTranslation } from 'react-i18next';
import {
    BookOpen,
    Headphones,
    MessagesSquare,
    Mic,
    Play,
    Repeat,
    Trash2,
    type LucideIcon,
} from 'lucide-react';

import type { SrsCard, SrsReviewForm, SrsSourceModule } from '@/common/contracts/srs';
import { SRS_PASS_SCORE } from '@/common/contracts/srs';
import { resolveSrsReviewForm } from '@/common/utils/srsReviewForm';
import { cn } from '@/fronted/lib/utils';

/** 来源模块小图标。 */
const MODULE_ICON: Record<SrsSourceModule, LucideIcon> = {
    player: Play,
    original: Mic,
    practice: Headphones,
    dialogue: MessagesSquare,
    vocabulary: BookOpen,
};

/** 形态文案键。 */
const FORM_LABEL: Record<SrsReviewForm, string> = {
    shadowing: 'srs.formShadowing',
    dictation: 'srs.formDictation',
    recall: 'srs.formRecall',
    vocab: 'srs.formVocab',
    scenario: 'srs.formScenario',
};

/**
 * 左侧队列里的一行。
 *
 * 必备元素：来源图标、类型标签、词句预览、阶段、上次得分、状态。
 */
export interface SrsQueueItemProps {
    /** 卡片。 */
    card: SrsCard;
    /** 是否为当前选中卡。 */
    active: boolean;
    /** 所在分组的展示状态。 */
    status: 'today' | 'overdue' | 'new' | 'mastered';
    /** 选中。 */
    onSelect: () => void;
    /** 请求移出复习。 */
    onDelete: () => void;
}

export default function SrsQueueItem({ card, active, status, onSelect, onDelete }: SrsQueueItemProps) {
    const { t } = useTranslation('pages');
    const module = card.sourceModules[0];
    const Icon = module ? MODULE_ICON[module] : Repeat;
    const form = resolveSrsReviewForm(card);
    const scoreTone = card.lastScore === null
        ? 'bg-muted text-muted-foreground'
        : card.lastScore >= SRS_PASS_SCORE
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-red-500/10 text-red-500';

    const statusLabel = status === 'overdue'
        ? t('srs.statusOverdue')
        : status === 'mastered'
            ? t('srs.statusMastered')
            : status === 'new'
                ? t('srs.newBadge')
                : t('srs.statusPending');

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect();
                }
            }}
            title={card.referenceText}
            className={cn(
                'group relative flex w-full cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
                active
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-transparent hover:bg-muted/60',
            )}
        >
            {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
            <span
                className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    status === 'overdue' ? 'bg-red-500/10 text-red-500' : 'bg-muted text-muted-foreground',
                )}
            >
                <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground">{card.referenceText}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5">{t(FORM_LABEL[form])}</span>
                    <span>{t('srs.stage', { stage: card.stage })}</span>
                    <span
                        className={cn('rounded px-1.5 py-0.5 tabular-nums', scoreTone)}
                    >
                        {card.lastScore ?? t('srs.lastScoreNone')}
                    </span>
                    <span
                        className={cn(
                            status === 'overdue' && 'text-red-500',
                            status === 'mastered' && 'text-emerald-600 dark:text-emerald-400',
                        )}
                    >
                        {statusLabel}
                    </span>
                </div>
            </div>
            <button
                type="button"
                aria-label={t('srs.remove')}
                onClick={(event) => {
                    event.stopPropagation();
                    onDelete();
                }}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
            >
                <Trash2 className="h-4 w-4" />
            </button>
        </div>
    );
}
