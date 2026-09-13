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
  getCourseById: vi.fn().mockResolvedValue({ id: 1, college: "经济学院" }),
  createListeningPlan: vi.fn().mockResolvedValue({ id: 1 }),
  getListeningPlansBySupervisor: vi.fn().mockResolvedValue([]),
  createEvaluation: vi.fn().mockResolvedValue({ id: 1, planId: null }),
  updateEvaluation: vi.fn().mockResolvedValue(undefined),
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
  vi.mocked(db.getCourseById).mockResolvedValue({ id: 1, college: "经济学院" } as any);
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

  it("尚未配置任何学期时不阻断业务，semesterId 留空", async () => {
    vi.mocked(db.getActiveSemester).mockResolvedValue(undefined as any);
    await appRouter.createCaller(ctx()).plans.create({ courseId: 1 });
    expect(db.createListeningPlan).toHaveBeenCalledWith(
      expect.objectContaining({ semesterId: undefined })
    );
  });
});

describe("查询按学期隔离", () => {
  it("待听课列表只取当前学期，不混入往期遗留计划", async () => {
    await appRouter.createCaller(ctx()).plans.myPlans();
    expect(db.getListeningPlansBySupervisor).toHaveBeenCalledWith(3, ACTIVE_SEMESTER.id);
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
