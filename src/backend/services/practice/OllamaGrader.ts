import axios, { isAxiosError } from 'axios';
import { injectable } from 'inversify';
import { getMainLogger } from '@/backend/infrastructure/logger';

/**
 * 练习评分的输入：参考句、学习者输出与练习模式。
 */
export interface PracticeGradeInput {
    /** 参考句。 */
    referenceText: string;
    /** 学习者输出：听写为键入文本，复述为识别文本。 */
    learnerText: string;
    /** 练习模式。 */
    mode: 'dictation' | 'retell';
}

/**
 * 模型给出的分项评分。
 */
export interface PracticeGrade {
    /** 语法分，0~100。 */
    grammar: number;
    /** 发音分，0~100；听写没有录音，无法评分。 */
    pronunciation: number | null;
    /** 与参考句的相似度，0~100。 */
    similarity: number | null;
    /** 语句层面的问题，形如「时态：过去时写成了现在时」。 */
    issues: string[];
    /** 值得记的生词/句型。 */
    vocab: string[];
    /** 一句中文点评，便于直接展示。 */
    note: string;
}

/**
 * 本地 Ollama 评分契约。
 */
export default interface OllamaGrader {
    /**
     * 用本地 Ollama 模型给一次练习打分。
     *
     * @param input 参考句、学习者输出与模式。
     * @returns 语法分、发音分（听写为 null）与点评。
     * @throws Ollama 未运行、模型不可用或返回内容不是合法 JSON 时抛出。
     */
    grade(input: PracticeGradeInput): Promise<PracticeGrade>;
}

/** Ollama 服务地址，可用环境变量覆盖。 */
const OLLAMA_BASE_URL = process.env.DASHPLAYER_OLLAMA_URL ?? 'http://127.0.0.1:11434';

/** 指定模型；为空时从已安装模型里按优先级挑一个。 */
const OLLAMA_MODEL = process.env.DASHPLAYER_OLLAMA_MODEL ?? '';

/** 模型优先级：短句评分用 8b 足够，且速度明显快于 14b/20b。 */
const MODEL_PREFERENCE = ['qwen3:8b', 'qwen3:8b-nothink', 'qwen3:14b', 'deepseek-r1:14b'];

/** 单次评分超时（毫秒）。 */
const GRADE_TIMEOUT_MS = 60_000;

/** 模型列表缓存时长（毫秒）。 */
const MODEL_CACHE_MS = 60_000;

/** 系统提示：约束输出为固定 JSON，避免模型自由发挥。 */
const SYSTEM_PROMPT = [
    'You grade a Chinese learner\'s English against a reference sentence.',
    'Return JSON only, with exactly these keys:',
    '{"grammar": <0-100 integer>, "pronunciation": <0-100 integer or null>, "similarity": <0-100 integer>,',
    ' "errors": [{"type": "tense|preposition|plural|order|usage", "detail": "<short Simplified Chinese>"}],',
    ' "vocab": [<up to 3 useful English words or phrases worth studying>],',
    ' "comment": "<one short Simplified Chinese sentence about fluency and the biggest problem>"}',
    'grammar: 100 when tense, articles, prepositions, plurals and word order are all correct.',
    'similarity: how close the learner sentence is to the reference meaning and wording.',
    'pronunciation: integer for mode "retell", judged from the transcript; null for mode "dictation" because no audio exists.',
    'errors: at most 3, name the grammar category in "type". vocab: at most 3 items, prefer phrases from the reference.',
].join('\n');

/**
 * 基于本地 Ollama 的练习评分器。
 *
 * 只做文本判断：语法看词序与搭配，发音看识别文本与参考句的吻合程度
 * （听写没有录音，发音分固定为 null）。评分失败不伪造分数，由调用方
 * 决定如何展示错误。
 */
@injectable()
export class OllamaGraderImpl implements OllamaGrader {
    private readonly logger = getMainLogger('OllamaGrader');

    /** 已确认可用的模型名与缓存时间。 */
    private cachedModel: { name: string; at: number } | null = null;

    public async grade(input: PracticeGradeInput): Promise<PracticeGrade> {
        const model = await this.resolveModel();
        const userPrompt = [
            `Mode: ${input.mode}`,
            `Reference sentence: ${input.referenceText}`,
            `Learner output: ${input.learnerText}`,
            input.mode === 'dictation'
                ? 'The learner typed this sentence, so pronunciation must be null.'
                : 'The learner said this sentence out loud and it was transcribed.',
        ].join('\n');

        const response = await axios.post(
            `${OLLAMA_BASE_URL}/api/chat`,
            {
                model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                stream: false,
                format: 'json',
                // qwen3 系列默认先输出思考串，会把 num_predict 吃光导致正文为空
                think: false,
                options: { temperature: 0.2, num_predict: 400 },
            },
            { proxy: false, timeout: GRADE_TIMEOUT_MS },
        );

        const raw = response.data?.message?.content;
        if (typeof raw !== 'string' || raw.trim().length === 0) {
            throw new Error('Ollama 返回内容为空');
        }
        return parseGrade(raw, input.mode);
    }

