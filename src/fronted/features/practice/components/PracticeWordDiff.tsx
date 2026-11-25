import { useTranslation } from 'react-i18next';

import type { ShadowingWordFeedback, ShadowingWordStatus } from '@/common/contracts/shadowing';
import { cn } from '@/fronted/lib/utils';

/** 逐词状态的文字样式。 */
const WORD_STATUS_CLASS: Record<ShadowingWordStatus, string> = {
    correct: 'text-emerald-600 dark:text-emerald-400',
    mispronounced: 'text-amber-600 dark:text-amber-400 underline decoration-amber-500/60 decoration-dotted decoration-2 underline-offset-4',
    missing: 'text-red-500 line-through decoration-red-400 decoration-2',
    extra: 'text-muted-foreground/70 italic line-through decoration-dotted',
};

/** 听写图例：把状态文案换成“写对/写错/漏写/多写”。 */
const LEGEND: Array<{ status: ShadowingWordStatus; dotClass: string; labelKey: string }> = [
    { status: 'correct', dotClass: 'bg-emerald-500', labelKey: 'practice.writingCorrect' },
    { status: 'mispronounced', dotClass: 'bg-amber-500', labelKey: 'practice.writingWrong' },
    { status: 'missing', dotClass: 'bg-red-500', labelKey: 'practice.writingMissing' },
    { status: 'extra', dotClass: 'bg-muted-foreground/50', labelKey: 'practice.writingExtra' },
];

/**
 * 听写逐词对比：显示参考文本中被写对、写错、漏写、多写的词。
 */
export default function PracticeWordDiff({ words }: { words: ShadowingWordFeedback[] }) {
    const { t } = useTranslation('pages');
    return (
        <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {LEGEND.map((item) => (
                    <span key={item.status} className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className={cn('h-1.5 w-1.5 rounded-full', item.dotClass)} />
                        {t(item.labelKey)}
                    </span>
                ))}
            </div>
            <p className="mt-2 text-lg leading-8 text-foreground">
                {words.map((word, index) => {
                    const title = word.status === 'mispronounced' && word.actual
                        ? t('practice.writtenAs', { word: word.actual })
                        : word.status === 'missing'
                            ? t('practice.writingMissingHint')
                            : word.status === 'extra'
                                ? t('practice.writingExtraHint')
                                : undefined;
                    return (
                        <span
                            key={`${index}-${word.status}`}
                            title={title}
                            className={cn('mx-0.5', WORD_STATUS_CLASS[word.status])}
                        >
                            {word.expected ?? word.actual}
                        </span>
                    );
                })}
            </p>
        </div>
    );
}
