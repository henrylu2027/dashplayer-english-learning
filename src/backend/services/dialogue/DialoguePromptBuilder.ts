import type {
    DialogueDifficulty,
    DialogueFocusLine,
    DialogueScene,
    DialogueScript,
    DialogueStats,
    DialogueTurnVO,
} from '@/common/contracts/dialogue';

/**
 * 难度对应的语言复杂度说明。
 *
 * 只控制句子长度、词汇和结构，不预设学习者年龄；年龄不等于水平。
 */
const DIFFICULTY_GUIDE: Record<DialogueDifficulty, string> = {
    basic: '短句为主（每句不超过 10 个词），使用高频词和简单结构，必要时把同一个意思拆成两句',
    intermediate: '自然的日常口语，句子长度适中，允许常见习语与缩略形式',
    challenge: '更长的句子和更地道的表达，可以包含从句、让步、反问等结构',
};

/** 难度在中文界面里的称呼，用于提示词与复盘。 */
const DIFFICULTY_LABEL: Record<DialogueDifficulty, string> = {
    basic: '入门',
    intermediate: '进阶',
    challenge: '挑战',
};

/**
 * 构建场景生成提示词。
 *
 * 说明：场景必须与视频台词有明确关联，否则“从视频句出发”就只是形式；
 * 同时要求不预设年龄，场景选材面向所有学习者。
 *
 * @param params 锚点台词、周边台词与难度。
 * @returns 交给结构化生成的单条提示词。
 */
export const buildScenePrompt = (params: {
    /** 锚定的视频台词。 */
    anchorText: string;
    /** 当前句及前后台词的快照。 */
    paragraphLines: string[];
    /** 难度。 */
    difficulty: DialogueDifficulty;
    /** 学习者练过的台词；有值时场景必须复用这些原句。 */
    focusLines?: DialogueFocusLine[];
}): string => {
    const contextLines = params.paragraphLines.length > 0
        ? params.paragraphLines.map((line, index) => `${index + 1}. ${line}`).join('\n')
        : '（无）';
    const focusLines = params.focusLines ?? [];
    const hasFocus = focusLines.length >= 2;
    const focusBlock = hasFocus
        ? [
            '',
            '学习者反复练习过下面这些台词（来自他们的跟读与复习记录）：',
            focusLines.map((line, index) => `${index + 1}. 「${line.en}」${line.zh ? `（${line.zh}）` : ''}`).join('\n'),
            '',
            '# 取材要求（优先级最高）',
            '- 场景必须让上面这些台词原样出现在对话里：逐字一致，不改时态、不换同义词、不省略。',
            '- targetExpressions 必须从这些台词里按顺序取 3~5 句：en 与原文逐字一致，zh 给出该句准确的中文意思。',
            '- 即使上面某句没有附中文，也要在 zh 里补上它准确的中文意思，不允许留空。',
            '- 情境要能自然地承接这些句子；不要为了凑句子硬拼互不相关的情节。',
        ]
        : [];
    return [
        '你在为英语学习工具设计一个角色扮演场景。学习者刚在视频里听到这句台词：',
        `「${params.anchorText}」`,
        '',
        '当前句及前后台词：',
        contextLines,
        ...focusBlock,
        '',
        `语言难度：${DIFFICULTY_LABEL[params.difficulty]}（${DIFFICULTY_GUIDE[params.difficulty]}）`,
        '',
        '# 设计要求',
        '- 场景与台词有明确关联：可以是台词发生的情境，也可以是由这句台词自然延伸的同类情境。',
        '- 场景要能来回多轮：有明确的双方诉求或话题，不要一问一答就结束。',
        '- 双方角色自然、地位平等，不预设学习者年龄，不要设计儿童专属场景。',
        '- 不要给学习者或 AI 角色起具体人名，用「你」「对方」或通用身份（如“店员”“旅客”）描述。',
        hasFocus
            ? '- 参考句式 3~5 句：按上面的「取材要求」从练习过的台词里选，不要另外新编表达。'
            : '- 参考句式 3~5 句（默认 4 句）：都是这个场景里真会用到的英文表达，难度符合上面的档位。',
        '- 开场白由 AI 角色先说，1~2 句英文，能自然引出学习者的回应；中文只用于设定和解说，台词必须是英文。',
        '- title 必须是英文，不超过 6 个词；openingHintZh 是一句中文，说明开场白的意思或学习者可以怎么接。',
        '',
        '# 输出要求',
        '只输出一个 JSON 对象，不要输出任何其他文字或 Markdown 代码块，字段如下：',
        '{',
        '  "title": "英文短标题（用于历史列表）",',
        '  "settingZh": "中文场景设定，一到两句",',
        '  "aiRole": "AI 扮演的角色（中文描述）",',
        '  "userRole": "学习者扮演的角色（中文描述）",',
        '  "targetExpressions": [{"en": "英文表达", "zh": "中文释义"}],',
        '  "openingLineEn": "AI 的开场白（英文）",',
        '  "openingHintZh": "开场白的中文提示"',
        '}',
    ].join('\n');
};

