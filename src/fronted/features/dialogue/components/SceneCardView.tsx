import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2 } from 'lucide-react';

import type { DialogueScene } from '@/common/contracts/dialogue';

/**
 * 场景卡：设定、双方角色与参考句式。
 *
 * @param props.scene 场景卡。
 * @param props.onSpeak 朗读参考句式。
 * @param props.actions 场景信息区右上角的操作按钮（重置对话、返回列表）。
 */
export default function SceneCardView({
    scene,
    onSpeak,
    actions,
}: {
    scene: DialogueScene;
    onSpeak: (text: string) => void;
    actions?: ReactNode;
}) {
    const { t } = useTranslation('pages');
    return (
        <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('dialogue.sceneTitle')}</div>
                    <h2 className="mt-0.5 text-base font-medium text-foreground">{scene.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-foreground/80">{scene.settingZh}</p>
                </div>
                {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-xl bg-muted/50 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{t('dialogue.aiRole')}</div>
                    <div className="mt-0.5 text-foreground/90">{scene.aiRole}</div>
                </div>
                <div className="rounded-xl bg-muted/50 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{t('dialogue.userRole')}</div>
                    <div className="mt-0.5 text-foreground/90">{scene.userRole}</div>
                </div>
            </div>

            <div>
                <div className="mb-1.5 text-xs text-muted-foreground">{t('dialogue.targets')}</div>
                <div className="flex flex-wrap gap-1.5">
                    {scene.targetExpressions.map((item) => (
                        <button
                            key={item.en}
                            type="button"
                            onClick={() => onSpeak(item.en)}
                            className="group flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-border hover:text-foreground"
                        >
                            <span>{item.en}</span>
                            {/* 取自练习记录的台词可能没有译文，空着就不占位，避免出现悬空的括号 */}
                            {item.zh.trim() !== '' && (
                                <span className="text-muted-foreground">{item.zh}</span>
                            )}
                            <Volume2 className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                    ))}
                </div>
            </div>

            {/* 本课练习点：来自场景生成时的核心词句与语法，旧场景没有这一块 */}
            {scene.practice && (
                <div className="flex flex-col gap-1.5 rounded-xl bg-muted/40 px-3 py-2.5 text-xs">
                    {scene.practice.coreWords.length > 0 && (
                        <div className="flex flex-wrap items-baseline gap-1.5">
                            <span className="shrink-0 text-muted-foreground">{t('dialogue.practiceWords')}</span>
                            {scene.practice.coreWords.map((word) => (
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
                    {scene.practice.corePhrases.length > 0 && (
                        <div className="flex flex-wrap items-baseline gap-1.5">
                            <span className="shrink-0 text-muted-foreground">{t('dialogue.practicePhrases')}</span>
                            {scene.practice.corePhrases.map((phrase) => (
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
                    {scene.practice.grammarFocus.length > 0 && (
                        <div className="flex flex-wrap items-baseline gap-1.5">
                            <span className="shrink-0 text-muted-foreground">{t('dialogue.practiceGrammar')}</span>
                            <span className="text-foreground/90">{scene.practice.grammarFocus.join(' · ')}</span>
                        </div>
                    )}
                    {scene.practice.replacements.length > 0 && (
                        <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">{t('dialogue.practiceReplacements')}</span>
                            {scene.practice.replacements.map((item) => (
                                <span key={`${item.from}-${item.to}`} className="text-foreground/80">
                                    {item.from} <span className="text-muted-foreground">→</span> {item.to}
                                    {item.note.trim() !== '' && <span className="ml-1 text-muted-foreground">（{item.note}）</span>}
                                </span>
                            ))}
                        </div>
                    )}
                    {scene.practice.extraVocabulary.length > 0 && (
                        <div className="flex flex-wrap items-baseline gap-1.5">
                            <span className="shrink-0 text-muted-foreground">{t('dialogue.practiceExtra')}</span>
                            {scene.practice.extraVocabulary.map((item) => (
                                <span key={item.word} className="text-foreground/90">
                                    {item.word}（{item.zh}）{item.usage.trim() !== '' && ` · ${item.usage}`}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
