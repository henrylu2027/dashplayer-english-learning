import { describe, expect, it, vi } from 'vitest';
import { groupTokensIntoWords } from '@/backend/services/speech/RecordedSpeechService';

// 日志与运行时路径是系统边界：模块加载期会触达 Electron app，测试中静音并替换。
vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));
vi.mock('@/backend/utils/runtimeEnv', () => ({
    getRuntimeResourcePath: vi.fn(() => '/fake/resource'),
    isDevelopmentMode: vi.fn(() => true),
}));

describe('子词聚合为词', () => {
    it('按是否以空格开头切分单词', () => {
        const words = groupTokensIntoWords([
            { text: ' R', probability: 0.9 },
            { text: 'ose', probability: 0.8 },
            { text: ' ', probability: 0.5 },
            { text: ' I', probability: 0.99 },
        ]);

        expect(words.map((word) => word.text)).toEqual(['Rose', 'I']);
    });

    it('一个词的概率取它所有子词里最低的那个', () => {
        const words = groupTokensIntoWords([
            { text: ' pen', probability: 0.98 },
            { text: 'cil', probability: 0.42 },
        ]);

        expect(words).toEqual([{ text: 'pencil', probability: 0.42 }]);
    });

    it('引擎没有给概率时按 1 处理，不猜测', () => {
        const words = groupTokensIntoWords([{ text: ' hello' }]);

        expect(words).toEqual([{ text: 'hello', probability: 1 }]);
    });

    it('只有空白的 token 被跳过，不影响后续词', () => {
        const words = groupTokensIntoWords([
            { text: ' ' },
            { text: ' He', probability: 0.7 },
            { text: ' ' },
            { text: ' said', probability: 0.3 },
        ]);

        expect(words).toEqual([
            { text: 'He', probability: 0.7 },
            { text: 'said', probability: 0.3 },
        ]);
    });

    it('空输入返回空数组', () => {
        expect(groupTokensIntoWords([])).toEqual([]);
    });
});
