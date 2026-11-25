import type {
    DialogueDifficulty,
    DialogueModelBackend,
    DialogueReview,
    DialogueScene,
    DialogueSessionSummary,
    DialogueTurnVO,
} from '@/common/contracts/dialogue';
import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';

/**
 * 新建对话会话的输入。
 */
export interface CreateDialogueSessionParams {
    /** main 进程中的聊天会话 ID。 */
    chatSessionId: string;
    /** 锚定的视频句来源。 */
    source: ShadowingAttemptSource;
    /** 锚定的台词原文。 */
    anchorText: string;
    /** 场景卡。 */
    scene: DialogueScene;
    /** 难度。 */
    difficulty: DialogueDifficulty;
    /** 模型后端。 */
    backend: DialogueModelBackend;
}

/**
 * 追加对话回合的输入。
 */
export interface AppendDialogueTurnParams {
    /** 对话数据库主键。 */
    sessionId: number;
    /** 说话方。 */
    role: DialogueTurnVO['role'];
    /** 文本内容。 */
    content: string;
    /** 加入复习后的卡片 ID。 */
    cardId?: number | null;
}

/**
 * 一段时间内的学习者发言轮数。
 */
export interface DialogueTurnStats {
    /** 学习者发言条数。 */
    count: number;
}

/**
 * 某一天的学习者发言轮数，日期按本机时区切分。
 */
export interface DialogueDailyCount {
    /** 本地日期，格式 `YYYY-MM-DD`。 */
    day: string;
    /** 当天学习者发言条数。 */
    count: number;
}

/**
 * 从数据库还原的会话内容。
 */
export interface DialogueSessionRecord {
    /** 会话摘要。 */
    session: DialogueSessionSummary;
    /** 场景卡。 */
    scene: DialogueScene;
    /** 复盘；未结束时为 null。 */
    review: DialogueReview | null;
}

/**
 * 场景对话持久化端口。
 */
export default interface DialogueRepository {
    /**
     * 新建会话。
     * @param params 会话、场景与视频句来源。
     * @returns 落库后的会话内容。
     */
    createSession(params: CreateDialogueSessionParams): Promise<DialogueSessionRecord>;

    /**
     * 读取会话；不存在时显式报错。
     * @param id 对话数据库主键。
     * @returns 会话内容。
     */
    getSession(id: number): Promise<DialogueSessionRecord>;

    /**
     * 按创建时间倒序列出会话。
     * @param limit 最多返回条数。
     * @returns 会话摘要列表，含回合数。
     */
    listSessions(limit: number): Promise<DialogueSessionSummary[]>;

    /**
     * 追加一条回合。
     * @param params 会话、角色、内容与可选卡片 ID。
     * @returns 落库后的回合。
     */
    appendTurn(params: AppendDialogueTurnParams): Promise<DialogueTurnVO>;

    /**
     * 按时间顺序读取一个会话的全部回合。
     * @param sessionId 对话数据库主键。
     * @returns 回合列表。
     */
    listTurns(sessionId: number): Promise<DialogueTurnVO[]>;

    /**
     * 写入复盘并标记会话结束。
     * @param id 对话数据库主键。
     * @param review 完整复盘。
     * @returns 更新后的会话内容。
     */
    finishSession(id: number, review: DialogueReview): Promise<DialogueSessionRecord>;

    /**
     * 统计某个时间点之后的学习者发言轮数。
     *
     * 只算学习者发言，不算 AI 台词和开场白：学习台衡量的是输出量。
     *
     * @param sinceMs 起始时间，epoch 毫秒（含）。
     * @returns 发言条数。
     */
    countUserTurnsSince(sinceMs: number): Promise<DialogueTurnStats>;

    /**
     * 按本机时区把学习者发言聚合为每日轮数。
     * @param sinceMs 起始时间，epoch 毫秒（含）。
     * @returns 从早到晚排列的每日轮数；没有记录的日期不会出现。
     */
    dailyUserTurnCountsSince(sinceMs: number): Promise<DialogueDailyCount[]>;
}
