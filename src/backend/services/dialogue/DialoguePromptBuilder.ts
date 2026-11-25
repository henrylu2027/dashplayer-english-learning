import type {
    DialogueDifficulty,
    DialogueScene,
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
}): string => {
    const contextLines = params.paragraphLines.length > 0
        ? params.paragraphLines.map((line, index) => `${index + 1}. ${line}`).join('\n')
        : '（无）';
    return [
        '你在为英语学习工具设计一个角色扮演场景。学习者刚在视频里听到这句台词：',
        `「${params.anchorText}」`,
        '',
        '当前句及前后台词：',
        contextLines,
        '',
        `语言难度：${DIFFICULTY_LABEL[params.difficulty]}（${DIFFICULTY_GUIDE[params.difficulty]}）`,
        '',
        '# 设计要求',
        '- 场景与台词有明确关联：可以是台词发生的情境，也可以是由这句台词自然延伸的同类情境。',
        '- 场景要能来回多轮：有明确的双方诉求或话题，不要一问一答就结束。',
        '- 双方角色自然、地位平等，不预设学习者年龄，不要设计儿童专属场景。',
        '- 不要给学习者或 AI 角色起具体人名，用「你」「对方」或通用身份（如“店员”“旅客”）描述。',
        '- 目标表达 2~4 个（默认 3 个）：都是这个场景里真会用到的英文表达，难度符合上面的档位。',
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
        .map((item) => `- ${item.en}（${item.zh}）`)
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
 * 把对话记录格式化为复盘提示词里的文本。
 * @param turns 全部回合。
 * @returns 逐行对话记录。
 */
const formatTurns = (turns: DialogueTurnVO[]): string => turns
    .map((turn) => `${turn.role === 'user' ? '学习者' : 'AI'}：${turn.content}`)
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
        .map((item) => `- ${item.en}（${item.zh}）`)
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
        '- 不要输出分数、等级或百分比；不要评价发音。',
    ].join('\n');
};
