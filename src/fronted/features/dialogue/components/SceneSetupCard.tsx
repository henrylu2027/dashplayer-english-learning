import { useTranslation } from 'react-i18next';
import { Loader2, Sparkles } from 'lucide-react';

import type {
    DialogueAvailability,
    DialogueDifficulty,
    DialogueModelBackend,
    DialogueScript,
    DialogueSpeaker,
} from '@/common/contracts/dialogue';
import { Button } from '@/fronted/components/ui/button';
import { Input } from '@/fronted/components/ui/input';
import { cn } from '@/fronted/lib/utils';

/** 难度选项。 */
const DIFFICULTIES: DialogueDifficulty[] = ['basic', 'intermediate', 'challenge'];

/** 剧本预览最多显示几行，避免设置卡被撑长。 */
const PREVIEW_LINES = 4;

/**
 * 场景生成前的设置卡：锚点台词、剧本区间、角色名字、难度与模型后端。
 *
 * 说明：角色默认是匿名的「说话人 A/B」，学习者可以改成视频里的真实名字；
 * 字幕文件没有说话人信息，台词归属由前端按顺序交替分配，这里不做自动识别。
 *
 * @param props.anchorText 当前台词。
 * @param props.script 从视频截取的剧本；为空时退回按锚点句生成。
 * @param props.roleAName 说话人 A 的显示名。
 * @param props.roleBName 说话人 B 的显示名。
 * @param props.learnerRole 学习者扮演哪一方。
 * @param props.availability 两种模型后端的可用性。
 * @param props.difficulty 当前难度。
 * @param props.backend 当前模型后端。
 * @param props.creating 是否正在生成场景。
 * @param props.onRoleANameChange 说话人 A 改名。
 * @param props.onRoleBNameChange 说话人 B 改名。
 * @param props.onLearnerRoleChange 切换扮演方。
 * @param props.onDifficultyChange 难度变更。
 * @param props.onBackendChange 后端变更。
 * @param props.onCreate 生成场景。
 */