/**
 * 把剧本格式化为「角色名：台词」的多行文本。
 *
 * @param script 剧本。
 * @returns 逐行台词；有译文时附在括号里。
 */
const formatScriptLines = (
    script: DialogueScript,
    lines: DialogueScript['lines'] = script.lines,
): string => lines
    .map((line) => {
        const name = line.speaker === 'a' ? script.roleAName : script.roleBName;
        const zh = line.zh?.trim();
        return zh ? `${name}：${line.en}（${zh}）` : `${name}：${line.en}`;
    })
    .join('\n');

/** 场景提示词里最多带几句台词；整部字幕太长，只取锚点附近这一段。 */
const PROMPT_SCRIPT_LINES = 12;

/**
 * 构建「跟着原片演」的场景提示词。
 *
 * 说明：与 `buildScenePrompt` 的区别是场景不再由模型另编，而是围绕一段真实字幕展开；
 * 角色名、目标表达、开场白都锁定到剧本内，避免模型改名或编台词。
 *
 * @param params 锚点台词、剧本与难度。
 * @returns 交给结构化生成的单条提示词。
 */
export const buildScriptScenePrompt = (params: {
    /** 锚定的视频台词。 */
    anchorText: string;
    /** 从视频截取的真实台词。 */
    script: DialogueScript;
    /** 难度。 */
    difficulty: DialogueDifficulty;
}): string => {
    const { script } = params;
    const aiName = script.learnerRole === 'a' ? script.roleBName : script.roleAName;
    const learnerName = script.learnerRole === 'a' ? script.roleAName : script.roleBName;
    return [
        '你在为英语学习工具设计一个角色扮演场景。学习者要跟着一段真实视频对话演一遍。',
        '',
        '原片剧本（来自视频字幕，按播放顺序，逐字照抄）：',
        formatScriptLines(script, (() => {
            const start = Math.max(0, script.lines.findIndex((line) => line.index >= script.startIndex));
            return script.lines.slice(start, start + PROMPT_SCRIPT_LINES);
        })()),
        '',
        '剧本里只有两个人：',
        `- ${script.roleAName}（说话人 A）`,
        `- ${script.roleBName}（说话人 B）`,
        '',
        `学习者扮演：${learnerName}`,
        `你（AI）扮演：${aiName}`,
        '',
        `锚点台词：「${params.anchorText}」`,
        `语言难度：${DIFFICULTY_LABEL[params.difficulty]}（${DIFFICULTY_GUIDE[params.difficulty]}）`,
        '',
        '# 设计要求',
        '- 场景设定必须来自上面这段对话的情境，不要另编互不相关的情节。',
        '- aiRole 填你扮演的角色，userRole 填学习者扮演的角色；两人都用剧本里给出的名字，不要改名、不要新增第三个角色。',
        '- targetExpressions 从上面剧本里按顺序取 3~5 句：en 与原文逐字一致，zh 给出该句准确的中文意思（剧本里有译文就直接用）。',
        `- openingLineEn 必须是 ${aiName} 在剧本里说过的英文，逐字照抄，不要改写。`,
        '- openingHintZh 是一句中文，说明开场白的意思或学习者可以怎么接。',
        '- title 必须是英文，不超过 6 个词。',
        '',
        '# 输出要求',
        '只输出一个 JSON 对象，不要输出任何其他文字或 Markdown 代码块，字段如下：',
        '{',
        '  "title": "英文短标题（用于历史列表）",',
        '  "settingZh": "中文场景设定，一到两句",',
        '  "aiRole": "AI 扮演的角色（用剧本里的名字）",',
        '  "userRole": "学习者扮演的角色（用剧本里的名字）",',
        '  "targetExpressions": [{"en": "英文表达", "zh": "中文释义"}],',
        '  "openingLineEn": "AI 的开场白（英文，逐字取自剧本）",',
        '  "openingHintZh": "开场白的中文提示"',
        '}',
    ].join('\n');
};

