import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2 } from 'lucide-react';

import type { DialogueScene, DialogueTurnHint } from '@/common/contracts/dialogue';

/**
 * 场景卡：设定、双方角色与参考句式。
 *
 * @param props.scene 场景卡。
 * @param props.onSpeak 朗读参考句式。
 * @param props.actions 场景信息区右上角的操作按钮（重置对话、返回列表）。
 * @param props.hint 学习者卡壳时给出的参考句式；只出现在这里，不进入对话气泡。
 */
export default function SceneCardView({
    scene,
    onSpeak,
    actions,
    hint,
}: {
    scene: DialogueScene;
    onSpeak: (text: string) => void;
    actions?: ReactNode;
    hint?: DialogueTurnHint | null;
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
                {hint && (
                    <button
                        type="button"
                        onClick={() => onSpeak(hint.en)}
                        className="mt-2 flex w-full items-start gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-left text-xs text-foreground/90 transition-colors hover:border-amber-500/60"
                    >
                        <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                            {t('dialogue.hintLabel')}
                        </span>
                        <span className="min-w-0">
                            <span>{hint.en}</span>
                            {hint.zh.trim() !== '' && (
                                <span className="ml-1.5 text-muted-foreground">{hint.zh}</span>
                            )}
                        </span>
                        <Volume2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    </button>
                )}
            </div>
        </section>
    );
}
