/**
 * 学期归档：新建记录须打上当前学期标记，查询须按学期隔离。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

const ACTIVE_SEMESTER = {
  id: 7,
  academicYear: "2026-2027",
  name: "第一学期",
  startDate: "2026-09-07",
  totalWeeks: 18,
};

vi.mock("./db", () => ({
  getActiveSemester: vi.fn(),
  listSemesters: vi.fn().mockResolvedValue([]),
  createSemester: vi.fn().mockResolvedValue({ id: 8 }),
  setActiveSemester: vi.fn().mockResolvedValue(undefined),
  updateSemester: vi.fn().mockResolvedValue(undefined),
  getCourseById: vi.fn().mockResolvedValue({ id: 1, college: "经济学院", semesterId: 7 }),
  createListeningPlan: vi.fn().mockResolvedValue({ id: 1 }),
  getListeningPlansBySupervisor: vi.fn().mockResolvedValue([]),
  createEvaluation: vi.fn().mockResolvedValue({ id: 1, planId: null }),
  updateEvaluation: vi.fn().mockResolvedValue(undefined),
  getSubmittedEvaluationByCourse: vi.fn().mockResolvedValue(null),
  completePendingPlanForEvaluation: vi.fn().mockResolvedValue(null),
  getCourses: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getUsedWeeksForCourse: vi.fn().mockResolvedValue({ usedWeeks: [], evaluatedWeeks: [] }),
  deleteListeningPlan: vi.fn(),
  updateListeningPlanStatus: vi.fn(),
  getEvaluationsBySupervisor: vi.fn().mockResolvedValue([]),
  getAllEvaluations: vi.fn().mockResolvedValue([]),
  getEvaluationById: vi.fn(),
  deleteEvaluation: vi.fn(),
  getAdminStats: vi.fn(),
  getCourseEvaluationProgress: vi.fn().mockResolvedValue([]),
  getAllCollegeEvaluationProgress: vi.fn().mockResolvedValue([]),
  getDistinctColleges: vi.fn().mockResolvedValue([]),
  getDistinctTeachers: vi.fn().mockResolvedValue([]),
  getNotificationsByUser: vi.fn().mockResolvedValue([]),
  getUnreadNotificationCount: vi.fn().mockResolvedValue(0),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  createNotification: vi.fn(),
  getAllUsers: vi.fn().mockResolvedValue([]),
  getUsersByRole: vi.fn().mockResolvedValue([]),
  updateUserRole: vi.fn(),
  updateUserExtraRoles: vi.fn(),
  updateUserSupervisorScope: vi.fn().mockResolvedValue(undefined),
  updateUserCollege: vi.fn(),
  updateUserPassword: vi.fn(),
  getUserByEmployeeId: vi.fn(),
  upsertUser: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({ sdk: { createSessionToken: vi.fn() } }));

function ctx(user: Partial<any> = {}): TrpcContext {
  return {
    user: { id: 3, role: "supervisor_expert", extraRoles: null, college: null, ...user } as any,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getActiveSemester).mockResolvedValue(ACTIVE_SEMESTER as any);
  vi.mocked(db.getCourseById).mockResolvedValue({ id: 1, college: "经济学院", semesterId: ACTIVE_SEMESTER.id } as any);
});

describe("新建记录打上当前学期标记", () => {
  it("听课计划带上当前学期 id", async () => {
    await appRouter.createCaller(ctx()).plans.create({ courseId: 1, planWeek: 3 });
    expect(db.createListeningPlan).toHaveBeenCalledWith(
      expect.objectContaining({ semesterId: ACTIVE_SEMESTER.id })
    );
  });

  it("评价带上当前学期 id", async () => {
    await appRouter.createCaller(ctx()).evaluations.create({ courseId: 1, status: "draft" });
    expect(db.createEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ semesterId: ACTIVE_SEMESTER.id })
    );
  });

  it("未建立学期档案时阻止产生无法归档的新记录", async () => {
    vi.mocked(db.getActiveSemester).mockResolvedValue(undefined as any);
    await expect(appRouter.createCaller(ctx()).plans.create({ courseId: 1 })).rejects.toThrow("历史学期档案只读");
    expect(db.createListeningPlan).not.toHaveBeenCalled();
  });
});

describe("查询按学期隔离", () => {
  it("待听课列表只取当前学期，不混入往期遗留计划", async () => {
    await appRouter.createCaller(ctx()).plans.myPlans();
    expect(db.getListeningPlansBySupervisor).toHaveBeenCalledWith(3, ACTIVE_SEMESTER.id);
  });
});

// ACTIVE_SEMESTER：2026-09-07 开学、18 周 → 可选范围 2026-09-01（第 0 周周一）~ 2027-01-10（学期末）
describe("听课日期服务端校验（此前仅前端拦截）", () => {
  it("早于开学前一周的日期被拒绝且不落库", async () => {
    await expect(
      appRouter.createCaller(ctx()).evaluations.create({ courseId: 1, status: "draft", listenDate: "2026-08-31" })
    ).rejects.toThrow("听课日期");
    expect(db.createEvaluation).not.toHaveBeenCalled();
  });

  it("学期末之后的日期被拒绝", async () => {
    await expect(
      appRouter.createCaller(ctx()).evaluations.create({ courseId: 1, status: "draft", listenDate: "2027-01-11" })
    ).rejects.toThrow("听课日期");
  });

  it("开学前一周内（第 0 周）与学期末当天放行", async () => {
    await appRouter.createCaller(ctx()).evaluations.create({ courseId: 1, status: "draft", listenDate: "2026-09-01" });
    await appRouter.createCaller(ctx()).evaluations.create({ courseId: 1, status: "draft", listenDate: "2027-01-10" });
    expect(db.createEvaluation).toHaveBeenCalledTimes(2);
  });

  it("update 路径同样拒绝越界日期（草稿保存不可绕过）", async () => {
    vi.mocked(db.getEvaluationById).mockResolvedValue({
      id: 5, supervisorId: 3, courseId: 1, status: "draft", semesterId: ACTIVE_SEMESTER.id, planId: null,
    } as any);
    await expect(
      appRouter.createCaller(ctx()).evaluations.update({ id: 5, data: { courseId: 1, listenDate: "2026-08-31", status: "draft" } })
    ).rejects.toThrow("听课日期");
    expect(db.updateEvaluation).not.toHaveBeenCalled();
  });
});

describe("评价提交通知（create 与 update 双路径，v4.0.6 修复的回归守护）", () => {
  function mockRecipients() {
    vi.mocked(db.getUsersByRole).mockImplementation(async (role: string) =>
      role === "graduate_admin"
        ? ([{ id: 10, name: "主管" }] as any)
        : ([{ id: 11, name: "秘书", college: "经济学院" }] as any)
    );
  }

  it("create 直接提交：主管与本学院秘书都收到通知", async () => {
    mockRecipients();
    await appRouter.createCaller(ctx()).evaluations.create({ courseId: 1, status: "submitted" });
    const recipients = vi.mocked(db.createNotification).mock.calls.map((c: any[]) => c[0].recipientId);
    expect(recipients).toContain(10);
    expect(recipients).toContain(11);
  });

  it("update 草稿转提交：同样通知，evaluationId 指向该评价", async () => {
    mockRecipients();
    vi.mocked(db.getEvaluationById).mockResolvedValue({
      id: 5, supervisorId: 3, courseId: 1, status: "draft", semesterId: ACTIVE_SEMESTER.id, planId: null,
    } as any);
    await appRouter.createCaller(ctx()).evaluations.update({ id: 5, data: { courseId: 1, status: "submitted" } });
    const calls = vi.mocked(db.createNotification).mock.calls as any[];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c[0].evaluationId === 5)).toBe(true);
    const recipients = calls.map((c) => c[0].recipientId);
    expect(recipients).toContain(10);
    expect(recipients).toContain(11);
  });

  it("已提交评价再次保存不重复通知", async () => {
    mockRecipients();
    vi.mocked(db.getEvaluationById).mockResolvedValue({
      id: 5, supervisorId: 3, courseId: 1, status: "submitted", semesterId: ACTIVE_SEMESTER.id, planId: null,
    } as any);
    await appRouter.createCaller(ctx()).evaluations.update({ id: 5, data: { courseId: 1, status: "submitted" } });
    expect(db.createNotification).not.toHaveBeenCalled();
  });
});

describe("学期管理接口", () => {
  it("当前学期对所有登录用户可读（前端据此算周次）", async () => {
    const res = await appRouter.createCaller(ctx()).semesters.active();
    expect(res).toMatchObject({ startDate: "2026-09-07", totalWeeks: 18 });
  });

  it("未配置学期时返回 null", async () => {
    vi.mocked(db.getActiveSemester).mockResolvedValue(undefined as any);
    expect(await appRouter.createCaller(ctx()).semesters.active()).toBeNull();
  });

  it("非管理员不能新建学期", async () => {
    await expect(
      appRouter.createCaller(ctx()).semesters.create({
        academicYear: "2026-2027", name: "第二学期", startDate: "2027-02-22", totalWeeks: 19,
      })
    ).rejects.toThrow(/研究生院主管/);
  });

  it("管理员可新建学期", async () => {
    await appRouter.createCaller(ctx({ role: "graduate_admin" })).semesters.create({
      academicYear: "2026-2027", name: "第二学期", startDate: "2027-02-22", totalWeeks: 19,
    });
    expect(db.createSemester).toHaveBeenCalled();
  });

  it("开始日期格式非法会被拒绝", async () => {
    await expect(
      appRouter.createCaller(ctx({ role: "graduate_admin" })).semesters.create({
        academicYear: "2026-2027", name: "第二学期", startDate: "2027/02/22", totalWeeks: 19,
      })
    ).rejects.toThrow();
  });

  it("管理员可切换当前学期", async () => {
    await appRouter.createCaller(ctx({ role: "graduate_admin" })).semesters.setActive({ id: 9 });
    expect(db.setActiveSemester).toHaveBeenCalledWith(9);
  });

  it("非管理员不能切换当前学期", async () => {
    await expect(
      appRouter.createCaller(ctx()).semesters.setActive({ id: 9 })
    ).rejects.toThrow(/研究生院主管/);
  });
});
