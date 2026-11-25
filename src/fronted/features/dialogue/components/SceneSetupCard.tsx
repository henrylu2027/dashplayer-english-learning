import { useTranslation } from 'react-i18next';
import { Loader2, Sparkles } from 'lucide-react';

import type {
    DialogueAvailability,
    DialogueDifficulty,
    DialogueModelBackend,
} from '@/common/contracts/dialogue';
import { Button } from '@/fronted/components/ui/button';
import { cn } from '@/fronted/lib/utils';

/** 难度选项。 */
const DIFFICULTIES: DialogueDifficulty[] = ['basic', 'intermediate', 'challenge'];

/**
 * 场景生成前的设置卡：锚点台词、难度与模型后端。
 *
 * @param props.anchorText 当前台词。
 * @param props.availability 两种模型后端的可用性。
 * @param props.difficulty 当前难度。
 * @param props.backend 当前模型后端。
 * @param props.creating 是否正在生成场景。
 * @param props.onDifficultyChange 难度变更。
 * @param props.onBackendChange 后端变更。
 * @param props.onCreate 生成场景。
 */
export default function SceneSetupCard({
    anchorText,
    availability,
    difficulty,
    backend,
    creating,
    onDifficultyChange,
    onBackendChange,
    onCreate,
}: {
    anchorText: string;
    availability: DialogueAvailability | null;
    difficulty: DialogueDifficulty;
    backend: DialogueModelBackend;
    creating: boolean;
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

    return (
        <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div>
                <div className="text-xs text-muted-foreground">{t('dialogue.currentSentence')}</div>
                <p className="mt-1 text-sm leading-6 text-foreground">“{anchorText}”</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('dialogue.anchorHint')}</p>
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
