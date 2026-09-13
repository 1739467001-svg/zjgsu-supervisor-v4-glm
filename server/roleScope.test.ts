/**
 * 多角色（extraRoles）与督导范围（校级/院级）权限测试，
 * 以及本次修复的两个 Bug 的服务端行为测试。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

vi.mock("./db", () => ({
  getCourses: vi.fn().mockResolvedValue({ data: [], total: 0 }),
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
  completePendingPlanForEvaluation: vi.fn().mockResolvedValue(null),
  getUsedWeeksForCourse: vi.fn().mockResolvedValue({ usedWeeks: [], evaluatedWeeks: [] }),
  getEvaluationsBySupervisor: vi.fn().mockResolvedValue([]),
  getAllEvaluations: vi.fn().mockResolvedValue([]),
  getEvaluationById: vi.fn().mockResolvedValue(null),
  createEvaluation: vi.fn().mockResolvedValue({ id: 77, planId: null }),
  updateEvaluation: vi.fn().mockResolvedValue(undefined),
  deleteEvaluation: vi.fn().mockResolvedValue(undefined),
  getAdminStats: vi.fn().mockResolvedValue(null),
  getCourseEvaluationProgress: vi.fn().mockResolvedValue([]),
  getAllCollegeEvaluationProgress: vi.fn().mockResolvedValue([]),
  getNotificationsByUser: vi.fn().mockResolvedValue([]),
  getUnreadNotificationCount: vi.fn().mockResolvedValue(0),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
  markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue({ id: 1 }),
  getAllUsers: vi.fn().mockResolvedValue([]),
  getUsersByRole: vi.fn().mockResolvedValue([]),
  updateUserRole: vi.fn().mockResolvedValue(undefined),
  updateUserExtraRoles: vi.fn().mockResolvedValue(undefined),
  updateUserSupervisorScope: vi.fn().mockResolvedValue(undefined),
  updateUserCollege: vi.fn().mockResolvedValue(undefined),
  updateUserPassword: vi.fn().mockResolvedValue(undefined),
  getUserByEmployeeId: vi.fn().mockResolvedValue(null),
  upsertUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./_core/sdk", () => ({
  sdk: { createSessionToken: vi.fn().mockResolvedValue("mock-token") },
}));

function ctxFor(user: Partial<any>): TrpcContext {
  return {
    user: {
      id: 10,
      openId: "open-id",
      name: "测试用户",
      email: null,
      employeeId: "10001",
      phone: null,
      loginMethod: "employee_id",
      role: "supervisor_expert",
      extraRoles: null,
      college: null,
      supervisorScope: "school",
      remark: null,
      password: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      ...user,
    } as any,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const HUMANITIES = "人文学院";
const STATS = "统计与数据科学学院";

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 督导范围：校级 vs 院级
// ============================================================
describe("督导范围（校级/院级）", () => {
  it("院级督导浏览课程时，学院筛选被强制限定为本学院", async () => {
    const caller = appRouter.createCaller(ctxFor({ role: "supervisor_expert", college: HUMANITIES, supervisorScope: "college" }));
    await caller.courses.list({ college: STATS, page: 1, pageSize: 20 });
    // 即使前端传了别的学院，也必须被覆盖为本学院
    expect(db.getCourses).toHaveBeenCalledWith(expect.objectContaining({ college: HUMANITIES }));
  });

  it("校级督导（未设置学院）浏览课程时，可按任意学院筛选", async () => {
    const caller = appRouter.createCaller(ctxFor({ role: "supervisor_expert", college: null }));
    await caller.courses.list({ college: STATS, page: 1, pageSize: 20 });
    expect(db.getCourses).toHaveBeenCalledWith(expect.objectContaining({ college: STATS }));
  });

  it("院级督导不能对外院课程建立听课计划", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 5, college: STATS } as any);
    const caller = appRouter.createCaller(ctxFor({ role: "supervisor_expert", college: HUMANITIES, supervisorScope: "college" }));
    await expect(caller.plans.create({ courseId: 5 })).rejects.toThrow(/本学院/);
    expect(db.createListeningPlan).not.toHaveBeenCalled();
  });

  it("院级督导可以对本学院课程建立听课计划", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 6, college: HUMANITIES } as any);
    const caller = appRouter.createCaller(ctxFor({ role: "supervisor_expert", college: HUMANITIES, supervisorScope: "college" }));
    await caller.plans.create({ courseId: 6, planWeek: 7 });
    expect(db.createListeningPlan).toHaveBeenCalled();
  });

  it("校级督导可以对任意学院课程建立听课计划", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 7, college: STATS } as any);
    const caller = appRouter.createCaller(ctxFor({ role: "supervisor_expert", college: null }));
    await caller.plans.create({ courseId: 7, planWeek: 3 });
    expect(db.createListeningPlan).toHaveBeenCalled();
  });

  it("院级督导不能对外院课程提交评价", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 8, college: STATS } as any);
    const caller = appRouter.createCaller(ctxFor({ role: "supervisor_expert", college: HUMANITIES, supervisorScope: "college" }));
    await expect(
      caller.evaluations.create({ courseId: 8, status: "submitted" })
    ).rejects.toThrow(/本学院/);
    expect(db.createEvaluation).not.toHaveBeenCalled();
  });
});

// ============================================================
// 多角色（extraRoles）
// ============================================================
describe("多角色（extraRoles）", () => {
  it("学院教学秘书本身无督导权限", async () => {
    const caller = appRouter.createCaller(ctxFor({ role: "college_secretary", college: HUMANITIES }));
    await expect(caller.plans.myPlans()).rejects.toThrow(/督导专家/);
  });

  it("学院教学秘书附加督导专家角色后，即可使用督导功能", async () => {
    const caller = appRouter.createCaller(
      ctxFor({ role: "college_secretary", college: HUMANITIES, extraRoles: ["supervisor_expert"] })
    );
    await expect(caller.plans.myPlans()).resolves.toEqual([]);
  });

  it("研究生院主管附加督导专家角色后，同时具备主管统计与督导听课能力", async () => {
    const caller = appRouter.createCaller(
      ctxFor({ role: "graduate_admin", extraRoles: ["supervisor_expert"] })
    );
    await expect(caller.plans.myPlans()).resolves.toEqual([]);
    await expect(caller.stats.allCollegeProgress()).resolves.toEqual([]);
  });

  it("普通用户附加研究生院主管角色后可访问管理端接口", async () => {
    const caller = appRouter.createCaller(ctxFor({ role: "user", extraRoles: ["graduate_admin"] }));
    await expect(caller.users.list()).resolves.toEqual([]);
  });

  it("普通用户无附加角色时不能访问管理端接口", async () => {
    const caller = appRouter.createCaller(ctxFor({ role: "user", extraRoles: [] }));
    await expect(caller.users.list()).rejects.toThrow(/研究生院主管/);
  });
});

// ============================================================
// 评价可见范围
// ============================================================
describe("评价记录可见范围", () => {
  it("督导专家只能看到自己的评价", async () => {
    const caller = appRouter.createCaller(ctxFor({ id: 42, role: "supervisor_expert" }));
    await caller.evaluations.allEvaluations({});
    expect(db.getEvaluationsBySupervisor).toHaveBeenCalledWith(42);
    expect(db.getAllEvaluations).not.toHaveBeenCalled();
  });

  it("督导组长可以看到全部评价", async () => {
    const caller = appRouter.createCaller(ctxFor({ role: "supervisor_leader" }));
    await caller.evaluations.allEvaluations({});
    expect(db.getAllEvaluations).toHaveBeenCalled();
    expect(db.getEvaluationsBySupervisor).not.toHaveBeenCalled();
  });

  it("学院教学秘书查看评价时被限定为本学院", async () => {
    const caller = appRouter.createCaller(ctxFor({ role: "college_secretary", college: HUMANITIES }));
    await caller.evaluations.allEvaluations({ college: STATS });
    expect(db.getAllEvaluations).toHaveBeenCalledWith(expect.objectContaining({ college: HUMANITIES }));
  });

  it("院级督导专家不会因为设置了学院就获得查看他人评价的权限", async () => {
    // 学院范围只约束「能听哪些课」，不等于「能看别人的评价」
    const caller = appRouter.createCaller(
      ctxFor({ id: 43, role: "supervisor_expert", college: HUMANITIES, supervisorScope: "college" })
    );
    await caller.evaluations.allEvaluations({});
    expect(db.getEvaluationsBySupervisor).toHaveBeenCalledWith(43);
    expect(db.getAllEvaluations).not.toHaveBeenCalled();
  });
});

// ============================================================
// Bug 修复：提交评价后同步听课计划状态
// ============================================================
describe("提交评价后自动完结听课计划", () => {
  it("新建评价并直接提交时，同步把待听课计划标记为已评价", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 9, college: HUMANITIES, courseName: "X" } as any);
    vi.mocked(db.completePendingPlanForEvaluation).mockResolvedValue(555);
    const caller = appRouter.createCaller(ctxFor({ id: 44, role: "supervisor_expert" }));

    await caller.evaluations.create({ courseId: 9, actualWeek: 7, status: "submitted" });

    expect(db.completePendingPlanForEvaluation).toHaveBeenCalledWith(44, 9, 7);
    // 并把计划 ID 回写到评价记录上
    expect(db.updateEvaluation).toHaveBeenCalledWith(77, { planId: 555 });
  });

  it("保存草稿时不应该完结听课计划", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 9, college: HUMANITIES } as any);
    const caller = appRouter.createCaller(ctxFor({ id: 44, role: "supervisor_expert" }));

    await caller.evaluations.create({ courseId: 9, actualWeek: 7, status: "draft" });

    expect(db.completePendingPlanForEvaluation).not.toHaveBeenCalled();
  });

  it("草稿改为提交时，同步完结听课计划", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 9, college: HUMANITIES } as any);
    vi.mocked(db.getEvaluationById).mockResolvedValue({
      id: 100, supervisorId: 44, courseId: 9, actualWeek: 7, planId: null, status: "draft",
    } as any);
    const caller = appRouter.createCaller(ctxFor({ id: 44, role: "supervisor_expert" }));

    await caller.evaluations.update({ id: 100, data: { courseId: 9, actualWeek: 7, status: "submitted" } });

    expect(db.completePendingPlanForEvaluation).toHaveBeenCalledWith(44, 9, 7);
  });

  it("已提交的评价再次保存（自动保存）时，不重复完结听课计划", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 9, college: HUMANITIES } as any);
    vi.mocked(db.getEvaluationById).mockResolvedValue({
      id: 100, supervisorId: 44, courseId: 9, actualWeek: 7, planId: 555, status: "submitted",
    } as any);
    const caller = appRouter.createCaller(ctxFor({ id: 44, role: "supervisor_expert" }));

    await caller.evaluations.update({ id: 100, data: { courseId: 9, actualWeek: 7, status: "submitted" } });

    expect(db.completePendingPlanForEvaluation).not.toHaveBeenCalled();
  });

  it("已提交的评价被自动保存时，状态仍写回 submitted（不得退回草稿）", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 9, college: HUMANITIES } as any);
    vi.mocked(db.getEvaluationById).mockResolvedValue({
      id: 100, supervisorId: 44, courseId: 9, actualWeek: 7, planId: 555, status: "submitted",
    } as any);
    const caller = appRouter.createCaller(ctxFor({ id: 44, role: "supervisor_expert" }));

    await caller.evaluations.update({ id: 100, data: { courseId: 9, actualWeek: 7, status: "submitted" } });

    expect(db.updateEvaluation).toHaveBeenCalledWith(100, expect.objectContaining({ status: "submitted" }));
  });
});

// ============================================================
// 回归：校级督导不得因人事归属学院被降级为院级
// ============================================================
describe("校级督导的全校范围（回归用例）", () => {
  it("填了人事归属学院的校级督导，浏览课程时不被限定学院", async () => {
    const caller = appRouter.createCaller(
      ctxFor({ role: "supervisor_expert", college: HUMANITIES, supervisorScope: "school" })
    );
    await caller.courses.list({ college: STATS, page: 1, pageSize: 20 });
    expect(db.getCourses).toHaveBeenCalledWith(expect.objectContaining({ college: STATS }));
  });

  it("填了人事归属学院的校级督导，可对其他学院课程建立听课计划", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 11, college: STATS } as any);
    const caller = appRouter.createCaller(
      ctxFor({ role: "supervisor_expert", college: HUMANITIES, supervisorScope: "school" })
    );
    await caller.plans.create({ courseId: 11, planWeek: 5 });
    expect(db.createListeningPlan).toHaveBeenCalled();
  });

  it("填了人事归属学院的校级督导，可对其他学院课程提交评价", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 12, college: STATS } as any);
    const caller = appRouter.createCaller(
      ctxFor({ role: "supervisor_expert", college: HUMANITIES, supervisorScope: "school" })
    );
    await caller.evaluations.create({ courseId: 12, status: "submitted" });
    expect(db.createEvaluation).toHaveBeenCalled();
  });

  it("老数据未标记范围时按校级处理，不被限定学院", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 13, college: STATS } as any);
    const caller = appRouter.createCaller(
      ctxFor({ role: "supervisor_expert", college: HUMANITIES, supervisorScope: null })
    );
    await caller.plans.create({ courseId: 13 });
    expect(db.createListeningPlan).toHaveBeenCalled();
  });
});

// ============================================================
// 回归：附加角色以 JSON 字符串回传时（MariaDB 的 JSON 列实为 LONGTEXT）
// 仍须正确生效，否则多角色用户的权限会整体失效
// ============================================================
describe("附加角色为 JSON 字符串时的权限（回归用例）", () => {
  it("附加了研究生院主管的院级督导，可浏览其他学院课程", async () => {
    const caller = appRouter.createCaller(
      ctxFor({
        role: "supervisor_expert",
        college: HUMANITIES,
        supervisorScope: "college",
        extraRoles: '["graduate_admin"]' as any,
      })
    );
    await caller.courses.list({ college: STATS, page: 1, pageSize: 20 });
    expect(db.getCourses).toHaveBeenCalledWith(expect.objectContaining({ college: STATS }));
  });

  it("附加了研究生院主管的院级督导，可评价其他学院课程", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 21, college: STATS } as any);
    const caller = appRouter.createCaller(
      ctxFor({
        role: "supervisor_expert",
        college: HUMANITIES,
        supervisorScope: "college",
        extraRoles: '["graduate_admin"]' as any,
      })
    );
    await caller.evaluations.create({ courseId: 21, status: "submitted" });
    expect(db.createEvaluation).toHaveBeenCalled();
  });

  it("没有附加角色的院级督导仍被限制在本学院", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 22, college: STATS } as any);
    const caller = appRouter.createCaller(
      ctxFor({ role: "supervisor_expert", college: HUMANITIES, supervisorScope: "college", extraRoles: "[]" as any })
    );
    await expect(caller.evaluations.create({ courseId: 22, status: "submitted" })).rejects.toThrow(/本学院/);
  });
});
