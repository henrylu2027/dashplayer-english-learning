import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'inversify';
import { generateObject, type ModelMessage } from 'ai';
import { z } from 'zod';
import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import type AiProviderService from '@/backend/services/AiProviderService';
import { CLOUD_AI_NOT_CONFIGURED_MESSAGE } from '@/backend/services/AiProviderService';
import type ModelRoutingService from '@/backend/services/ModelRoutingService';
import type LocalAiService from '@/backend/services/LocalAiService';
import type ChatSessionService from '@/backend/services/ChatSessionService';
import type RecordedSpeechService from '@/backend/services/speech/RecordedSpeechService';
import type DialogueRepository from '@/backend/services/repositories/DialogueRepository';
import {
    DIALOGUE_BACKENDS,
    DIALOGUE_DIFFICULTIES,
    DIALOGUE_ROLES,
    DIALOGUE_SPEAKERS,
    dialogueCorrectionDraftSchema,
    dialogueReviewDraftSchema,
    dialogueSceneSchema,
    dialogueTurnReplySchema,
    type DialogueAvailability,
    type DialogueCreateRequest,
    type DialogueCreateResult,
    type DialogueDetail,
    type DialogueFinishRequest,
    type DialogueFinishResult,
    type DialogueListQuery,
    type DialogueModelBackend,
    type DialogueReview,
    type DialogueReviewDraft,
    type DialogueScene,
    type DialogueScript,
    type DialogueSessionSummary,
    type DialogueFocusLine,
    type DialogueStats,
    type DialogueTargetExpression,
    type DialogueTranscribeRequest,
    type DialogueTranscribeResult,
    type DialogueTurnVO,
    type DialogueAppendTurnRequest,
    type DialogueAppendTurnResult,
    type DialogueCorrectTurnRequest,
    type DialogueCorrectTurnResult,
    type DialogueCorrection,
    type DialogueCorrectionDraft,
    type DialogueCorrectionItem,
    type DialogueReplyTurnRequest,
    type DialogueReplyTurnResult,
    type DialogueTurnEvaluation,
    type DialogueTurnReplyDraft,
} from '@/common/contracts/dialogue';
import { normalizeShadowingSource } from '@/backend/services/shadowing/ShadowingSource';
import { normalizeWord, tokenizeForScoring } from '@/common/utils/wordTokens';
import {
    buildCorrectionPrompt,
    buildCustomScenePrompt,
    buildDialogueTurnPrompt,
    buildDialogueTurnSystemPrompt,
    buildReviewPrompt,
    buildScenePrompt,
    buildScriptScenePrompt,
} from '@/backend/services/dialogue/DialoguePromptBuilder';

/**
 * 场景对话业务契约。
 */
export default interface DialogueService {
    /** 查询本地与云端模型各自是否可用。 */
    availability(): Promise<DialogueAvailability>;

    /**
     * 基于视频台词生成场景并创建对话。
     *
     * @param request 锚点台词、上下文、来源、难度与模型后端。
     * @returns 已落库的会话摘要与场景卡。
     * @throws 台词为空/过长、未绑定视频句或场景生成失败时抛出。
     */
    create(request: DialogueCreateRequest): Promise<DialogueCreateResult>;

    /**
     * 把录音转写成文字，供学习者确认后再发送。
     *
     * @param request 录音字节与 MIME 类型。
     * @returns 识别文本与音频时长。
     * @throws 录音为空/过大或识别失败时抛出。
     */
    transcribe(request: DialogueTranscribeRequest): Promise<DialogueTranscribeResult>;

    /**
     * 对一条学习者发言做逐句纠错，并把结果写回该回合。
     *
     * @param request 会话、回合与识别置信度低的词。
     * @returns 已落库的纠错结果。
     * @throws 回合不属于该会话、不是学习者发言或生成失败时抛出。
     */
    correctTurn(request: DialogueCorrectTurnRequest): Promise<DialogueCorrectTurnResult>;

    /**
     * 追加一条已完成的消息。
     *
     * @param request 会话、角色、内容与可选卡片 ID。
     * @returns 落库后的回合。
     * @throws 会话不存在或已结束时抛出。
     */
    appendTurn(request: DialogueAppendTurnRequest): Promise<DialogueAppendTurnResult>;

    /**
     * 学习者说一句，模型回一句角色台词并评测这一句。
     *
     * 说明：每次请求都携带完整对话历史、场景背景、角色与难度；
     * 角色台词与评测在同一个 JSON 里严格分开，两条回合都由后端落库。
     *
     * @param request 会话、学习者原话与可选的低置信度词。
     * @returns 两条回合与可选的卡壳提示。
     * @throws 会话不存在/已结束、内容为空或生成失败时抛出。
     */
    replyTurn(request: DialogueReplyTurnRequest): Promise<DialogueReplyTurnResult>;

    /**
     * 结束对话并生成复盘；已复盘时幂等返回原结果。
     *
     * @param request 会话 ID。
     * @returns 会话摘要与复盘。
     * @throws 没有学习者发言或复盘生成失败时抛出。
     */
    finish(request: DialogueFinishRequest): Promise<DialogueFinishResult>;

    /** 查询最近的对话。 */
    list(query?: DialogueListQuery): Promise<DialogueSessionSummary[]>;

    /** 读取一条对话的完整详情。 */
    detail(sessionId: number): Promise<DialogueDetail>;
}

/** 历史列表默认与最大条数。 */
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

