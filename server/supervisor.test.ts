import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock db module
vi.mock("./db", () => ({
  getCourses: vi.fn().mockResolvedValue({ courses: [], total: 0 }),
  getActiveSemester: vi.fn().mockResolvedValue({ id: 1, academicYear: "2025-2026", name: "第二学期", startDate: "2026-03-02", totalWeeks: 19 }),
  listSemesters: vi.fn().mockResolvedValue([]),
  createSemester: vi.fn().mockResolvedValue({ id: 1 }),
  setActiveSemester: vi.fn().mockResolvedValue(undefined),
  updateSemester: vi.fn().mockResolvedValue(undefined),
  getCourseById: vi.fn().mockResolvedValue(null),
  getDistinctColleges: vi.fn().mockResolvedValue([]),
  getDistinctTeachers: vi.fn().mockResolvedValue([]),
  getListeningPlansBySupervisor: vi.fn().mockResolvedValue([]),
  createListeningPlan: vi.fn().mockResolvedValue({ id: 1 }),
  deleteListeningPlan: vi.fn().mockResolvedValue(undefined),
  updateListeningPlanStatus: vi.fn().mockResolvedValue(undefined),
  getEvaluationsBySupervisor: vi.fn().mockResolvedValue([]),
  getAllEvaluations: vi.fn().mockResolvedValue([]),
  getEvaluationById: vi.fn().mockResolvedValue(null),
  createEvaluation: vi.fn().mockResolvedValue({ id: 1 }),
  updateEvaluation: vi.fn().mockResolvedValue(undefined),
  deleteEvaluation: vi.fn().mockResolvedValue(undefined),
  getAdminStats: vi.fn().mockResolvedValue({
    totalCourses: 1344,
    totalEvaluations: 0,
    totalSupervisors: 9,
    evalByCollege: [],
    evalByWeekday: [],
    recentEvals: [],
    topSupervisors: [],
    avgScoreByCollege: [],
  }),
  getNotificationsByUser: vi.fn().mockResolvedValue([]),
  getUnreadNotificationCount: vi.fn().mockResolvedValue(0),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
  markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue({ id: 1 }),
  getAllUsers: vi.fn().mockResolvedValue([]),
  getUsersByRole: vi.fn().mockResolvedValue([]),
  updateUserRole: vi.fn().mockResolvedValue(undefined),
  getUserByEmployeeId: vi.fn().mockResolvedValue(null),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getCollegeStats: vi.fn().mockResolvedValue({ total: 0, submitted: 0, draft: 0 }),
}));

// Mock sdk
vi.mock("./_core/sdk", () => ({
  sdk: {
    createSessionToken: vi.fn().mockResolvedValue("mock-token"),
  },
}));

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-open-id",
      name: "管理员",
      email: "admin@zjgsu.edu.cn",
      loginMethod: "employee_id",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createSupervisorContext(role: string = "supervisor_expert"): TrpcContext {
  return {
    user: {
      id: 2,
      openId: "supervisor-open-id",
      name: "督导专家",
      email: "supervisor@zjgsu.edu.cn",
      loginMethod: "employee_id",
      role: role as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createSecretaryContext(): TrpcContext {
  return {
    user: {
      id: 3,
      openId: "secretary-open-id",
      name: "教学秘书",
      email: "secretary@zjgsu.edu.cn",
      loginMethod: "employee_id",
      role: "college_secretary" as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("auth", () => {
  it("auth.me returns user when authenticated", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeDefined();
    expect(result?.name).toBe("管理员");
  });

  it("auth.me returns null when not authenticated", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("auth.logout clears cookie", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
  });
});

describe("courses", () => {
  it("courses.list returns paginated results", async () => {
    const ctx = createSupervisorContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.courses.list({ page: 1, pageSize: 10 });
    expect(result).toHaveProperty("courses");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.courses)).toBe(true);
  });

  it("courses.getColleges returns list", async () => {
    const ctx = createSupervisorContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.courses.getColleges();
    expect(Array.isArray(result)).toBe(true);
  });

  it("courses.list requires authentication", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    await expect(caller.courses.list({ page: 1, pageSize: 10 })).rejects.toThrow();
  });
});

describe("plans", () => {
  it("plans.myPlans returns supervisor's plans", async () => {
    const ctx = createSupervisorContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.plans.myPlans();
    expect(Array.isArray(result)).toBe(true);
  });

  it("plans.myPlans requires supervisor role", async () => {
    const ctx = createSecretaryContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.plans.myPlans()).rejects.toThrow();
  });

  it("plans.create requires supervisor role", async () => {
    const ctx = createSecretaryContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.plans.create({ courseId: 1 })).rejects.toThrow();
  });
});

