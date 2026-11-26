import { z } from 'zod';
import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';

/**
 * 场景对话契约。
 *
 * 对话以一条视频台词为锚点：先由模型设计一个可延续的角色扮演场景，
 * 学习者用语音或文字扮演其中一方，结束后生成一份复盘，好句可进入同一个复习队列。
 * 评测只覆盖可验证的层面：客观统计、文本点评、可选跟读评分；
 * 自由发言的发音不做评分（当前识别引擎只输出词序列，无法诚实评估音素与语调）。
 */

/** 场景难度；只控制语言复杂度，不预设学习者年龄。 */
export const DIALOGUE_DIFFICULTIES = ['basic', 'intermediate', 'challenge'] as const;

/** 场景难度类型。 */
export type DialogueDifficulty = (typeof DIALOGUE_DIFFICULTIES)[number];

/** 对话使用的模型后端：内置本地模型或 OpenAI 兼容接口。 */
export const DIALOGUE_BACKENDS = ['local', 'cloud'] as const;

/** 模型后端类型。 */
export type DialogueModelBackend = (typeof DIALOGUE_BACKENDS)[number];

/** 对话回合的说话方。 */
export const DIALOGUE_ROLES = ['user', 'assistant'] as const;

/** 对话回合角色类型。 */
export type DialogueRole = (typeof DIALOGUE_ROLES)[number];

/**
 * 场景中的一个目标表达。
 */
export const dialogueTargetExpressionSchema = z.object({
    /** 英文表达。 */
    en: z.string().min(1),
    /**
     * 中文释义。
     *
     * 允许为空：取自学习者练习记录的台词可能还没有译文，本地小模型也会原样留空。
     * 宁可只显示英文，也不为了通过校验临时编一个意思。
     */
    zh: z.string(),
});

/** 目标表达类型。 */
export type DialogueTargetExpression = z.infer<typeof dialogueTargetExpressionSchema>;

/**
 * 场景生成的结构化输出契约。
 *
 * 该结构与场景卡一一对应：标题、设定、双方角色、目标表达与开场白。
 */
export const dialogueSceneSchema = z.object({
    /** 英文短标题，用于历史列表。 */
    title: z.string().min(1),
    /** 中文场景设定，一到两句。 */
    settingZh: z.string().min(1),
    /** AI 扮演的角色（中文描述）。 */
    aiRole: z.string().min(1),
    /** 学习者扮演的角色（中文描述）。 */
    userRole: z.string().min(1),
    /** 目标表达，2~4 个；优先 3 个，给模型留出少量容错。 */
    targetExpressions: z.array(dialogueTargetExpressionSchema).min(2).max(4),
    /** AI 的开场白，英文。 */
    openingLineEn: z.string().min(1),
    /** 开场白的中文提示。 */
    openingHintZh: z.string().min(1),
});

/** 场景类型。 */
export type DialogueScene = z.infer<typeof dialogueSceneSchema>;

/**
 * 复盘生成的结构化输出契约。
 *
 * 目标表达使用情况与客观统计由代码计算，不交给模型，避免模型“编”数字。
 */
export const dialogueReviewDraftSchema = z.object({
    /** 中文总评，两到三句。 */
    summaryZh: z.string().min(1),
    /** 逐句建议，必须引用学习者原句。 */
    suggestions: z.array(z.object({
        original: z.string().min(1),
        better: z.string().min(1),
        whyZh: z.string().min(1),
    })).max(5),
    /** 值得进入复习的句子。 */
    goodLines: z.array(z.object({
        en: z.string().min(1),
        reasonZh: z.string().min(1),
    })).max(5),
});

/** 复盘草稿类型。 */
export type DialogueReviewDraft = z.infer<typeof dialogueReviewDraftSchema>;

/**
 * 客观统计；全部由代码计算，可解释、可复现。
 */
export const dialogueStatsSchema = z.object({
    /** 学习者发言轮数。 */
    userTurnCount: z.number().int().min(0),
    /** 学习者说出的总词数。 */
    userWordCount: z.number().int().min(0),
    /** 平均每轮词数，保留一位小数。 */
    avgWordsPerTurn: z.number().min(0),
    /** 用到的目标表达数量。 */
    targetUsedCount: z.number().int().min(0),
    /** 目标表达总数。 */
    targetTotalCount: z.number().int().min(0),
});

