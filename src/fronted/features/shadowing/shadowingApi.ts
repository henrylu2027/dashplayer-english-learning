import type {
    ShadowingAttemptQuery,
    ShadowingAttemptSource,
    ShadowingAttemptSummary,
    ShadowingScoreResponse,
} from '@/common/contracts/shadowing';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';

/**
 * 跟读打分功能的 backendClient 封装。
 */
export const shadowingApi = {
    /**
     * 提交一段跟读录音做本地识别与逐词评测，并保存本次记录。
     * @param params 参考文本、录音字节、MIME 类型与句子来源。
     * @returns 评测结果与已落库的记录摘要。
     */
    score: (params: {
        referenceText: string;
        audio: Uint8Array;
        mimeType: string;
        source: ShadowingAttemptSource;
    }): Promise<ShadowingScoreResponse> => backendClient.call('shadowing/score', params),

    /**
     * 查询最近的跟读记录。
     * @param query 条数与可选过滤条件。
     * @returns 按时间倒序排列的记录摘要。
     */
    listAttempts: (query: ShadowingAttemptQuery = {}): Promise<ShadowingAttemptSummary[]> =>
        backendClient.call('shadowing/list-attempts', query),

    /** 确保 macOS 麦克风授权已就绪（未决定时主进程弹系统授权框）；仅 'granted' 可录音。 */
    ensureMicrophone: (): Promise<'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'> =>
        backendClient.call('system/ensure-microphone'),
};
