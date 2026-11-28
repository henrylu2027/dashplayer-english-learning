import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import type { SrsVerdict } from '@/common/contracts/srs';
import { Button } from '@/fronted/components/ui/button';
import { cn } from '@/fronted/lib/utils';

/**
 * 底部掌握度判定条。
 *
 * 按钮只表达方向；机器分是否达标由后端封顶，前端不参与调度计算。
 */
export interface VerdictBarProps {
    /** 是否已有作答结果可判定。 */
    disabled: boolean;
    /** 判定请求进行中。 */
    submitting: boolean;
    /** 未就绪时显示的提示。 */
    hint: string;
    /** 点击判定。 */
    onVerdict: (verdict: SrsVerdict) => void;
}

/** 三个方向的展示配置。 */
const VERDICTS: Array<{
    value: SrsVerdict;
    labelKey: string;
    hintKey: string;
    className: string;
}> = [
    {
        value: 'forgot',
        labelKey: 'srs.verdictForgot',
        hintKey: 'srs.verdictForgotHint',
        className: 'border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400',
    },
    {
        value: 'fuzzy',
        labelKey: 'srs.verdictFuzzy',
        hintKey: 'srs.verdictFuzzyHint',
        className: 'border-border/70 text-foreground hover:bg-muted',
    },
    {
        value: 'known',
        labelKey: 'srs.verdictKnown',
        hintKey: 'srs.verdictKnownHint',
        className: 'bg-primary text-primary-foreground hover:bg-primary/90',
    },
];

export default function VerdictBar({ disabled, submitting, hint, onVerdict }: VerdictBarProps) {
    const { t } = useTranslation('pages');
    return (
        <footer className="shrink-0 border-t border-border/60 bg-card/80 px-6 py-3 backdrop-blur">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                    {submitting ? t('srs.submitting') : hint}
                </div>
                <div className="flex items-center gap-2">
                    {VERDICTS.map((item) => (
                        <Button
                            key={item.value}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={disabled || submitting}
                            title={t(item.hintKey)}
                            onClick={() => onVerdict(item.value)}
                            className={cn('h-9 min-w-[92px] rounded-lg px-4 text-sm', item.className)}
                        >
                            {submitting && item.value === 'known' && (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            )}
                            {t(item.labelKey)}
                        </Button>
                    ))}
                </div>
            </div>
        </footer>
    );
}
