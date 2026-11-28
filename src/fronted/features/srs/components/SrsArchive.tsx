import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronUp, History, Loader2 } from 'lucide-react';

import type {
    SrsErrorTag,
    SrsHistoryDay,
    SrsHistoryItem,
    SrsReviewForm,
    SrsVerdict,
} from '@/common/contracts/srs';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { srsApi } from '../srsApi';

const logger = getRendererLogger('SrsArchive');

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
    /** 本次评分得到的错误标签。 */
    errorTags: SrsErrorTag[];
    /** 判定时间，epoch 毫秒。 */
    at: number;
}

/** 形态文案键。 */
const FORM_LABEL: Record<SrsReviewForm, string> = {
    shadowing: 'srs.formShadowing',
    dictation: 'srs.formDictation',
    recall: 'srs.formRecall',
    vocab: 'srs.formVocab',
    scenario: 'srs.formScenario',
};

/** 判定文案键。 */
const VERDICT_LABEL: Record<SrsVerdict, string> = {
    forgot: 'srs.verdictForgot',
    fuzzy: 'srs.verdictFuzzy',
    known: 'srs.verdictKnown',
};

/**
 * 复习记录存档：本次会话明细 + 历史日志。
 *
 * 本次会话只保存在内存，刷新页面即清空；历史日志来自 `dp_srs_review_log`，按日期分组。
 */
export interface SrsArchiveProps {
    /** 本次会话的判定记录，按时间正序。 */
    items: ArchiveItem[];
}

