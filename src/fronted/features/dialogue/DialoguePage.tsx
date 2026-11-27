import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, MessagesSquare } from 'lucide-react';

import type {
    DialogueAvailability,
    DialogueDetail,
    DialogueDifficulty,
    DialogueFocusLine,
    DialogueModelBackend,
    DialogueReview,
    DialogueScene,
    DialogueScript,
    DialogueSessionSummary,
    DialogueSpeaker,
} from '@/common/contracts/dialogue';
import PageHeader from '@/fronted/components/shared/common/PageHeader';
import { Button } from '@/fronted/components/ui/button';
import useFile from '@/fronted/features/file-browser/fileStore';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { buildVideoShadowingSource } from '@/fronted/features/shadowing/shadowingSource';
import { shadowingApi } from '@/fronted/features/shadowing/shadowingApi';
import { srsApi } from '@/fronted/features/srs/srsApi';
import { getTtsUrl, playAudioUrl } from '@/fronted/infrastructure/audio/AudioPlayer';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { dialogueApi } from './dialogueApi';
import ClipTranscriptRail from './components/ClipTranscriptRail';
import CorrectionCard from './components/CorrectionCard';
import DialogueSessionView from './components/DialogueSessionView';
import HistoryList from './components/HistoryList';
import ReviewPanel from './components/ReviewPanel';
import SceneCardView from './components/SceneCardView';
import SceneSetupCard from './components/SceneSetupCard';
import SpeechScorePanel from './components/SpeechScorePanel';

const logger = getRendererLogger('DialoguePage');

/** 最近对话保留条数；页面上只有这一份列表。 */
const HISTORY_LIMIT = 6;

/** 整部视频的台词上限：超长字幕文件不整段搬运，避免 IPC 与界面过载。 */
const MAX_SCRIPT_LINES = 2000;

/**
 * 场景对话页：从当前台词生成角色扮演场景，语音或文字演完，结束后复盘。
 *
 * 页面不提供自由场景：锚点必须是播放器当前视频句，保证每次对话都能回到具体语境；
 * 模型后端在生成前显式选择，本地与云端不会静默互相顶替。
 */
