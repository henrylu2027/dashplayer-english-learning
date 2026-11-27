import { useTranslation } from 'react-i18next';
import { Loader2, Sparkles } from 'lucide-react';

import type {
    DialogueAvailability,
    DialogueDifficulty,
    DialogueModelBackend,
    DialogueSceneMode,
    DialogueScript,
} from '@/common/contracts/dialogue';
import { DIALOGUE_DIFFICULTIES } from '@/common/contracts/dialogue';
import { Button } from '@/fronted/components/ui/button';
import { Input } from '@/fronted/components/ui/input';
import { cn } from '@/fronted/lib/utils';

/** 剧本预览最多显示几行，避免设置卡被撑长。 */
const PREVIEW_LINES = 4;

/**
 * 场景生成前的设置卡：模式、锚点台词或主题、角色名字、难度与模型后端。
 *
 * @param props.mode 场景生成模式：跟随视频剧情或自编主题。
 * @param props.topic 自编模式的主题关键词。
 * @param props.anchorText 当前台词；视频模式使用。
 * @param props.script 从视频截取的剧本；为空时不显示预览。
 * @param props.roleAName 说话人 A 的显示名。
 * @param props.roleBName 说话人 B 的显示名。
 * @param props.availability 两种模型后端的可用性。
 * @param props.difficulty 当前难度。
 * @param props.backend 当前模型后端。
 * @param props.creating 是否正在生成场景。
 * @param props.onModeChange 切换模式。
 * @param props.onTopicChange 修改主题。
 * @param props.onRoleANameChange 说话人 A 改名。
 * @param props.onRoleBNameChange 说话人 B 改名。
 * @param props.onDifficultyChange 难度变更。
 * @param props.onBackendChange 后端变更。
 * @param props.onCreate 生成场景。
 */
export default function SceneSetupCard({
    mode,
    topic,
    anchorText,
    script,
    roleAName,
    roleBName,
    availability,
    difficulty,
    backend,
    creating,
    onModeChange,
    onTopicChange,
    onRoleANameChange,
    onRoleBNameChange,
    onDifficultyChange,
    onBackendChange,
    onCreate,
}: {
    mode: DialogueSceneMode;
    topic: string;
    anchorText: string;
    script: DialogueScript | null;
    roleAName: string;
    roleBName: string;
    availability: DialogueAvailability | null;
    difficulty: DialogueDifficulty;
    backend: DialogueModelBackend;
    creating: boolean;
    onModeChange: (value: DialogueSceneMode) => void;
    onTopicChange: (value: string) => void;
    onRoleANameChange: (value: string) => void;
    onRoleBNameChange: (value: string) => void;
    onDifficultyChange: (value: DialogueDifficulty) => void;
    onBackendChange: (value: DialogueModelBackend) => void;
    onCreate: () => void;
}) {
    const { t } = useTranslation('pages');
    const selected = availability ? availability[backend] : null;
    const canCreate = Boolean(selected?.available)
        && !creating
        && (mode === 'custom' ? topic.trim().length >= 2 : anchorText.trim().length > 0);

    const displayA = roleAName.trim() || t('dialogue.roleDefault.a');
    const displayB = roleBName.trim() || t('dialogue.roleDefault.b');

    // 预览只显示锚点句往后的几行：整部台词在右侧轨道里
    const startPosition = script
        ? Math.max(0, script.lines.findIndex((line) => line.index >= script.startIndex))
        : 0;
    const previewLines = script ? script.lines.slice(startPosition, startPosition + PREVIEW_LINES) : [];
    const remainingLines = script ? Math.max(0, script.lines.length - startPosition - PREVIEW_LINES) : 0;

    return (
        <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div>
                <div className="mb-1.5 text-xs text-muted-foreground">{t('dialogue.modeTitle')}</div>
                <div className="flex gap-1 rounded-xl bg-muted p-1">
                    {(['video', 'custom'] as const).map((value) => (
                        <button
                            key={value}
                            type="button"
                            disabled={creating}
                            onClick={() => onModeChange(value)}
                            className={cn(
                                'flex-1 truncate rounded-lg px-3 py-1.5 text-sm transition-colors',
                                mode === value
                                    ? 'bg-background text-foreground shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {t(`dialogue.sceneMode.${value}`)}
                        </button>
                    ))}
                </div>
            </div>

            {mode === 'video' ? (
                <>
                    <div>
                        <div className="text-xs text-muted-foreground">{t('dialogue.currentSentence')}</div>
                        <p className="mt-1 text-sm leading-6 text-foreground">
                            {anchorText ? `“${anchorText}”` : t('dialogue.noSentenceShort')}
                        </p>
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
                </>
            ) : (
                <div>
                    <div className="mb-1.5 text-xs text-muted-foreground">{t('dialogue.topicTitle')}</div>
                    <Input
                        value={topic}
                        placeholder={t('dialogue.topicPlaceholder')}
                        disabled={creating}
                        maxLength={60}
                        onChange={(event) => onTopicChange(event.target.value)}
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">{t('dialogue.topicHint')}</p>
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
                <div className="mb-1.5 text-xs text-muted-foreground">{t('dialogue.difficultyTitle')}</div>
                <div className="flex gap-1 rounded-xl bg-muted p-1">
                    {DIALOGUE_DIFFICULTIES.map((value) => (
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
                    {(['local', 'cloud'] as const).map((value) => {
                        const state = availability ? availability[value] : null;
                        const available = state?.available === true;
                        return (
                            <button
                                key={value}
                                type="button"
                                disabled={!available || creating}
                                onClick={() => onBackendChange(value)}
                                className={cn(
                                    'rounded-xl border px-3 py-2.5 text-left transition-colors',
                                    backend === value
                                        ? 'border-primary/60 bg-primary/5'
                                        : 'border-border/60 hover:border-border',
                                    !available && 'cursor-not-allowed opacity-50',
                                )}
                            >
                                <div className="text-sm text-foreground">
                                    {value === 'local' ? t('dialogue.backendLocal') : t('dialogue.backendCloud')}
                                </div>
                                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                                    {available
                                        ? (value === 'local' ? t('dialogue.backendLocalHint') : t('dialogue.backendCloudHint'))
                                        : (state?.reason || t('dialogue.backendChecking'))}
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
