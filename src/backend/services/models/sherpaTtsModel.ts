/**
 * Sherpa-ONNX Piper 英语 TTS 模型的固定安装目录名。
 *
 * 采用 lessac-medium（22kHz）而不是原来的 amy-low（16kHz）：
 * amy-low 对单个短词收尾偏软、尾辅音常常听不出来，lessac 清晰度明显更高。
 */
export const SHERPA_TTS_MODEL_DIRECTORY = 'vits-piper-en_US-lessac-medium';

/** Sherpa-ONNX Piper TTS 模型归档的官方下载地址（GitHub Releases，大陆直连极慢）。 */
export const SHERPA_TTS_MODEL_DOWNLOAD_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2';

/**
 * 有序候选下载地址。
 *
 * 说明：项目自建的 ModelScope 镜像目前只同步了 amy-low，没有 lessac-medium，
 * 因此这里只有官方源；镜像补上该音色后再加回来。
 */
export const SHERPA_TTS_MODEL_DOWNLOAD_URLS = [
    SHERPA_TTS_MODEL_DOWNLOAD_URL,
] as const;

/** 归档文件的 SHA256，下载完成后校验，防止镜像或代理被篡改。 */
export const SHERPA_TTS_MODEL_ARCHIVE_SHA256 = '9e3febfacf0abf4270172d2958bcec246032b7e88efc2720840cc80c93de334e';

export const SHERPA_TTS_MODEL_ARCHIVE_NAME = 'vits-piper-en_US-lessac-medium.tar.bz2';

/** Sherpa-ONNX Piper TTS 模型运行所需的文件。 */
export const SHERPA_TTS_REQUIRED_FILES = [
    'en_US-lessac-medium.onnx',
    'tokens.txt',
    'espeak-ng-data',
] as const;
