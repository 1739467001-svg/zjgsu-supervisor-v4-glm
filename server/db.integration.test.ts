/**
 * 数据库集成测试（默认跳过）
 *
 * 覆盖两处无法用 mock 验证的真实 SQL：
 *   - completePendingPlanForEvaluation：提交评价后按周次完结听课计划
 *   - getUsersByRole：需同时匹配主角色（role）与附加角色（extraRoles，JSON_CONTAINS）
 *
 * ⚠ 本测试会清空 listening_plans 与 users 两张表，因此：
 *   1. 只有显式设置 TEST_DATABASE_URL 时才运行（刻意不复用 DATABASE_URL，避免误连生产库）
 *   2. 库名必须包含 "test"，否则直接报错拒绝执行
 *
 * 本地运行示例：
 *   TEST_DATABASE_URL='mysql://root@127.0.0.1:3306/zjgsu_test' npx vitest run server/db.integration.test.ts
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

const TEST_URL = process.env.TEST_DATABASE_URL;

// 必须在导入 db 模块之前设置，因为 getDb() 读取的是 process.env.DATABASE_URL
if (TEST_URL) {
  const dbName = new URL(TEST_URL).pathname.replace(/^\//, "");
  if (!dbName.includes("test")) {
    throw new Error(
      `拒绝执行：集成测试会清空数据表，但目标库名 "${dbName}" 不含 "test"。` +
        `请指向一个专用测试库。`
    );
  }
  process.env.DATABASE_URL = TEST_URL;
}

describe.skipIf(!TEST_URL)("数据库集成测试", () => {
  let db: any;
  let dbMod: typeof import("./db");
  let schema: typeof import("../drizzle/schema");

  beforeAll(async () => {
    dbMod = await import("./db");
    schema = await import("../drizzle/schema");
    db = await dbMod.getDb();
    expect(db, "无法连接测试数据库").toBeTruthy();
  });

  afterAll(async () => {
    await dbMod?.closeDb();
  });

  beforeEach(async () => {
    await db.delete(schema.listeningPlans);
  });

  describe("completePendingPlanForEvaluation（提交评价后完结听课计划）", () => {
    it("多条计划时按周次精确匹配，且不影响其他周次", async () => {
      await db.insert(schema.listeningPlans).values([
        { supervisorId: 1, courseId: 100, planWeek: 5, status: "pending" },
        { supervisorId: 1, courseId: 100, planWeek: 7, status: "pending" },
      ]);

      const id = await dbMod.completePendingPlanForEvaluation(1, 100, 7);
      const rows = await db.select().from(schema.listeningPlans);

      const matched = rows.find((r: any) => r.id === id);
      expect(matched?.planWeek).toBe(7);
      expect(matched?.status).toBe("completed");
      expect(rows.filter((r: any) => r.id !== id).every((r: any) => r.status === "pending")).toBe(true);
    });

    it("周次对不上时，回退到「未指定周次」的计划", async () => {
      await db.insert(schema.listeningPlans).values([
        { supervisorId: 1, courseId: 100, planWeek: 3, status: "pending" },
        { supervisorId: 1, courseId: 100, planWeek: null, status: "pending" },
      ]);

      const id = await dbMod.completePendingPlanForEvaluation(1, 100, 9);
      const rows = await db.select().from(schema.listeningPlans);

      expect(rows.find((r: any) => r.id === id)?.planWeek).toBeNull();
      expect(rows.find((r: any) => r.planWeek === 3)?.status).toBe("pending");
    });

    it("没有待听课计划时返回 null", async () => {
      expect(await dbMod.completePendingPlanForEvaluation(1, 100, 7)).toBeNull();
    });

    it("不会完结其他督导或其他课程的计划", async () => {
      await db.insert(schema.listeningPlans).values([
        { supervisorId: 2, courseId: 100, planWeek: 7, status: "pending" },
        { supervisorId: 1, courseId: 999, planWeek: 7, status: "pending" },
      ]);

      const id = await dbMod.completePendingPlanForEvaluation(1, 100, 7);
      const rows = await db.select().from(schema.listeningPlans);

      expect(id).toBeNull();
      expect(rows.every((r: any) => r.status === "pending")).toBe(true);
    });

    it("已完结的计划不会被重复处理", async () => {
      await db.insert(schema.listeningPlans).values([
        { supervisorId: 1, courseId: 100, planWeek: 7, status: "completed" },
      ]);
      expect(await dbMod.completePendingPlanForEvaluation(1, 100, 7)).toBeNull();
    });
  });

  describe("getUsersByRole（主角色 + 附加角色）", () => {
    beforeEach(async () => {
      await db.delete(schema.users);
      await db.insert(schema.users).values([
        { openId: "it-u1", employeeId: "it-1", name: "主管甲", role: "graduate_admin", extraRoles: null },
        { openId: "it-u2", employeeId: "it-2", name: "秘书兼督导", role: "college_secretary", extraRoles: ["supervisor_expert"] },
        { openId: "it-u3", employeeId: "it-3", name: "纯督导", role: "supervisor_expert", extraRoles: [] },
        { openId: "it-u4", employeeId: "it-4", name: "督导兼主管", role: "supervisor_expert", extraRoles: ["graduate_admin"] },
      ]);
    });

    it("能查到主角色持有者和附加角色持有者", async () => {
      const names = (await dbMod.getUsersByRole("graduate_admin")).map((u) => u.name).sort();
      expect(names).toEqual(["主管甲", "督导兼主管"].sort());
    });

    it("督导专家同理（含把督导作为附加角色的用户）", async () => {
      const names = (await dbMod.getUsersByRole("supervisor_expert")).map((u) => u.name).sort();
      expect(names).toEqual(["秘书兼督导", "督导兼主管", "纯督导"].sort());
    });
  });

  // ============================================================
  // 统计仪表盘：三张学院图表必须出自同一份数据
  // ============================================================
  // 注意：迁移 0006 会在任何按正规流程建出的库里回填一个激活学期，
  // 而 getAdminStats 只统计激活学期的课程与评价 —— 所以这里播种时
  // 必须带上激活学期的 semesterId，否则统计恒为空（此前该用例从未真正运行过）。
  describe("统计仪表盘的学院口径", () => {
    let activeSemesterId: number;

    beforeAll(async () => {
      const active = await dbMod.getActiveSemester();
      activeSemesterId = active!.id;
    });

    beforeEach(async () => {
      await db.delete(schema.courseEvaluations);
      await db.delete(schema.courses);
    });

    async function seedCourse(college: string) {
      const [res] = await db.insert(schema.courses).values({
        college, courseName: `${college}的课`, teacher: "某老师",
        weekday: "星期一", period: "第1-2节", classroom: "A101",
        semesterId: activeSemesterId,
      });
      return Number(res.insertId);
    }

    async function seedEval(courseId: number, overallScore: number | null) {
      await db.insert(schema.courseEvaluations).values({
        courseId, supervisorId: 1, status: "submitted", overallScore,
        semesterId: activeSemesterId,
      });
    }

    it("有评价但一条总分都没打的学院，仍然出现在统计里（此前会从平均分图表消失，导致三张图学院数不一致）", async () => {
      const scored = await seedCourse("经济学院");
      const unscored = await seedCourse("未来传播学院");
      await seedEval(scored, 4.5);
      await seedEval(unscored, null);
      await seedEval(unscored, null);

      const stats = await dbMod.getAdminStats();
      const names = stats!.collegeStats.map((r: any) => r.college);
      expect(names).toContain("经济学院");
      expect(names).toContain("未来传播学院");

      const blank = stats!.collegeStats.find((r: any) => r.college === "未来传播学院");
      expect(blank.count).toBe(2);
      expect(blank.scoredCount).toBe(0);
      expect(blank.avgScore).toBeNull();
    });

    it("学院范围统计：括号别名能解析到课表简称，范围外学院不出现", async () => {
      const a = await seedCourse("经济学院");
      await seedEval(a, 4);
      const b = await seedCourse("法学院");
      await seedEval(b, 5);

      const stats = await dbMod.getAdminStats(undefined, "法学院（知识产权学院）");
      expect(stats!.collegeStats.map((r: any) => r.college)).toEqual(["法学院"]);
      expect(stats!.totalCourses).toBe(1);
      expect(stats!.totalEvaluations).toBe(1);
      expect(stats!.semesterColleges.map((r: any) => r.college)).toEqual(["法学院"]);
    });

    it("各学院评价次数之和等于评价总数，一条都不会漏", async () => {
      for (const college of ["经济学院", "人文学院", "MBA学院"]) {
        const id = await seedCourse(college);
        await seedEval(id, 4);
        await seedEval(id, null);
      }
      const stats = await dbMod.getAdminStats();
      const sum = stats!.collegeStats.reduce((a: number, r: any) => a + r.count, 0);
      expect(sum).toBe(stats!.totalEvaluations);
    });

    it("课程被换掉后，孤儿评价归入「未知学院」而不是被悄悄丢掉", async () => {
      const id = await seedCourse("经济学院");
      await seedEval(id, 4);
      await db.delete(schema.courses);

      const stats = await dbMod.getAdminStats();
      const sum = stats!.collegeStats.reduce((a: number, r: any) => a + r.count, 0);
      expect(sum).toBe(stats!.totalEvaluations);
      expect(stats!.collegeStats.map((r: any) => r.college).join()).toMatch(/未知学院/);
    });
  });

  // 回归（2026-10-25 线上实测发现）：create 后必须按自增主键回读。
  // createdAt 只有秒级精度，同秒连建两条会打平，旧实现按 createdAt 倒序取回，
  // 会把另一条的行返回给前端（草稿保存后跳错记录）。
  describe("create 返回行的正确性（同秒连建不串行）", () => {
    let activeSemesterId: number;

    beforeAll(async () => {
      const active = await dbMod.getActiveSemester();
      activeSemesterId = active!.id;
    });

    beforeEach(async () => {
      await db.delete(schema.courseEvaluations);
      await db.delete(schema.listeningPlans);
      await db.delete(schema.courses);
    });

    async function seedCourse(college = "经济学院") {
      const [res] = await db.insert(schema.courses).values({
        college, courseName: "同秒连建回归课", teacher: "某老师",
        weekday: "星期一", period: "第1-2节", classroom: "A101",
        semesterId: activeSemesterId,
      });
      return Number(res.insertId);
    }

    it("同一督导同秒连建两条评价，create 各自返回正确的行", async () => {
      const courseA = await seedCourse();
      const courseB = await seedCourse("法学院");
      const first = await dbMod.createEvaluation({
        supervisorId: 1, courseId: courseA, semesterId: activeSemesterId, status: "draft", overallScore: 4,
      });
      const second = await dbMod.createEvaluation({
        supervisorId: 1, courseId: courseB, semesterId: activeSemesterId, status: "draft", overallScore: 5,
      });
      expect(Number(first.id)).toBeGreaterThan(0);
      expect(Number(second.id)).toBeGreaterThan(Number(first.id));
      expect(first.courseId).toBe(courseA);
      expect(second.courseId).toBe(courseB);
      expect(second.overallScore).toBe(5);
    });

    it("同一门课同秒连建两条不同周次的听课计划，create 各自返回正确的周次", async () => {
      const course = await seedCourse();
      const week6 = await dbMod.createListeningPlan({
        supervisorId: 1, courseId: course, semesterId: activeSemesterId, planWeek: 6, status: "pending",
      });
      const week7 = await dbMod.createListeningPlan({
        supervisorId: 1, courseId: course, semesterId: activeSemesterId, planWeek: 7, status: "pending",
      });
      expect(week6.planWeek).toBe(6);
      expect(week7.planWeek).toBe(7);
      expect(Number(week7.id)).toBeGreaterThan(Number(week6.id));
    });
  });

  // 回归（2026-10-25 第4轮线上实测发现）：通知列表此前硬编码 LIMIT 50，
  // 与全量口径的未读数/全部已读矛盾（主管 54 条只可见 50 条）。
  describe("通知列表不因数量截断", () => {
    beforeEach(async () => {
      await db.delete(schema.notifications);
    });

    it("超过 50 条时全部可见，且与未读计数同口径", async () => {
      const rows = Array.from({ length: 55 }, (_, i) => ({
        recipientId: 1,
        senderId: 2,
        type: "evaluation_complete",
        title: `通知 ${i + 1}`,
        content: "内容",
        evaluationId: null,
        isRead: i < 5, // 5 已读 + 50 未读
      }));
      await db.insert(schema.notifications).values(rows);

      const list = await dbMod.getNotificationsByUser(1);
      expect(list).toHaveLength(55);

      const unread = await dbMod.getUnreadNotificationCount(1);
      expect(unread).toBe(50);

      await dbMod.markAllNotificationsRead(1);
      expect(await dbMod.getUnreadNotificationCount(1)).toBe(0);
    });
  });
});
