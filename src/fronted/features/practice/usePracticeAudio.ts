import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';
import UrlUtil from '@/common/utils/UrlUtil';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { practiceApi } from './practiceApi';

const logger = getRendererLogger('usePracticeAudio');

/** 原声播放阶段。 */
export type PracticeAudioPhase = 'idle' | 'loading' | 'playing';

/**
 * 播放当前句原声。
 *
 * 音频由后端从视频里裁出并缓存，第一次点击稍慢；再次点击可停止。
 * 卸载时自动停止，不会在切换模式后继续播放。
 *
 * @param source 当前句子的视频来源。
 */
export function usePracticeAudio(source: ShadowingAttemptSource | null): {
    phase: PracticeAudioPhase;
    toggle: () => Promise<void>;
    stop: () => void;
} {
    const { t } = useTranslation('pages');
    const [phase, setPhase] = useState<PracticeAudioPhase>('idle');
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const stop = (): void => {
        audioRef.current?.pause();
        audioRef.current = null;
        setPhase('idle');
    };

    useEffect(() => {
        return () => {
            audioRef.current?.pause();
            audioRef.current = null;
        };
    }, []);

    const toggle = async (): Promise<void> => {
        if (phase === 'playing') {
            stop();
            return;
        }
        if (phase === 'loading' || !source || source.kind !== 'video') {
            return;
        }
        setPhase('loading');
        try {
            const filePath = await practiceApi.sentenceAudio(source);
            const audio = new Audio(UrlUtil.toUrl(filePath));
            audioRef.current = audio;
            audio.onended = () => {
                audioRef.current = null;
                setPhase('idle');
            };
            await audio.play();
            setPhase('playing');
        } catch (audioError) {
            logger.error('播放原声失败', { error: audioError });
            toast.error(audioError instanceof Error ? audioError.message : t('practice.listenFailed'));
            setPhase('idle');
        }
    };

    return { phase, toggle, stop };
}
