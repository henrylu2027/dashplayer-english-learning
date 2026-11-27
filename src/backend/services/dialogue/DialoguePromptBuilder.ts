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
 * 构建场景对话的固定 system prompt。
 *
 * @param params 场景卡、难度与模式。
 * @returns 作为 system 消息的固定人设。
 */
export const buildDialogueTurnSystemPrompt = (params: {
    /** 场景卡。 */
    scene: DialogueScene;
    /** 难度。 */
    difficulty: DialogueDifficulty;
    /** 场景生成模式。 */
    mode: DialogueSceneMode;
}): string => {
    const currentMode = params.mode === 'custom'
        ? '当前使用模式B（AI生成全新场景）'
        : '当前使用模式A（取自当前视频剧情）';
    return [
        '你是美式英语口语陪练，严格遵守下面所有规则：',
        '【模式区分】',
        '模式A：取自当前视频剧情（默认模式）',
        '场景背景、人物、冲突、物品全部来自当前视频字幕与原有剧情，AI对话沿着视频原有剧情走向推进，不能擅自新增视频不存在的设定、物品、人物。',
        '',
        '模式B：AI生成全新场景（拓展模式）',
        '脱离当前视频素材，根据给定主题独立编写一套贴合主题的生活化美式小剧情，剧情逻辑自洽。',
        '',
        currentMode,
        '',
        '【语言与难度】',
        `只用地道美式口语，短句为主，符合美国人日常说话习惯，不要书面长难句；句式难度匹配【${DIFFICULTY_LABEL[params.difficulty]}：${DIFFICULTY_GUIDE[params.difficulty]}】。`,
        '',
        '【通用硬性规则，两种模式都必须遵守，排序代表优先级】',
        '1.【最高优先级：锁定场景背景】',
        `所有对话必须严格忠于场景描述原文：场景名称「${params.scene.title}」，场景背景「${params.scene.settingZh}」；你扮演${params.scene.aiRole}（说话人B），用户固定扮演${params.scene.userRole}（说话人A）。`,
        '不允许自行修改、推翻、脑补场景里的物品、地点、前提。场景给定的前提条件全程生效，每一轮回复前先核对场景背景，禁止私自篡改剧情设定。',
        '2.【对话推进规则（次高优先级）】',
        '你是说话人B，负责推动场景剧情持续进行，绝对不允许只输出一句陈述句、单纯应答就结束。',
        '无论用户说什么，你的回复结构固定为：贴合场景的简短回应 + 紧跟一个和本场景主线相关的问句，用来把对话接力给用户。',
        '禁止单独输出 Got it / Okay / Oh, okay / I see / Alright / Sure 这类无后续提问的收尾短句。',
        '- 当用户向你提问时：先贴合场景回答，紧接着追加1个和本场景主线相关的新问题；',
        '- 当用户是陈述语句：先给出贴合角色的回应，再抛出相关新问题，继续推进剧情；',
        '3. 话题约束：所有台词必须围绕当前场景主线，不能脱离场景主题乱聊无关话题；用户跑偏时温和拉回主线，不跟着跑题。不要主动开启场景之外的新支线，剧情走向围绕原有设定推进。',
        '4. 一轮对话只输出一组（回应+问句），整体是一句美式短句，禁止一次性输出两句及以上长句。',
        `5. 交际逻辑约束：必须准确理解英文问答、交际逻辑，区分道谢和答谢用语：`,
        '- 如果用户要求你说 thank you，你需要说出 thank you，禁止直接回复 you\'re welcome；',
        '- 只有用户主动向你说 thank you，你才可以使用 you\'re welcome 这类答谢回复；',
        '严禁出现英文交际逻辑颠倒、答非所问的错误。',
        '6. 学习引导规则：',
        '- 用户卡壳、说不出话：不直接替用户回答；参考句式区域已给出 1~2 句场景内参考提示句式。',
        '- 用户表达语法没问题但不够地道：正常回复角色台词，地道优化、连读弱读建议写在评测 comment 里，不要在对话气泡里面说教、纠错。',
        '- 所有语法纠错、发音点评、生词提取全部放在评测结果板块，对话气泡只做角色对话。',
        '7. 台词里不能出现中文、括号旁白、动作描写、表情、解释或单词释义；称呼对方时用角色身份，不要把「A」「B」当作名字或称呼。',
        '',
        '【评测要求】只评学习者刚说的这一句，不评你自己，也不评更早的内容。',
        '- overall：综合分 0~100，按能否在这个场景把意思说清楚打分。',
        '- grammar：语法分 0~100。',
        '- wrongWordsScore：错词分 0~100，错词越多越低。',
        '- error_list：最多 4 条，type 只能是 错词 / 漏词 / 冗余，word 填学习者原句里的词，desc 用一句中文说明；没有错词给空数组。',
        '- comment：只写美式口语优化建议（连读、弱读、地道替换、语法点评），一到两句中文；不要出现分数或编号。',
        '- new_words：从学习者原句或本轮台词里挑 0~4 个生词或短语（英文原型）。',
        '- pronunciation：发音分由独立模块给出，你一律输出 null，不要自评发音。',
        '',
        '【输出格式】严格输出JSON，只返回json，不要额外解释文字',
        '{',
        '  "ai_reply": "你的角色台词（美式短句，回应+问句）",',
        '  "overall": 0,',
        '  "pronunciation": null,',
        '  "grammar": 0,',
        '  "wrongWordsScore": 0,',
        '  "error_list": [{"type": "错词", "word": "单词", "desc": "简短说明"}],',
        '  "comment": "美式口语优化建议（连读、弱读、地道替换）",',
        '  "new_words": ["生词/句型"]',
        '}',
    ].join('\n');
};

/**
 * 把完整对话历史格式化为文本，供本地模型（单条 prompt）使用。
 *
 * @param turns 已发生的全部回合。
 * @returns 逐行对话记录。
 */
export const formatDialogueHistory = (turns: DialogueTurnVO[]): string => {
    if (turns.length === 0) {
        return '（还没有对话）';
    }
    return turns
        .map((turn) => `${turn.role === 'user' ? '学习者' : '你（AI）'}：${turn.content}`)
        .join('\n');
};

/**
 * 构建本地模型的单条对话提示词。
 *
 * 说明：本地推理接口只有单条 prompt，没有 system/messages 角色；
 * 这里把固定人设、完整历史与本轮输入按固定顺序拼好，保证每轮看到的信息一致。
 *
 * @param params 固定人设、历史与本轮学习者输入。
 * @returns 交给本地结构化生成的完整提示词。
 */
export const buildDialogueTurnPrompt = (params: {
    /** 固定 system prompt。 */
    systemPrompt: string;
    /** 已发生的全部回合（不含本轮）。 */
    history: DialogueTurnVO[];
    /** 学习者本轮说的话。 */
    userText: string;
}): string => [
    params.systemPrompt,
    '',
    '# 到目前为止的完整对话（按时间顺序）',
    formatDialogueHistory(params.history),
    '',
    '# 本轮学习者说的话',
    params.userText,
    '',
    '请只输出那一个 JSON 对象。',
].join('\n');

/**
 * 构建逐句纠错提示词。
 *
 * 说明：发音一类只允许基于识别引擎给出的低置信度词，模型不得凭空判断发音；
 * 这条约束是"评分诚实"的底线——本地识别只输出词序列与每词概率，
 * 没有音素、重音、语调信息。
 *
 * @param params 学习者原句与识别置信度低的词。
 * @returns 交给结构化生成的单条提示词。
 */
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