    /**
     * 选一个可用模型：环境变量优先，其次按优先级挑已安装的模型。
     * @returns 模型名。
     * @throws 列表为空或全部请求失败时抛出。
     */
    private async resolveModel(): Promise<string> {
        if (OLLAMA_MODEL) {
            return OLLAMA_MODEL;
        }
        if (this.cachedModel && Date.now() - this.cachedModel.at < MODEL_CACHE_MS) {
            return this.cachedModel.name;
        }
        const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, { proxy: false, timeout: 10_000 });
        const names: string[] = (response.data?.models ?? [])
            .map((item: { name?: string }) => item.name ?? '')
            .filter((name: string) => name.length > 0);
        if (names.length === 0) {
            throw new Error('Ollama 里没有已安装的模型');
        }
        const picked = MODEL_PREFERENCE.find((candidate) => names.includes(candidate)) ?? names[0];
        this.cachedModel = { name: picked, at: Date.now() };
        this.logger.info('ollama model selected', { model: picked, available: names.length });
        return picked;
    }
}

/**
 * 解析模型返回的 JSON 并夹到合法区间。
 *
 * @param raw 模型原始文本。
 * @param mode 练习模式，决定发音分是否有效。
 * @returns 结构化评分。
 * @throws 文本不是合法 JSON 时抛出。
 */
function parseGrade(raw: string, mode: PracticeGradeInput['mode']): PracticeGrade {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // 模型偶尔会在 JSON 外套一层说明，取第一个大括号块再试一次
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start < 0 || end <= start) {
            throw new Error(`Ollama 评分结果不是 JSON：${raw.slice(0, 120)}`);
        }
        parsed = JSON.parse(raw.slice(start, end + 1));
    }
    const data = parsed as {
        grammar?: unknown;
        pronunciation?: unknown;
        similarity?: unknown;
        errors?: unknown;
        vocab?: unknown;
        comment?: unknown;
        note?: unknown;
    };
    const grammar = clampScore(data.grammar);
    if (grammar === null) {
        throw new Error('Ollama 评分结果缺少 grammar');
    }
    return {
        grammar,
        pronunciation: mode === 'dictation' ? null : clampScore(data.pronunciation),
        similarity: clampScore(data.similarity),
        issues: parseIssues(data.errors),
        vocab: parseVocab(data.vocab),
        note: parseComment(data.comment ?? data.note),
    };
}

/**
 * 把模型给的语法问题列表整理成可展示的短句。
 * @param raw 模型返回的 errors 字段。
 * @returns 形如「时态：过去时写成了现在时」的列表，最多 3 条。
 */
function parseIssues(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map((item) => {
            if (typeof item === 'string') {
                return item.trim();
            }
            if (item && typeof item === 'object') {
                const record = item as { type?: unknown; detail?: unknown };
                const type = typeof record.type === 'string' ? record.type.trim() : '';
                const detail = typeof record.detail === 'string' ? record.detail.trim() : '';
                if (!type) {
                    return detail;
                }
                return detail ? `${GRAMMAR_TYPE_LABEL[type] ?? type}：${detail}` : (GRAMMAR_TYPE_LABEL[type] ?? type);
            }
            return '';
        })
        .filter((text) => text.length > 0)
        .slice(0, 3);
}

/** 模型给的语法分类英文标签 → 中文。 */
const GRAMMAR_TYPE_LABEL: Record<string, string> = {
    tense: '时态',
    preposition: '介词',
    plural: '单复数',
    order: '语序',
    usage: '用法',
};

/**
 * 整理生词/句型列表。
 * @param raw 模型返回的 vocab 字段。
 * @returns 去重后的词条，最多 3 条。
 */
function parseVocab(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seen = new Set<string>();
    const words: string[] = [];
    for (const item of raw) {
        const text = typeof item === 'string' ? item.trim() : '';
        if (!text) {
            continue;
        }
        const key = text.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        words.push(text);
        if (words.length >= 3) {
            break;
        }
    }
    return words;
}

/**
 * 取模型的一句点评。
 * @param raw comment 或 note 字段。
 * @returns 截断后的中文点评；没有时为空字符串。
 */
function parseComment(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
}

/**
 * 把任意值转成 0~100 的整数分。
 * @param value 原始值。
 * @returns 合法分数；无法转换时为 null。
 */
function clampScore(value: unknown): number | null {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }
    return Math.max(0, Math.min(100, Math.round(numeric)));
}

/** axios 错误是否属于连接失败（Ollama 未启动）。 */
export function isOllamaUnavailable(error: unknown): boolean {
    return isAxiosError(error) && (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT');
}