/**
 * 构建对话系统人设。
 *
 * 说明：人设只包含模型无法自行推导的场景信息与行为规则；
 * 不要求模型逐轮点评——复盘在结束时统一生成，避免打断角色扮演。
 *
 * @param params 场景卡与难度。
 * @returns 作为 system 消息的完整人设。
 */
export const buildDialogueSystemPrompt = (params: {
    /** 场景卡。 */
    scene: DialogueScene;
    /** 难度。 */
    difficulty: DialogueDifficulty;
}): string => {
    const targets = params.scene.targetExpressions
        .map((item) => (item.zh.trim() ? `- ${item.en}（${item.zh}）` : `- ${item.en}`))
        .join('\n');
    return [
        '# 角色扮演规则',
        '你正在和一位英语学习者进行角色扮演练习。',
        `场景：${params.scene.settingZh}`,
        `你扮演：${params.scene.aiRole}`,
        `对方扮演：${params.scene.userRole}`,
        '',
        '本场景的目标表达（不要求对方全部用上，也不要逐条点名要求）：',
        targets,
        '',
        `语言难度：${DIFFICULTY_LABEL[params.difficulty]}（${DIFFICULTY_GUIDE[params.difficulty]}）`,
        '',
        '# 行为规则',
        '- 只说英文，保持角色身份，每次回复 1~3 句，像真实对话一样自然。',
        '- 不要解释语法、不要点评、不要跳出角色，也不要替对方说台词。',
        '- 对方明显没听懂或用中文求助时，先用一行「（提示：……）」给一句中文解释，再用英文继续。',
        '- 对方用中文回答时，用英文自然回应，并可以顺带用一次目标表达做示范。',
        '- 不要输出 Markdown、列表、标题或任何格式标记，只输出对话内容。',
    ].join('\n');
};

/**
 * 训练用的口语风格说明：只影响台词本身，不影响评测口径。
 */
const SPOKEN_STYLE_GUIDE = '美式日常口语：用缩略形式（I\'m、don\'t、gonna 少用），不用书面语和教科书腔，不堆砌形容词。';

/**
 * 构建场景对话的固定 system prompt。
 *
 * 说明：这是对话链路的唯一人设，每次请求都原样携带，保证多轮之间口径一致。
 * 核心是把「角色台词」与「评测纠错」在同一份输出里严格分开：
 * 台词只进对话气泡，评测只进右侧面板，两边绝不互相污染。
 *
 * @param params 场景卡与难度。
 * @returns 作为 system 消息的固定人设。
 */
