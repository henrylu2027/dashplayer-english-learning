import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getRendererLogger } from '@/fronted/log/simple-logger';
import { shadowingApi } from './shadowingApi';

const logger = getRendererLogger('useAudioRecorder');

/** 单次录音默认最长时长（毫秒）：到点自动停止，避免用户忘记点结束。 */
const DEFAULT_MAX_DURATION_MS = 60_000;

/** 录音计时刷新间隔（毫秒）。 */
const TIMER_TICK_MS = 200;

/** 录音阶段。 */
export type AudioRecorderPhase = 'idle' | 'recording';

/**
 * 通用麦克风录音器。
 */
export interface AudioRecorder {
    /** 当前是否在录音。 */
    phase: AudioRecorderPhase;
    /** 已录制时长（秒）；停止后归零。 */
    elapsedSec: number;
    /** 麦克风或录音启动失败的提示；开始新一轮时清空。 */
    error: string | null;
    /**
     * 开始录音。
     * @returns 是否真正开始；授权失败、无麦克风或被取消时为 false。
     */
    start: () => Promise<boolean>;
    /** 停止录音；停止后通过 onStop 回调交出完整 Blob。 */
    stop: () => void;
}

/**
 * 把 getUserMedia 的失败原因映射为界面提示文案的 i18n key。
 *
 * 没插麦克风、被别的程序占用和用户拒绝授权是三种不同情况，
 * 混成一句「没有权限」会让用户排查错方向。
 *
 * @param error getUserMedia 抛出的异常。
 * @returns 对应提示文案的 i18n key。
 */
function resolveMicErrorKey(error: unknown): string {
    if (error instanceof DOMException) {
        if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            return 'shadowing.micNotFound';
        }
        if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            return 'shadowing.micBusy';
        }
    }
    return 'shadowing.micDenied';
}

/**
 * 判断当前环境可用的录音 MIME，优先 opus 编码的 webm。
 * @returns 可用的 MIME；环境不支持 MediaRecorder 时返回 undefined。
 */
function pickMimeType(): string | undefined {
    if (typeof MediaRecorder === 'undefined') {
        return undefined;
    }
    for (const mimeType of ['audio/webm;codecs=opus', 'audio/webm']) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
            return mimeType;
        }
    }
    return undefined;
}

/**
 * 页面级通用录音器：麦克风开流、MediaRecorder 录音、停止后交出 Blob。
 *
 * 跟读、复述共用；业务方只处理 Blob（提交后端识别或评分），不接触
 * MediaRecorder 生命周期。麦克风授权（含 macOS 系统弹框）、最长录音、
 * 卸载清理都在这里统一处理。
 *
 * @param options.maxDurationMs 最长录音时长，默认 60 秒。
 * @param options.onStop 录音结束回调；同一时刻只会有一路录音。
 */
export function useAudioRecorder(options: {
    maxDurationMs?: number;
    onStop: (blob: Blob) => Promise<void> | void;
}): AudioRecorder {
    const { t } = useTranslation('pages');
    const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

    const [phase, setPhase] = useState<AudioRecorderPhase>('idle');
    const [elapsedSec, setElapsedSec] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<number | null>(null);
    const maxTimerRef = useRef<number | null>(null);
    const startedAtRef = useRef<number | null>(null);
    const phaseRef = useRef<AudioRecorderPhase>('idle');
    /** 防止授权/开流期间重复点击导致两路麦克风同时打开。 */
    const startingRef = useRef(false);
    /** 授权/开流期间用户已经点了停止：流程走到检查点时作废本次录音。 */
    const abortRequestedRef = useRef(false);
    const mountedRef = useRef(true);
    /** 最新 onStop，避免录音器闭包拿到旧回调。 */
    const onStopRef = useRef(options.onStop);

    useEffect(() => {
        onStopRef.current = options.onStop;
    }, [options.onStop]);

    /**
     * 同步更新阶段 state 与镜像 ref。
     * @param next 目标阶段。
     */
    const applyPhase = (next: AudioRecorderPhase): void => {
        phaseRef.current = next;
        setPhase(next);
    };

    /** 清掉计时器。 */
    const clearTimers = (): void => {
        if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (maxTimerRef.current !== null) {
            window.clearTimeout(maxTimerRef.current);
            maxTimerRef.current = null;
        }
    };

    /** 释放麦克风。 */
    const releaseStream = (): void => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    };

    /** 停止当前录音；录音器的 onstop 负责交出数据。 */
    const stopRecorder = (): void => {
        clearTimers();
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
            recorder.stop();
        }
    };

    const start = async (): Promise<boolean> => {
        if (phaseRef.current !== 'idle' || startingRef.current) {
            return false;
        }
        if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            setError(t('shadowing.micUnsupported'));
            return false;
        }

        startingRef.current = true;
        abortRequestedRef.current = false;
        setError(null);
        setElapsedSec(0);
        try {
            // macOS 的授权框要由主进程请求才会弹；未授权时 Chromium 只给全静音音轨且不报错
            const micStatus = await shadowingApi.ensureMicrophone();
            if (!mountedRef.current || abortRequestedRef.current) {
                return false;
            }
            if (micStatus !== 'granted') {
                logger.warn('麦克风授权未就绪，取消录音', { micStatus });
                setError(t('shadowing.micDenied'));
                return false;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
            if (!mountedRef.current || abortRequestedRef.current) {
                stream.getTracks().forEach((track) => track.stop());
                return false;
            }
            streamRef.current = stream;

            chunksRef.current = [];
            const mimeType = pickMimeType();
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            recorderRef.current = recorder;
            recorder.ondataavailable = (event: BlobEvent) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };
            recorder.onstop = () => {
                releaseStream();
                recorderRef.current = null;
                const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
                chunksRef.current = [];
                applyPhase('idle');
                setElapsedSec(0);
                startedAtRef.current = null;
                void onStopRef.current(blob);
            };
            recorder.start(200);

            applyPhase('recording');
            startedAtRef.current = Date.now();
            setElapsedSec(0);
            timerRef.current = window.setInterval(() => {
                if (startedAtRef.current !== null) {
                    setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
                }
            }, TIMER_TICK_MS);
            maxTimerRef.current = window.setTimeout(stopRecorder, maxDurationMs);
            return true;
        } catch (startError) {
            logger.error('获取麦克风失败', { error: startError });
            releaseStream();
            applyPhase('idle');
            setError(t(resolveMicErrorKey(startError)));
            return false;
        } finally {
            startingRef.current = false;
        }
    };

    const stop = (): void => {
        if (phaseRef.current === 'recording') {
            stopRecorder();
            return;
        }
        // 还在授权/开流途中：打上作废标记，等流程走到检查点自行退出，
        // 不会在用户已经点过停止之后突然开始收音
        if (startingRef.current) {
            abortRequestedRef.current = true;
        }
    };

    // 卸载时中断录音并释放麦克风
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            clearTimers();
            const recorder = recorderRef.current;
            if (recorder) {
                // 卸载后不再回传录音，避免对已离开的页面 setState
                recorder.onstop = null;
                if (recorder.state !== 'inactive') {
                    recorder.stop();
                }
                recorderRef.current = null;
            }
            releaseStream();
        };
    }, []);

    return { phase, elapsedSec, error, start, stop };
}
