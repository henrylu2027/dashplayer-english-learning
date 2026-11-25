import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import TYPES from '@/backend/ioc/types';
import type DashboardService from '@/backend/services/DashboardService';

/**
 * 学习台 IPC 控制器：注册 dashboard/* 路径。
 */
@injectable()
export default class DashboardController implements Controller {
    @inject(TYPES.DashboardService)
    private dashboardService!: DashboardService;

    registerRoutes(): void {
        registerRoute('dashboard/summary', () => this.dashboardService.summary());
    }
}
