import React, { useMemo, useRef, useState } from 'react';
import { Input } from '@/fronted/components/ui/input';
import { Button } from '@/fronted/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/fronted/components/ui/select';
import { Search, Upload, Download, List, LocateFixed, Pencil, ArrowUpDown, Repeat, CheckCircle2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/fronted/lib/utils';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import ConfirmDeleteButton from '@/fronted/components/shared/common/ConfirmDeleteButton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/fronted/components/ui/tooltip';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import TimeUtil from '@/common/utils/TimeUtil';
import { useTranslation } from 'react-i18next';
import type { WordOrigin } from '@/common/contracts/vocabulary';

export interface WordItem {
  id: number;
  word: string;
  translate: string;
  created_at: string;
  updated_at: string;
  videoCount?: number;
  /** 最近一次被添加视频（生成关联片段）的时间；没有关联片段时为 null。 */
  lastClipAddedAt?: string | null;
  /** 学会时间，epoch 毫秒；未学会为 null。 */
  learnedAt?: number | null;
  /** 最近一条出处；没有出处为 null。 */
  origin?: WordOrigin | null;
}

/** 单词列表排序方式。 */
type SortMode = 'usage' | 'alphabetical' | 'recentVideo';

/** 单词列表筛选方式：全部 / 未学 / 已学。 */
export type LearnFilter = 'all' | 'unlearned' | 'learned';

/** 出处模块的展示文案翻译键。 */
const ORIGIN_MODULE_LABEL: Record<string, string> = {
  player: 'originModule.player',
  original: 'originModule.original',
  practice: 'originModule.practice',
  dialogue: 'originModule.dialogue',
  vocabulary: 'originModule.vocabulary',
};

type Props = {
  words: WordItem[];
  loading: boolean;
  selectedWord: WordItem | null;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onWordClick: (word: WordItem) => void;
  onClearSelection: () => void;
  onExportTemplate: () => void;
  onImportWords: (filePath: string) => void;
  /** 请求编辑某个单词，由页面负责打开编辑弹窗。 */
  onEditWord: (word: WordItem) => void;
  /** 某个单词删除成功后的回调。 */
  onWordDeleted: (word: WordItem) => void;
  /** 初始筛选；从学习台带参数进来时直接落到对应视图。 */
  initialLearnFilter?: LearnFilter;
};

export default function WordSidebar({
  words,
  loading,
  selectedWord,
  searchTerm,
  onSearchChange,
  onWordClick,
  onClearSelection,
  onExportTemplate,
  onImportWords,
  onEditWord,
  onWordDeleted,
  initialLearnFilter = 'all',
}: Props) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { t } = useTranslation('common');
  const [sortMode, setSortMode] = useState<SortMode>('usage');
  /** 未学/已学筛选。 */
  const [learnFilter, setLearnFilter] = useState<LearnFilter>(initialLearnFilter);
  /** 本次会话里刚点了「学会了」的词，先本地生效，等下次拉取再以数据库为准。 */
  const [learnedAtById, setLearnedAtById] = useState<Record<number, number>>({});
  // 正在执行删除请求的单词 id，用于按钮转圈与防重复提交
  const [deletingId, setDeletingId] = useState<number | null>(null);
  /** 正在提交「学会了」的词 id。 */
  const [learningId, setLearningId] = useState<number | null>(null);
  /** 正在把生词批量加入间隔复习。 */
  const [addingToReview, setAddingToReview] = useState(false);

  /** 取词条的学会时间：本会话刚点过的优先。 */
  const learnedAtOf = (word: WordItem): number | null => learnedAtById[word.id] ?? word.learnedAt ?? null;

  const displayedWords = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const filtered = words.filter((word) => {
      const learnedAt = learnedAtById[word.id] ?? word.learnedAt ?? null;
      if (learnFilter === 'learned' && !learnedAt) {
        return false;
      }
      if (learnFilter === 'unlearned' && learnedAt) {
        return false;
      }
      return !term
        || word.word.toLowerCase().includes(term)
        || word.translate?.toLowerCase().includes(term);
    });

    const sorted = [...filtered];
    if (sortMode === 'alphabetical') {
      sorted.sort((a, b) => a.word.localeCompare(b.word));
    } else if (sortMode === 'recentVideo') {
      sorted.sort((a, b) => {
        const aAt = a.lastClipAddedAt ?? '';
        const bAt = b.lastClipAddedAt ?? '';
        // 没有关联片段的单词沉底
        if (!aAt && !bAt) return a.word.localeCompare(b.word);
        if (!aAt) return 1;
        if (!bAt) return -1;
        const diff = bAt.localeCompare(aAt);
        return diff !== 0 ? diff : a.word.localeCompare(b.word);
      });
    } else {
      sorted.sort((a, b) => {
        const diff = (b.videoCount || 0) - (a.videoCount || 0);
        return diff !== 0 ? diff : a.word.localeCompare(b.word);
      });
    }
    return sorted;
  }, [words, searchTerm, sortMode, learnFilter, learnedAtById]);

  const handleImportClick = async () => {
    const selectedFiles = await videoLearningApi.selectVocabularyFile();
    const filePath = selectedFiles?.[0];
    if (!filePath) {
      return;
    }
    onImportWords(filePath);
  };

  const handleShowAll = () => {
    onClearSelection();
  };

  const handleLocateCurrent = () => {
    if (!selectedWord) return;
    const targetIndex = displayedWords.findIndex((word) => word.id === selectedWord.id);
    if (targetIndex >= 0) {
      virtuosoRef.current?.scrollToIndex({ index: targetIndex, align: 'center', behavior: 'smooth' });
    }
  };

  /**
   * 批量加入复习：选中的词优先，没有选中就推当前列表里的全部词。
   *
   * 与单词行的「学会了」走同一接口：有出处就以出处句做语境卡，没有出处才退化成词卡；
   * 重复提交是幂等的。
   */
  const handleAddToReview = async () => {
    const targets = selectedWord ? [selectedWord] : displayedWords;
    if (targets.length === 0) {
      toast.error(t('wordReviewEmpty'));
      return;
    }
    setAddingToReview(true);
    let added = 0;
    let queued = 0;
    let noSource = 0;
    let failed = 0;
    try {
      for (const word of targets) {
        const response = await videoLearningApi.learnWord(word.word);
        if (!response.success) {
          failed += 1;
          continue;
        }
        setLearnedAtById((previous) => ({ ...previous, [word.id]: Date.now() }));
        if (response.data?.srsRejected) {
          noSource += 1;
        } else if (response.data?.queued) {
          queued += 1;
        } else {
          added += 1;
        }
      }
      if (failed > 0) {
        toast.error(t('wordLearnPartialFailed', { failed }));
      }
      if (noSource > 0) {
        toast.error(t('wordLearnNoSourceBatch', { count: noSource }));
      }
      if (added + queued > 0) {
        toast.success(t('wordLearnBatchDone', { added, queued }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('wordLearnFailed'));
    } finally {
      setAddingToReview(false);
    }
  };

  /** 单词行上的「学会了」：建语境卡入池并标记已学。 */
  const handleLearn = async (word: WordItem) => {
    if (learningId !== null || learnedAtOf(word)) {
      return;
    }
    setLearningId(word.id);
    try {
      const response = await videoLearningApi.learnWord(word.word);
      if (!response.success) {
        toast.error(response.error || t('wordLearnFailed'));
        return;
      }
      setLearnedAtById((previous) => ({ ...previous, [word.id]: Date.now() }));
      if (response.data?.srsRejected) {
        toast.success(t('wordLearnedNoReview'));
      } else if (response.data?.queued) {
        toast.success(t('wordLearnQueued'));
      } else {
        toast.success(response.data?.hasContext ? t('wordLearnedWithContext') : t('wordLearnedNoContext'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('wordLearnFailed'));
    } finally {
      setLearningId(null);
    }
  };

  /** 删除确认后调用后端删除并回调页面刷新。 */
  const handleDeleteConfirmed = async (word: WordItem) => {
    setDeletingId(word.id);
    try {
      const result = await videoLearningApi.deleteWord(word.word);
      if (result.success) {
        onWordDeleted(word);
      } else {
        toast.error(result.error || t('wordDeleteFailed'));
      }
    } catch {
      toast.error(t('wordDeleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 顶部工具栏 */}
      <div className="pb-3 space-y-2.5 shrink-0 border-b border-border/40">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            className="pl-9 h-9 text-xs rounded-xl bg-muted/30 focus-visible:bg-background border-border/50 transition-colors"
            placeholder={t('wordSearch')}
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <TooltipProvider>
          <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground pt-0.5">
            <div className="text-xs font-medium text-muted-foreground tabular-nums">
              {t('wordCount', { count: words.length })}
              {(searchTerm || learnFilter !== 'all') && (
                <span className="ml-1.5 text-primary">({t('foundWords', { count: displayedWords.length })})</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Select value={learnFilter} onValueChange={(value) => setLearnFilter(value as LearnFilter)}>
                <SelectTrigger
                  className="h-7 w-auto gap-1 rounded-lg px-2 text-xs text-muted-foreground"
                  aria-label={t('learnFilter')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('learnFilterAll')}</SelectItem>
                  <SelectItem value="unlearned">{t('learnFilterUnlearned')}</SelectItem>
                  <SelectItem value="learned">{t('learnFilterLearned')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
                <SelectTrigger
                  className="h-7 w-auto gap-1 rounded-lg px-2 text-xs text-muted-foreground"
                  aria-label={t('sortMode')}
                >
                  <ArrowUpDown className="w-3 h-3" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="usage">{t('sortByUsage')}</SelectItem>
                  <SelectItem value="alphabetical">{t('sortAlphabetical')}</SelectItem>
                  <SelectItem value="recentVideo">{t('sortByRecentVideo')}</SelectItem>
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                    aria-label={t('wordReviewAdd')}
                    type="button"
                    disabled={addingToReview}
                    onClick={() => void handleAddToReview()}
                  >
                    <Repeat className={`w-3.5 h-3.5 ${addingToReview ? 'animate-spin' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('wordReviewAdd')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                    aria-label={t('exportTemplate')}
                    type="button"
                    onClick={onExportTemplate}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('exportTemplate')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                    aria-label={t('importExcel')}
                    type="button"
                    onClick={handleImportClick}
                  >
                    <Upload className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('importExcel')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={selectedWord ? 'ghost' : 'secondary'}
                    size="icon"
                    className="h-7 w-7 rounded-lg"
                    aria-label={t('showAllVideos')}
                    type="button"
                    onClick={handleShowAll}
                  >
                    <List className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('showAllVideos')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                    aria-label={t('locateCurrentWord')}
                    type="button"
                    onClick={handleLocateCurrent}
                    disabled={!selectedWord}
                  >
                    <LocateFixed className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('locateCurrentWord')}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </TooltipProvider>
      </div>

      {/* 列表区域：使用虚拟列表，占满剩余高度 */}
      <div className="flex-1 min-h-0 pt-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-primary border-t-transparent"></div>
              {t('loading')}
            </div>
          </div>
        ) : displayedWords.length === 0 ? (
          <div className="text-center text-muted-foreground py-10 text-xs">
            {searchTerm ? t('noMatchingWords') : t('noVocabulary')}
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%' }}
            className="scrollbar-thin"
            data={displayedWords}
            increaseViewportBy={200}
            itemContent={(index, word) => {
              const active = selectedWord?.id === word.id;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  className={[
                    'group px-3 py-2 rounded-xl cursor-pointer transition-all text-xs mb-1.5 flex flex-col gap-0.5',
                    active
                      ? 'bg-primary text-primary-foreground font-medium shadow-2xs'
                      : 'hover:bg-muted/60 text-foreground'
                  ].join(' ')}
                  onClick={() => onWordClick(word)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onWordClick(word);
                    }
                  }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="font-semibold text-sm tracking-tight truncate">{word.word}</div>
                    <div className="flex items-center gap-0.5 shrink-0 ml-auto">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleLearn(word);
                        }}
                        disabled={learningId === word.id || Boolean(learnedAtOf(word))}
                        className={cn(
                          'p-1 rounded-md transition-all cursor-pointer shrink-0 disabled:cursor-default',
                          learnedAtOf(word)
                            ? 'text-emerald-500'
                            : active
                              ? 'text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/80 opacity-0 group-hover:opacity-100'
                        )}
                        title={learnedAtOf(word) ? t('wordLearned') : t('wordLearn')}
                      >
                        {learningId === word.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <CheckCircle2 className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditWord(word);
                        }}
                        className={cn(
                          'p-1 rounded-md transition-all cursor-pointer shrink-0',
                          active
                            ? 'text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/80 opacity-0 group-hover:opacity-100'
                        )}
                        title={t('editWord')}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <ConfirmDeleteButton
                        title={t('deleteWord')}
                        confirmLabel={t('confirmDelete')}
                        deleting={deletingId === word.id}
                        onConfirm={() => handleDeleteConfirmed(word)}
                        triggerClassName={
                          active
                            ? 'text-primary-foreground/70 hover:text-primary-foreground'
                            : 'opacity-0 group-hover:opacity-100'
                        }
                      />
                      {!!word.videoCount && word.videoCount > 0 && (
                        <div
                          className={[
                            'text-[11px] px-1.5 py-0.5 rounded-md font-medium shrink-0 tabular-nums',
                            active
                              ? 'bg-primary-foreground/20 text-primary-foreground'
                              : 'bg-muted text-muted-foreground'
                          ].join(' ')}
                        >
                          {t('videoCount', { count: word.videoCount })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={['flex items-center gap-1.5 text-xs', active ? 'text-primary-foreground/80' : 'text-muted-foreground'].join(' ')}>
                    <span className="truncate">{word.translate || t('noDefinition')}</span>
                    {learnedAtOf(word) && (
                      <span
                        className={[
                          'shrink-0 text-[10px] px-1.5 py-0.5 rounded-md font-medium',
                          active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        ].join(' ')}
                        title={t('wordLearned')}
                      >
                        {t('wordLearnedChip')}
                      </span>
                    )}
                    {word.lastClipAddedAt && (
                      <span
                        className={[
                          'shrink-0 text-[10px] tabular-nums',
                          active ? 'text-primary-foreground/60' : 'text-muted-foreground/80'
                        ].join(' ')}
                        title={t('sortByRecentVideo')}
                      >
                        {t('videoAddedAt', { time: TimeUtil.dateToRelativeTime(TimeUtil.isoToDate(word.lastClipAddedAt)) })}
                      </span>
                    )}
                  </div>
                  {word.origin && (
                    <div
                      className={[
                        'flex items-center gap-1 text-[11px] min-w-0',
                        active ? 'text-primary-foreground/70' : 'text-muted-foreground/80'
                      ].join(' ')}
                      title={word.origin.sentence}
                    >
                      <span className="shrink-0">{t('wordOrigin')}</span>
                      <span className="shrink-0">
                        {t(ORIGIN_MODULE_LABEL[word.origin.module] ?? 'originModule.player')}
                      </span>
                      <span className="truncate">· {word.origin.sentence}</span>
                    </div>
                  )}
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
