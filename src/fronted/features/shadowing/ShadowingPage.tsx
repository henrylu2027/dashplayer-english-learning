import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { BookmarkPlus, Film, Loader2, Mic, Square, X } from 'lucide-react';

import type { ShadowingAttemptSource, ShadowingAttemptSummary } from '@/common/contracts/shadowing';
import PageHeader from '@/fronted/components/shared/common/PageHeader';
import { Button } from '@/fronted/components/ui/button';
import { Textarea } from '@/fronted/components/ui/textarea';
import useFile from '@/fronted/features/file-browser/fileStore';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { srsApi } from '@/fronted/features/srs/srsApi';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import ScorePanel from './components/ScorePanel';
import { SHADOWING_PRESETS } from './presets';
import { buildVideoShadowingSource } from './shadowingSource';
import { useShadowingRecorder } from './useShadowingRecorder';

const logger = getRendererLogger('ShadowingPage');

/**
 * 把秒数格式化为 `分:秒`，用于录音计时展示。
 * @param seconds 已录制秒数。
 */
function formatElapsed(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** 最近跟读记录里分数徽标的配色。 */
function scoreChipTone(score: number): string {
    if (score >= 85) {
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    }
    if (score >= 70) {
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    }
    return 'bg-red-500/10 text-red-500';
}

/**
 * 跟读打分页：从当前视频句或自由文本取一句英文，录下自己的朗读，由本地识别做逐词评测。
 *
 * 录音与评分都留在本机：渲染进程只负责采集，转码、识别、对齐打分全部在主进程完成。
 * 每次评分都会写入跟读记录，绑定视频句子的记录可以直接进入后续的复习与统计。
 */
export default function ShadowingPage() {
    const { t } = useTranslation('pages');
    const currentSentence = usePlayer((s) => s.currentSentence);
    const srtHash = useFile((s) => s.srtHash);
    const videoPath = useFile((s) => s.videoPath);
    const subtitlePath = useFile((s) => s.subtitlePath);

    // 从播放器切过来时直接带上当前句；没有播放上下文则退化为自由输入
    const [referenceText, setReferenceText] = useState(() => currentSentence?.text ?? '');
    const [source, setSource] = useState<ShadowingAttemptSource>(() => (
        currentSentence
            ? buildVideoShadowingSource(currentSentence, videoPath, subtitlePath)
            : { kind: 'free' }
    ));
    const recorder = useShadowingRecorder(referenceText, source);

    const wordCount = referenceText.trim().split(/\s+/).filter(Boolean).length;
    const isRecording = recorder.phase === 'recording';
    const isScoring = recorder.phase === 'scoring';

    const handleMicClick = (): void => {
        if (isRecording) {
            recorder.stop();
            return;
        }
        void recorder.start();
    };

    /** 取播放器当前高亮句：替换文本并绑定视频来源。 */
    const applyCurrentSentence = (): void => {
        if (!currentSentence) {
            toast.error(t('shadowing.noCurrentSentence'));
            return;
        }
        setReferenceText(currentSentence.text);
        setSource(buildVideoShadowingSource(currentSentence, videoPath, subtitlePath));
    };

    /** 把本次评分对应的句子加入间隔复习；同一句重复点击是幂等的。 */
    const handleAddToReview = async (): Promise<void> => {
        const attempt = recorder.lastAttempt;
        const scoredSource = recorder.scoredSource;
        if (!attempt || !scoredSource) {
            toast.error(t('shadowing.addToReviewFailed'));
            return;
        }
        try {
            const response = await srsApi.addCard({
                referenceText: attempt.referenceText,
                source: scoredSource,
            });
            toast.success(response.created ? t('shadowing.addedToReview') : t('shadowing.alreadyInReview'));
        } catch (error) {
            logger.error('加入复习失败', { error });
            toast.error(error instanceof Error ? error.message : t('shadowing.addToReviewFailed'));
        }
    };

    /**
     * 点击历史记录重新练习。
     *
     * 只有与当前视频一致时才带上回放路径，避免把别的视频路径写进这条记录。
     */
    const retryAttempt = (attempt: ShadowingAttemptSummary): void => {
        setReferenceText(attempt.referenceText);
        if (attempt.sourceKind === 'video' && attempt.videoKey && attempt.sentenceIndex !== null) {
            const sameVideo = attempt.videoKey === srtHash;
            setSource({
                kind: 'video',
                videoKey: attempt.videoKey,
                sentenceIndex: attempt.sentenceIndex,
                videoPath: sameVideo ? videoPath ?? undefined : undefined,
                subtitlePath: sameVideo ? subtitlePath ?? undefined : undefined,
            });
            return;
        }
        setSource({ kind: 'free' });
    };

    return (
        <div className="w-full h-full flex flex-col overflow-hidden select-text bg-background text-foreground">
            <div className="px-6 pt-5 pb-2">
                <PageHeader title={t('shadowing.title')} description={t('shadowing.description')} />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-2">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-sm font-medium text-foreground">{t('shadowing.textTitle')}</h2>
                                <p className="mt-0.5 text-xs text-muted-foreground">{t('shadowing.textHint')}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <span className="text-xs tabular-nums text-muted-foreground">
                                    {t('shadowing.wordCount', { words: wordCount })}
                                </span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 rounded-lg px-2.5 text-xs"
                                    disabled={!currentSentence || isScoring}
                                    title={currentSentence ? undefined : t('shadowing.noCurrentSentence')}
                                    onClick={applyCurrentSentence}
                                >
                                    <Film className="mr-1 h-3.5 w-3.5" />
                                    {t('shadowing.useCurrentSentence')}
                                </Button>
                            </div>
                        </div>

                        <Textarea
                            value={referenceText}
                            onChange={(event) => {
                                setReferenceText(event.target.value);
                                // 用户改写文本后，原来的视频句子绑定即失效
                                if (source.kind !== 'free') {
                                    setSource({ kind: 'free' });
                                }
                            }}
                            rows={3}
                            disabled={isScoring}
                            placeholder={t('shadowing.placeholder')}
                            className="mt-3 resize-none select-text rounded-xl bg-background text-sm leading-6"
                        />

                        {source.kind === 'video' && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                                    <Film className="h-3 w-3" />
                                    {t('shadowing.boundToVideo')}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setSource({ kind: 'free' })}
                                    className="inline-flex items-center gap-0.5 transition-colors hover:text-foreground"
                                >
                                    <X className="h-3 w-3" />
                                    {t('shadowing.unbindVideo')}
                                </button>
                            </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">{t('shadowing.presetLabel')}</span>
                            {SHADOWING_PRESETS.map((sentence) => (
                                <button
                                    key={sentence}
                                    type="button"
                                    disabled={isScoring}
                                    onClick={() => {
                                        setReferenceText(sentence);
                                        setSource({ kind: 'free' });
                                    }}
                                    className="rounded-full border border-border/60 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-border hover:bg-muted disabled:opacity-50"
                                >
                                    {sentence}
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="flex flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card p-6 shadow-xs">
                        <button
                            type="button"
                            onClick={handleMicClick}
                            disabled={isScoring}
                            aria-label={isRecording ? t('shadowing.stopRecording') : t('shadowing.startRecording')}
                            className={cn(
                                'relative flex h-20 w-20 items-center justify-center rounded-full transition-all',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                isRecording
                                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                                    : 'bg-primary text-primary-foreground hover:scale-105',
                                isScoring && 'cursor-wait opacity-60',
                            )}
                        >
                            {isRecording && (
                                <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-red-500/20" />
                            )}
                            {isRecording ? (
                                <Square className="h-7 w-7 fill-current" />
                            ) : isScoring ? (
                                <Loader2 className="h-8 w-8 animate-spin" />
                            ) : (
                                <Mic className="h-8 w-8" />
                            )}
                        </button>

                        <div className="h-5 text-sm text-muted-foreground">
                            {isRecording
                                ? t('shadowing.recording', { time: formatElapsed(recorder.elapsedSec) })
                                : isScoring
                                    ? t('shadowing.scoring')
                                    : recorder.hasReferenceText
                                        ? t('shadowing.idle')
                                        : t('shadowing.needText')}
                        </div>
                        {isRecording && (
                            <div className="text-xs text-muted-foreground/80">{t('shadowing.maxDurationHint')}</div>
                        )}
                    </section>

                    {recorder.error && (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                            {recorder.error}
                        </div>
                    )}

                    {recorder.result && <ScorePanel result={recorder.result} />}

                    {recorder.result && (
                        <div className="flex justify-end">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-lg px-3 text-xs"
                                onClick={() => void handleAddToReview()}
                            >
                                <BookmarkPlus className="mr-1 h-3.5 w-3.5" />
                                {t('shadowing.addToReview')}
                            </Button>
                        </div>
                    )}

                    {recorder.attempts.length > 0 && (
                        <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <h2 className="text-sm font-medium text-foreground">{t('shadowing.recentTitle')}</h2>
                                <span className="text-xs text-muted-foreground">{t('shadowing.recentHint')}</span>
                            </div>
                            <div className="mt-3 flex flex-col gap-1">
                                {recorder.attempts.map((attempt) => (
                                    <button
                                        key={attempt.id}
                                        type="button"
                                        onClick={() => retryAttempt(attempt)}
                                        className="flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted/60"
                                    >
                                        <span
                                            className={cn(
                                                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums',
                                                scoreChipTone(attempt.score),
                                            )}
                                        >
                                            {attempt.score}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                            {attempt.referenceText}
                                        </span>
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                            {attempt.sourceKind === 'video'
                                                ? t('shadowing.sourceVideo')
                                                : t('shadowing.sourceFree')}
                                        </span>
                                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                            {new Date(attempt.createdAt).toLocaleString()}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
}
