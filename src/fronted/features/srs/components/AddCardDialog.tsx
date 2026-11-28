import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';

import { Button } from '@/fronted/components/ui/button';
import { Textarea } from '@/fronted/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/fronted/components/ui/dialog';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { srsApi } from '../srsApi';

const logger = getRendererLogger('SrsAddCardDialog');

/**
 * 手动添加句子弹窗。
 *
 * 只能添加自由文本：没有原声，复习时走跟读。输入单个词会因「无原声原句」被拒绝。
 * 由父组件在打开时挂载、关闭时卸载，草稿随之清空。
 */
export interface AddCardDialogProps {
    /** 关闭回调。 */
    onClose: () => void;
    /** 添加成功后刷新队列。 */
    onAdded: () => Promise<void>;
}

export default function AddCardDialog({ onClose, onAdded }: AddCardDialogProps) {
    const { t } = useTranslation('pages');
    const [text, setText] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const submit = async (): Promise<void> => {
        const referenceText = text.trim();
        if (!referenceText || submitting) {
            return;
        }
        setSubmitting(true);
        try {
            const response = await srsApi.addCard({
                referenceText,
                source: { kind: 'free' },
            });
            toast.success(response.created ? t('srs.added') : t('srs.alreadyAdded'));
            onClose();
            await onAdded();
        } catch (error) {
            logger.error('手动添加句子失败', { error });
            toast.error(error instanceof Error ? error.message : t('srs.addFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open onOpenChange={(next) => !next && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('srs.addDialogTitle')}</DialogTitle>
                    <DialogDescription>{t('srs.addDialogHint')}</DialogDescription>
                </DialogHeader>
                <Textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder={t('srs.addDialogPlaceholder')}
                    className="min-h-[96px] resize-none text-sm"
                    disabled={submitting}
                />
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        className="rounded-lg"
                        disabled={submitting}
                        onClick={onClose}
                    >
                        {t('srs.cancel')}
                    </Button>
                    <Button
                        type="button"
                        className="rounded-lg"
                        disabled={!text.trim() || submitting}
                        onClick={() => void submit()}
                    >
                        {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                        {t('srs.addDialogConfirm')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
