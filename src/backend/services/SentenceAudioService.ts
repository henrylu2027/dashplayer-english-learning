import { createHash } from 'crypto';
import path from 'path';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type FfmpegService from '@/backend/services/FfmpegService';
import type SubtitleService from '@/backend/services/SubtitleService';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';

/**
 * 视频句原声提取契约。
 *
 * 按字幕时间区间从视频裁出一段 mp3 并缓存；复习、听写、复述共用同一份缓存，
 * 同一句只转码一次。
 */
export default interface SentenceAudioService {
    /**
     * 提取某个字幕句的原声。
     *
     * @param params.videoPath 视频绝对路径。
     * @param params.subtitlePath 字幕绝对路径。
     * @param params.sentenceIndex 字幕句序号。
     * @param params.job 可选日志检索键，用于串联调用方。
     * @returns 音频文件绝对路径，供渲染进程播放。
     * @throws 视频不存在、字幕解析失败、句子定位失败或时间区间非法时抛出。
     */
    extract(params: {
        videoPath: string;
        subtitlePath: string;
        sentenceIndex: number;
        job?: string;
    }): Promise<string>;
}

/**
 * 基于 ffmpeg 截取字幕句原声的服务。
 */
@injectable()
export class SentenceAudioServiceImpl implements SentenceAudioService {
    private readonly logger = getMainLogger('SentenceAudioService');

    /** 正在提取中的任务；同一句重复请求时复用同一个 Promise，避免重复写同一缓存文件。 */
    private readonly extractions = new Map<string, Promise<string>>();

    @inject(TYPES.SubtitleService)
    private subtitleService!: SubtitleService;

    @inject(TYPES.FfmpegService)
    private ffmpegService!: FfmpegService;

    @inject(TYPES.StorageDirectoryProvider)
    private storageDirectoryProvider!: StorageDirectoryProvider;

    @inject(TYPES.FileSystemGateway)
    private fileSystemGateway!: FileSystemGateway;

    public async extract(params: {
        videoPath: string;
        subtitlePath: string;
        sentenceIndex: number;
        job?: string;
    }): Promise<string> {
        const { videoPath, subtitlePath, sentenceIndex, job } = params;
        if (!(await this.fileSystemGateway.fileExists(videoPath))) {
            throw new Error(`原视频不存在：${videoPath}`);
        }
        const parsed = await this.subtitleService.parseSrt(subtitlePath);
        const sentence = parsed.sentences.find((item) => item.index === sentenceIndex);
        if (!sentence) {
            throw new Error(`字幕里找不到第 ${sentenceIndex} 句，无法播放原声`);
        }
        const start = sentence.adjustedStart ?? sentence.start;
        const end = sentence.adjustedEnd ?? sentence.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            throw new Error('句子时间区间无效，无法播放原声');
        }

        const cacheKey = createHash('sha1').update(`${videoPath}|${start}|${end}`).digest('hex');
        const tempRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.TEMP);
        const folder = path.join(tempRoot, 'sentence-audio');
        const audioFile = path.join(folder, `${cacheKey}.mp3`);
        if (await this.fileSystemGateway.fileExists(audioFile)) {
            return audioFile;
        }

        const inFlight = this.extractions.get(audioFile);
        if (inFlight) {
            return inFlight;
        }
        const task = (async (): Promise<string> => {
            await this.fileSystemGateway.ensureDirectory(folder);
            await this.ffmpegService.trimAudio(videoPath, start, end, audioFile);
            this.logger.info('sentence audio extracted', {
                job,
                start,
                end,
                audioFile,
            });
            return audioFile;
        })();
        this.extractions.set(audioFile, task);
        try {
            return await task;
        } finally {
            this.extractions.delete(audioFile);
        }
    }
}
