import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import TYPES from '@/backend/ioc/types';
import type SrsService from '@/backend/services/SrsService';

/**
 * 间隔复习 IPC 控制器：注册 srs/* 路径。
 */
@injectable()
export default class SrsController implements Controller {
    @inject(TYPES.SrsService)
    private srsService!: SrsService;

    registerRoutes(): void {
        registerRoute('srs/add-card', (p) => this.srsService.addCard(p));
        registerRoute('srs/overview', () => this.srsService.overview());
        registerRoute('srs/submit-review', (p) => this.srsService.submitReview(p));
        registerRoute('srs/remove-card', (p) => this.srsService.removeCard(p.cardId));
        registerRoute('srs/sentence-audio', (p) => this.srsService.getSentenceAudio(p.cardId));
    }
}
