import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { inject, injectable } from 'inversify';
import { app } from 'electron';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type FfmpegService from '@/backend/services/FfmpegService';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';

const execFileAsync = promisify(execFile);

/**
 * 一个词的重音检查结果（仅多音节词有）。
 */
export interface PronunciationStress {
    /** 词典标注的重读音节下标（从 0 开始）。 */
    expected: number;
    /** 按能量峰值判断的实际重读音节下标。 */
    heard: number;
    /** 两者是否一致。 */
    ok: boolean;
    /** 音节总数。 */
    syllables: number;
}

/**
 * 一个词的发音分。
 */
export interface PronunciationWordScore {
    /** 参考句里的词，保留原样含标点。 */
    word: string;
    /** 该词发音分，0~100。 */
    score: number;
    /** 重音检查；单音节词或缺词典条目时为 null。 */
    stress: PronunciationStress | null;
}

/**
 * 一次发音评估结果。
 */
export interface PronunciationResult {
    /** 整句发音分，0~100。 */
    score: number;
    /** 逐词发音分，用于标出偏差最大的词。 */
    words: PronunciationWordScore[];
    /** 评估所用模型名。 */
    model: string;
    /** 音频时长，单位秒。 */
    durationSec: number;
}

/**
 * 本地发音评估契约。
 *
 * 用 wav2vec2 字符级 CTC 模型做强制对齐，纯离线；不依赖任何云服务。
 */
export default interface PronunciationService {
    /**
     * 给一段录音按参考句打分。
     *
     * @param params.audio 渲染进程录制的原始音频字节。
     * @param params.mimeType 录音 MIME 类型。
     * @param params.referenceText 参考句。
     * @param params.job 日志检索键。
     * @returns 整句分与逐词分。
     * @throws 音频为空、转码失败、侧车缺失或侧车报错时抛出。
     */
    score(params: {
        audio: Uint8Array;
        mimeType: string;
        referenceText: string;
        job: string;
    }): Promise<PronunciationResult>;
}

/** 侧车单次运行超时（毫秒）。 */
const SIDECAR_TIMEOUT_MS = 120_000;

/** 录音 MIME → 临时文件扩展名。 */
const AUDIO_EXTENSION_BY_MIME: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
};

/**
 * 解析侧车给出的重音检查结果。
 *
 * @param raw 侧车 JSON 里的 stress 字段。
 * @returns 结构化重音结果；缺失或格式非法时为 null。
 */
function parseStress(raw: unknown): PronunciationStress | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const record = raw as { expected?: unknown; heard?: unknown; ok?: unknown; syllables?: unknown };
    const expected = Number(record.expected);
    const heard = Number(record.heard);
    const syllables = Number(record.syllables);
    if (!Number.isInteger(expected) || !Number.isInteger(heard) || !Number.isInteger(syllables)) {
        return null;
    }
    return {
        expected,
        heard,
        ok: record.ok === true || expected === heard,
        syllables,
    };
}

/**
 * 解析临时文件扩展名。
 * @param mimeType 录音 MIME。
 * @returns 扩展名。
 * @throws MIME 不在白名单时抛出。
 */
function resolveExtension(mimeType: string): string {
    const baseType = mimeType.split(';')[0].trim().toLowerCase();
    const extension = AUDIO_EXTENSION_BY_MIME[baseType];
    if (!extension) {
        throw new Error(`不支持的录音格式：${mimeType || '未知'}`);
    }
    return extension;
}

/**
 * 基于 wav2vec2 ONNX 侧车的发音评估服务。
 */
@injectable()
export class PronunciationServiceImpl implements PronunciationService {
    private readonly logger = getMainLogger('PronunciationService');

    @inject(TYPES.StorageDirectoryProvider)
    private storageDirectoryProvider!: StorageDirectoryProvider;

    @inject(TYPES.FileSystemGateway)
    private fileSystemGateway!: FileSystemGateway;

    @inject(TYPES.FfmpegService)
    private ffmpegService!: FfmpegService;

