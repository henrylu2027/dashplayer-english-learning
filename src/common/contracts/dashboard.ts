import type { ShadowingAttemptSummary } from '@/common/contracts/shadowing';

/**
 * 学习台契约。
 *
 * 所有数字都是即时聚合：待复习来自复习卡片表，跟读次数与平均分来自跟读记录表，
 * 不额外保存一份“仪表盘数据”，避免和真实学习记录分叉。
 */

/**
 * 某一天的练习次数。
 */
export interface DashboardDailyActivity {
    /** 本地日期，格式 `YYYY-MM-DD`。 */
    date: string;
    /** 当天练习次数：跟读 + 听写/复述 + 对话发言。 */
    count: number;
}

/**
 * 学习台概览。
 *
 * 练习口径：跟读一次、听写/复述一次、对话里说一句，都算一次练习。
 * 听写是词准确率、复述是关键词覆盖，二者不跨模式求平均；
 * 对话只统计学习者发言，不统计 AI 台词和开场白。
 */
export interface DashboardSummary {
    /** 当前到期待复习的卡片数。 */
    dueReviewCount: number;
    /** 尚未到期的卡片数（未来复习）。 */
    upcomingReviewCount: number;
    /** 今日新学（今天入池）的卡片数。 */
    todayNewCardCount: number;
    /** 每日新卡上限；0 表示暂停入池。 */
    dailyNewCardLimit: number;
    /** 全部复习卡片数。 */
    totalCardCount: number;
    /** 今日跟读次数（含复习时的跟读）。 */
    todayAttemptCount: number;
    /** 今日跟读平均分，四舍五入到整数；今天没跟读时为 null。 */
    todayAverageScore: number | null;
    /** 今日听写/复述次数。 */
    todayPracticeCount: number;
    /** 今日对话中学习者发言轮数。 */
    todayDialogueTurnCount: number;
    /** 今日练习总次数：跟读 + 听写/复述 + 对话发言。 */
    todayTotalCount: number;
    /** 连续学习天数：从今天（或昨天）往前数，每天至少完成一次任一类型练习。 */
    streakDays: number;
    /** 最近 7 天（含今天）的每日练习总次数，缺日为 0。 */
    dailyActivity: DashboardDailyActivity[];
    /** 最近 5 条跟读记录。 */
    recentAttempts: ShadowingAttemptSummary[];
    /** 统计生成时间，epoch 毫秒。 */
    generatedAt: number;
}
