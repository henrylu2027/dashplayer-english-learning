import type {
    DialogueAppendTurnRequest,
    DialogueAppendTurnResult,
    DialogueAvailability,
    DialogueCreateRequest,
    DialogueCreateResult,
    DialogueDetail,
    DialogueFinishRequest,
    DialogueFinishResult,
    DialogueListQuery,
    DialogueSessionSummary,
    DialogueTranscribeRequest,
    DialogueTranscribeResult,
} from '@/common/contracts/dialogue';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';

/**
 * 场景对话功能的 backendClient 封装。
 */
export const dialogueApi = {
    /** 查询本地与云端模型是否可用。 */
    availability: (): Promise<DialogueAvailability> =>
        backendClient.call('dialogue/availability'),

    /** 基于当前台词生成场景并创建对话。 */
    create: (params: DialogueCreateRequest): Promise<DialogueCreateResult> =>
        backendClient.call('dialogue/create', params),

    /** 语音转文字，结果交给学习者确认后再发送。 */
    transcribe: (params: DialogueTranscribeRequest): Promise<DialogueTranscribeResult> =>
        backendClient.call('dialogue/transcribe', params),

    /** 追加一条已完成的消息。 */
    appendTurn: (params: DialogueAppendTurnRequest): Promise<DialogueAppendTurnResult> =>
        backendClient.call('dialogue/append-turn', params),

    /** 结束对话并生成复盘。 */
    finish: (params: DialogueFinishRequest): Promise<DialogueFinishResult> =>
        backendClient.call('dialogue/finish', params),

    /** 查询最近的对话。 */
    list: (query: DialogueListQuery = {}): Promise<DialogueSessionSummary[]> =>
        backendClient.call('dialogue/list', query),

    /** 读取一条对话的完整详情。 */
    detail: (sessionId: number): Promise<DialogueDetail> =>
        backendClient.call('dialogue/detail', { sessionId }),
};
