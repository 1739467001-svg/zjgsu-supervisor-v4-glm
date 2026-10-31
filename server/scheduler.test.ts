/**
 * 听课提醒调度器测试。
 *
 * 背景（2026-10-25 第6轮补齐）：v4.0.1 曾因「学期起始日写死 + 进程时区丢失」
 * 导致提醒整体漂移，修复后一直没有回归守护——此前仅有的用例只断言
 * 函数存在。这里守住四件事：
 *   1. 周次/星期换算的边界（第 1 周首日、跨周、学期范围外）
 *   2. 与进程时区解耦（北京时间午夜前后的时刻映射到正确的日历日）
 *   3. 对真实数据库：只提醒「明天那一周次 + 课程星期匹配 + pending」的计划，
 *      错周次/错星期/已完结的计划都不发；提醒不改计划状态
 *   4. 通知内容含周次/星期/课程名，不含未命中的课程
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { calculateWeekFromDate } from "@shared/dateUtils";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) {
  const dbName = new URL(TEST_URL).pathname.replace(/^\//, "");
  if (!dbName.includes("test")) {
    throw new Error(`拒绝执行：集成测试会写数据表，但目标库名 "${dbName}" 不含 "test"。`);
  }
  process.env.DATABASE_URL = TEST_URL;
}

// ---- 纯函数单测（无需数据库） ----
describe("scheduler.getSemesterInfo（周次/星期换算）", async () => {
  const { getSemesterInfo, cstCalendarUtc } = await import("./scheduler");
  const sem = { startDate: "2026-09-14", totalWeeks: 18 };

  it("开学首日 = 第 1 周 星期一", () => {
    expect(getSemesterInfo(new Date("2026-09-14T10:00:00+08:00"), sem)).toEqual({ week: 1, weekdayCN: "星期一" });
  });

  it("同一周的第 7 天 = 第 1 周 星期日", () => {
    expect(getSemesterInfo(new Date("2026-09-20T23:00:00+08:00"), sem)).toEqual({ week: 1, weekdayCN: "星期日" });
  });

  it("第 8 天跨到第 2 周 星期一", () => {
    expect(getSemesterInfo(new Date("2026-09-21T08:00:00+08:00"), sem)).toEqual({ week: 2, weekdayCN: "星期一" });
  });

  it("学期最后一天在范围内，次日返回 null", () => {
    const lastDay = getSemesterInfo(new Date("2027-01-17T12:00:00+08:00"), sem); // 09-14 + 17*7 + 6
    expect(lastDay).not.toBeNull();
    expect(getSemesterInfo(new Date("2027-01-18T12:00:00+08:00"), sem)).toBeNull();
  });

  it("早于开学日返回 null（第 0 周不参与提醒，与听课日期可选范围是两套口径）", () => {
    expect(getSemesterInfo(new Date("2026-09-13T12:00:00+08:00"), sem)).toBeNull();
  });

  it("与进程时区解耦：同一绝对时刻按北京日历日换算", () => {
    // 2026-10-25 23:30 北京 —— 无论进程 TZ 如何都必须落到 10-25（09-14 起第 41 天 = 第 6 周 星期日）
    expect(getSemesterInfo(new Date("2026-10-25T23:30:00+08:00"), sem)).toEqual({ week: 6, weekdayCN: "星期日" });
    // 半小时后（10-26 北京，第 42 天）跨到第 7 周 星期一
    expect(getSemesterInfo(new Date("2026-10-26T00:30:00+08:00"), sem)).toEqual({ week: 7, weekdayCN: "星期一" });
  });

  it("cstCalendarUtc 输出为该日历日的 UTC 零点", () => {
    const d = cstCalendarUtc(new Date("2026-10-25T23:30:00+08:00"));
    expect(d.toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });
});

// ---- 集成：真实数据库上的匹配行为 ----
describe.skipIf(!TEST_URL)("scheduler.sendListeningReminders（集成）", () => {
  let dbMod: typeof import("./db");
  let schema: typeof import("../drizzle/schema");
  let db: any;
  let oldActiveId: number | null = null;
  let semesterCfg: { startDate: string; totalWeeks: number };
  let tomorrowYMD: string;

  beforeAll(async () => {
    dbMod = await import("./db");
    schema = await import("../drizzle/schema");
    db = await dbMod.getDb();
    expect(db).toBeTruthy();

    // 造一个「明天必在学期中」的当前学期，保证测试任何一天都能确定性运行
    const { cstCalendarUtc } = await import("./scheduler");
    const tomorrow = new Date(cstCalendarUtc(new Date()).getTime() + 86400000);
    tomorrowYMD = tomorrow.toISOString().slice(0, 10);
    const start = new Date(tomorrow.getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const prev = await dbMod.getActiveSemester();
    oldActiveId = prev?.id ?? null;
    if (oldActiveId) {
      await db.update(schema.semesters).set({ isActive: false }).where(eq(schema.semesters.id, oldActiveId));
    }
    await db.insert(schema.semesters).values({
      academicYear: "TEST", name: "调度测试学期", startDate: start, totalWeeks: 30, isActive: true,
    });
    const active = await dbMod.getActiveSemester();
    semesterCfg = { startDate: active!.startDate, totalWeeks: active!.totalWeeks };
  });

  afterAll(async () => {
    if (oldActiveId) {
      await db.update(schema.semesters).set({ isActive: true }).where(eq(schema.semesters.id, oldActiveId));
    }
    await db.delete(schema.semesters).where(eq(schema.semesters.academicYear, "TEST"));
    await dbMod?.closeDb();
  });

  beforeEach(async () => {
    await db.delete(schema.notifications);
    await db.delete(schema.listeningPlans);
    await db.delete(schema.courses);
  });

  it("只提醒匹配「明天周次+课程星期+pending」的计划，通知内容正确且不改计划状态", async () => {
    const { sendListeningReminders, cstCalendarUtc, getSemesterInfo } = await import("./scheduler");
    const tomorrowBJ = new Date(cstCalendarUtc(new Date()).getTime() + 86400000);
    const info = getSemesterInfo(tomorrowBJ, semesterCfg);
    expect(info).not.toBeNull();
    const { week, weekdayCN } = info!;
    // 兜底自检：与 shared/dateUtils 的周次口径一致（同一起始日下两者算法等价）
    expect(week).toBe(calculateWeekFromDate(tomorrowYMD, semesterCfg));

    const semId = (await dbMod.getActiveSemester())!.id;
    const otherDay = weekdayCN === "星期一" ? "星期二" : "星期一";
    const hitRes = await db.insert(schema.courses).values({
      college: "测试学院", courseName: "命中课·明日提醒", teacher: "甲", weekday: weekdayCN,
      period: "第1-2节", classroom: "A101", semesterId: semId,
    });
    const hitId = Number(hitRes[0]?.insertId);
    const wrongDayRes = await db.insert(schema.courses).values({
      college: "测试学院", courseName: "错星期课", teacher: "丙", weekday: otherDay,
      period: "第5-6节", classroom: "A103", semesterId: semId,
    });
    const wrongDayId = Number(wrongDayRes[0]?.insertId);

    await db.insert(schema.listeningPlans).values([
      { supervisorId: 990001, courseId: hitId, planWeek: week, status: "pending", semesterId: semId, note: "应命中" },
      { supervisorId: 990001, courseId: hitId, planWeek: week + 1, status: "pending", semesterId: semId, note: "错周次" },
      { supervisorId: 990001, courseId: wrongDayId, planWeek: week, status: "pending", semesterId: semId, note: "错星期" },
      { supervisorId: 990002, courseId: hitId, planWeek: week, status: "completed", semesterId: semId, note: "已完结不发" },
    ]);

    await sendListeningReminders();

    const notes = await db.select().from(schema.notifications);
    expect(notes).toHaveLength(1); // 只有 990001 的命中计划（990002 已完结）
    expect(notes[0]?.recipientId).toBe(990001);
    expect(notes[0]?.type).toBe("plan_reminder");
    expect(notes[0]?.title).toContain(weekdayCN);
    expect(notes[0]?.content).toContain("命中课·明日提醒");
    expect(notes[0]?.content).toContain(`第${week}周`);
    expect(notes[0]?.content).not.toContain("错星期课");

    // 提醒不改变计划状态
    const plans = await db.select().from(schema.listeningPlans).where(eq(schema.listeningPlans.courseId, hitId));
    const hitPlan = plans.find((p: any) => p.planWeek === week && p.supervisorId === 990001);
    expect(hitPlan?.status).toBe("pending");
  });

  it("归档学期的遗留 pending 计划不提醒（周次/星期恰好对上当前校历也不发，第10轮 I-1）", async () => {
    const { sendListeningReminders, cstCalendarUtc, getSemesterInfo } = await import("./scheduler");
    const tomorrowBJ = new Date(cstCalendarUtc(new Date()).getTime() + 86400000);
    const info = getSemesterInfo(tomorrowBJ, semesterCfg);
    expect(info).not.toBeNull();
    const { week, weekdayCN } = info!;
    const activeId = (await dbMod.getActiveSemester())!.id;

    // 造一个已归档学期（isActive=false；academicYear 仍为 TEST 以便 afterAll 清理）
    await db.insert(schema.semesters).values({
      academicYear: "TEST", name: "调度测试归档学期", startDate: "2026-03-02", totalWeeks: 19, isActive: false,
    });
    const archived = await dbMod.getActiveSemester(); // 仍应返回 isActive 的那个
    expect(archived!.id).toBe(activeId);
    const archivedId = (
      await db.select().from(schema.semesters).where(eq(schema.semesters.name, "调度测试归档学期"))
    )[0]?.id;
    expect(archivedId).toBeTruthy();

    // 归档学期的课程 + 遗留 pending 计划：planWeek/weekday 故意等于明天的周次/星期
    const archivedCourseRes = await db.insert(schema.courses).values({
      college: "测试学院", courseName: "上学期遗留课", teacher: "乙", weekday: weekdayCN,
      period: "第3-4节", classroom: "B202", semesterId: archivedId,
    });
    const archivedCourseId = Number(archivedCourseRes[0]?.insertId);
    // 对照组：当前学期的命中计划
    const hitRes = await db.insert(schema.courses).values({
      college: "测试学院", courseName: "当前学期命中课", teacher: "甲", weekday: weekdayCN,
      period: "第1-2节", classroom: "A101", semesterId: activeId,
    });
    const hitId = Number(hitRes[0]?.insertId);

    await db.insert(schema.listeningPlans).values([
      { supervisorId: 990003, courseId: archivedCourseId, planWeek: week, status: "pending", semesterId: archivedId, note: "归档遗留-不应提醒" },
      { supervisorId: 990003, courseId: hitId, planWeek: week, status: "pending", semesterId: activeId, note: "当前学期-应提醒" },
    ]);

    await sendListeningReminders();

    const notes = await db.select().from(schema.notifications);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.recipientId).toBe(990003);
    expect(notes[0]?.content).toContain("当前学期命中课");
    expect(notes[0]?.content).not.toContain("上学期遗留课");

    // 清掉本用例造的归档学期，避免污染其他用例
    await db.delete(schema.listeningPlans);
    await db.delete(schema.courses);
    await db.delete(schema.notifications);
    await db.delete(schema.semesters).where(eq(schema.semesters.name, "调度测试归档学期"));
  });
});