/** 锚点台词最大词数；过长会导致场景失焦。 */
const MAX_ANCHOR_WORDS = 120;

/** 自编场景的主题关键词最大字数。 */
const MAX_TOPIC_CHARS = 60;

/** 单条消息最大字符数，兜住异常粘贴。 */
const MAX_TURN_CHARS = 4000;

/** 周边上下文最多保留的行数。 */
const MAX_CONTEXT_LINES = 6;

/** 练过的台词最多取几句；再多场景就装不下了。 */
const MAX_FOCUS_LINES = 6;

/** 目标表达最多几个，与场景 schema 的上限一致。 */
const MAX_TARGET_EXPRESSIONS = 4;

/**
 * 剧本最多保留的台词行数。
 *
 * 右侧轨道要能翻完整部视频，所以放宽到整段字幕；提示词只取锚点附近的若干行，
 * 不会把整部台词塞进模型上下文。
 */
const MAX_SCRIPT_LINES = 2000;

/** 说话人为空时使用的默认显示名。 */
const DEFAULT_ROLE_A_NAME = '说话人 A';
const DEFAULT_ROLE_B_NAME = '说话人 B';

/**
 * 低于该概率的词视为"识别没把握"。
 *
 * 依据：实测正常朗读的词概率普遍在 0.9 以上，低于 0.6 的基本是听不清、
 * 环境噪音或生僻词。它只能提示"可能没读清"，不能判定发音对错。
 */
const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** 一次最多提示几个低置信度词，避免整句标红。 */
const MAX_LOW_CONFIDENCE_WORDS = 6;

/** 单轮纠错最多几条意见，与 schema 上限一致。 */
const MAX_CORRECTION_ITEMS = 4;

/**
 * 场景对话的采样参数。
 *
 * 温度 0.65 让台词自然、有变化；top_p 0.8 收窄候选池，
 * 避免小模型在多轮对话里突然跑题或改写人设。
 */
const DIALOGUE_TEMPERATURE = 0.65;
const DIALOGUE_TOP_P = 0.8;

/** 角色台词词数兜底上限；回应+问句通常略长，超过只记日志不截断。 */
const MAX_REPLY_WORDS = 30;

/** 台词为空时的兜底；宁可让学习者重说，也不把空白气泡发出去。 */
const FALLBACK_REPLY = 'Sorry, could you say that again?';

/** 每轮最多提取几个生词。 */
const MAX_TURN_VOCAB = 4;

/**
 * 把文本归一化为用于目标表达匹配的字符串。
 * @param text 原始文本。
 * @returns 小写、去标点、空格分隔的文本。
 */
const normalizePhrase = (text: string): string => tokenizeForScoring(text)
    .map(normalizeWord)
    .filter((word) => word.length > 0)
    .join(' ');

/**
 * 归一化学习者练过的台词：去空、按归一化文本去重、限制条数。
 *
 * @param lines 前端传来的练过的台词（可能为空或含空串）。
 * @returns 干净的台词列表，最多 `MAX_FOCUS_LINES` 条。
 */
const normalizeFocusLines = (lines: DialogueFocusLine[] | undefined): DialogueFocusLine[] => {
    const seen = new Set<string>();
    const normalized: DialogueFocusLine[] = [];
    for (const line of lines ?? []) {
        const en = (line?.en ?? '').trim();
        if (en.length === 0) {
            continue;
        }
        const key = normalizePhrase(en);
        if (key.length === 0 || seen.has(key)) {
            continue;
        }
        seen.add(key);
        const zh = (line?.zh ?? '').trim();
        normalized.push({
            en,
            ...(zh ? { zh } : {}),
            ...(line.sentenceIndex === undefined ? {} : { sentenceIndex: line.sentenceIndex }),
        });
        if (normalized.length >= MAX_FOCUS_LINES) {
            break;
        }
    }
    return normalized;
};

/**
 * 归一化前端传来的剧本。
 *
 * 说明：剧本来自视频字幕，是这段对话的"真实底本"，所以只做清洗不做改写——
 * 台词保留原文，行序按传入顺序；角色名相同或为空时回落到「说话人 A/B」，
 * 避免提示词里出现两个一样的名字。
 *
 * @param raw 前端传来的剧本（可能为空）。
 * @param fallbackVideoKey 剧本没有带视频标识时使用的值。
 * @returns 清洗后的剧本；没有可用台词时返回 null（退回旧行为）。
 */
const normalizeScript = (
    raw: DialogueScript | undefined,
    fallbackVideoKey: string,
): DialogueScript | null => {
    if (!raw || !Array.isArray(raw.lines)) {
        return null;
    }
    const lines = raw.lines
        .filter((line) => line && Number.isInteger(line.index) && (line.en ?? '').trim().length > 0
            && DIALOGUE_SPEAKERS.includes(line.speaker))
        .slice(0, MAX_SCRIPT_LINES)
        .map((line) => {
            const zh = (line.zh ?? '').trim();
            return {
                index: line.index,
                en: line.en.trim(),
                ...(zh ? { zh } : {}),
                speaker: line.speaker,
            };
        });
    if (lines.length === 0) {
        return null;
    }
    const roleA = (raw.roleAName ?? '').trim() || DEFAULT_ROLE_A_NAME;
    const roleB = (raw.roleBName ?? '').trim() || DEFAULT_ROLE_B_NAME;
    const distinct = roleA === roleB;
    return {
        videoKey: (raw.videoKey ?? '').trim() || fallbackVideoKey,
        // 排练起点由前端给出（锚点句）；缺失时退回第一行
        startIndex: Number.isInteger(raw.startIndex) ? raw.startIndex : lines[0].index,
        endIndex: lines[lines.length - 1].index,
        lines,
        roleAName: distinct ? DEFAULT_ROLE_A_NAME : roleA,
        roleBName: distinct ? DEFAULT_ROLE_B_NAME : roleB,
        learnerRole: raw.learnerRole === 'b' ? 'b' : 'a',
    };
};

