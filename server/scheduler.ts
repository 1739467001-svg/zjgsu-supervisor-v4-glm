/**
 * 定时任务模块：听课前一天自动发送站内信提醒
 *
 * 逻辑说明：
 * - 浙工商研究生课程按"周次+星期"排课，无具体日期
 * - 学期配置优先读 semesters 表的当前学期，无记录时回退到常量
 * - 每天凌晨 0:30（北京时间）运行，计算明天是第几周星期几，
 *   查找所有 status=pending 且 planWeek 匹配的听课计划，
 *   向对应督导专家发送站内信提醒
 *
 * 时区说明：所有"今天是几号"的判断都通过 Intl 强制按北京时间取日历日
 * （cstCalendarUtc），不依赖进程本地时区——此前进程 TZ 丢失时
 * 这里的日期计算会整体漂移（2026-10-06 线上体检发现）。
 */

import { getDb, getActiveSemester } from "./db";
import { listeningPlans, courses, users, notifications } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";

// ============================================================
// 学期日期计算
// ============================================================

/** 数据库无当前学期记录时的兜底配置 */
const FALLBACK_SEMESTER = { startDate: "2026-03-02", totalWeeks: 19 };

/** 优先读数据库当前学期；读不到时回退常量 */
async function getSemesterConfig(): Promise<{ startDate: string; totalWeeks: number }> {
  const active = await getActiveSemester();
  if (active?.startDate) {
    return { startDate: active.startDate, totalWeeks: active.totalWeeks || FALLBACK_SEMESTER.totalWeeks };
  }
  return FALLBACK_SEMESTER;
}

/**
 * 把任意时刻映射到「北京时间的日历日」，用 UTC 零点表示。
 * UTC 零点恰好是北京当天 08:00，getUTCDay()/天数差都与该日历日一致，
 * 且不受进程本地时区影响。
 */
function cstCalendarUtc(date: Date): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date); // YYYY-MM-DD
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** ISO weekday -> 中文星期 */
const ISO_TO_CN: Record<number, string> = {
  1: "星期一",
  2: "星期二",
  3: "星期三",
  4: "星期四",
  5: "星期五",
  6: "星期六",
  7: "星期日",
};

/**
 * 根据给定日期计算学期周次和星期
 * @returns { week: number, weekdayCN: string } | null（超出学期范围则返回null）
 */
function getSemesterInfo(
  date: Date,
  semester: { startDate: string; totalWeeks: number }
): { week: number; weekdayCN: string } | null {
  // 都映射到"日历日的 UTC 零点"同一根日期轴上做天数差，与进程时区无关
  const bjDate = cstCalendarUtc(date);
  const [sy, sm, sd] = semester.startDate.split("-").map(Number);
  const startBJ = new Date(Date.UTC(sy, sm - 1, sd));

  const diffMs = bjDate.getTime() - startBJ.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return null; // 学期未开始

  const week = Math.floor(diffDays / 7) + 1;
  if (week > semester.totalWeeks) return null; // 学期已结束

  // UTC 零点即该日历日（北京 08:00），getUTCDay 直接就是星期几
  const jsDay = bjDate.getUTCDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const weekdayCN = ISO_TO_CN[isoDay];

  return { week, weekdayCN };
}

// ============================================================
// 核心提醒逻辑
// ============================================================

