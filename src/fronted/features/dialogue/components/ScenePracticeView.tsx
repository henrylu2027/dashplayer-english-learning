import { useTranslation } from 'react-i18next';

import type { DialogueScene } from '@/common/contracts/dialogue';
import { cn } from '@/fronted/lib/utils';

/**
 * 本课练习点：核心词、短语、语法、可替换表达与拓展词。
 *
 * 说明：场景对话页把它放在右侧参考句式下面；历史详情里仍嵌在场景卡内。
 *
 * @param props.practice 场景卡里的练习点。
 * @param props.onSpeak 朗读词句。
 * @param props.className 额外的容器样式。
 */
export default function ScenePracticeView({
    practice,
    onSpeak,
    className,
}: {
    practice: NonNullable<DialogueScene['practice']>;
    onSpeak: (text: string) => void;
    className?: string;
}) {
    const { t } = useTranslation('pages');
    return (
        <div className={cn('flex flex-col gap-1.5 text-xs', className)}>
            {practice.coreWords.length > 0 && (
                <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="shrink-0 text-muted-foreground">{t('dialogue.practiceWords')}</span>
                    {practice.coreWords.map((word) => (
                        <button
                            key={word}
                            type="button"
                            onClick={() => onSpeak(word)}
                            className="rounded-full bg-background px-2 py-0.5 text-foreground/90"
                        >
                            {word}
                        </button>
                    ))}
                </div>
            )}
            {practice.corePhrases.length > 0 && (
                <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="shrink-0 text-muted-foreground">{t('dialogue.practicePhrases')}</span>
                    {practice.corePhrases.map((phrase) => (
                        <button
                            key={phrase}
                            type="button"
                            onClick={() => onSpeak(phrase)}
                            className="rounded-full bg-background px-2 py-0.5 text-foreground/90"
                        >
                            {phrase}
                        </button>
                    ))}
                </div>
            )}
            {practice.grammarFocus.length > 0 && (
                <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="shrink-0 text-muted-foreground">{t('dialogue.practiceGrammar')}</span>
                    <span className="text-foreground/90">{practice.grammarFocus.join(' · ')}</span>
                </div>
            )}
            {practice.replacements.length > 0 && (
                <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground">{t('dialogue.practiceReplacements')}</span>
                    {practice.replacements.map((item) => (
                        <span key={`${item.from}-${item.to}`} className="text-foreground/80">
                            {item.from} <span className="text-muted-foreground">→</span> {item.to}
                            {item.note.trim() !== '' && <span className="ml-1 text-muted-foreground">（{item.note}）</span>}
                        </span>
                    ))}
                </div>
            )}
            {practice.extraVocabulary.length > 0 && (
                <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="shrink-0 text-muted-foreground">{t('dialogue.practiceExtra')}</span>
                    {practice.extraVocabulary.map((item) => (
                        <span key={item.word} className="text-foreground/90">
                            {item.word}（{item.zh}）{item.usage.trim() !== '' && ` · ${item.usage}`}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
