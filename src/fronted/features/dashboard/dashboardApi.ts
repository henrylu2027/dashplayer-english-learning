import type { DashboardSummary } from '@/common/contracts/dashboard';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';

/**
 * 学习台功能的 backendClient 封装。
 */
export const dashboardApi = {
    /** 获取今日任务、连续天数与近期活动。 */
    summary: (): Promise<DashboardSummary> => backendClient.call('dashboard/summary'),
};