/** 客观统计类型。 */
export type DialogueStats = z.infer<typeof dialogueStatsSchema>;

/**
 * 完整复盘：模型点评 + 代码统计 + 点评模型来源。
 */
export const dialogueReviewSchema = z.object({
    /** 中文总评。 */
    summaryZh: z.string(),
    /** 逐句建议。 */
    suggestions: dialogueReviewDraftSchema.shape.suggestions,
    /** 可收藏的好句。 */
    goodLines: dialogueReviewDraftSchema.shape.goodLines,
    /** 目标表达使用情况。 */
    usedExpressions: z.array(z.object({ en: z.string(), used: z.boolean() })),
    /** 客观统计。 */
    stats: dialogueStatsSchema,
    /** 点评所用模型；界面必须如实标注。 */
    reviewer: z.object({
        backend: z.enum(DIALOGUE_BACKENDS),
        model: z.string(),
    }),
});

/** 完整复盘类型。 */
export type DialogueReview = z.infer<typeof dialogueReviewSchema>;

/**
 * 一条对话记录摘要。
 */
export interface DialogueSessionSummary {
    /** 数据库主键。 */
    id: number;
    /** main 进程中的聊天会话 ID，用于流式对话。 */
    chatSessionId: string;
    /** 场景英文短标题。 */
    title: string;
    /** 锚定的视频台词。 */
    anchorText: string;
    /** 难度。 */
    difficulty: DialogueDifficulty;
    /** 模型后端。 */
    backend: DialogueModelBackend;
    /** 已记录的回合数（含开场白）。 */
    turnCount: number;
    /** 创建时间，epoch 毫秒。 */
    createdAt: number;
    /** 结束复盘时间；未结束时为 null。 */
    finishedAt: number | null;
}

/**
 * 一条对话回合。
 */
export interface DialogueTurnVO {
    /** 回合主键。 */
    id: number;
    /** 说话方。 */
    role: DialogueRole;
    /** 文本内容。 */
    content: string;
    /** 该回合被加入复习后的卡片 ID；未加入时为 null。 */
    cardId: number | null;
    /** 记录时间，epoch 毫秒。 */
    createdAt: number;
}

/**
 * 两种模型后端的可用性。
 */
export interface DialogueAvailability {
    /** 内置本地模型。 */
    local: { available: boolean; reason: string | null };
    /** OpenAI 兼容接口。 */
    cloud: { available: boolean; reason: string | null };
}

/**
 * 剧本里的两个匿名说话人。
 *
 * 字幕文件没有「谁说的」这一信息，所以不做说话人识别，只用 A/B 两个匿名标签，
 * 由学习者在设置卡里改成视频里的真实名字。
 */
export const DIALOGUE_SPEAKERS = ['a', 'b'] as const;

/** 说话人标签类型。 */
export type DialogueSpeaker = (typeof DIALOGUE_SPEAKERS)[number];

/**
 * 剧本中的一行台词。
 */
export interface DialogueScriptLine {
    /** 字幕句序号，便于回溯原句。 */
    index: number;
    /** 英文原文，逐字取自字幕。 */
    en: string;
    /** 中文译文；字幕没有译文时省略，不补写。 */
    zh?: string;
    /** 这一行的说话人（按字幕顺序自动交替分配）。 */
    speaker: DialogueSpeaker;
}

/**
 * 从视频里截取的一段真实对话，作为角色扮演的剧本。
 *
 * 说明：场景不再由模型凭空设计，而是围绕这段真实台词展开；
 * 剧本本身只做展示与提示词上下文，不对学习者逐句打分。
 */
export interface DialogueScript {
    /** 视频标识。 */
    videoKey: string;
    /** 起始字幕句序号（含）。 */
    startIndex: number;
    /** 结束字幕句序号（含）。 */
    endIndex: number;
    /** 台词行，按字幕顺序排列。 */
    lines: DialogueScriptLine[];
    /** 说话人 A 的显示名。 */
    roleAName: string;
    /** 说话人 B 的显示名。 */
    roleBName: string;
    /** 学习者扮演哪一方。 */
    learnerRole: DialogueSpeaker;
}

/**
 * 剧本的运行时校验；数据库里读出来的 JSON 必须符合此结构。
 */
