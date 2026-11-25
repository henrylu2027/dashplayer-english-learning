/**
 * 英文词序列的归一化工具，供跟读评分、听写校对与复述关键词共用。
 */

/**
 * 把词归一化为可比较的形式：转小写、去掉撇号以外的标点、去掉首尾撇号。
 *
 * 这样 `Hello,`、`HELLO`、`hello!` 都视为同一个词；`don't` 仍保留词内撇号。
 *
 * @param word 原始词。
 * @returns 用于比较的归一化词；可能为空串。
 */
export function normalizeWord(word: string): string {
    return word
        .toLowerCase()
        .replace(/[^a-z0-9']/g, '')
        .replace(/^'+/, '')
        .replace(/'+$/, '');
}

/**
 * 把文本切成用于比较的词序列。
 *
 * 按空白与连字符切分（`well-known` 与 `well known` 视为两个词），
 * 弯引号统一为直撇号；归一化后为空的片段（纯标点、符号）会被丢弃。
 *
 * @param text 参考文本或识别文本。
 * @returns 保留原始大小写与标点的展示词序列。
 */
export function tokenizeForScoring(text: string): string[] {
    return text
        .normalize('NFKC')
        .replace(/[‘’ʼ]/g, '\'')
        .split(/[\s\-‐‑–—]+/)
        .filter((token) => normalizeWord(token).length > 0);
}
