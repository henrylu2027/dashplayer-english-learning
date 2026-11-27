import type {
    DialogueDifficulty,
    DialogueFocusLine,
    DialogueScene,
    DialogueSceneMode,
    DialogueStats,
    DialogueTurnVO,
} from '@/common/contracts/dialogue';

/**
 * 难度对应的语言复杂度说明。
 *
 * 只控制句子长度、词汇和结构，不预设学习者年龄；年龄不等于水平。
 */
const DIFFICULTY_GUIDE: Record<DialogueDifficulty, string> = {
    basic: '每句不超过 8 个词，只用高频词和最简单结构',
    intermediate: '每句不超过 10 个词，日常口语，允许常见习语和缩略形式',
    challenge: '每句不超过 12 个词，可以用从句、反问等结构',
    advanced: '每句不超过 16 个词，用地道美式表达，允许短语动词和常见俚语',
};

/** 难度在中文界面里的称呼，用于提示词与复盘。 */
const DIFFICULTY_LABEL: Record<DialogueDifficulty, string> = {
    basic: '入门',
    intermediate: '初级',
    challenge: '中级',
    advanced: '高级',
};

/**
 * 构建场景生成提示词：基于视频剧情与本课核心词汇句型库，重新设计一段双人美式口语练习。
 *
 * 说明：目标是让学习者在熟悉的剧情里复用本课词汇与句型，而不是复述原台词；
 * 视频模式锁定原剧情骨架，自编模式围绕主题自洽展开，两者输出同一套字段。
 *
 * @param params 模式、主题、锚点、剧情片段、本课台词与难度。
 * @returns 交给结构化生成的单条提示词。
 */
