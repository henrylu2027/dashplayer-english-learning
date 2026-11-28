import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type { DashboardDailyActivity, DashboardSummary } from '@/common/contracts/dashboard';
import type SrsCardRepository from '@/backend/services/repositories/SrsCardRepository';
import type SrsService from '@/backend/services/SrsService';
import type ShadowingAttemptRepository from '@/backend/services/repositories/ShadowingAttemptRepository';
import type PracticeAttemptRepository from '@/backend/services/repositories/PracticeAttemptRepository';
import type DialogueRepository from '@/backend/services/repositories/DialogueRepository';

/**
 * 学习台业务契约。
 */
export default interface DashboardService {
    /**
     * 聚合今日任务、连续天数、最近 7 天活动与最近跟读记录。
     *
     * 所有数字都从复习卡片表、跟读记录、练习记录和对话回合表现算，
     * 不读取任何缓存副本；练习口径为跟读 + 听写/复述 + 对话发言。
     *
     * @returns 学习台概览。
     */
    summary(): Promise<DashboardSummary>;
}

/** 最近活动展示的天数（含今天）。 */
const ACTIVITY_DAYS = 7;

/** 计算连续天数时最多回看的天数；一年以上的连续记录极少，取 400 天足够。 */
const STREAK_WINDOW_DAYS = 400;

/** 最近跟读记录条数。 */
const RECENT_ATTEMPT_LIMIT = 5;

/**
 * 把日期格式化为本机时区的 `YYYY-MM-DD`。
 * @param date 日期。
 */
function localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 学习台聚合服务。
 */
@injectable()
export class DashboardServiceImpl implements DashboardService {
    @inject(TYPES.SrsCardRepository)
    private srsCardRepository!: SrsCardRepository;

    @inject(TYPES.SrsService)
    private srsService!: SrsService;

    @inject(TYPES.ShadowingAttemptRepository)
    private shadowingAttemptRepository!: ShadowingAttemptRepository;

    @inject(TYPES.PracticeAttemptRepository)
    private practiceAttemptRepository!: PracticeAttemptRepository;

    @inject(TYPES.DialogueRepository)
    private dialogueRepository!: DialogueRepository;

    public async summary(): Promise<DashboardSummary> {
        const now = Date.now();
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const windowStart = new Date(todayStart);
        windowStart.setDate(windowStart.getDate() - (STREAK_WINDOW_DAYS - 1));

        const [
            overview,
            shadowToday,
            shadowDaily,
            practiceToday,
            practiceDaily,
            dialogueToday,
            dialogueDaily,
            recentAttempts,
        ] = await Promise.all([
            // 列表只取一条，计数仍是全量；学习台只需要数字
            this.srsCardRepository.overview(now, 1, 1, todayStart.getTime()),
            this.shadowingAttemptRepository.summarySince(todayStart.getTime()),
            this.shadowingAttemptRepository.dailyCountsSince(windowStart.getTime()),
            this.practiceAttemptRepository.summarySince(todayStart.getTime()),
            this.practiceAttemptRepository.dailyCountsSince(windowStart.getTime()),
            this.dialogueRepository.countUserTurnsSince(todayStart.getTime()),
            this.dialogueRepository.dailyUserTurnCountsSince(windowStart.getTime()),
            this.shadowingAttemptRepository.list({ limit: RECENT_ATTEMPT_LIMIT }),
        ]);

        // 三类练习按天合并：连续天数与 7 天柱状图都看总练习量
        const countByDay = new Map<string, number>();
        const mergeCounts = (items: Array<{ day: string; count: number }>) => {
            items.forEach((item) => {
                countByDay.set(item.day, (countByDay.get(item.day) ?? 0) + item.count);
            });
        };
        mergeCounts(shadowDaily);
        mergeCounts(practiceDaily);
        mergeCounts(dialogueDaily);
        const activeDays = new Set(
            [...countByDay.entries()].filter(([, count]) => count > 0).map(([day]) => day),
        );
        const todayKey = localDateKey(todayStart);

        // 今天还没开始学但昨天学过时，连续天数从昨天往前算，白天打开页面不会显示断签
        const cursor = new Date(todayStart);
        if (!activeDays.has(todayKey)) {
            cursor.setDate(cursor.getDate() - 1);
        }
        let streakDays = 0;
        while (activeDays.has(localDateKey(cursor))) {
            streakDays++;
            cursor.setDate(cursor.getDate() - 1);
        }

        const dailyActivity: DashboardDailyActivity[] = [];
        for (let offset = ACTIVITY_DAYS - 1; offset >= 0; offset--) {
            const day = new Date(todayStart);
            day.setDate(day.getDate() - offset);
            const key = localDateKey(day);
            dailyActivity.push({ date: key, count: countByDay.get(key) ?? 0 });
        }

        const dailyNewCardLimit = await this.srsService.getDailyNewCardLimit();

        return {
            dueReviewCount: overview.dueCount,
            // 未来复习 = 全部卡片里没到期的那部分，不额外查一次
            upcomingReviewCount: Math.max(0, overview.totalCount - overview.dueCount),
            todayNewCardCount: overview.newCount,
            dailyNewCardLimit,
            totalCardCount: overview.totalCount,
            todayAttemptCount: shadowToday.count,
            todayAverageScore: shadowToday.averageScore === null ? null : Math.round(shadowToday.averageScore),
            todayPracticeCount: practiceToday.count,
            todayDialogueTurnCount: dialogueToday.count,
            todayTotalCount: shadowToday.count + practiceToday.count + dialogueToday.count,
            streakDays,
            dailyActivity,
            recentAttempts,
            generatedAt: now,
        };
    }
}
