/**
 * 初始密码改密提醒（2026-10-26 用户需求）的回归守护。
 *
 * 行为约定：
 *   1. 登录时若密码仍为初始密码（空或等于工号），投递一条 password_reminder
 *      站内信——铃铛角标 +1；
 *   2. 同一账号已有未读的 password_reminder 时不重复投递（避免每次登录堆积）；
 *   3. auth.me 返回 isDefaultPassword 标记，前端据此弹窗；
 *   4. 改密成功后标记消失，后续登录不再投递。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

vi.mock("./db", () => ({
  getActiveSemester: vi.fn().mockResolvedValue({ id: 2, startDate: "2026-09-14", totalWeeks: 18 }),
  listSemesters: vi.fn().mockResolvedValue([]),
  getCourseById: vi.fn(),
  createListeningPlan: vi.fn(),
  getListeningPlansBySupervisor: vi.fn().mockResolvedValue([]),
  createEvaluation: vi.fn().mockResolvedValue({ id: 1 }),
  updateEvaluation: vi.fn(),
  getSubmittedEvaluationByCourse: vi.fn().mockResolvedValue(null),
  completePendingPlanForEvaluation: vi.fn().mockResolvedValue(null),
  getCourses: vi.fn().mockResolvedValue({ courses: [], total: 0 }),
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
  markPasswordRemindersRead: vi.fn(),
  createNotification: vi.fn().mockResolvedValue({ id: 1 }),
  getAllUsers: vi.fn().mockResolvedValue([]),
  getUsersByRole: vi.fn().mockResolvedValue([]),
  updateUserRole: vi.fn(),
  updateUserExtraRoles: vi.fn(),
  updateUserSupervisorScope: vi.fn(),
  updateUserCollege: vi.fn(),
  updateUserPassword: vi.fn(),
  getUserByEmployeeId: vi.fn(),
  getUserByOpenId: vi.fn(),
  getUserById: vi.fn(),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  countOtherAdmins: vi.fn().mockResolvedValue(1),
  logUserAdminChange: vi.fn(),
  listUserAdminLogs: vi.fn().mockResolvedValue([]),
}));

vi.mock("./_core/sdk", () => ({ sdk: { createSessionToken: vi.fn().mockResolvedValue("t") } }));

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function fakeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    openId: "emp_1010137",
    employeeId: "1010137",
    name: "测试用户",
    role: "supervisor_expert",
    college: "工商管理学院",
    supervisorScope: "college",
    password: null,
    phone: "13900000000",
    email: null,
    loginMethod: "employee_id",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getActiveSemester).mockResolvedValue({ id: 2, startDate: "2026-09-14", totalWeeks: 18 } as any);
});

describe("登录时投递初始密码提醒", () => {
  it("密码为空（初始密码）→ 投递 password_reminder 站内信", async () => {
    vi.mocked(db.getUserByEmployeeId).mockResolvedValue(fakeUser() as any);
    vi.mocked(db.getNotificationsByUser).mockResolvedValue([] as any);
    const r = await appRouter.createCaller(ctx()).auth.loginByEmployeeId({ employeeId: "1010137", password: "1010137" });
    expect(r.success).toBe(true);
    expect(db.createNotification).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(db.createNotification).mock.calls[0][0] as any;
    expect(payload.type).toBe("password_reminder");
    expect(payload.recipientId).toBe(42);
    expect(payload.title).toContain("初始密码");
  });

  it("已有未读 password_reminder 时不重复投递", async () => {
    vi.mocked(db.getUserByEmployeeId).mockResolvedValue(fakeUser() as any);
    vi.mocked(db.getNotificationsByUser).mockResolvedValue([
      { id: 9, type: "password_reminder", isRead: false, title: "安全提醒：请修改初始密码", content: "", recipientId: 42 },
    ] as any);
    await appRouter.createCaller(ctx()).auth.loginByEmployeeId({ employeeId: "1010137", password: "1010137" });
    expect(db.createNotification).not.toHaveBeenCalled();
  });

  it("提醒已读但密码未改 → 再次登录重新投递", async () => {
    vi.mocked(db.getUserByEmployeeId).mockResolvedValue(fakeUser() as any);
    vi.mocked(db.getNotificationsByUser).mockResolvedValue([
      { id: 9, type: "password_reminder", isRead: true, title: "x", content: "", recipientId: 42 },
    ] as any);
    await appRouter.createCaller(ctx()).auth.loginByEmployeeId({ employeeId: "1010137", password: "1010137" });
    expect(db.createNotification).toHaveBeenCalledTimes(1);
  });

  it("已改密（password 与工号不同）→ 不投递", async () => {
    vi.mocked(db.getUserByEmployeeId).mockResolvedValue(fakeUser({ password: "Abc123456" }) as any);
    await appRouter.createCaller(ctx()).auth.loginByEmployeeId({ employeeId: "1010137", password: "Abc123456" });
    expect(db.createNotification).not.toHaveBeenCalled();
  });
});

describe("auth.me 的 isDefaultPassword 标记", () => {
  function meCtx(user: any): TrpcContext {
    return { ...ctx(), user };
  }

  it("初始密码 → true；已改密 → false", async () => {
    const a = await appRouter.createCaller(meCtx(fakeUser())).auth.me();
    expect((a as any).isDefaultPassword).toBe(true);
    const b = await appRouter.createCaller(meCtx(fakeUser({ password: "Abc123456" }))).auth.me();
    expect((b as any).isDefaultPassword).toBe(false);
  });

  it("密码等于工号（曾把密码改成工号）→ 也视为初始密码", async () => {
    const c = await appRouter.createCaller(meCtx(fakeUser({ password: "1010137" }))).auth.me();
    expect((c as any).isDefaultPassword).toBe(true);
  });
});

describe("改密后提醒即已读", () => {
  it("markPasswordRemindersRead 只把未读的改密提醒置已读", async () => {
    const userCtx = { ...ctx(), user: fakeUser() } as TrpcContext;
    const r = await appRouter.createCaller(userCtx).notifications.markPasswordRemindersRead();
    expect(r.success).toBe(true);
    expect(db.markPasswordRemindersRead).toHaveBeenCalledWith(42);
  });
});