export const buildLessonScenePrompt = (params: {
    /** 场景生成模式。 */
    mode: DialogueSceneMode;
    /** 自编模式的主题关键词。 */
    topic: string;
    /** 锚定的视频台词。 */
    anchorText: string;
    /** 当前句及前后台词的快照。 */
    paragraphLines: string[];
    /** 本课核心词汇句型库：学习者练过的台词。 */
    focusLines: DialogueFocusLine[];
    /** 难度。 */
    difficulty: DialogueDifficulty;
}): string => {
    const contextLines = params.paragraphLines.length > 0
        ? params.paragraphLines.map((line, index) => `${index + 1}. ${line}`).join('\n')
        : '（无）';
    const focusBlock = params.focusLines.length > 0
        ? params.focusLines
            .map((line, index) => `${index + 1}. 「${line.en}」${line.zh ? `（${line.zh}）` : ''}`)
            .join('\n')
        : '（无，按剧情片段自行提炼本课核心词句）';
    const material = params.mode === 'custom'
        ? [
            '主题：',
            `「${params.topic}」`,
            '',
            '（自编模式，没有原视频剧情，请围绕主题设计一套逻辑自洽的生活化美式小剧情。）',
        ]
        : [
            '视频剧情存档（当前句及前后台词）：',
            contextLines,
            '',
            '本课核心词汇句型库（学习者练过、复习过的台词）：',
            focusBlock,
            '',
            `当前锚点台词：「${params.anchorText}」`,
        ];
    return [
        '请基于视频剧情存档和本课核心词汇句型库，生成一个新的双人美式口语练习场景。',
        '目标是让学习者在熟悉的剧情中复用本课词汇、短语、句型和语法，而不是简单复述原视频台词。',
        '',
        ...material,
        '',
        `学习者水平：${DIFFICULTY_LABEL[params.difficulty]}（${DIFFICULTY_GUIDE[params.difficulty]}）`,
        '',
        '你必须严格做到：',
        params.mode === 'custom'
            ? '1. 场景围绕给定主题，剧情逻辑自洽，人物关系与诉求清楚。'
            : '1. 锁定原视频剧情骨架：保持场景地点、人物身份、人物情绪、人物诉求、当前任务、关键事实和主线不变；',
        '2. 保持学习目标：对话主体必须优先使用本课核心词汇、短语、句型和语法；',
        '3. 允许重新设计对话：可以改变切入角度、提问方式、回应方式、语气、表达顺序和句式结构；',
        '4. 控制新词：新增拓展词不超过2个，且必须与场景紧密相关、难度适合学习者当前水平；',
        params.mode === 'custom'
            ? '5. 禁止生成无关支线，禁止改变人物关系，禁止新增第三人。'
            : '5. 禁止生成无关支线，禁止改变人物关系，禁止新增视频中不存在的人物、事件和物品；',
        '6. 对话必须自然、简短、口语化，适合美式口语练习。',
        '',
        '句式配比约束：',
        '- AI 陪练 B 禁止连续使用问句，问句占 B 所有回复的比例不超过 30%；',
        '- 回复结构优先：简短评价/陈述句承接 + 可选追加温和提问；',
        '- 禁止单一审问式问句，避免对话变成问答盘问；',
        '- 优先使用本课指定的目标语法、核心词汇组织台词；',
        '- 如果学习者使用了非本课目标时态，AI 陪练正常承接对话，时态纠正放在右侧评测提示，不要靠连续提问来引导。',
        '',
        '输出要求：',
        '- characters 中说明：A 是学习者，B 是 AI 陪练（用中文描述角色身份）。',
        '- 台词里不要用「A」「B」当称呼或人名，双方只由 speaker 字段区分；需要称呼时用角色身份（如 sir、honey、老师）。',
        '- dialogue 由 B 先开口；A 的每一句都要带 practice_focus，用一句中文点明这句在练哪个词句或语法。',
        '- practice_points 的 core_words / core_phrases / core_sentences / grammar_focus 必须来自本课词汇句型库（自编模式则围绕主题给出同等难度的核心词句），core_sentences 给 3~5 句。',
        '- replacements 给 3~6 条可替换表达：from 是对话里出现过的说法，to 是更口语或同义的说法，note 是一句中文说明。',
        '- extra_vocabulary 最多 2 个新词，每个给 word / zh / usage（本场景里怎么用）。',
        '- 只输出一个 JSON 对象，不要输出任何其他文字或 Markdown 代码块，字段如下：',
        '{',
        '  "scene_title": "英文短标题，不超过 6 个词",',
        '  "scene_context": "中文场景背景，一到两句",',
        '  "characters": {"a": "学习者扮演的角色（中文）", "b": "AI 扮演的角色（中文）"},',
        '  "dialogue": [{"speaker": "B", "en": "英文台词"}, {"speaker": "A", "en": "英文台词", "practice_focus": "这句在练什么"}],',
        '  "practice_points": {',
        '    "core_words": ["单词"],',
        '    "core_phrases": ["短语"],',
        '    "core_sentences": ["句型或整句"],',
        '    "grammar_focus": ["语法点"]',
        '  },',
        '  "replacements": [{"from": "原说法", "to": "替换说法", "note": "中文说明"}],',
        '  "extra_vocabulary": [{"word": "新词", "zh": "中文意思", "usage": "本场景用法"}]',
        '}',
    ].join('\n');
};

/**
 * 把对话历史格式化为文本。
 * @param turns 已发生的全部回合。
 * @returns 逐行对话记录。
 */
export const formatDialogueHistory = (turns: DialogueTurnVO[]): string => {
    if (turns.length === 0) {
        return '（还没有对话）';
    }
    return turns
        .map((turn) => `${turn.role === 'user' ? 'A' : 'B'}：${turn.content}`)
        .join('\n');
};

/**
 * 构建「只生成一句台词」的 system prompt。
 *
 * 说明：台词与评测拆成两次调用后，这里只保留说话需要的几条规则，
 * 并用三轮示例代替长篇说明——小模型对示例的服从度远高于规则。
 *
 * @param params 场景卡、难度与模式。
 * @returns 作为 system 消息的简短人设。
 */
