import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PencilLine } from 'lucide-react';

import type { PracticeAttemptSummary, PracticeMode } from '@/common/contracts/practice';
import PageHeader from '@/fronted/components/shared/common/PageHeader';
import { Button } from '@/fronted/components/ui/button';
import useFile from '@/fronted/features/file-browser/fileStore';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { buildVideoShadowingSource } from '@/fronted/features/shadowing/shadowingSource';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import DictationPanel from './components/DictationPanel';
import RetellPanel from './components/RetellPanel';
import { practiceApi } from './practiceApi';

const logger = getRendererLogger('PracticePage');

/** 最近练习记录条数。 */
const RECENT_ATTEMPT_LIMIT = 5;

/** 练习模式标签。 */
const MODE_LABELS: Record<PracticeMode, string> = {
    dictation: 'practice.modeDictation',
    retell: 'practice.modeRetell',
};

/**
 * 精听练习页：听写与复述共用播放器当前高亮句，两种模式完成的是“听 → 写/说”的输出练习。
 *
 * 页面不提供自由文本：听写必须有原声，复述也需要原句作参照；句子统一来自播放器，
 * 保证每次练习都能回到具体视频语境。
 */
export default function PracticePage() {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();
    const currentSentence = usePlayer((s) => s.currentSentence);
    const videoPath = useFile((s) => s.videoPath);
    const subtitlePath = useFile((s) => s.subtitlePath);
    const videoId = useFile((s) => s.videoId);

    const [mode, setMode] = useState<PracticeMode>('dictation');
    const [history, setHistory] = useState<PracticeAttemptSummary[]>([]);
    const [historyError, setHistoryError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const recent = await practiceApi.listAttempts({ limit: RECENT_ATTEMPT_LIMIT });
                if (!cancelled) {
                    setHistory(recent);
                }
            } catch (error) {
                logger.error('加载练习记录失败', { error });
                if (!cancelled) {
                    setHistoryError(t('practice.historyFailed'));
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [t]);

    if (!currentSentence) {
        return (
            <div className="w-full h-full flex flex-col overflow-hidden select-none bg-background text-foreground">
                <div className="px-6 pt-5 pb-2">
                    <PageHeader title={t('practice.title')} description={t('practice.description')} />
                </div>
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-10 text-center">
                    <PencilLine className="h-8 w-8 text-muted-foreground/40" />
                    <h3 className="text-base font-medium text-foreground/80">{t('practice.noSentenceTitle')}</h3>
                    <p className="max-w-sm text-xs leading-5 text-muted-foreground">{t('practice.noSentenceGuide')}</p>
                    <Button
                        type="button"
                        size="sm"
                        className="mt-1 h-8 rounded-lg px-3 text-xs"
                        onClick={() => navigate(videoId ? `/player/${videoId}?sideBarAnimation=false` : '/home')}
                    >
                        <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                        {t('practice.goPlayer')}
                    </Button>
                </div>
            </div>
        );
    }

    const source = buildVideoShadowingSource(currentSentence, videoPath, subtitlePath);
    const canPlayAudio = Boolean(videoPath && subtitlePath);
    const videoName = videoPath?.split(/[\\/]/).pop() ?? '';

    const handleSaved = (attempt: PracticeAttemptSummary): void => {
        setHistory((prev) => [
            attempt,
            ...prev.filter((item) => item.id !== attempt.id),
        ].slice(0, RECENT_ATTEMPT_LIMIT));
    };

    return (
        <div className="w-full h-full flex flex-col overflow-hidden select-none bg-background text-foreground">
            <div className="px-6 pt-5 pb-2">
                <PageHeader title={t('practice.title')} description={t('practice.description')} />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-2">
                <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
                    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-xs">
                        <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">{t('practice.currentSentence')}</div>
                            <div className="mt-0.5 truncate text-sm text-foreground">
                                {videoName
                                    ? t('practice.currentVideo', { name: videoName })
                                    : t('practice.boundVideo')}
                            </div>
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 shrink-0 rounded-lg px-3 text-xs"
                            disabled={!videoId}
                            onClick={() => navigate(videoId ? `/player/${videoId}?sideBarAnimation=false` : '/')}
                        >
                            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                            {t('practice.backToPlayer')}
                        </Button>
                    </section>

                    <div className="flex gap-1 rounded-xl bg-muted p-1">
                        {(['dictation', 'retell'] as const).map((item) => (
                            <button
                                key={item}
                                type="button"
                                onClick={() => setMode(item)}
                                className={cn(
                                    'flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors',
                                    mode === item
                                        ? 'bg-background text-foreground shadow-xs'
                                        : 'text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {t(MODE_LABELS[item])}
                            </button>
                        ))}
                    </div>

                    {mode === 'dictation' ? (
                        <DictationPanel
                            key="dictation"
                            referenceText={currentSentence.text}
                            source={source}
                            canPlayAudio={canPlayAudio}
                            onSaved={handleSaved}
                        />
                    ) : (
                        <RetellPanel
                            key="retell"
                            referenceText={currentSentence.text}
                            source={source}
                            canPlayAudio={canPlayAudio}
                            onSaved={handleSaved}
                        />
                    )}

                    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                        <div className="flex items-baseline justify-between">
                            <h2 className="text-sm font-medium text-foreground">{t('practice.historyTitle')}</h2>
                            <span className="text-xs text-muted-foreground">{t('practice.historyHint')}</span>
                        </div>
                        {historyError && (
                            <div className="mt-2 text-xs text-red-500">{historyError}</div>
                        )}
                        {history.length === 0 ? (
                            <div className="mt-3 rounded-xl bg-muted/50 px-4 py-6 text-center text-xs text-muted-foreground">
                                {t('practice.historyEmpty')}
                            </div>
                        ) : (
                            <div className="mt-2 flex flex-col gap-1">
                                {history.map((attempt) => (
                                    <div key={attempt.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                                        <span
                                            className={cn(
                                                'shrink-0 rounded-md px-1.5 py-0.5 text-[10px]',
                                                attempt.mode === 'dictation'
                                                    ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                                    : 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
                                            )}
                                        >
                                            {t(MODE_LABELS[attempt.mode])}
                                        </span>
                                        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                                            {attempt.score}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-sm text-foreground/80">
                                            {attempt.referenceText === currentSentence.text
                                                ? t('practice.currentSentenceRecord')
                                                : attempt.referenceText}
                                        </span>
                                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                            {new Date(attempt.createdAt).toLocaleString()}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
