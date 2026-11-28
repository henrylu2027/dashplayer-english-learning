import type {
    SrsAddCardRequest,
    SrsAddCardResponse,
    SrsCardLocation,
    SrsCardThumbnail,
    SrsCheckRequest,
    SrsCheckResult,
    SrsHistoryCalendarResponse,
    SrsHistoryExportResponse,
    SrsHistoryRequest,
    SrsHistoryResponse,
    SrsOverview,
    SrsQueueRequest,
    SrsQueueResponse,
    SrsReviewOutcome,
    SrsSubmitReviewRequest,
    SrsVerdictRequest,
    SrsVerdictResult,
    SrsWordDefinition,
} from '@/common/contracts/srs';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';

/**
 * 间隔复习功能的 backendClient 封装。
 */
export const srsApi = {
    /** 把一句话加入复习队列；已存在时返回原卡片。 */
    addCard: (params: SrsAddCardRequest): Promise<SrsAddCardResponse> =>
        backendClient.call('srs/add-card', params),

    /** 查询待复习与未来卡片。 */
    overview: (): Promise<SrsOverview> =>
        backendClient.call('srs/overview'),

    /** 分页查询复习队列。 */
    queue: (params: SrsQueueRequest): Promise<SrsQueueResponse> =>
        backendClient.call('srs/queue', params),

    /** 只打分，不改排期。 */
    check: (params: SrsCheckRequest): Promise<SrsCheckResult> =>
        backendClient.call('srs/check', params),

    /** 按掌握度判定推进排期。 */
    verdict: (params: SrsVerdictRequest): Promise<SrsVerdictResult> =>
        backendClient.call('srs/verdict', params),

    /** 用一条跟读记录提交复习结果。 */
    submitReview: (params: SrsSubmitReviewRequest): Promise<SrsReviewOutcome> =>
        backendClient.call('srs/submit-review', params),

    /** 从复习队列移除卡片。 */
    removeCard: (cardId: number): Promise<void> =>
        backendClient.call('srs/remove-card', { cardId }),

    /** 提取并返回卡片句子的原声音频路径。 */
    sentenceAudio: (cardId: number): Promise<string> =>
        backendClient.call('srs/sentence-audio', { cardId }),

    /** 定位卡片对应的原片与句子起始时间。 */
    cardLocation: (cardId: number): Promise<SrsCardLocation> =>
        backendClient.call('srs/card-location', { cardId }),

    /** 生成并返回卡片对应句子的视频截图。 */
    cardThumbnail: (cardId: number): Promise<SrsCardThumbnail> =>
        backendClient.call('srs/card-thumbnail', { cardId }),

    /** 读取卡片目标词在词表里的释义。 */
    wordDefinition: (cardId: number): Promise<SrsWordDefinition> =>
        backendClient.call('srs/word-definition', { cardId }),

    /** 读取最近的复习日志。 */
    history: (params: SrsHistoryRequest = {}): Promise<SrsHistoryResponse> =>
        backendClient.call('srs/history', params),

    /** 读取最近一年的复习日历。 */
    historyCalendar: (): Promise<SrsHistoryCalendarResponse> =>
        backendClient.call('srs/history-calendar'),

    /** 导出复习记录 CSV。 */
    exportHistory: (): Promise<SrsHistoryExportResponse> =>
        backendClient.call('srs/export-history'),

    /** 修改每日新卡上限；0 表示暂停入池。 */
    setDailyLimit: (limit: number): Promise<number> =>
        backendClient.call('srs/set-daily-limit', { limit }),
};
