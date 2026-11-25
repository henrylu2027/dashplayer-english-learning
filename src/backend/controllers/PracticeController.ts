import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import TYPES from '@/backend/ioc/types';
import type PracticeService from '@/backend/services/PracticeService';

/**
 * 精听练习 IPC 控制器：注册 practice/* 路径。
 */
@injectable()
export default class PracticeController implements Controller {
    @inject(TYPES.PracticeService)
    private practiceService!: PracticeService;

    registerRoutes(): void {
        registerRoute('practice/dictation', (p) => this.practiceService.dictation(p));
        registerRoute('practice/retell', (p) => this.practiceService.retell(p));
        registerRoute('practice/list-attempts', (p) => this.practiceService.listAttempts(p));
        registerRoute('practice/sentence-audio', (p) => this.practiceService.getSentenceAudio(p.source));
    }
}