export const dialogueScriptSchema = z.object({
    videoKey: z.string().min(1),
    startIndex: z.number().int(),
    endIndex: z.number().int(),
    lines: z.array(z.object({
        index: z.number().int(),
        en: z.string().min(1),
        zh: z.string().optional(),
        speaker: z.enum(DIALOGUE_SPEAKERS),
    })).min(1),
    roleAName: z.string().min(1),
    roleBName: z.string().min(1),
    learnerRole: z.enum(DIALOGUE_SPEAKERS),
});

/**
 * 学习者练过的一句台词。
 *
 * 来源是当前视频的跟读记录或复习卡：这些句子用户已经反复听过、读过，
 * 拿来练口语比让模型凭空设计场景更贴近真实学习。
 */
export interface DialogueFocusLine {
    /** 英文原句；进入对话时必须逐字复用。 */
    en: string;
    /** 中文译文；缺失时由模型补写释义。 */
    zh?: string;
    /** 字幕句序号，便于回溯原句。 */
    sentenceIndex?: number;
}

/**
 * 生成场景并创建对话的请求。
 */
export interface DialogueCreateRequest {
    /** 当前视频台词原文。 */
    anchorText: string;
    /** 当前句及前后台词的快照。 */
    paragraphLines: string[];
    /**
     * 学习者练过的台词（跟读记录 / 复习卡）。
     *
     * 传了 2 句以上时，场景必须让这些原句自然出现，目标表达直接使用这些原句，
     * 不再由模型自由生成；不足 2 句则忽略，退回按当前句生成。
     */
    focusLines?: DialogueFocusLine[];
    /** 视频句来源；必须绑定视频与字幕，才能保留回放语境。 */
    source: ShadowingAttemptSource;
    /**
     * 从视频截取的真实台词，作为剧本。
     *
     * 传了就从这段真实对话出发；不传则退回按锚点句另编场景（旧行为）。
     */
    script?: DialogueScript;
    /** 难度。 */
    difficulty: DialogueDifficulty;
    /** 使用的模型后端。 */
    backend: DialogueModelBackend;
}

/**
 * 生成场景的结果。
 */
export interface DialogueCreateResult {
    /** 已落库的对话摘要。 */
    session: DialogueSessionSummary;
    /** 生成的场景卡。 */
    scene: DialogueScene;
    /** 本次使用的剧本；旧版按锚点句生成时为 null。 */
    script: DialogueScript | null;
}

/**
 * 语音转文字请求。
 */
export interface DialogueTranscribeRequest {
    /** 录音字节。 */
    audio: Uint8Array;
    /** 录音 MIME 类型。 */
    mimeType: string;
}

/**
 * 语音转文字结果。
 */
export interface DialogueTranscribeResult {
    /** 识别文本；供学习者确认或修改后再发送。 */
    text: string;
    /** 音频时长，单位秒。 */
    durationSec: number;
}

/**
 * 追加一条对话回合的请求。
 *
 * 说明：回合是转写记录，不是评分依据；前端在消息完成后调用，
 * 中途关闭应用时已完成的回合不会丢失。
 */
export interface DialogueAppendTurnRequest {
    /** 对话数据库主键。 */
    sessionId: number;
    /** 说话方。 */
    role: DialogueRole;
    /** 文本内容。 */
    content: string;
    /** 若是添加到复习的句子，记录卡片 ID。 */
    cardId?: number | null;
}

/**
 * 追加回合的结果。
 */
export interface DialogueAppendTurnResult {
    /** 落库后的回合。 */
    turn: DialogueTurnVO;
}

/**
 * 结束对话并生成复盘的请求。
 */
export interface DialogueFinishRequest {
    /** 对话数据库主键。 */
    sessionId: number;
}

/**
 * 结束对话的结果。
 */
export interface DialogueFinishResult {
    /** 更新后的对话摘要。 */
    session: DialogueSessionSummary;
    /** 生成的复盘。 */
    review: DialogueReview;
}

/**
 * 历史列表查询。
 */
export interface DialogueListQuery {
    /** 最多返回多少条，范围 1~50。 */
    limit?: number;
}

/**
 * 一条对话的完整详情。
 */
export interface DialogueDetail {
    /** 对话摘要。 */
    session: DialogueSessionSummary;
    /** 场景卡。 */
    scene: DialogueScene;
    /** 本次使用的剧本；旧版对话为 null。 */
    script: DialogueScript | null;
    /** 全部回合，按时间顺序。 */
    turns: DialogueTurnVO[];
    /** 复盘；未结束时为 null。 */
    review: DialogueReview | null;
}