export default function SrsArchive({ items }: SrsArchiveProps) {
    const { t } = useTranslation('pages');
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<'session' | 'history' | 'calendar'>('session');
    const [history, setHistory] = useState<SrsHistoryItem[] | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [calendar, setCalendar] = useState<SrsHistoryDay[] | null>(null);
    const [calendarLoading, setCalendarLoading] = useState(false);

    const average = useMemo(() => {
        const scored = items.filter((item) => item.score !== null);
        if (scored.length === 0) {
            return null;
        }
        return Math.round(scored.reduce((sum, item) => sum + (item.score ?? 0), 0) / scored.length);
    }, [items]);

    /** 按日期分组的历史记录，日期用本地时区。 */
    const historyGroups = useMemo(() => {
        const groups = new Map<string, SrsHistoryItem[]>();
        (history ?? []).forEach((item) => {
            const key = new Date(item.createdAt).toLocaleDateString('zh-CN');
            const list = groups.get(key) ?? [];
            list.push(item);
            groups.set(key, list);
        });
        return [...groups.entries()];
    }, [history]);

    /** 首次切到历史时加载。 */
    const loadHistory = async (): Promise<void> => {
        if (history !== null || historyLoading) {
            return;
        }
        setHistoryLoading(true);
        try {
            const result = await srsApi.history({ limit: 200 });
            setHistory(result.items);
        } catch (error) {
            logger.error('加载复习历史失败', { error });
            toast.error(error instanceof Error ? error.message : t('srs.loadFailed'));
        } finally {
            setHistoryLoading(false);
        }
    };

    /** 首次切到日历时加载。 */
    const loadCalendar = async (): Promise<void> => {
        if (calendar !== null || calendarLoading) {
            return;
        }
        setCalendarLoading(true);
        try {
            const result = await srsApi.historyCalendar();
            setCalendar(result.days);
        } catch (error) {
            logger.error('加载复习日历失败', { error });
            toast.error(error instanceof Error ? error.message : t('srs.loadFailed'));
        } finally {
            setCalendarLoading(false);
        }
    };

    /** 最近 60 天的日历格子，按日期从旧到新。 */
    const calendarCells = useMemo(() => {
        const byDate = new Map((calendar ?? []).map((day) => [day.date, day]));
        const cells: Array<{ date: string; day: SrsHistoryDay | null }> = [];
        for (let offset = 59; offset >= 0; offset--) {
            const date = new Date();
            date.setDate(date.getDate() - offset);
            const key = date.toLocaleDateString('sv-SE');
            cells.push({ date: key, day: byDate.get(key) ?? null });
        }
        return cells;
    }, [calendar]);

    const switchTab = (next: 'session' | 'history' | 'calendar'): void => {
        setTab(next);
        if (next === 'history') {
            void loadHistory();
        }
        if (next === 'calendar') {
            void loadCalendar();
        }
    };

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
                <div className="px-6 pb-3">
                    <div className="mb-2 flex items-center gap-1.5">
                        {(['session', 'history', 'calendar'] as const).map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => switchTab(value)}
                                className={cn(
                                    'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                                    tab === value
                                        ? 'border-primary/40 bg-primary/10 text-primary'
                                        : 'border-transparent text-muted-foreground hover:bg-muted',
                                )}
                            >
                                {t(
                                    value === 'session'
                                        ? 'srs.archiveSession'
                                        : value === 'history'
                                            ? 'srs.archiveHistory'
                                            : 'srs.archiveCalendar',
                                )}
                            </button>
                        ))}
                    </div>

                    {tab === 'session' ? (
                        <div className="max-h-48 overflow-y-auto">
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
                                            <FormChip form={item.form} />
                                            <span className="min-w-0 flex-1 truncate text-foreground" title={item.text}>
                                                {item.text}
                                            </span>
                                            {item.score !== null && (
                                                <span className="shrink-0 tabular-nums text-muted-foreground">{item.score}</span>
                                            )}
                                            <VerdictLabel verdict={item.verdict} />
                                            <span className="shrink-0 tabular-nums text-muted-foreground">
                                                {item.mastered
                                                    ? t('srs.statusMastered')
                                                    : t('srs.verdictNext', { days: item.intervalDays })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : tab === 'calendar' ? (
                        calendarLoading ? (
                            <div className="flex justify-center py-4 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                        ) : calendarCells.every((cell) => cell.day === null) ? (
                            <p className="py-2 text-xs text-muted-foreground">{t('srs.calendarEmpty')}</p>
                        ) : (
                            <div className="grid grid-cols-10 gap-1 py-1">
                                {calendarCells.map((cell) => (
                                    <div
                                        key={cell.date}
                                        title={`${cell.date} · ${cell.day?.count ?? 0}`}
                                        className={cn(
                                            'h-4 rounded-sm',
                                            !cell.day || cell.day.count === 0
                                                ? 'bg-muted'
                                                : cell.day.count <= 2
                                                    ? 'bg-emerald-500/25'
                                                    : cell.day.count <= 5
                                                        ? 'bg-emerald-500/50'
                                                        : 'bg-emerald-500/80',
                                        )}
                                    />
                                ))}
                            </div>
                        )
                    ) : historyLoading ? (
                        <div className="flex justify-center py-4 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                    ) : historyGroups.length === 0 ? (
                        <p className="py-2 text-xs text-muted-foreground">{t('srs.archiveEmpty')}</p>
                    ) : (
                        <div className="max-h-56 space-y-2 overflow-y-auto">
                            {historyGroups.map(([day, list]) => (
                                <div key={day}>
                                    <div className="sticky top-0 bg-card/95 px-2 py-1 text-[11px] text-muted-foreground">
                                        {day}
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        {list.map((item) => (
                                            <div
                                                key={item.id}
                                                className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs"
                                            >
                                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                                    {new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
                                                </span>
                                                <FormChip form={item.form} />
                                                <span className="min-w-0 flex-1 truncate text-foreground" title={item.text}>
                                                    {item.text}
                                                </span>
                                                {item.score !== null && (
                                                    <span className="shrink-0 tabular-nums text-muted-foreground">{item.score}</span>
                                                )}
                                                <VerdictLabel verdict={item.verdict} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/** 形态标签。 */
function FormChip({ form }: { form: SrsReviewForm }) {
    const { t } = useTranslation('pages');
    return (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
            {t(FORM_LABEL[form])}
        </span>
    );
}

/** 判定标签。 */
function VerdictLabel({ verdict }: { verdict: SrsVerdict }) {
    const { t } = useTranslation('pages');
    return (
        <span
            className={cn(
                'shrink-0',
                verdict === 'forgot' && 'text-red-500',
                verdict === 'fuzzy' && 'text-amber-600 dark:text-amber-400',
                verdict === 'known' && 'text-emerald-600 dark:text-emerald-400',
            )}
        >
            {t(VERDICT_LABEL[verdict])}
        </span>
    );
}
