import * as os from 'os';
import * as path from 'path';
import { inject, injectable } from 'inversify';
import { WithSemaphore } from '@/backend/utils/concurrency/decorators';
import { SHERPA_TTS_MODEL_DIRECTORY } from '@/backend/services/models/sherpaTtsModel';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import TYPES from '@/backend/ioc/types';
import { SherpaOnnxTtsCli } from '@/backend/infrastructure/media/sherpa/SherpaOnnxTtsCli';
import type SherpaTtsModelService from '@/backend/services/SherpaTtsModelService';/** 句末标点判定（含中英文与引号/括号收尾）。 */
const TERMINAL_PUNCTUATION = /[.!?。！？…]["')\]]*$/;

/**
 * 给没有句末标点的文本补一个句号。
 *
 * Piper 的 VITS 模型对「没有句末标点」的短文本收尾偏快：单个单词常在尾辅音
 * （/t/ /k/ /d/）处戛然而止，听起来像没读完。补一个句号让模型按完整句子收尾，
 * 实测 put 0.43s → 0.64s、pocket 0.57s → 0.72s，尾音明显更完整。
 *
 * @param text 已 trim 的待合成文本。
 * @returns 补好句末标点的文本。
 */
const ensureTerminalPunctuation = (text: string): string => (TERMINAL_PUNCTUATION.test(text) ? text : `${text}.`);

/**
 * LocalTtsService 的业务契约。
 */
export default interface LocalTtsService {
    /**
     * 将文本合成为 WAV 文件。
     * @param text 待读取的英文文本；空文本直接失败。
     * @returns 临时 WAV 文件路径。
     */
    synthesize(text: string): Promise<string>;
}



/**
 * 使用本地 Sherpa-ONNX Piper 模型生成语音。
 */
@injectable()
export class LocalTtsServiceImpl implements LocalTtsService {
    constructor(
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.SherpaTtsModelService) private readonly modelService: SherpaTtsModelService,
        @inject(TYPES.SherpaOnnxTtsCli) private readonly cli: SherpaOnnxTtsCli,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    /**
     * 将文本合成为 WAV 文件。
     * @param text 待读取的英文文本；空文本直接失败。
     * @returns 临时 WAV 文件路径。
     */
    @WithSemaphore('tts')
    public async synthesize(text: string): Promise<string> {
        if (!text.trim()) throw new Error('TTS 文本不能为空');
        const status = await this.modelService.getStatus();
        if (!status.ready) throw new Error('Sherpa TTS 模型尚未下载，请先到设置中心下载模型');
        const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
        const modelDir = path.join(modelsRoot, SHERPA_TTS_MODEL_DIRECTORY);
        const outputDir = path.join(os.tmpdir(), 'dp', 'tts');
        await this.fileSystemGateway.ensureDirectory(outputDir);
        const outputPath = path.join(outputDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
        return this.cli.run({
            modelPath: path.join(modelDir, 'en_US-lessac-medium.onnx'),
            tokensPath: path.join(modelDir, 'tokens.txt'),
            dataDir: path.join(modelDir, 'espeak-ng-data'),
            outputPath,
            text: ensureTerminalPunctuation(text.trim()),
        });
    }
}
