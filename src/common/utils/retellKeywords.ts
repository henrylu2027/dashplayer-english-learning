import { normalizeWord, tokenizeForScoring } from '@/common/utils/wordTokens';

/**
 * 复述提示用的常见虚词表。
 *
 * 复述看的是“有没有说出关键信息”，因此提示词从实词里取；这张表只覆盖高频虚词，
 * 不追求完整词性标注，避免引入额外依赖。
 */
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'because',
    'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'about',
    'as', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
    'do', 'does', 'did', 'have', 'has', 'had',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'its', 'our', 'their',
    'this', 'that', 'these', 'those', 'there', 'here',
    'what', 'who', 'whom', 'whose', 'which', 'when', 'where', 'why', 'how',
    'not', 'no', 'yes', 'can', 'could', 'will', 'would', 'shall', 'should',
    'may', 'might', 'must', 'just', 'very', 'too', 'also', 'oh', 'um', 'uh',
]);

/** 默认最多给出的关键词数量：太多就失去提示作用。 */
const DEFAULT_MAX_KEYWORDS = 8;

/**
 * 从参考句子里提取复述提示词。
 *
 * 取非虚词的实词，去重后按出现顺序返回，最多 `maxKeywords` 个；
 * 整句都是虚词时退回为全部词，保证至少有关键词可用于覆盖判定。
 *
 * @param referenceText 参考文本。
 * @param maxKeywords 最多返回的关键词数。
 * @returns 归一化后的关键词（小写、无标点）。
 */
export function extractRetellKeywords(
    referenceText: string,
    maxKeywords: number = DEFAULT_MAX_KEYWORDS,
): string[] {
    const picked: string[] = [];
    const seen = new Set<string>();
    for (const token of tokenizeForScoring(referenceText)) {
        const key = normalizeWord(token);
        if (key.length === 0 || STOP_WORDS.has(key) || seen.has(key)) {
            continue;
        }
        seen.add(key);
        picked.push(key);
        if (picked.length >= maxKeywords) {
            return picked;
        }
    }
    if (picked.length > 0) {
        return picked;
    }
    // 全句都是虚词（如 "I do"）：退回所有词，仍然给出可覆盖的提示
    for (const token of tokenizeForScoring(referenceText)) {
        const key = normalizeWord(token);
        if (key.length === 0 || seen.has(key)) {
            continue;
        }
        seen.add(key);
        picked.push(key);
        if (picked.length >= maxKeywords) {
            break;
        }
    }
    return picked;
}