    public async score(params: {
        audio: Uint8Array;
        mimeType: string;
        referenceText: string;
        job: string;
    }): Promise<PronunciationResult> {
        if (!(params.audio instanceof Uint8Array) || params.audio.byteLength === 0) {
            throw new Error('没有录到声音，无法评估发音');
        }
        const extension = resolveExtension(params.mimeType);
        const tempRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.TEMP);
        const tempFolder = path.join(tempRoot, 'pronunciation', randomUUID());
        const rawFile = path.join(tempFolder, `recording.${extension}`);
        const wavFile = path.join(tempFolder, 'recording-16k.wav');
        try {
            await this.fileSystemGateway.ensureDirectory(tempFolder);
            await this.fileSystemGateway.writeBinaryFile(rawFile, params.audio);
            await this.ffmpegService.convertToWav(rawFile, wavFile);
            return await this.runSidecar(wavFile, params.referenceText, params.job);
        } finally {
            try {
                await this.fileSystemGateway.removeDirectoryIfExists(tempFolder);
            } catch (cleanupError) {
                this.logger.warn('发音临时文件清理失败', { job: params.job, cleanupError });
            }
        }
    }

    /**
     * 调用 Python 侧车打分。
     *
     * @param wavFile 16kHz 单声道 WAV 路径。
     * @param referenceText 参考句。
     * @param job 日志检索键。
     * @returns 解析后的评分。
     * @throws 侧车缺失、超时或输出不是合法 JSON 时抛出。
     */
    private async runSidecar(wavFile: string, referenceText: string, job: string): Promise<PronunciationResult> {
        const python = this.resolvePython();
        const script = this.resolveScript();
        const startedAt = Date.now();
        const { stdout } = await execFileAsync(
            python,
            [script, '--wav', wavFile, '--text', referenceText],
            { timeout: SIDECAR_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        );
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            throw new Error(`发音侧车输出无法解析：${line.slice(0, 200)}`);
        }
        const data = parsed as {
            error?: unknown;
            score?: unknown;
            words?: Array<{ word?: unknown; score?: unknown; stress?: unknown }>;
            model?: unknown;
            durationSec?: unknown;
        };
        if (typeof data.error === 'string') {
            throw new Error(data.error);
        }
        const score = Number(data.score);
        if (!Number.isFinite(score)) {
            throw new Error('发音侧车没有返回分数');
        }
        this.logger.info('pronunciation scored', {
            job,
            score,
            elapsedMs: Date.now() - startedAt,
            words: Array.isArray(data.words) ? data.words.length : 0,
        });
        return {
            score: Math.round(score),
            words: (data.words ?? [])
                .map((item) => ({
                    word: typeof item.word === 'string' ? item.word : '',
                    score: Number(item.score) || 0,
                    stress: parseStress(item.stress),
                }))
                .filter((item) => item.word.length > 0),
            model: typeof data.model === 'string' ? data.model : 'wav2vec2',
            durationSec: Number(data.durationSec) || 0,
        };
    }

    /**
     * 定位 Python 解释器：优先环境变量，其次应用目录与 resources 下的侧车 venv。
     * @returns 解释器绝对路径。
     * @throws 找不到时抛出。
     */
    private resolvePython(): string {
        const candidates: string[] = [];
        if (process.env.DASHPLAYER_PRON_PYTHON) {
            candidates.push(process.env.DASHPLAYER_PRON_PYTHON);
        }
        const rel = path.join('tools', 'pron-sidecar', '.venv', 'Scripts', 'python.exe');
        candidates.push(path.join(app.getAppPath(), rel));
        candidates.push(path.join(process.resourcesPath, 'pron-sidecar', '.venv', 'Scripts', 'python.exe'));
        for (const candidate of candidates) {
            if (candidate && fs.existsSync(candidate)) {
                return candidate;
            }
        }
        throw new Error('发音评估组件未安装（找不到 Python 侧车），请先安装 tools/pron-sidecar');
    }

    /**
     * 定位侧车脚本。
     * @returns 脚本绝对路径。
     * @throws 找不到时抛出。
     */
    private resolveScript(): string {
        const candidates: string[] = [];
        if (process.env.DASHPLAYER_PRON_SCRIPT) {
            candidates.push(process.env.DASHPLAYER_PRON_SCRIPT);
        }
        candidates.push(path.join(app.getAppPath(), 'tools', 'pron-sidecar', 'score.py'));
        candidates.push(path.join(process.resourcesPath, 'pron-sidecar', 'score.py'));
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        throw new Error('发音评估脚本缺失：tools/pron-sidecar/score.py');
    }
}
