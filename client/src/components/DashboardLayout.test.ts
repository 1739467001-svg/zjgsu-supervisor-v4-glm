/**
 * 侧边栏菜单的回归测试。
 *
 * 外部审查报出：getMenuItems 里 "admin" 同时出现在督导分支和管理分支，
 * 而这是一串 if / else if —— 系统管理员被第一个分支接住，
 * 用户管理、统计仪表盘、上传课程数据永远不会出现在菜单里。
 *
 * 2026-10-03：菜单改为按全部有效角色取"能力并集"（getMenuItemsForRoles），
 * 切换身份不隐藏任何已授权入口；教学秘书开放全校聚合统计图表；
 * 研究生院主管菜单补上听课计划（后端本就放行其评课）。
 */
import { describe, expect, it } from "vitest";
import { getMenuItems, getMenuItemsForRoles } from "./DashboardLayout";

const keys = (role: string) => getMenuItems(role).map((i) => i.key);
const keysOf = (roles: string[]) => getMenuItemsForRoles(roles).map((i) => i.key);

describe("getMenuItems", () => {
  it("系统管理员既有督导菜单也有管理菜单", () => {
    const k = keys("admin");
    expect(k).toContain("plans");
    expect(k).toContain("users");
    expect(k).toContain("admin");
    expect(k).toContain("upload-courses");
    expect(k).toContain("course-progress-admin");
  });

  it("研究生院主管有全套管理菜单", () => {
    const k = keys("graduate_admin");
    expect(k).toEqual(
      expect.arrayContaining(["evaluations-admin", "course-progress-admin", "admin", "users", "upload-courses"]),
    );
  });

  it("督导专家只有听课计划和自己的评价记录，没有管理入口", () => {
    const k = keys("supervisor_expert");
    expect(k).toContain("plans");
    expect(k).toContain("evaluations-expert");
    expect(k).not.toContain("users");
    expect(k).not.toContain("admin");
    expect(k).not.toContain("upload-courses");
  });

  it("学院教学秘书有本学院评价、进度和全校聚合统计图表，没有听课计划和管理入口", () => {
    const k = keys("college_secretary");
    expect(k).toContain("evaluations-secretary");
    expect(k).toContain("course-progress-secretary");
    expect(k).toContain("admin");
    expect(k).not.toContain("plans");
    expect(k).not.toContain("users");
    expect(k).not.toContain("upload-courses");
  });

  it("研究生院主管菜单包含听课计划（后端本就允许主管评课）", () => {
    expect(keys("graduate_admin")).toContain("plans");
  });

  it("学院分管领导（督导+秘书双身份）任意身份下都保留听课计划入口", () => {
    const k = keysOf(["supervisor_expert", "college_secretary"]);
    expect(k).toContain("plans");
    expect(k).toContain("evaluations-secretary");
    expect(k).toContain("course-progress-secretary");
    expect(k).not.toContain("users");
    expect(k).not.toContain("upload-courses");
  });

  it("主管兼督导（如傅培华）拥有督导与管理全部入口", () => {
    const k = keysOf(["graduate_admin", "supervisor_expert"]);
    expect(k).toContain("plans");
    expect(k).toContain("evaluations-admin");
    expect(k).toContain("users");
    expect(k).toContain("upload-courses");
  });

  it("普通用户只有工作台和全校课程", () => {
    expect(keys("user")).toEqual(["home", "courses"]);
  });

  it("同一个路径不会出现两个菜单项（admin 曾经既是督导又是管理员）", () => {
    for (const role of ["admin", "graduate_admin", "supervisor_expert", "supervisor_leader", "college_secretary"]) {
      const paths = getMenuItems(role).map((i) => i.path);
      expect(new Set(paths).size, `${role} 的菜单里有重复路径：${paths.join("、")}`).toBe(paths.length);
    }
  });
});
