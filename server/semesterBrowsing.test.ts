import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import type { TrpcContext } from "./_core/context";

const old = { id: 1, academicYear: "2025-2026", name: "第二学期", startDate: "2026-03-02", totalWeeks: 19, isActive: false };
const current = { ...old, id: 2, academicYear: "2026-2027", name: "第一学期", startDate: "2026-09-07", isActive: true };
vi.mock("./db", () => ({
  getActiveSemester: vi.fn(), getSemesterById: vi.fn(),
  getAdminStats: vi.fn().mockResolvedValue({}), getAllCollegeEvaluationProgress: vi.fn().mockResolvedValue([]),
  getCourses: vi.fn().mockResolvedValue({ data: [], total: 0 }), getDistinctColleges: vi.fn().mockResolvedValue([]),
  getCourseEvaluationProgress: vi.fn().mockResolvedValue([]), getAllEvaluations: vi.fn().mockResolvedValue([]),
  getEvaluationsBySupervisor: vi.fn().mockResolvedValue([]), getListeningPlansBySupervisor: vi.fn().mockResolvedValue([]),
  getCourseById: vi.fn(), getEvaluationById: vi.fn(), getListeningPlanById: vi.fn(),
  createListeningPlan: vi.fn(), createEvaluation: vi.fn(), updateEvaluation: vi.fn(), deleteEvaluation: vi.fn(),
  deleteListeningPlan: vi.fn(), updateListeningPlanStatus: vi.fn(), getAllUsers: vi.fn().mockResolvedValue([]),
  getUsersByRole: vi.fn().mockResolvedValue([]), setActiveSemester: vi.fn(),
}));
vi.mock("./_core/sdk", () => ({ sdk: {} }));

function caller(role = "graduate_admin", college: string | null = null) {
  return appRouter.createCaller({ user: { id: 10, role, college, supervisorScope: "school", extraRoles: [] }, req: {}, res: {} } as TrpcContext);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getActiveSemester).mockResolvedValue(current as any);
  vi.mocked(db.getSemesterById).mockImplementation(async id => [old, current].find(s => s.id === id) as any);
  vi.mocked(db.getCourseById).mockResolvedValue({ id: 100, semesterId: 1, college: "法学院" } as any);
  vi.mocked(db.getEvaluationById).mockResolvedValue({ id: 20, courseId: 100, supervisorId: 10, semesterId: 1 } as any);
  vi.mocked(db.getListeningPlanById).mockResolvedValue({ id: 30, courseId: 100, supervisorId: 10, semesterId: 1 } as any);
});

describe("学期浏览隔离", () => {
  it("省略学期只查当前，不回退为所有历史", async () => {
    await caller().stats.adminDashboard();
    expect(db.getAdminStats).toHaveBeenCalledWith(2, undefined);
  });
  it("历史仪表盘与覆盖率均传递同一学期", async () => {
    await caller().stats.adminDashboard({ semesterId: 1 });
    await caller().stats.allCollegeProgress({ semesterId: 1 });
    expect(db.getAdminStats).toHaveBeenCalledWith(1, undefined);
    expect(db.getAllCollegeEvaluationProgress).toHaveBeenCalledWith(undefined, 1);
    expect(db.setActiveSemester).not.toHaveBeenCalled();
  });
  it("不存在的学期不能静默查询全库", async () => {
    await expect(caller().stats.adminDashboard({ semesterId: 999 })).rejects.toThrow("请选择");
    expect(db.getAdminStats).not.toHaveBeenCalled();
  });
  it("课程与学院选项保留学期范围", async () => {
    await caller().courses.list({ semesterId: 1 });
    await caller().courses.getColleges({ semesterId: 1 });
    expect(db.getCourses).toHaveBeenCalledWith(expect.objectContaining({ semesterId: 1 }));
    expect(db.getDistinctColleges).toHaveBeenCalledWith(1);
  });
  it("督导本人评价和计划可以查看历史，不越权查看他人", async () => {
    const c = caller("supervisor_expert");
    await c.evaluations.allEvaluations({ semesterId: 1 });
    await c.plans.myPlans({ semesterId: 1 });
    expect(db.getEvaluationsBySupervisor).toHaveBeenCalledWith(10, 1);
    expect(db.getListeningPlansBySupervisor).toHaveBeenCalledWith(10, 1);
    expect(db.getAllEvaluations).not.toHaveBeenCalled();
  });
  it("秘书切学期仍受本学院限制", async () => {
    const c = caller("college_secretary", "法学院");
    await c.evaluations.allEvaluations({ semesterId: 1, college: "经济学院" });
    await c.stats.courseProgress({ semesterId: 1, college: "经济学院" });
    expect(db.getAllEvaluations).toHaveBeenCalledWith(expect.objectContaining({ semesterId: 1, college: "法学院" }));
    expect(db.getCourseEvaluationProgress).toHaveBeenCalledWith("法学院", 1);
  });
  it("批量导出 Excel/PDF 不混入其他学期", async () => {
    await caller().evaluations.exportToExcel({ semesterId: 1 });
    await caller().evaluations.exportToPdf({ semesterId: 1 });
    expect(db.getAllEvaluations).toHaveBeenNthCalledWith(1, { semesterId: 1, college: undefined });
    expect(db.getAllEvaluations).toHaveBeenNthCalledWith(2, { semesterId: 1, college: undefined });
  });
});

describe("历史档案禁止写入", () => {
  it("不能给旧课新建评价或计划", async () => {
    await expect(caller().evaluations.create({ courseId: 100, status: "draft" })).rejects.toThrow("历史学期档案只读");
    await expect(caller().plans.create({ courseId: 100 })).rejects.toThrow("历史学期档案只读");
    expect(db.createEvaluation).not.toHaveBeenCalled();
    expect(db.createListeningPlan).not.toHaveBeenCalled();
  });
  it("管理员也不能从常规接口改删历史评价", async () => {
    await expect(caller().evaluations.update({ id: 20, data: { courseId: 100, status: "draft" } })).rejects.toThrow("历史学期档案只读");
    await expect(caller().evaluations.delete(20)).rejects.toThrow("历史学期档案只读");
    expect(db.updateEvaluation).not.toHaveBeenCalled();
    expect(db.deleteEvaluation).not.toHaveBeenCalled();
  });
  it("历史计划不能取消或删除", async () => {
    await expect(caller().plans.updateStatus({ planId: 30, status: "cancelled" })).rejects.toThrow("历史学期档案只读");
    await expect(caller().plans.delete(30)).rejects.toThrow("历史学期档案只读");
    expect(db.updateListeningPlanStatus).not.toHaveBeenCalled();
    expect(db.deleteListeningPlan).not.toHaveBeenCalled();
  });
  it("新学期课程正常建计划，归属不来自前端查看状态", async () => {
    vi.mocked(db.getCourseById).mockResolvedValue({ id: 101, semesterId: 2, college: "法学院" } as any);
    await caller("supervisor_expert").plans.create({ courseId: 101 });
    expect(db.createListeningPlan).toHaveBeenCalledWith(expect.objectContaining({ courseId: 101, semesterId: 2, supervisorId: 10 }));
  });
});