export const buildDialogueReplySystemPrompt = (params: {
    scene: DialogueScene;
    difficulty: DialogueDifficulty;
    mode: DialogueSceneMode;
}): string => {
    const modeRule = params.mode === 'custom'
        ? '场景是围绕给定主题自编的，台词保持该主题的逻辑自洽。'
        : '场景来自原视频剧情，地点、人物、物品、关键事实都以场景背景为准，不新增视频里没有的东西。';
    return [
        `你是美式口语陪练，扮演 B（${params.scene.aiRole}）；学习者是 A（${params.scene.userRole}）。`,
        `场景：${params.scene.title}——${params.scene.settingZh}`,
        modeRule,
        `难度：${DIFFICULTY_LABEL[params.difficulty]}（${DIFFICULTY_GUIDE[params.difficulty]}）。`,
        '',
        '规则：',
        '1. 只输出 B 的一句英文台词：先说一句陈述或简短评价承接 A 的话，需要时再带一个温和的问句。',
        '2. 问句占全部回复不超过 30%，不要连续两句都是问句，不要审问式追问。',
        '3. 不复述 A 的话，不纠错、不解释、不加中文、不加引号或旁白。',
        '4. 优先用本课核心词句组织台词，台词自然、口语化、简短。',
        '',
        '示例：',
        'A：I think I lost my phone.',
        'B：Oh no, that is the worst. Where did you see it last?',
        'A：It was in my pocket this morning.',
        'B：That happens to me all the time. I once left mine in the fridge.',
        'A：Do you have a charger?',
        'B：Yeah, it is in my bag. I can grab it for you.',
    ].join('\n');
};

/**
 * 构建本地模型的台词提示词（单条 prompt）。
 *
 * @param params 固定人设、历史、本轮输入与问句占比提醒。
 * @returns 只要求一句台词的提示词。
 */
export const buildDialogueReplyPrompt = (params: {
    systemPrompt: string;
    history: DialogueTurnVO[];
    userText: string;
}): string => {
    const aiTurns = params.history.filter((turn) => turn.role === 'assistant');
    const questionTurns = aiTurns.filter((turn) => turn.content.includes('?')).length;
    const ratio = aiTurns.length === 0 ? 0 : Math.round((questionTurns / aiTurns.length) * 100);
    const lastWasQuestion = aiTurns.at(-1)?.content.includes('?') ?? false;
    return [
        params.systemPrompt,
        '',
        '# 到目前为止的对话',
        formatDialogueHistory(params.history),
        '',
        '# 学习者刚刚说',
        params.userText,
        '',
        `# 提醒：你已经回复 ${aiTurns.length} 句，其中问句 ${questionTurns} 句（${ratio}%，上限 30%）。`,
        lastWasQuestion ? '上一轮你已经问过问题，这一轮必须用陈述句承接。' : '',
        '只输出 B 的一句英文台词，不要任何解释。',
    ].filter((line) => line.length > 0).join('\n');
};

/**
 * 构建单轮评测提示词（与台词生成分开调用）。
 *
 * @param params 学习者原句。
 * @returns 交给结构化生成的评测提示词。
 */
export const buildEvaluationPrompt = (params: {
    /** 学习者刚说的一句。 */
    text: string;
}): string => [
    '你在给一位英语学习者的一句口语打分，只评这一句，不评其他人或更早的内容。',
    `学习者原句：「${params.text}」`,
    '',
    '输出要求：',
    '- overall：综合分 0~100，按能否在场景里把意思说清楚打分。',
    '- grammar：语法分 0~100。',
    '- wrongWordsScore：错词分 0~100，错词越多越低。',
    '- error_list：最多 4 条，type 只能是 错词 / 漏词 / 冗余，word 填原句里的词，desc 用一句中文说明；没有错词给空数组。',
    '- comment：只写美式口语优化建议（连读、弱读、地道替换、语法点评），一到两句中文。',
    '- new_words：从原句里挑 0~4 个生词或短语（英文原型）。',
    '',
    '只输出一个 JSON 对象，不要任何解释文字：',
    '{',
    '  "overall": 0, "grammar": 0, "wrongWordsScore": 0,',
    '  "error_list": [{"type": "错词", "word": "单词", "desc": "简短说明"}],',
    '  "comment": "中文建议", "new_words": ["生词"]',
    '}',
].join('\n');