export async function sendListeningReminders(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Scheduler] Database not available, skipping reminder task");
    return;
  }

  // 学期配置读数据库当前学期（换学期后提醒自动跟随，不再依赖写死的起始日）
  const semester = await getSemesterConfig();

  // 北京时间的"明天"（在日历轴上加一天），与进程时区解耦
  const tomorrow = new Date(cstCalendarUtc(new Date()).getTime() + 24 * 60 * 60 * 1000);
  const info = getSemesterInfo(tomorrow, semester);

  if (!info) {
    console.log("[Scheduler] Tomorrow is outside semester range, no reminders to send");
    return;
  }

  const { week: tomorrowWeek, weekdayCN: tomorrowWeekday } = info;
  console.log(`[Scheduler] Checking reminders for: 第${tomorrowWeek}周 ${tomorrowWeekday}`);

  try {
    // 查询明天有课的所有待听课计划（JOIN courses表）
    const pendingPlans = await db
      .select({
        planId: listeningPlans.id,
        supervisorId: listeningPlans.supervisorId,
        planWeek: listeningPlans.planWeek,
        courseId: listeningPlans.courseId,
        courseName: courses.courseName,
        teacher: courses.teacher,
        weekday: courses.weekday,
        period: courses.period,
        classroom: courses.classroom,
        campus: courses.campus,
      })
      .from(listeningPlans)
      .innerJoin(courses, eq(listeningPlans.courseId, courses.id))
      .where(
        and(
          eq(listeningPlans.status, "pending"),
          eq(listeningPlans.planWeek, tomorrowWeek),
          eq(courses.weekday, tomorrowWeekday)
        )
      );

    if (pendingPlans.length === 0) {
      console.log("[Scheduler] No pending plans for tomorrow, no reminders needed");
      return;
    }

    console.log(`[Scheduler] Found ${pendingPlans.length} plans to remind`);

    // 按督导专家分组，批量创建通知
    type PlanRow = (typeof pendingPlans)[number];
    const plansBySupervisor: Record<number, PlanRow[]> = {};
    for (const plan of pendingPlans) {
      if (!plansBySupervisor[plan.supervisorId]) {
        plansBySupervisor[plan.supervisorId] = [];
      }
      plansBySupervisor[plan.supervisorId].push(plan);
    }

    let sentCount = 0;
    for (const supervisorIdStr of Object.keys(plansBySupervisor)) {
      const supervisorId = parseInt(supervisorIdStr);
      const plans = plansBySupervisor[supervisorId];
      // 构建通知内容
      const courseList = plans
        .map(
          (p) =>
            `《${p.courseName || "未知课程"}》（${p.teacher || ""}，${p.period || ""}，${p.classroom || ""}）`
        )
        .join("；");

      const title = `听课提醒：明天（${tomorrowWeekday}）有 ${plans.length} 门课程待督导`;
      const content = `您好！明天（第${tomorrowWeek}周 ${tomorrowWeekday}）您有以下听课计划待执行：\n\n${courseList}\n\n请按时前往听课，完成后记得填写课程评价。`;

      await db.insert(notifications).values({
        recipientId: supervisorId,
        senderId: 0, // 系统自动发送
        title,
        content,
        type: "plan_reminder",
        isRead: false,
        createdAt: new Date(),
      });
      sentCount++;
    }

    console.log(`[Scheduler] Sent ${sentCount} reminder notifications to supervisors`);
  } catch (error) {
    console.error("[Scheduler] Error sending reminders:", error);
  }
}

// ============================================================
// 定时器启动（每天凌晨 0:30 运行）
// ============================================================

let schedulerTimer: NodeJS.Timeout | null = null;

function getNextRunDelay(): number {
  const now = new Date();
  // 目标：下一个北京时间 00:30。CST = UTC+8，
  // 因此"北京某日 00:30"的绝对时刻 = Date.UTC(年, 月-1, 日, 0, 30) - 8h
  const today = cstCalendarUtc(now);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const d = today.getUTCDate();
  let target = new Date(Date.UTC(y, m, d, 0, 30) - 8 * 60 * 60 * 1000);

  // 如果今天的 0:30 已过，则设为明天的 0:30
  if (target.getTime() <= now.getTime()) {
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  }

  const delay = target.getTime() - now.getTime();
  return delay;
}

export function startScheduler(): void {
  const scheduleNext = () => {
    const delay = getNextRunDelay();
    const nextRun = new Date(Date.now() + delay);
    console.log(
      `[Scheduler] Next reminder check scheduled at: ${nextRun.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
    );

    schedulerTimer = setTimeout(async () => {
      await sendListeningReminders();
      scheduleNext(); // 执行完后安排下一次
    }, delay);
  };

  scheduleNext();
  console.log("[Scheduler] Listening reminder scheduler started");
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
    console.log("[Scheduler] Scheduler stopped");
  }
}