export const buildDialogueTurnSystemPrompt = (params: {
    /** 场景卡。 */
    scene: DialogueScene;
    /** 难度。 */
    difficulty: DialogueDifficulty;
}): string => {
    const targets = params.scene.targetExpressions
        .map((item) => (item.zh.trim() ? `- ${item.en}（${item.zh}）` : `- ${item.en}`))
        .join('\n');
    return [
        '# 身份',
        '你是一位英语口语陪练，正在和一位中国学习者做角色扮演对话。',
        `场景背景：${params.scene.settingZh}`,
        `你扮演：${params.scene.aiRole}`,
        `学习者扮演：${params.scene.userRole}`,
        '',
        '本场景可以参考的句式（不要求学习者全部用上）：',
        targets,
        '',
        `语言难度：${DIFFICULTY_LABEL[params.difficulty]}。${DIFFICULTY_GUIDE[params.difficulty]}。`,
        '',
        '# 你的两个任务（每次回复都要同时完成，写入不同字段，绝不能混在一起）',
        '【角色对话回复】只写你扮演的角色接下来要说的一句英文台词，写在 replyEn。',
        '【评测纠错】只写对学习者上一句的评测，写在 evaluation 里。这些内容只出现在右侧评测面板，一个字都不能出现在 replyEn 中。',
        '',
        '# 角色台词的硬性要求（replyEn）',
        `- 每次只回一句${SPOKEN_STYLE_GUIDE}`,
        '- 一句就是一整句：不超过 14 个词，必须有标点，只表达一个意思。',
        '- 台词里不能出现：中文、括号、引号包裹、表情、旁白、动作描写、解释、点评、语法纠错、单词释义。',
        '- 不能替学习者说他要说的话，也不能把学习者该说的台词替他说出来。',
        '- 承接上文，推动这个场景继续；不要重复自己上一句，不要一句话把话题聊死。',
        '- 学习者用中文说时，用简单英文回应并自然继续，不评价他用了中文。',
        '',
        '# 场景约束',
        '- 学习者说的话脱离场景时，用一句符合角色身份的话温和把人拉回场景，不跟随无关话题，也不批评他跑题。',
        '- 学习者说不会、卡住或明显答不上来时：replyEn 只给一句自然的等待或鼓励（例如 "Take your time."），同时在 hint 里给出学习者下一句可以说的英文参考和中文意思；不要替他回答，也不要把参考句式写进 replyEn。',
        '- 学习者表达顺畅时，hint 输出 null。',
        '',
        '# 评测的要求（evaluation）',
        '- 只评学习者刚说的这一句，不评你自己上一句，也不评更早的内容。',
        '- overall 是 0~100 的整数，按「能否在这个场景里把意思说清楚」打分；能顺畅交流 80 以上。',
        '- grammar 是 0~100 的整数：语法正确、用词自然给高分；没有语法问题时给 90 以上，无法判断时给 null。',
        '- pronunciation 只在学习者这条消息来自录音时才给分（0~100）；如果提供了「识别没把握的词」，这些词可以扣分并写进 problems（kind 用 pronunciation），否则给 null，绝不凭空判断发音。',
        '- problems 最多 4 条，按重要性排序：',
        '  - kind=grammar：时态、一致、冠词、介词、词序等真实错误。',
        '  - kind=wording：不算错但不够地道的说法，better 给更常用的表达。',
        '  - kind=pronunciation：只针对「识别没把握的词」，whyZh 提示可能没读清、建议重读。',
        '  - kind=linking：学习者这句已经说对时，给一条美式连读/弱读建议（哪两个词连起来读），不算错误。',
        '  - original 必须逐字照抄学习者原句里的片段，不能改写；better 必须与 original 不同；whyZh 用一句中文，面向初学者。',
        '  - 学习者的句子没有问题、也没有连读可提时，problems 输出空数组。',
        '- commentZh 用一到两句中文点评，先说做到的地方，再说最值得改的一点；不出现分数以外的编号、列表或 Markdown。',
        '- vocab 是本轮值得进词汇工坊的生词或短语（英文原型，最多 4 个）：优先取学习者说错、说不上来的词，其次是本场景高频但学习者还没用过的词；没有就给空数组。',
        '',
        '# 禁止事项',
        '- 不输出任何 JSON 之外的文字，不加 Markdown 代码块，不加解释。',
        '- 不评价口音、语速、语调是否「像美国人」，pronunciation 只针对上面说明的识别线索。',
        '- 不复述学习者的整句，不在 replyEn 里夸奖或纠正他。',
        '',
        '# 输出格式（严格 JSON，字段一个都不能少）',
        '{',
        '  "replyEn": "角色台词，一句美式英文短句",',
        '  "replyZh": "这句台词的中文意思",',
        '  "hint": null 或 {"en": "学习者可以说的英文参考", "zh": "中文意思"},',
        '  "evaluation": {',
        '    "overall": 0,',
        '    "grammar": 0,',
        '    "pronunciation": null,',
        '    "commentZh": "中文点评",',
        '    "problems": [{"kind": "grammar", "original": "原句片段", "better": "更好的英文", "whyZh": "中文说明"}],',
        '    "vocab": ["word"]',
        '  }',
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
    /** 本轮是否来自录音。 */
    hasAudio: boolean;
    /** 识别没把握的词。 */
    lowConfidenceWords: string[];
}): string => {
    const lowConfidence = params.hasAudio
        ? (params.lowConfidenceWords.length > 0
            ? `本轮来自录音，识别没把握的词：${params.lowConfidenceWords.join('、')}`
            : '本轮来自录音，识别没有明显没把握的词；pronunciation 可以按整体流畅度给分，但不要虚构发音问题。')
        : '本轮不是录音输入（打字），pronunciation 必须为 null，也不能给 pronunciation 类问题。';
    return [
        params.systemPrompt,
        '',
        '# 到目前为止的完整对话（按时间顺序）',
        formatDialogueHistory(params.history),
        '',
        '# 本轮学习者说的话',
        params.userText,
        '',
        lowConfidence,
        '',
        '请只输出那一个 JSON 对象。',
    ].join('\n');
};

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
