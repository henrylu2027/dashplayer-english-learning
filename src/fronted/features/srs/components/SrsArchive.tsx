import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, History } from 'lucide-react';

import type { SrsReviewForm, SrsVerdict } from '@/common/contracts/srs';
import { cn } from '@/fronted/lib/utils';

/** 本次会话的一条复习记录。 */
export interface ArchiveItem {
    /** 卡片 ID。 */
    cardId: number;
    /** 词句预览。 */
    text: string;
    /** 本次形态。 */
    form: SrsReviewForm;
    /** 机器分。 */
    score: number | null;
    /** 用户判定。 */
    verdict: SrsVerdict;
    /** 判定后的间隔天数。 */
    intervalDays: number;
    /** 是否标记为已掌握。 */
    mastered: boolean;
    /** 判定时间，epoch 毫秒。 */
    at: number;
}

/** 形态文案键。 */
const FORM_LABEL: Record<SrsReviewForm, string> = {
    shadowing: 'srs.formShadowing',
    dictation: 'srs.formDictation',
    recall: 'srs.formRecall',
    vocab: 'srs.formVocab',
};

/** 判定文案键。 */
const VERDICT_LABEL: Record<SrsVerdict, string> = {
    forgot: 'srs.verdictForgot',
    fuzzy: 'srs.verdictFuzzy',
    known: 'srs.verdictKnown',
};

/**
 * 复习记录存档：本次会话的统计与明细。
 *
 * 历史日期回溯属于 P1，这里只保留当前会话，刷新页面即清空。
 */
export interface SrsArchiveProps {
    /** 本次会话的判定记录，按时间正序。 */
    items: ArchiveItem[];
}

export default function SrsArchive({ items }: SrsArchiveProps) {
    const { t } = useTranslation('pages');
    const [open, setOpen] = useState(false);

    const average = useMemo(() => {
        const scored = items.filter((item) => item.score !== null);
        if (scored.length === 0) {
            return null;
        }
        return Math.round(scored.reduce((sum, item) => sum + (item.score ?? 0), 0) / scored.length);
    }, [items]);

    return (
        <div className="shrink-0 border-t border-border/60 bg-card/60">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex w-full items-center justify-between px-6 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
                <span className="flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5" />
                    {t('srs.archiveTitle')}
                    <span className="tabular-nums">{items.length}</span>
                </span>
                <span className="flex items-center gap-3">
                    {average !== null && <span>{t('srs.archiveAvg', { score: average })}</span>}
                    {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </span>
            </button>
            {open && (
                <div className="max-h-48 overflow-y-auto px-6 pb-3">
                    {items.length === 0 ? (
                        <p className="py-2 text-xs text-muted-foreground">{t('srs.archiveEmpty')}</p>
                    ) : (
                        <div className="flex flex-col gap-1">
                            {[...items].reverse().map((item) => (
                                <div
                                    key={`${item.cardId}-${item.at}`}
                                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs"
                                >
                                    <span className="shrink-0 tabular-nums text-muted-foreground">
                                        {new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false })}
                                    </span>
                                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                                        {t(FORM_LABEL[item.form])}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-foreground" title={item.text}>
                                        {item.text}
                                    </span>
                                    {item.score !== null && (
                                        <span className="shrink-0 tabular-nums text-muted-foreground">{item.score}</span>
                                    )}
                                    <span
                                        className={cn(
                                            'shrink-0',
                                            item.verdict === 'forgot' && 'text-red-500',
                                            item.verdict === 'fuzzy' && 'text-amber-600 dark:text-amber-400',
                                            item.verdict === 'known' && 'text-emerald-600 dark:text-emerald-400',
                                        )}
                                    >
                                        {t(VERDICT_LABEL[item.verdict])}
                                    </span>
                                    <span className="shrink-0 tabular-nums text-muted-foreground">
                                        {item.mastered ? t('srs.statusMastered') : t('srs.verdictNext', { days: item.intervalDays })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