export const buildCorrectionPrompt = (params: {
    /** 学习者的英文原句。 */
    text: string;
}): string => {
    return [
        '你在帮一位英语学习者检查他刚说出的一句英文。',
        '',
        `学习者原句：「${params.text}」`,
        '',
        '# 你可以指出两类问题',
        '1. grammar：真实的语法错误（时态、主谓一致、单复数、冠词、介词、词序等）。',
        '2. wording：不算错但不够自然的地道表达，给出更常用的说法。',
        '',
        '发音不归你判断——识别引擎会单独给出"没读清"的词，不要输出任何发音类意见。',
        '',
        '# 规则',
        '- original 必须照抄学习者原句里的片段，不能改写、不能引用别人的话。',
        '- better 必须是英文，且与 original 不同。',
        '- whyZh 用一句中文说明原因，面向初学者，不堆术语。',
        '- 最多 3 条意见，按重要性排序；没有问题时 items 为空数组。',
        '- 不要评价口音、语调、语速，不要给分。',
        '- corrected 是整句改写后的版本；没有需要改的地方就与原文完全相同。',
        '',
        '# 输出要求',
        '只输出一个 JSON 对象，不要输出任何其他文字或 Markdown 代码块，字段如下：',
        '{',
        '  "corrected": "整句改写（英文）",',
        '  "items": [{"kind": "grammar|wording|pronunciation", "original": "原句片段", "better": "更好的英文", "whyZh": "一句中文说明"}]',
        '}',
    ].join('\n');
};

/**
 * 把对话记录格式化为复盘提示词里的文本。
 * @param turns 全部回合。
 * @returns 逐行对话记录。
 */
const formatTurns = (turns: DialogueTurnVO[]): string => turns
    .map((turn) => {
        const base = `${turn.role === 'user' ? '学习者' : 'AI'}：${turn.content}`;
        // 逐句纠错已经标过的问题带进复盘，让总评能归纳反复出现的类型
        const items = turn.role === 'user' ? turn.correction?.items ?? [] : [];
        if (items.length === 0) {
            return base;
        }
        const notes = items
            .map((item) => `${item.original} → ${item.better}（${item.whyZh}）`)
            .join('；');
        return `${base}\n  [已标注的问题] ${notes}`;
    })
    .join('\n');

/**
 * 构建对话复盘提示词。
 *
 * 说明：目标表达使用情况与客观统计由代码计算并单独展示，
 * 提示词里只让模型做文本点评，避免模型编造数字或分数。
 *
 * @param params 场景、对话记录与客观统计。
 * @returns 交给结构化生成的单条提示词。
 */
export const buildReviewPrompt = (params: {
    /** 场景卡。 */
    scene: DialogueScene;
    /** 全部回合。 */
    turns: DialogueTurnVO[];
    /** 代码计算的客观统计。 */
    stats: DialogueStats;
}): string => {
    const targets = params.scene.targetExpressions
        .map((item) => (item.zh.trim() ? `- ${item.en}（${item.zh}）` : `- ${item.en}`))
        .join('\n');
    return [
        '下面是学习者和 AI 的角色扮演记录，请做一次学习复盘。',
        '',
        `场景：${params.scene.settingZh}`,
        `学习者扮演：${params.scene.userRole}`,
        '',
        '目标表达：',
        targets,
        '',
        '对话记录：',
        formatTurns(params.turns),
        '',
        `客观统计：学习者发言 ${params.stats.userTurnCount} 轮，共 ${params.stats.userWordCount} 词。`,
        '',
        '# 输出要求',
        '只输出一个 JSON 对象，不要输出任何其他文字或 Markdown 代码块，字段如下：',
        '{',
        '  "summaryZh": "两到三句中文总评，说清楚完成度和最值得改的一点",',
        '  "suggestions": [{"original": "学习者原句（照抄）", "better": "更自然或更正确的英文", "whyZh": "一句中文说明"}],',
        '  "goodLines": [{"en": "值得复习的英文句子", "reasonZh": "一句中文说明"}]',
        '}',
        '',
        '# 要求',
        '- suggestions 最多 5 条，只针对学习者说过的句子：original 必须照抄学习者的原句，不能引用 AI 的台词，也不能编造。',
        '- better 必须与 original 不同，不要重复原句；没有明显问题时输出空数组。',
        '- goodLines 最多 5 句，优先选 AI 台词里地道的表达，或学习者改进后可复用的句子。',
        '- 不要输出分数、等级或百分比；不要评价发音，发音问题只在对话中逐句提示过。',
        '- 如果对话记录里带有「已标注的问题」，总评要归纳反复出现的类型（例如时态、冠词），不要逐条重复。',
    ].join('\n');
};
