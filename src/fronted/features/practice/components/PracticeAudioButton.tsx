import { useTranslation } from 'react-i18next';
import { Loader2, Volume2 } from 'lucide-react';

import type { ShadowingAttemptSource } from '@/common/contracts/shadowing';
import { Button } from '@/fronted/components/ui/button';
import { usePracticeAudio } from '../usePracticeAudio';

/**
 * 播放当前句原声的按钮；没有可用视频/字幕路径时置灰并给出提示。
 */
export default function PracticeAudioButton({
    source,
    canPlay,
    disabled = false,
}: {
    source: ShadowingAttemptSource;
    canPlay: boolean;
    disabled?: boolean;
}) {
    const { t } = useTranslation('pages');
    const { phase, toggle } = usePracticeAudio(source);
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg px-3 text-xs"
                disabled={disabled || !canPlay || phase === 'loading'}
                onClick={() => void toggle()}
            >
                {phase === 'loading' ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                    <Volume2 className="mr-1 h-3.5 w-3.5" />
                )}
                {phase === 'playing' ? t('practice.stopAudio') : t('practice.listen')}
            </Button>
            {!canPlay && <span className="text-xs text-muted-foreground">{t('practice.noAudioHint')}</span>}
        </div>
    );
}
