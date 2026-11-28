import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DialogueScene } from '@/common/contracts/dialogue';
import ScenePracticeView from './ScenePracticeView';

/**
 * 场景卡：设定、双方角色与本课练习点（参考句式已移到右侧栏）。
 *
 * @param props.scene 场景卡。
 * @param props.onSpeak 朗读练习点里的词句。
 * @param props.actions 场景信息区右上角的操作按钮（重置对话、返回列表）。
 * @param props.showPractice 是否在卡内显示练习点；场景对话页改为放到右侧栏。
 */
export default function SceneCardView({
    scene,
    onSpeak,
    actions,
    showPractice = true,
}: {
    scene: DialogueScene;
    onSpeak: (text: string) => void;
    actions?: ReactNode;
    showPractice?: boolean;
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

            {/* 参考句式已移到右侧栏顶部 */}

            {/* 本课练习点：来自场景生成时的核心词句与语法，旧场景没有这一块 */}
            {showPractice && scene.practice && (
                <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                    <ScenePracticeView practice={scene.practice} onSpeak={onSpeak} />
                </div>
            )}
        </section>
    );
}