export default function DialoguePage() {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();
    const currentSentence = usePlayer((state) => state.currentSentence);
    const sentences = usePlayer((state) => state.sentences);
    const videoPath = useFile((state) => state.videoPath);
    const subtitlePath = useFile((state) => state.subtitlePath);
    const videoId = useFile((state) => state.videoId);

    const [availability, setAvailability] = useState<DialogueAvailability | null>(null);
    const [difficulty, setDifficulty] = useState<DialogueDifficulty>('basic');
    const [backend, setBackend] = useState<DialogueModelBackend>('local');
    const [creating, setCreating] = useState(false);
    const [active, setActive] = useState<{
        session: DialogueSessionSummary;
        scene: DialogueScene;
        script: DialogueScript | null;
    } | null>(null);
    const [review, setReview] = useState<DialogueReview | null>(null);
    const [history, setHistory] = useState<DialogueSessionSummary[]>([]);
    const [historyDetail, setHistoryDetail] = useState<DialogueDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** 剧本角色名：默认留空，界面回落到「说话人 A/B」，学习者可改成视频里的名字。 */
    const [roleAName, setRoleAName] = useState('');
    const [roleBName, setRoleBName] = useState('');
    const [learnerRole, setLearnerRole] = useState<DialogueSpeaker>('a');
    /** 右侧原片台词面板是否展开。 */
    const [railOpen, setRailOpen] = useState(true);
    /** 只在首次拿到可用性时选默认后端，之后不覆盖用户的选择。 */
    const backendInitializedRef = useRef(false);

    const refreshHistory = useCallback(async (): Promise<void> => {
        try {
            setHistory(await dialogueApi.list({ limit: HISTORY_LIMIT }));
        } catch (historyError) {
            logger.error('加载对话历史失败', { error: historyError });
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        dialogueApi.availability()
            .then((result) => {
                if (cancelled) {
                    return;
                }
                setAvailability(result);
                if (!backendInitializedRef.current) {
                    backendInitializedRef.current = true;
                    // 本地优先；本地不可用而云端可用时切到云端，并在界面上如实展示
                    setBackend(result.local.available ? 'local' : 'cloud');
                }
            })
            .catch((availabilityError) => {
                logger.error('查询模型可用性失败', { error: availabilityError });
                if (!cancelled) {
                    setError(availabilityError instanceof Error
                        ? availabilityError.message
                        : t('dialogue.availabilityFailed'));
                }
            });
        // 历史加载放在异步回调里：effect 体内不同步 setState，避免级联渲染
        (async () => {
            try {
                const sessions = await dialogueApi.list({ limit: HISTORY_LIMIT });
                if (!cancelled) {
                    setHistory(sessions);
                }
            } catch (historyError) {
                logger.error('加载对话历史失败', { error: historyError });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [refreshHistory, t]);

    /** 当前句及前后各三句，作为场景生成的语境。 */
    const paragraphLines = useMemo(() => {
        if (!currentSentence) {
            return [];
        }
        const ordered = [...sentences].sort((a, b) => a.index - b.index);
        const position = ordered.findIndex((item) => item.index === currentSentence.index);
        if (position < 0) {
            return [currentSentence.text];
        }
        return ordered
            .slice(Math.max(0, position - 3), position + 4)
            .map((item) => item.text);
    }, [currentSentence, sentences]);

    /** 剧本里的角色显示名；留空时用匿名默认值。 */
    const resolvedRoleA = roleAName.trim() || t('dialogue.roleDefault.a');
    const resolvedRoleB = roleBName.trim() || t('dialogue.roleDefault.b');

    /**
     * 把整部视频的台词整理成剧本。
     *
     * 说明：右侧轨道要能从头翻到尾，所以这里取全部字幕；
     * 排练从锚点句（startIndex）开始，之前的台词只作为上下文展示。
     * 字幕文件没有说话人字段，按顺序交替分配 A/B 作为近似，界面上已注明可能不准。
     */
    const script = useMemo<DialogueScript | null>(() => {
        if (!currentSentence) {
            return null;
        }
        const ordered = [...sentences].sort((a, b) => a.index - b.index).slice(0, MAX_SCRIPT_LINES);
        const toScriptLine = (index: number, text: string, zh: string | undefined, speaker: DialogueSpeaker) => ({
            index,
            en: text,
            ...(zh && zh.trim() ? { zh } : {}),
            speaker,
        });
        if (ordered.length === 0) {
            return {
                videoKey: currentSentence.fileHash,
                startIndex: currentSentence.index,
                endIndex: currentSentence.index,
                lines: [toScriptLine(currentSentence.index, currentSentence.text, currentSentence.textZH, 'a')],
                roleAName: resolvedRoleA,
                roleBName: resolvedRoleB,
                learnerRole,
            };
        }
        return {
            videoKey: currentSentence.fileHash,
            startIndex: currentSentence.index,
            endIndex: ordered[ordered.length - 1].index,
            lines: ordered.map((item, offset) => toScriptLine(
                item.index,
                item.text,
                item.textZH,
                offset % 2 === 0 ? 'a' : 'b',
            )),
            roleAName: resolvedRoleA,
            roleBName: resolvedRoleB,
            learnerRole,
        };
    }, [currentSentence, sentences, resolvedRoleA, resolvedRoleB, learnerRole]);

    /**
     * 收集当前视频里学习者练过的台词，作为场景取材。
     *
     * 来源：复习卡（进过复习队列）与跟读记录（练过但没加复习）。
     * 这些句子用户已经反复听过、读过，拿来练口语比让模型凭空设计场景更有效。
     * 不足 3 句时用当前句前后各两句补齐，保证场景有足够的句子可用。
     */
    const collectFocusLines = useCallback(async (): Promise<DialogueFocusLine[]> => {
        if (!currentSentence) {
            return [];
        }
        const videoKey = currentSentence.fileHash;
        const learnedIndexes = new Set<number>();
        try {
            const overview = await srsApi.overview();
            [...overview.dueCards, ...overview.upcomingCards].forEach((card) => {
                if (card.videoKey === videoKey && card.sentenceIndex !== null) {
                    learnedIndexes.add(card.sentenceIndex);
                }
            });
        } catch (cardError) {
            logger.warn('读取复习卡失败，场景取材退化为跟读记录', { error: cardError });
        }
        try {
            // 接口上限 50 条，超过会被主进程拒绝
            const attempts = await shadowingApi.listAttempts({ videoKey, limit: 50 });
            attempts.forEach((attempt) => {
                if (attempt.sentenceIndex !== null) {
                    learnedIndexes.add(attempt.sentenceIndex);
                }
            });
        } catch (attemptError) {
            logger.warn('读取跟读记录失败', { error: attemptError });
        }

        const byIndex = new Map(sentences.map((sentence) => [sentence.index, sentence]));
        const learned = [...learnedIndexes]
            .sort((a, b) => a - b)
            .flatMap((index) => {
                const sentence = byIndex.get(index);
                return sentence
                    ? [{ en: sentence.text, zh: sentence.textZH, sentenceIndex: sentence.index }]
                    : [];
            });

        if (learned.length >= 3) {
            return learned.slice(0, 5);
        }

        // 不足 3 句：用当前句前后各两句补齐，练过的句子仍排在最前
        const ordered = [...sentences].sort((a, b) => a.index - b.index);
        const position = ordered.findIndex((item) => item.index === currentSentence.index);
        const padded = [...learned];
        const used = new Set(padded.map((line) => line.sentenceIndex));
        if (position >= 0) {
            for (const sentence of ordered.slice(Math.max(0, position - 2), position + 3)) {
                if (padded.length >= 3) {
                    break;
                }
                if (used.has(sentence.index)) {
                    continue;
                }
                used.add(sentence.index);
                padded.push({ en: sentence.text, zh: sentence.textZH, sentenceIndex: sentence.index });
            }
        }
        return padded;
    }, [currentSentence, sentences]);

    const speak = useCallback((text: string) => {
        if (!text.trim()) {
            return;
        }
        getTtsUrl(text)
            .then((url) => playAudioUrl(url))
            .catch((speakError) => {
                logger.error('朗读失败', { error: speakError });
            });
    }, []);

    const handleCreate = async (): Promise<void> => {
        if (!currentSentence) {
            return;
        }
        setCreating(true);
        setError(null);
        setReview(null);
        setHistoryDetail(null);
        try {
            // 有剧本时场景围绕真实台词展开，不再去翻练习记录取材
            const focusLines = script ? [] : await collectFocusLines();
            const result = await dialogueApi.create({
                anchorText: currentSentence.text,
                paragraphLines,
                focusLines,
                source: buildVideoShadowingSource(currentSentence, videoPath, subtitlePath),
                ...(script ? { script } : {}),
                difficulty,
                backend,
            });
            setActive({ session: result.session, scene: result.scene, script: result.script });
            await refreshHistory();
        } catch (createError) {
            logger.error('场景生成失败', { error: createError });
            setError(createError instanceof Error ? createError.message : t('dialogue.createFailed'));
        } finally {
            setCreating(false);
        }
    };

    const handleFinished = async (session: DialogueSessionSummary, result: DialogueReview): Promise<void> => {
        setActive(null);
        setReview(result);
        await refreshHistory();
        logger.info('对话复盘完成', { sessionId: session.id });
    };

    const handleOpenHistory = async (sessionId: number): Promise<void> => {
        setDetailLoading(true);
        setHistoryDetail(null);
        try {
            const detail = await dialogueApi.detail(sessionId);
            setHistoryDetail(detail);
            setActive(null);
            setReview(null);
        } catch (detailError) {
            logger.error('读取对话详情失败', { error: detailError });
            toast.error(detailError instanceof Error ? detailError.message : t('dialogue.detailFailed'));
        } finally {
            setDetailLoading(false);
        }
    };

    const resetToSetup = (): void => {
        setActive(null);
        setReview(null);
        setHistoryDetail(null);
        setError(null);
    };

    const renderMain = () => {
        if (historyDetail) {
            const detail = historyDetail;
            return (
                <div className={cn(
                    'grid min-h-0 gap-4',
                    detail.script && railOpen && 'lg:grid-cols-[minmax(0,1fr)_320px]',
                )}>
                    <div className="flex min-w-0 flex-col gap-4">
                    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-xs">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">{historyDetail.session.title}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                                {new Date(historyDetail.session.createdAt).toLocaleString()}
                                {' · '}
                                {t('dialogue.historyTurns', { count: historyDetail.session.turnCount })}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            {detail.script && !railOpen && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 rounded-lg px-2 text-xs"
                                    onClick={() => setRailOpen(true)}
                                >
                                    {t('dialogue.railShow')}
                                </Button>
                            )}
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-lg px-3 text-xs"
                                onClick={resetToSetup}
                            >
                                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                                {t('dialogue.back')}
                            </Button>
                        </div>
                    </section>
                    <SceneCardView scene={historyDetail.scene} onSpeak={speak} />
                    <section className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                        {historyDetail.turns.map((turn) => (
                            <div key={turn.id} className={cn('flex flex-col', turn.role === 'user' ? 'items-end' : 'items-start')}>
                                <div className="mb-0.5 text-[11px] text-muted-foreground">
                                    {turn.role === 'user' ? t('dialogue.userLabel') : t('dialogue.aiLabel')}
                                </div>
                                <div
                                    className={cn(
                                        'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6',
                                        turn.role === 'user'
                                            ? 'rounded-tr-sm bg-primary text-primary-foreground'
                                            : 'rounded-tl-sm bg-muted/70 text-foreground',
                                    )}
                                >
                                    {turn.content}
                                </div>
                                {turn.role === 'user' && turn.correction && (
                                    <div className="flex w-full justify-end">
                                        <CorrectionCard correction={turn.correction} pending={false} />
                                    </div>
                                )}
                                {turn.role === 'user' && turn.evaluation && (
                                    <div className="mt-1 flex w-full justify-end">
                                        <div className="max-w-[85%] rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-[11px] leading-5">
                                            <div className="text-muted-foreground">
                                                {t('dialogue.scoreOverall')} {turn.evaluation.overall}
                                                {' · '}
                                                {turn.evaluation.commentZh}
                                            </div>
                                            {turn.evaluation.problems.map((problem) => (
                                                <div key={`${problem.kind}-${problem.original}`} className="mt-0.5">
                                                    <span className="text-foreground/70 line-through">{problem.original}</span>
                                                    <span className="mx-1 text-muted-foreground">→</span>
                                                    <span className="text-foreground">{problem.better}</span>
                                                    <span className="ml-1 text-muted-foreground">{problem.whyZh}</span>
                                                </div>
                                            ))}
                                            {turn.evaluation.vocab.length > 0 && (
                                                <div className="mt-0.5 text-muted-foreground">
                                                    {t('dialogue.evalVocab')}：{turn.evaluation.vocab.join('、')}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </section>
                    {historyDetail.review ? (
                        <ReviewPanel review={historyDetail.review} onSpeak={speak} onRestart={resetToSetup} />
                    ) : (
                        <section className="rounded-2xl border border-dashed border-border/60 px-4 py-5 text-center text-xs text-muted-foreground">
                            {t('dialogue.unfinished')}
                        </section>
                    )}
                    </div>
                    {detail.script && railOpen && (
                        <div className="min-h-0 lg:sticky lg:top-0 lg:h-[calc(100vh-150px)]">
                            <ClipTranscriptRail
                                script={detail.script}
                                focusIndex={detail.turns.filter((turn) => turn.role === 'user').length}
                                onCollapse={() => setRailOpen(false)}
                            />
                        </div>
                    )}
                </div>
            );
        }
        if (review) {
            return <ReviewPanel review={review} onSpeak={speak} onRestart={resetToSetup} />;
        }
        if (active) {
            return (
                <DialogueSessionView
                    key={active.session.id}
                    session={active.session}
                    scene={active.scene}
                    script={active.script}
                    scenes={history}
                    onFinished={(session, result) => {
                        void handleFinished(session, result);
                    }}
                    onSpeak={speak}
                    onBack={() => setActive(null)}
                    onOpenHistory={(id) => void handleOpenHistory(id)}
                />
            );
        }
        if (!currentSentence) {
            return (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-card px-6 py-14 text-center shadow-xs">
                        <MessagesSquare className="h-8 w-8 text-muted-foreground/40" />
                        <h3 className="text-base font-medium text-foreground/80">{t('dialogue.noSentenceTitle')}</h3>
                        <p className="max-w-sm text-xs leading-5 text-muted-foreground">{t('dialogue.noSentenceGuide')}</p>
                        <Button
                            type="button"
                            size="sm"
                            className="mt-1 h-8 rounded-lg px-3 text-xs"
                            onClick={() => navigate(videoId ? `/player/${videoId}?sideBarAnimation=false` : '/home')}
                        >
                            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                            {t('dialogue.goPlayer')}
                        </Button>
                    </div>
                    <SpeechScorePanel
                        result={null}
                        pending={false}
                        disabled
                        savingWords={false}
                        onAddWords={() => undefined}
                        onRetry={() => undefined}
                        onContinue={() => undefined}
                    />
                </div>
            );
        }
        return (
            <div className={cn(
                'grid min-h-0 gap-4',
                script && railOpen && 'lg:grid-cols-[minmax(0,1fr)_320px]',
            )}>
                <div className="flex min-w-0 flex-col gap-4">
                {script && !railOpen && (
                    <div className="flex justify-end">
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 rounded-lg px-2 text-xs"
                            onClick={() => setRailOpen(true)}
                        >
                            {t('dialogue.railShow')}
                        </Button>
                    </div>
                )}
                {error && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                        {error}
                    </div>
                )}
                <SceneSetupCard
                    anchorText={currentSentence.text}
                    script={script}
                    roleAName={roleAName}
                    roleBName={roleBName}
                    learnerRole={learnerRole}
                    availability={availability}
                    difficulty={difficulty}
                    backend={backend}
                    creating={creating}
                    onRoleANameChange={setRoleAName}
                    onRoleBNameChange={setRoleBName}
                    onLearnerRoleChange={setLearnerRole}
                    onDifficultyChange={setDifficulty}
                    onBackendChange={setBackend}
                    onCreate={() => void handleCreate()}
                />
                </div>
                {script && railOpen && (
                    <div className="min-h-0 lg:sticky lg:top-0 lg:h-[calc(100vh-150px)]">
                        <ClipTranscriptRail
                            script={script}
                            focusIndex={0}
                            onCollapse={() => setRailOpen(false)}
                        />
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="w-full h-full flex flex-col overflow-hidden select-none bg-background text-foreground">
            <div className="px-6 pt-5 pb-2">
                <PageHeader title={t('dialogue.title')} description={t('dialogue.description')} />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-2">
                <div className={cn(
                    'mx-auto flex w-full flex-col gap-4',
                    (active || historyDetail) ? 'max-w-6xl' : 'max-w-4xl',
                )}>
                    {detailLoading && (
                        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card px-4 py-8 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t('dialogue.detailLoading')}
                        </div>
                    )}
                    {renderMain()}
                    <HistoryList sessions={history} onOpen={(id) => void handleOpenHistory(id)} />
                </div>
            </div>
        </div>
    );
}
