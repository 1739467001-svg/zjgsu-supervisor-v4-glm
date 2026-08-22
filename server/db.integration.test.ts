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
});
