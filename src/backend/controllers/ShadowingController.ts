import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import TYPES from '@/backend/ioc/types';
import type ShadowingService from '@/backend/services/ShadowingService';

/**
 * 跟读打分 IPC 控制器：注册 shadowing/* 路径，把请求转交给 ShadowingService。
 */
@injectable()
export default class ShadowingController implements Controller {
    @inject(TYPES.ShadowingService)
    private shadowingService!: ShadowingService;

    registerRoutes(): void {
        registerRoute('shadowing/score', (p) => this.shadowingService.score(p));
        registerRoute('shadowing/list-attempts', (p) => this.shadowingService.listAttempts(p));
    }
}