export default function SceneSetupCard({
    anchorText,
    script,
    roleAName,
    roleBName,
    learnerRole,
    availability,
    difficulty,
    backend,
    creating,
    onRoleANameChange,
    onRoleBNameChange,
    onLearnerRoleChange,
    onDifficultyChange,
    onBackendChange,
    onCreate,
}: {
    anchorText: string;
    script: DialogueScript | null;
    roleAName: string;
    roleBName: string;
    learnerRole: DialogueSpeaker;
    availability: DialogueAvailability | null;
    difficulty: DialogueDifficulty;
    backend: DialogueModelBackend;
    creating: boolean;
    onRoleANameChange: (value: string) => void;
    onRoleBNameChange: (value: string) => void;
    onLearnerRoleChange: (value: DialogueSpeaker) => void;
    onDifficultyChange: (value: DialogueDifficulty) => void;
    onBackendChange: (value: DialogueModelBackend) => void;
    onCreate: () => void;
}) {
    const { t } = useTranslation('pages');
    const selected = availability ? availability[backend] : null;
    const canCreate = Boolean(selected?.available) && !creating;

    const backendOptions: Array<{ value: DialogueModelBackend; label: string; hint: string }> = [
        {
            value: 'local',
            label: t('dialogue.backendLocal'),
            hint: t('dialogue.backendLocalHint'),
        },
        {
            value: 'cloud',
            label: t('dialogue.backendCloud'),
            hint: t('dialogue.backendCloudHint'),
        },
    ];

    // 输入框留空时回落到匿名默认名：剧本和提示词里不能出现空名字
    const displayA = roleAName.trim() || t('dialogue.roleDefault.a');
    const displayB = roleBName.trim() || t('dialogue.roleDefault.b');
    const roleOptions: Array<{ value: DialogueSpeaker; name: string }> = [
        { value: 'a', name: displayA },
        { value: 'b', name: displayB },
    ];

    // 预览只显示锚点句往后的几行：整部台词在右侧轨道里
    const startPosition = script
        ? Math.max(0, script.lines.findIndex((line) => line.index >= script.startIndex))
        : 0;
    const previewLines = script
        ? script.lines.slice(startPosition, startPosition + PREVIEW_LINES)
        : [];
    const remainingLines = script
        ? Math.max(0, script.lines.length - startPosition - PREVIEW_LINES)
        : 0;

    return (
        <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div>
                <div className="text-xs text-muted-foreground">{t('dialogue.currentSentence')}</div>
                <p className="mt-1 text-sm leading-6 text-foreground">“{anchorText}”</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('dialogue.anchorHint')}</p>
            </div>

            {script && (
                <div>
                    <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                        <span className="text-xs text-muted-foreground">{t('dialogue.scriptTitle')}</span>
                        <span className="text-xs text-muted-foreground/80">
                            {t('dialogue.scriptFullRange', {
                                count: script.lines.length,
                                start: script.startIndex,
                            })}
                        </span>
                    </div>
                    <div className="flex flex-col gap-1.5 rounded-xl bg-muted/40 px-3 py-2.5">
                        {previewLines.map((line) => (
                            <div key={line.index} className="flex gap-2 text-xs leading-5">
                                <span className="w-16 shrink-0 truncate text-muted-foreground">
                                    {line.speaker === 'a' ? displayA : displayB}
                                </span>
                                <span className="min-w-0 flex-1 text-foreground/90">{line.en}</span>
                            </div>
                        ))}
                        {remainingLines > 0 && (
                            <div className="text-[11px] text-muted-foreground">
                                {t('dialogue.scriptMore', { count: remainingLines })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div>
                <div className="mb-1.5 text-xs text-muted-foreground">{t('dialogue.roleNames')}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground">A</span>
                        <Input
                            aria-label={t('dialogue.roleDefault.a')}
                            value={roleAName}
                            placeholder={t('dialogue.roleDefault.a')}
                            disabled={creating}
                            maxLength={24}
                            onChange={(event) => onRoleANameChange(event.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground">B</span>
                        <Input
                            aria-label={t('dialogue.roleDefault.b')}
                            value={roleBName}
                            placeholder={t('dialogue.roleDefault.b')}
                            disabled={creating}
                            maxLength={24}
                            onChange={(event) => onRoleBNameChange(event.target.value)}
                        />
                    </div>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{t('dialogue.roleNameHint')}</p>
            </div>

            <div>
                <div className="mb-1.5 text-xs text-muted-foreground">{t('dialogue.learnerRole')}</div>
                <div className="flex gap-1 rounded-xl bg-muted p-1">
                    {roleOptions.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => onLearnerRoleChange(option.value)}
                            disabled={creating}
                            className={cn(
                                'flex-1 truncate rounded-lg px-3 py-1.5 text-sm transition-colors',
                                learnerRole === option.value
                                    ? 'bg-background text-foreground shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {option.name || t(`dialogue.roleDefault.${option.value}`)}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <div className="mb-1.5 text-xs text-muted-foreground">{t('dialogue.difficultyTitle')}</div>
                <div className="flex gap-1 rounded-xl bg-muted p-1">
                    {DIFFICULTIES.map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => onDifficultyChange(value)}
                            disabled={creating}
                            className={cn(
                                'flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors',
                                difficulty === value
                                    ? 'bg-background text-foreground shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {t(`dialogue.difficulty.${value}`)}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <div className="mb-1.5 text-xs text-muted-foreground">{t('dialogue.backend')}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                    {backendOptions.map((option) => {
                        const state = availability ? availability[option.value] : null;
                        const available = state?.available === true;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={!available || creating}
                                onClick={() => onBackendChange(option.value)}
                                className={cn(
                                    'rounded-xl border px-3 py-2.5 text-left transition-colors',
                                    backend === option.value
                                        ? 'border-primary/60 bg-primary/5'
                                        : 'border-border/60 hover:border-border',
                                    !available && 'cursor-not-allowed opacity-50',
                                )}
                            >
                                <div className="text-sm text-foreground">{option.label}</div>
                                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                                    {available ? option.hint : (state?.reason || t('dialogue.backendChecking'))}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-3">
                {!canCreate && availability && !selected?.available && (
                    <span className="mr-auto text-xs text-amber-600 dark:text-amber-400">
                        {t('dialogue.noBackend')}
                    </span>
                )}
                <Button
                    type="button"
                    size="sm"
                    className="h-9 rounded-xl px-4 text-sm"
                    disabled={!canCreate}
                    onClick={onCreate}
                >
                    {creating
                        ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                    {creating ? t('dialogue.creating') : t('dialogue.create')}
                </Button>
            </div>
        </section>
    );
}
