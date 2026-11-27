import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import type { DialogueCorrection } from '@/common/contracts/dialogue';

/** 纠错类型对应的中文标签键。 */
const KIND_LABEL_KEY: Record<string, string> = {
    grammar: 'dialogue.correctionKind.grammar',
    wording: 'dialogue.correctionKind.wording',
    pronunciation: 'dialogue.correctionKind.pronunciation',
};

/**
 * 学习者发言下方的小卡片：逐句纠错。
 *
 * 说明：不弹窗、不打断对话，只在句子下面追加一条记录；
 * 没有问题时也显示一行，让学习者知道这句被检查过了。
 *
 * @param props.correction 纠错结果；为空表示还在生成。
 * @param props.pending 是否正在生成。
 */
export default function CorrectionCard({
    correction,
    pending,
    spokenText,
}: {
    correction: DialogueCorrection | null;
    pending: boolean;
    /** 学习者这句的原文，用于给出连读/弱读建议。 */
    spokenText?: string;
}) {
    const { t } = useTranslation('pages');

    if (pending && !correction) {
        return (
            <div className="mt-1.5 flex max-w-[85%] items-center gap-1.5 rounded-xl border border-border/60 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('dialogue.correctionPending')}
            </div>
        );
    }
    if (!correction) {
        return null;
    }
    if (correction.items.length === 0) {
        return (
            <div className="mt-1.5 max-w-[85%] rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-1.5 text-[11px] leading-5 text-emerald-700 dark:text-emerald-400">
                {spokenText
                    ? t('dialogue.correctionSuggestion', { text: spokenText })
                    : t('dialogue.correctionClean')}
            </div>
        );
    }
    return (
        <div className="mt-1.5 flex max-w-[85%] flex-col gap-1 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            {correction.items.map((item, index) => (
                <div key={`${item.kind}-${index}`} className="text-[11px] leading-5">
                    <span className="mr-1 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                        {t(KIND_LABEL_KEY[item.kind] ?? 'dialogue.correctionKind.wording')}
                    </span>
                    <span className="text-foreground/70 line-through decoration-red-400/60">{item.original}</span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    <span className="text-foreground">{item.better}</span>
                    <span className="ml-1 text-muted-foreground">{item.whyZh}</span>
                </div>
            ))}
            <div className="text-[10px] text-muted-foreground">
                {t('dialogue.correctionBy', {
                    backend: correction.reviewer.backend === 'local'
                        ? t('dialogue.reviewerLocal')
                        : t('dialogue.reviewerCloud'),
                    model: correction.reviewer.model,
                })}
            </div>
        </div>
    );
}
