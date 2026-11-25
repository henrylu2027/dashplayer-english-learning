import { randomUUID } from 'crypto';
import path from 'path';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type FfmpegService from '@/backend/services/FfmpegService';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type TranscriptionEngineSelector from '@/backend/services/TranscriptionEngineSelector';
import { concurrency } from '@/backend/utils/concurrency';

/**
 * 浏览器端录音的转写结果。
 */
export interface RecordedSpeechResult {
    /** 识别文本。 */
    text: string;
    /** 转码后音频时长，单位秒。 */
    durationSec: number;
}

/**
 * 浏览器端录音转写契约。
 *
 * 跟读评分与复述共用：把渲染进程录制的原始音频写成临时文件、转 16kHz WAV、
 * 用当前识别引擎转写，结束后清理临时文件。
 */
export default interface RecordedSpeechService {
    /**
     * 转写一段浏览器录音。
     *
     * @param params.audio 渲染进程录制的原始音频字节。
     * @param params.mimeType 录音 MIME 类型，用于决定临时文件扩展名。
     * @param params.job 日志检索键。
     * @returns 识别文本与音频时长。
     * @throws 音频为空/过大/格式不支持，或转码、识别失败时抛出。
     */
    transcribe(params: {
        audio: Uint8Array;
        mimeType: string;
        job: string;
    }): Promise<RecordedSpeechResult>;
}

/** 单次录音字节上限（25MB），足够覆盖 60 秒的常见音频编码，同时兜住异常大包。 */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** 允许的录音 MIME 类型 → 临时文件扩展名；MediaRecorder 的 codecs 参数会被忽略。 */
const AUDIO_EXTENSION_BY_MIME: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
};

/**
 * 从 MIME 类型解析临时文件扩展名。
 *
 * @param mimeType 录音 MIME，可带 `;codecs=...` 参数。
 * @returns 对应的文件扩展名。
 * @throws MIME 缺失或不在白名单内时抛出。
 */
function resolveAudioExtension(mimeType: string): string {
    const baseType = mimeType.split(';')[0].trim().toLowerCase();
    const extension = AUDIO_EXTENSION_BY_MIME[baseType];
    if (!extension) {
        throw new Error(`不支持的录音格式：${mimeType || '未知'}`);
    }
    return extension;
}

/**
 * 本地录音转写服务。
 */
@injectable()
export class RecordedSpeechServiceImpl implements RecordedSpeechService {
    private readonly logger = getMainLogger('RecordedSpeechService');

    @inject(TYPES.StorageDirectoryProvider)
    private storageDirectoryProvider!: StorageDirectoryProvider;

    @inject(TYPES.FileSystemGateway)
    private fileSystemGateway!: FileSystemGateway;

    @inject(TYPES.FfmpegService)
    private ffmpegService!: FfmpegService;

    @inject(TYPES.TranscriptionEngineSelector)
    private transcriptionEngineSelector!: TranscriptionEngineSelector;

    public async transcribe(params: {
        audio: Uint8Array;
        mimeType: string;
        job: string;
    }): Promise<RecordedSpeechResult> {
        if (!(params.audio instanceof Uint8Array) || params.audio.byteLength === 0) {
            throw new Error('没有录到声音，请重试');
        }
        if (params.audio.byteLength > MAX_AUDIO_BYTES) {
            throw new Error('录音数据过大，请缩短录音后重试');
        }
        const extension = resolveAudioExtension(params.mimeType);

        const tempRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.TEMP);
        const tempFolder = path.join(tempRoot, 'recorded-speech', randomUUID());
        const rawFile = path.join(tempFolder, `recording.${extension}`);
        const wavFile = path.join(tempFolder, 'recording-16k.wav');
        try {
            await this.fileSystemGateway.ensureDirectory(tempFolder);
            await this.fileSystemGateway.writeBinaryFile(rawFile, params.audio);
            await this.ffmpegService.convertToWav(rawFile, wavFile);
            const durationSec = await this.ffmpegService.duration(wavFile);

            const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
            const gateway = this.transcriptionEngineSelector.select();
            // 与批量转录共用 whisper 信号量，避免两路识别同时抢 CPU；调用链里没有持有更高序的锁
            const recognition = await concurrency.withSemaphore(
                'whisper',
                () => gateway.transcribe({ audioPath: wavFile, modelsRoot, job: params.job }),
                { skipOrderCheck: true },
            );
            return { text: recognition.text.trim(), durationSec };
        } finally {
            try {
                await this.fileSystemGateway.removeDirectoryIfExists(tempFolder);
            } catch (cleanupError) {
                // 清理失败只产生临时文件残留，不影响本次结果
                this.logger.warn('录音临时文件清理失败', { job: params.job, tempFolder, cleanupError });
            }
        }
    }
}