describe("evaluations", () => {
  it("evaluations.myEvaluations returns supervisor's evaluations", async () => {
    const ctx = createSupervisorContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.evaluations.myEvaluations();
    expect(Array.isArray(result)).toBe(true);
  });

  it("evaluations.allEvaluations accessible to supervisor_leader", async () => {
    const leaderCtx = createSupervisorContext("supervisor_leader");
    const leaderCaller = appRouter.createCaller(leaderCtx);
    const result = await leaderCaller.evaluations.allEvaluations({});
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("stats", () => {
  it("stats.adminDashboard requires admin role", async () => {
    const expertCtx = createSupervisorContext("supervisor_expert");
    const expertCaller = appRouter.createCaller(expertCtx);
    await expect(expertCaller.stats.adminDashboard()).rejects.toThrow();
  });

  it("stats.adminDashboard accessible to graduate_admin", async () => {
    const adminCtx = createSupervisorContext("graduate_admin");
    const adminCaller = appRouter.createCaller(adminCtx);
    const result = await adminCaller.stats.adminDashboard();
    expect(result).toHaveProperty("totalCourses");
    expect(result.totalCourses).toBe(1344);
  });
});

describe("notifications", () => {
  it("notifications.list returns user notifications", async () => {
    const ctx = createSupervisorContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.notifications.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("notifications.unreadCount returns number", async () => {
    const ctx = createSupervisorContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.notifications.unreadCount();
    expect(typeof result).toBe("number");
    expect(result).toBe(0);
  });
});

describe("auth.loginByEmployeeId", () => {
  it("login fails when user not found", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.auth.loginByEmployeeId({ employeeId: "9999999", password: "9999999" })
    ).rejects.toThrow("工号不存在");
  });

  it("login fails with wrong password", async () => {
    const { getUserByEmployeeId } = await import("./db");
    (getUserByEmployeeId as any).mockResolvedValueOnce({
      id: 10,
      openId: "emp_1234567",
      employeeId: "1234567",
      name: "测试用户",
      password: "1234567",
      role: "supervisor_expert",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.auth.loginByEmployeeId({ employeeId: "1234567", password: "wrongpass" })
    ).rejects.toThrow("密码错误");
  });

  it("login succeeds with correct credentials", async () => {
    const { getUserByEmployeeId, upsertUser } = await import("./db");
    const mockUser = {
      id: 10,
      openId: "emp_1234567",
      employeeId: "1234567",
      name: "测试用户",
      password: "1234567",
      role: "supervisor_expert",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
    (getUserByEmployeeId as any).mockResolvedValueOnce(mockUser);
    (upsertUser as any).mockResolvedValueOnce(undefined);
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.loginByEmployeeId({ employeeId: "1234567", password: "1234567" });
    expect(result.success).toBe(true);
    expect(result.user?.name).toBe("测试用户");
  });
});

describe("scheduler", () => {
  it("sendListeningReminders is a function", async () => {
    const { sendListeningReminders } = await import("./scheduler");
    expect(typeof sendListeningReminders).toBe("function");
  });

  it("startScheduler and stopScheduler are exported", async () => {
    const { startScheduler, stopScheduler } = await import("./scheduler");
    expect(typeof startScheduler).toBe("function");
    expect(typeof stopScheduler).toBe("function");
  });
});

describe("users", () => {
  it("users.list requires admin role", async () => {
    const expertCtx = createSupervisorContext("supervisor_expert");
    const expertCaller = appRouter.createCaller(expertCtx);
    await expect(expertCaller.users.list()).rejects.toThrow();
  });

  it("users.list accessible to admin", async () => {
    const adminCtx = createAdminContext();
    const adminCaller = appRouter.createCaller(adminCtx);
    const result = await adminCaller.users.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("users.getSupervisors accessible to all authenticated users", async () => {
    const ctx = createSupervisorContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.users.getSupervisors();
    expect(Array.isArray(result)).toBe(true);
  });
});