/**
 * 把目标表达锁定为学习者练过的原句。
 *
 * 提示词只能"建议"模型复用原句，是否照做不可控；复盘的目标表达命中按文本匹配，
 * 一旦模型改写了句子就永远命中不了。这里在代码层直接替换，保证场景卡与复盘
 * 核对的是同一批句子。
 *
 * @param scene 模型生成的场景。
 * @param focusLines 练过的台词（已归一化）。
 * @returns 目标表达被替换后的场景；可用原句不足 2 句时原样返回。
 */
const applyFocusTargets = (scene: DialogueScene, focusLines: DialogueFocusLine[]): DialogueScene => {
    if (focusLines.length < 2) {
        return scene;
    }
    const zhByKey = new Map(scene.targetExpressions.map((item) => [normalizePhrase(item.en), item.zh]));
    const targets: DialogueTargetExpression[] = focusLines
        .slice(0, MAX_TARGET_EXPRESSIONS)
        .map((line) => {
            // 译文只用「同一句」的：字幕里已有的，或模型对这句给出的释义。
            // 取不到就留空——宁可只显示英文，也不把别句的意思安上去。
            const zh = line.zh?.trim() || zhByKey.get(normalizePhrase(line.en)) || '';
            return { en: line.en, zh };
        });
    if (targets.length < 2) {
        return scene;
    }
    return { ...scene, targetExpressions: targets };
};

/**
 * 场景对话服务：场景生成、消息转写、复盘与持久化。
 *
 * 说明：对话本身复用 ChatSessionService 的流式会话；本服务只负责
 * 场景与复盘的结构化生成、客观统计和落库，不参与逐 token 的流式转发。
 */
@injectable()
export class DialogueServiceImpl implements DialogueService {
    private readonly logger = getMainLogger('DialogueService');

    @inject(TYPES.DialogueRepository)
    private dialogueRepository!: DialogueRepository;

    @inject(TYPES.ChatSessionService)
    private chatSessionService!: ChatSessionService;

    @inject(TYPES.AiProviderService)
    private aiProviderService!: AiProviderService;

    @inject(TYPES.ModelRoutingService)
    private modelRoutingService!: ModelRoutingService;

    @inject(TYPES.LocalAiService)
    private localAiService!: LocalAiService;

    @inject(TYPES.RecordedSpeechService)
    private recordedSpeechService!: RecordedSpeechService;

    public async availability(): Promise<DialogueAvailability> {
        const status = await this.localAiService.getStatus();
        const active = status.models.find((model) => model.modelId === status.activeModelId);
        const localAvailable = status.runtimeReady && active?.ready === true;
        let localReason: string | null = null;
        if (!status.runtimeReady) {
            localReason = '本地推理运行时缺失，请重新安装应用或运行下载脚本';
        } else if (!active) {
            localReason = '本地模型未安装';
        } else if (!active.ready) {
            localReason = '本地模型未下载完成';
        }

        let cloudAvailable = false;
        let cloudReason: string | null = null;
        try {
            cloudAvailable = this.aiProviderService.getModel('sentenceLearning') !== null;
        } catch (error) {
            cloudReason = error instanceof Error ? error.message : String(error);
        }
        if (!cloudAvailable && !cloudReason) {
            cloudReason = '云端模型未配置，请到「设置 → 服务与资源」填写';
        }
        return {
            local: { available: localAvailable, reason: localReason },
            cloud: { available: cloudAvailable, reason: cloudReason },
        };
    }

    public async create(request: DialogueCreateRequest): Promise<DialogueCreateResult> {
        const mode = request.mode === 'custom' ? 'custom' : 'video';
        // 自编模式用主题当锚点；跟视频模式必须绑定视频句
        const topic = (request.topic ?? '').trim();
        if (mode === 'custom') {
            if (topic.length < 2) {
                throw new Error('写一个主题再生成场景');
            }
            if (topic.length > MAX_TOPIC_CHARS) {
                throw new Error(`主题太长，请控制在 ${MAX_TOPIC_CHARS} 字以内`);
            }
        }
        const anchorText = (mode === 'custom' ? topic : request.anchorText.trim());
        // 视频模式才按英文词数校验；自编主题是中文，按字数在前一步校验
        if (mode === 'video') {
            const anchorWordCount = tokenizeForScoring(anchorText).length;
            if (anchorWordCount === 0) {
                throw new Error('请先播放到一句有字幕的视频台词');
            }
            if (anchorWordCount > MAX_ANCHOR_WORDS) {
                throw new Error(`当前句过长（${anchorWordCount} 词），请选择更短的一句`);
            }
        }
        if (!DIALOGUE_DIFFICULTIES.includes(request.difficulty)) {
            throw new Error(`未知的场景难度：${String(request.difficulty)}`);
        }
        if (!DIALOGUE_BACKENDS.includes(request.backend)) {
            throw new Error(`未知的模型后端：${String(request.backend)}`);
        }
        const source = normalizeShadowingSource(request.source);
        if (mode === 'video' && (source.kind !== 'video' || !source.videoKey || source.sentenceIndex === undefined)) {
            throw new Error('场景对话必须绑定视频句，请在播放器中播放到目标台词');
        }
        const paragraphLines = request.paragraphLines
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, MAX_CONTEXT_LINES);
        // 学习者练过的台词：至少两句才参与取材，否则退回按当前句生成
        const focusLines = mode === 'video' ? normalizeFocusLines(request.focusLines) : [];
        // 剧本：有值时场景围绕这段真实对话展开，目标表达也锁定在剧本内
        const script = mode === 'video' ? normalizeScript(request.script, source.videoKey ?? '') : null;

