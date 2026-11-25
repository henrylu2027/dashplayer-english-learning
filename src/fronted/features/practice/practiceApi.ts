import type {
    DictationRequest,
    DictationResult,
    PracticeAttemptQuery,
    PracticeAttemptSummary,
    RetellRequest,
    RetellResult,
} from '@/common/contracts/practice';
import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';

/**
 * 精听练习功能的 backendClient 封装。
 */
export const practiceApi = {
    /** 提交听写文本，做逐词校对并保存记录。 */
    dictation: (params: DictationRequest): Promise<DictationResult> =>
        backendClient.call('practice/dictation', params),

    /** 提交复述录音，做关键词覆盖评测并保存记录。 */
    retell: (params: RetellRequest): Promise<RetellResult> =>
        backendClient.call('practice/retell', params),

    /** 查询最近练习记录。 */
    listAttempts: (query: PracticeAttemptQuery = {}): Promise<PracticeAttemptSummary[]> =>
        backendClient.call('practice/list-attempts', query),

    /** 提取句子原声路径。 */
    sentenceAudio: (source: ShadowingAttemptSource): Promise<string> =>
        backendClient.call('practice/sentence-audio', { source }),
};