        if (request.backend === 'local') {
            this.localAiService.beginDialogueSession();
        }
        let chatSessionId: string | null = null;
        try {
            const generatedScene = await this.generateScene({
                mode,
                topic,
                anchorText,
                paragraphLines,
                focusLines,
                script,
                difficulty: request.difficulty,
                backend: request.backend,
            });
            // 有剧本时目标表达已经限定在剧本内，不再用练习记录覆盖；
            // 没有剧本时才走「练过的句子优先」，避免模型改写后复盘核对不上
            const scene = script ? generatedScene : applyFocusTargets(generatedScene, focusLines);
            const systemPrompt = buildDialogueTurnSystemPrompt({
                scene,
                difficulty: request.difficulty,
                mode,
            });
            chatSessionId = this.chatSessionService.create({
                videoId: source.videoKey ?? '',
                originalTopic: anchorText,
                paragraphLines,
                subtitleFileHash: source.videoKey ?? '',
                anchorSentenceIndex: source.sentenceIndex ?? 0,
                mode: 'scenario-dialogue',
                backend: request.backend,
                systemPrompt,
            }).sessionId;
            const created = await this.dialogueRepository.createSession({
                chatSessionId,
                source,
                anchorText,
                scene,
                script,
                mode,
                difficulty: request.difficulty,
                backend: request.backend,
            });
            await this.dialogueRepository.appendTurn({
                sessionId: created.session.id,
                role: 'assistant',
                content: scene.openingLineEn,
            });
            const record = await this.dialogueRepository.getSession(created.session.id);
            this.logger.info('dialogue created', {
                sessionId: record.session.id,
                backend: request.backend,
                difficulty: request.difficulty,
                targetCount: scene.targetExpressions.length,
                focusCount: focusLines.length,
                focusLocked: focusLines.length >= 2,
            });
            return { session: record.session, scene, script: record.script };
        } catch (error) {
            if (chatSessionId) {
                this.closeChatSession(chatSessionId);
            }
            if (request.backend === 'local') {
                this.localAiService.endDialogueSession();
            }
            throw error;
        }
    }

    public async transcribe(request: DialogueTranscribeRequest): Promise<DialogueTranscribeResult> {
        const job = `dialogue:${randomUUID()}`;
        const speech = await this.recordedSpeechService.transcribe({
            audio: request.audio,
            mimeType: request.mimeType,
            job,
        });
        // 只提示识别没把握的词；这是"可能没读清"，不是发音评分
        const lowConfidenceWords = speech.words
            .filter((word) => word.probability < LOW_CONFIDENCE_THRESHOLD)
            .slice(0, MAX_LOW_CONFIDENCE_WORDS)
            .map((word) => word.text);
        this.logger.info('dialogue speech transcribed', {
            job,
            textLength: speech.text.length,
            durationSec: Math.round(speech.durationSec * 100) / 100,
            lowConfidenceCount: lowConfidenceWords.length,
        });
        return {
            text: speech.text,
            durationSec: speech.durationSec,
            lowConfidenceWords,
        };
    }

    public async correctTurn(request: DialogueCorrectTurnRequest): Promise<DialogueCorrectTurnResult> {
        if (!Number.isInteger(request.sessionId) || !Number.isInteger(request.turnId)) {
            throw new Error('纠错请求缺少会话或回合');
        }
        const record = await this.dialogueRepository.getSession(request.sessionId);
        const turns = await this.dialogueRepository.listTurns(request.sessionId);
        const target = turns.find((turn) => turn.id === request.turnId);
        if (!target) {
            throw new Error('这条发言不属于当前对话');
        }
        if (target.role !== 'user') {
            throw new Error('只能对学习者的发言纠错');
        }
        const lowConfidenceWords = (request.lowConfidenceWords ?? [])
            .map((word) => word.trim())
            .filter((word) => word.length > 0)
            .slice(0, MAX_LOW_CONFIDENCE_WORDS);
        const correction = await this.generateCorrection({
            text: target.content,
            lowConfidenceWords,
            backend: record.session.backend,
        });
        const saved = await this.dialogueRepository.updateTurnCorrection(request.turnId, correction);
        this.logger.info('dialogue turn corrected', {
            sessionId: request.sessionId,
            turnId: request.turnId,
            itemCount: correction.items.length,
            lowConfidenceCount: lowConfidenceWords.length,
        });
        return { turnId: saved.id, correction: saved.correction ?? correction };
    }

    public async appendTurn(request: DialogueAppendTurnRequest): Promise<DialogueAppendTurnResult> {
        if (!DIALOGUE_ROLES.includes(request.role)) {
            throw new Error(`未知的对话角色：${String(request.role)}`);
        }
        const content = request.content.trim();
        if (content.length === 0) {
            throw new Error('对话内容不能为空');
        }
        if (content.length > MAX_TURN_CHARS) {
            throw new Error(`单条消息过长，请控制在 ${MAX_TURN_CHARS} 字以内`);
        }
        const record = await this.dialogueRepository.getSession(request.sessionId);
        if (record.session.finishedAt !== null) {
            throw new Error('对话已结束，不能再追加消息');
        }
        const turn = await this.dialogueRepository.appendTurn({
            sessionId: request.sessionId,
            role: request.role,
            content,
            cardId: request.cardId ?? null,
        });
        return { turn };
    }

    public async replyTurn(request: DialogueReplyTurnRequest): Promise<DialogueReplyTurnResult> {
        if (!Number.isInteger(request.sessionId)) {
            throw new Error('对话请求缺少会话');
        }
        const text = request.text.trim();
        if (text.length === 0) {
            throw new Error('先说一句再发送');
        }
        if (text.length > MAX_TURN_CHARS) {
            throw new Error(`单条消息过长，请控制在 ${MAX_TURN_CHARS} 字以内`);
        }
        const record = await this.dialogueRepository.getSession(request.sessionId);
        if (record.session.finishedAt !== null) {
            throw new Error('对话已结束，不能再继续');
        }
        const turns = await this.dialogueRepository.listTurns(request.sessionId);
        // undefined 表示打字输入；数组（可能为空）表示来自录音
        const hasAudio = Array.isArray(request.lowConfidenceWords);
        // 难度可以在对话中途调整：界面传了就用界面的，否则沿用创建时的设置
        const difficulty = request.difficulty && DIALOGUE_DIFFICULTIES.includes(request.difficulty)
            ? request.difficulty
            : record.session.difficulty;
        const systemPrompt = buildDialogueTurnSystemPrompt({
            scene: record.scene,
            difficulty,
            mode: record.session.mode,
        });
        let draft = await this.generateTurnReply({
            systemPrompt,
            history: turns,
            userText: text,
            backend: record.session.backend,
        });
        let reply = this.sanitizeReply(draft.ai_reply);
        // 缺了追问就等于把对话聊死：带着纠正提示重来一次，仍缺就照原样展示
        if (!reply.includes('?')) {
            this.logger.info('dialogue reply missing follow-up question', { sessionId: request.sessionId });
            draft = await this.generateTurnReply({
                systemPrompt,
                history: turns,
                userText: `${text}\n\n（上一次回复只做了回应、没有追问。请重写：先贴合场景简短回应，再紧跟一个和主线相关的问题，把对话交回用户；整体一句美式短句。）`,
                backend: record.session.backend,
            });
            reply = this.sanitizeReply(draft.ai_reply);
        }
        const evaluation = this.sanitizeEvaluation(draft, text);
        const userTurn = await this.dialogueRepository.appendTurn({
            sessionId: request.sessionId,
            role: 'user',
            content: text,
            evaluation,
        });
        const assistantTurn = await this.dialogueRepository.appendTurn({
            sessionId: request.sessionId,
            role: 'assistant',
            content: reply,
        });
        this.logger.info('dialogue turn replied', {
            sessionId: request.sessionId,
            backend: record.session.backend,
            mode: record.session.mode,
            hasAudio,
            errorCount: evaluation.errorList.length,
            vocabCount: evaluation.vocab.length,
            replyWords: tokenizeForScoring(reply).length,
        });
        return { userTurn, assistantTurn };
    }

    public async finish(request: DialogueFinishRequest): Promise<DialogueFinishResult> {
        const record = await this.dialogueRepository.getSession(request.sessionId);
        if (record.review) {
            // 幂等：重复点「结束并复盘」不重复调用模型，也不再释放一次租约
            return { session: record.session, review: record.review };
        }
        const turns = await this.dialogueRepository.listTurns(request.sessionId);
        const userTurns = turns.filter((turn) => turn.role === 'user');
        if (userTurns.length === 0) {
            throw new Error('还没有对话内容，先回应一句再复盘');
        }
        const stats = this.computeStats(record.scene, turns);
        const usedExpressions = record.scene.targetExpressions.map((item) => ({
            en: item.en,
            used: this.isExpressionUsed(item.en, userTurns.map((turn) => turn.content)),
        }));
        const { draft, reviewer } = await this.generateReview({
            scene: record.scene,
            turns,
            stats,
            backend: record.session.backend,
        });
        const suggestions = this.filterSuggestions(draft.suggestions, userTurns);
        if (suggestions.length !== draft.suggestions.length) {
            this.logger.info('dialogue suggestions filtered', {
                total: draft.suggestions.length,
                kept: suggestions.length,
            });
        }
        const review: DialogueReview = {
            summaryZh: draft.summaryZh,
            suggestions,
            goodLines: draft.goodLines,
            usedExpressions,
            stats,
            reviewer,
        };
        const finished = await this.dialogueRepository.finishSession(request.sessionId, review);
        if (record.session.backend === 'local') {
            this.localAiService.endDialogueSession();
        }
        this.closeChatSession(record.session.chatSessionId);
        this.logger.info('dialogue finished', {
            sessionId: request.sessionId,
            userTurnCount: stats.userTurnCount,
            suggestionCount: review.suggestions.length,
            goodLineCount: review.goodLines.length,
            reviewerBackend: reviewer.backend,
        });
        return { session: finished.session, review };
    }

    public async list(query: DialogueListQuery = {}): Promise<DialogueSessionSummary[]> {
        const limit = query.limit ?? DEFAULT_LIST_LIMIT;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
            throw new Error(`对话记录条数必须在 1~${MAX_LIST_LIMIT} 之间`);
        }
        return this.dialogueRepository.listSessions(limit);
    }

    public async detail(sessionId: number): Promise<DialogueDetail> {
        const record = await this.dialogueRepository.getSession(sessionId);
        const turns = await this.dialogueRepository.listTurns(sessionId);
        return {
            session: record.session,
            scene: record.scene,
            script: record.script,
            turns,
            review: record.review,
        };
    }

    /**
     * 生成场景卡：本地走 llama-server 的结构化生成，云端走 generateObject。
     * @param params 锚点、上下文、难度与后端。
     * @returns 通过 schema 校验的场景卡。
     */
    private async generateScene(params: {
        /** 场景生成模式。 */
        mode: 'video' | 'custom';
        /** 自编模式的主题关键词。 */
        topic: string;
        anchorText: string;
        paragraphLines: string[];
        /** 学习者练过的台词；有值时场景必须复用这些原句。 */
        focusLines: DialogueFocusLine[];
        /** 真实台词剧本；有值时按剧本生成，不再另编场景。 */
        script: DialogueScript | null;
        difficulty: DialogueCreateRequest['difficulty'];
        backend: DialogueModelBackend;
    }): Promise<DialogueScene> {
        const prompt = params.mode === 'custom'
            ? buildCustomScenePrompt({ topic: params.topic, difficulty: params.difficulty })
            : params.script
                ? buildScriptScenePrompt({
                    anchorText: params.anchorText,
                    script: params.script,
                    difficulty: params.difficulty,
                })
                : buildScenePrompt(params);
        if (params.backend === 'local') {
            const modelId = await this.localAiService.getActiveModelId();
            const raw = await this.localAiService.generate(
                prompt,
                z.toJSONSchema(dialogueSceneSchema),
                modelId,
            );
            return dialogueSceneSchema.parse(raw);
        }
        const model = this.aiProviderService.getModel('sentenceLearning');
        if (!model) {
            throw new Error(CLOUD_AI_NOT_CONFIGURED_MESSAGE);
        }
        const result = await generateObject({ model, schema: dialogueSceneSchema, prompt });
        return result.object;
    }

    /**
     * 生成复盘点评。
     * @param params 场景、回合、统计与后端。
     * @returns 通过 schema 校验的点评草稿与模型来源。
     */
    private async generateReview(params: {
        scene: DialogueScene;
        turns: DialogueTurnVO[];
        stats: DialogueStats;
        backend: DialogueModelBackend;
    }): Promise<{ draft: DialogueReviewDraft; reviewer: DialogueReview['reviewer'] }> {
        const prompt = buildReviewPrompt(params);
        if (params.backend === 'local') {
            const modelId = await this.localAiService.getActiveModelId();
            const raw = await this.localAiService.generate(
                prompt,
                z.toJSONSchema(dialogueReviewDraftSchema),
                modelId,
            );
            return {
                draft: dialogueReviewDraftSchema.parse(raw),
                reviewer: { backend: 'local', model: modelId },
            };
        }
        const model = this.aiProviderService.getModel('sentenceLearning');
        if (!model) {
            throw new Error(CLOUD_AI_NOT_CONFIGURED_MESSAGE);
        }
        const routed = this.modelRoutingService.resolveOpenAiModel('sentenceLearning');
        if (!routed) {
            throw new Error(CLOUD_AI_NOT_CONFIGURED_MESSAGE);
        }
        const result = await generateObject({ model, schema: dialogueReviewDraftSchema, prompt });
        return {
            draft: result.object,
            reviewer: { backend: 'cloud', model: routed.modelId },
        };
    }

    /**
     * 生成本轮回复：一句角色台词 + 对学习者这句的评测。
     *
     * 说明：本地模型只有单条 prompt，历史拼进提示词；云端走 messages，
     * 每轮都把完整历史重发一遍，保证上下文连贯、口径一致。
     *
     * @param params 固定人设、历史、本轮输入与后端。
     * @returns 通过 schema 校验的回复草稿。
     */
    private async generateTurnReply(params: {
        systemPrompt: string;
        history: DialogueTurnVO[];
        userText: string;
        backend: DialogueModelBackend;
    }): Promise<DialogueTurnReplyDraft> {
        if (params.backend === 'local') {
            const modelId = await this.localAiService.getActiveModelId();
            const prompt = buildDialogueTurnPrompt({
                systemPrompt: params.systemPrompt,
                history: params.history,
                userText: params.userText,
            });
            const raw = await this.localAiService.generate(
                prompt,
                z.toJSONSchema(dialogueTurnReplySchema),
                modelId,
                undefined,
                { temperature: DIALOGUE_TEMPERATURE, topP: DIALOGUE_TOP_P },
            );
            return dialogueTurnReplySchema.parse(raw);
        }
        const model = this.aiProviderService.getModel('sentenceLearning');
        if (!model) {
            throw new Error(CLOUD_AI_NOT_CONFIGURED_MESSAGE);
        }
        const messages: ModelMessage[] = [
            ...params.history.map((turn) => ({
                role: turn.role,
                content: turn.content,
            } as ModelMessage)),
            { role: 'user', content: params.userText },
        ];
        const result = await generateObject({
            model,
            schema: dialogueTurnReplySchema,
            system: params.systemPrompt,
            messages,
            temperature: DIALOGUE_TEMPERATURE,
            topP: DIALOGUE_TOP_P,
        });
        return result.object;
    }

    /**
     * 清洗角色台词：只留一句英文，去掉中文、括号旁白与说话人前缀。
     *
     * 说明：气泡里只允许出现角色台词，模型偶尔会夹带解释、中文或引号，
     * 这道清洗比只靠提示词更可靠。
     *
     * @param raw 模型返回的台词。
     * @returns 可直接显示的一句英文。
     */
    private sanitizeReply(raw: string): string {
        let text = raw
            // 台词里不允许出现中文（含中文标点与全角字符）
            .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g, ' ')
            // 去掉括号里的旁白或备注
            .replace(/[（(][^）)]*[）)]/g, ' ')
            // 去掉「AI:」「Rose:」之类的前缀
            .replace(/^\s*[A-Za-z][A-Za-z .'-]{0,20}\s*[:：]\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();
        // 只取第一句：一句一句聊，避免模型一次说一大段
        // 台词结构是「简短回应 + 问句」，最多保留两句；有问句时连同它前面那句一起留下
        const parts = text.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);
        if (parts.length > 2) {
            const questionIndex = parts.findIndex((part) => part.includes('?'));
            text = questionIndex >= 0
                ? parts.slice(Math.max(0, questionIndex - 1), questionIndex + 1).join(' ').trim()
                : parts[0].trim();
        }
        if (tokenizeForScoring(text).length > MAX_REPLY_WORDS) {
            this.logger.warn('dialogue reply longer than expected', { words: tokenizeForScoring(text).length });
        }
        if (!text) {
            return FALLBACK_REPLY;
        }
        return /[.!?]$/.test(text) ? text : `${text}.`;
    }

    /**
     * 清洗评测：错词去重、生词过滤，分数统一到 0~100。
     *
     * 注意：模型自评的 pronunciation 一律丢弃——发音分由独立发音评测模块给出。
     *
     * @param draft 模型返回的整份草稿。
     * @param userText 学习者原句。
     * @returns 可展示、可入库的评测。
     */
    private sanitizeEvaluation(
        draft: DialogueTurnReplyDraft,
        userText: string,
    ): DialogueTurnEvaluation {
        const sentence = normalizePhrase(userText);
        const seen = new Set<string>();
        const errorList = draft.error_list.filter((item) => {
            const word = normalizePhrase(item.word);
            // 漏词不可能出现在原句里；错词与冗余必须能在学习者原句里找到
            if (item.type !== '漏词' && (word.length === 0 || !sentence.includes(word))) {
                return false;
            }
            const key = `${item.type}:${word}`;
            if (word.length === 0 || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        }).slice(0, MAX_CORRECTION_ITEMS);

        const vocab: string[] = [];
        for (const word of draft.new_words) {
            const trimmed = word.trim();
            if (vocab.length >= MAX_TURN_VOCAB) {
                break;
            }
            // 生词本只收英文单词或短语，混进来的解释句直接丢掉
            if (!/^[A-Za-z][A-Za-z' -]*$/.test(trimmed)) {
                continue;
            }
            if (vocab.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
                continue;
            }
            vocab.push(trimmed);
        }

        const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
        return {
            overall: clamp(draft.overall),
            grammar: clamp(draft.grammar),
            wrongWordsScore: clamp(draft.wrongWordsScore),
            commentZh: draft.comment.trim(),
            errorList,
            vocab,
        };
    }

    /**
     * 生成逐句纠错。
     *
     * @param params 学习者原句、识别置信度低的词与后端。
     * @returns 通过 schema 校验、并已按"诚实评分"规则过滤的纠错结果。
     */
    private async generateCorrection(params: {
        text: string;
        lowConfidenceWords: string[];
        backend: DialogueModelBackend;
    }): Promise<DialogueCorrection> {
        const prompt = buildCorrectionPrompt({ text: params.text });
        if (params.backend === 'local') {
            const modelId = await this.localAiService.getActiveModelId();
            const raw = await this.localAiService.generate(
                prompt,
                z.toJSONSchema(dialogueCorrectionDraftSchema),
                modelId,
            );
            return this.toCorrection(
                dialogueCorrectionDraftSchema.parse(raw),
                params,
                { backend: 'local', model: modelId },
            );
        }
        const model = this.aiProviderService.getModel('sentenceLearning');
        if (!model) {
            throw new Error(CLOUD_AI_NOT_CONFIGURED_MESSAGE);
        }
        const routed = this.modelRoutingService.resolveOpenAiModel('sentenceLearning');
        if (!routed) {
            throw new Error(CLOUD_AI_NOT_CONFIGURED_MESSAGE);
        }
        const result = await generateObject({ model, schema: dialogueCorrectionDraftSchema, prompt });
        return this.toCorrection(result.object, params, { backend: 'cloud', model: routed.modelId });
    }

    /**
     * 过滤纠错意见，守住"只说能验证的话"。
     *
     * 规则：原句片段必须真的出现在学习者原句里；better 不能与原句相同；
     * 发音类只能落在识别置信度低的词上——模型自作主张补的发音意见一律丢弃。
     *
     * @param draft 模型返回的草稿。
     * @param params 原句与低置信度词。
     * @param reviewer 点评模型来源。
     * @returns 可展示的纠错结果。
     */
    private toCorrection(
        draft: DialogueCorrectionDraft,
        params: { text: string; lowConfidenceWords: string[] },
        reviewer: DialogueCorrection['reviewer'],
    ): DialogueCorrection {
        const sentence = normalizePhrase(params.text);
        const seen = new Set<string>();
        // 语法与用词：只留真实的模型意见；原句片段必须能在学习者原句里找到
        const modelItems = draft.items.filter((item) => {
            if (item.kind === 'pronunciation') {
                // 发音不交给模型：它会时有时无，而且本就没有判断依据
                return false;
            }
            const original = normalizePhrase(item.original);
            const better = normalizePhrase(item.better);
            if (original.length === 0 || original === better) {
                return false;
            }
            if (!sentence.includes(original)) {
                return false;
            }
            const key = `${item.kind}:${original}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
        // 发音：直接由识别引擎给出的低置信度词生成，确定、可复现，不经过模型
        const pronunciationItems: DialogueCorrectionItem[] = [];
        const seenWords = new Set<string>();
        for (const word of params.lowConfidenceWords) {
            const trimmed = word.trim();
            if (!trimmed || seenWords.has(trimmed.toLowerCase()) || pronunciationItems.length >= 2) {
                continue;
            }
            seenWords.add(trimmed.toLowerCase());
            pronunciationItems.push({
                kind: 'pronunciation',
                original: trimmed,
                better: trimmed,
                whyZh: '识别没把握，可能没读清，建议再读一遍。',
            });
        }
        const items = [...modelItems, ...pronunciationItems].slice(0, MAX_CORRECTION_ITEMS);
        if (items.length !== draft.items.length + pronunciationItems.length) {
            this.logger.info('dialogue correction filtered', {
                modelTotal: draft.items.length,
                modelKept: modelItems.length,
                pronunciationAdded: pronunciationItems.length,
            });
        }
        return {
            corrected: draft.corrected.trim() || params.text,
            items,
            reviewer,
        };
    }

    /**
     * 过滤模型编造或重复的逐句建议。
     *
     * 说明：判断依据是学习者原话——建议的原句至少要有八成词出现在某一条学习者发言里，
     * 否则视为引用错误或编造；同一原句只保留一条，改写后与原句相同的也丢弃。
     * 小模型容易把 AI 台词当学习者的句子，这道约束比反复强调提示词更可靠。
     *
     * @param suggestions 模型返回的建议。
     * @param userTurns 学习者全部发言。
     * @returns 可展示的建议。
     */
    private filterSuggestions(
        suggestions: DialogueReviewDraft['suggestions'],
        userTurns: DialogueTurnVO[],
    ): DialogueReviewDraft['suggestions'] {
        const seen = new Set<string>();
        return suggestions.filter((item) => {
            const original = normalizePhrase(item.original);
            const better = normalizePhrase(item.better);
            if (original.length === 0 || original === better) {
                return false;
            }
            if (seen.has(original)) {
                return false;
            }
            const tokens = original.split(' ');
            const covered = userTurns.some((turn) => {
                const turnTokens = new Set(normalizePhrase(turn.content).split(' '));
                const hitCount = tokens.filter((token) => turnTokens.has(token)).length;
                return tokens.length > 0 && hitCount / tokens.length >= 0.8;
            });
            if (!covered) {
                return false;
            }
            seen.add(original);
            return true;
        });
    }

    /**
     * 计算客观统计：发言轮数、词数与平均每轮词数。
     * @param scene 场景卡。
     * @param turns 全部回合。
     */
    private computeStats(scene: DialogueScene, turns: DialogueTurnVO[]): DialogueStats {
        const userTurns = turns.filter((turn) => turn.role === 'user');
        const wordCounts = userTurns.map((turn) => tokenizeForScoring(turn.content).length);
        const userWordCount = wordCounts.reduce((total, count) => total + count, 0);
        const avgWordsPerTurn = userTurns.length === 0
            ? 0
            : Math.round((userWordCount / userTurns.length) * 10) / 10;
        const userText = userTurns.map((turn) => normalizePhrase(turn.content)).join(' ');
        const targetUsedCount = scene.targetExpressions
            .filter((item) => {
                const phrase = normalizePhrase(item.en);
                return phrase.length > 0 && userText.includes(phrase);
            })
            .length;
        return {
            userTurnCount: userTurns.length,
            userWordCount,
            avgWordsPerTurn,
            targetUsedCount,
            targetTotalCount: scene.targetExpressions.length,
        };
    }

    /**
     * 判断目标表达是否出现在学习者发言里。
     * @param expression 目标表达英文。
     * @param contents 学习者全部发言。
     */
    private isExpressionUsed(expression: string, contents: string[]): boolean {
        const phrase = normalizePhrase(expression);
        if (phrase.length === 0) {
            return false;
        }
        return contents.some((content) => normalizePhrase(content).includes(phrase));
    }

    /**
     * 关闭内存中的聊天会话；会话已随重启丢失时只记日志，不影响已落库的复盘。
     * @param chatSessionId 聊天会话 ID。
     */
    private closeChatSession(chatSessionId: string): void {
        try {
            this.chatSessionService.close(chatSessionId);
        } catch (error) {
            this.logger.warn('close dialogue chat session failed', {
                chatSessionId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
