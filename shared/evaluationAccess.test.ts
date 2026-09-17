/**
 * 「谁能看这条评价」的权限测试。
 *
 * 这些用例对应一次外部代码审查报出的越权问题：评价详情接口只拦了院级范围，
 * 校级的普通督导专家只要知道别人的评价 ID 就能读到详情；打印路由更宽松，
 * 只拦学院秘书且学院名用字符串全等比较。
 */
import { describe, expect, it } from "vitest";
import { canViewEvaluation, canMutateListeningPlan, type AccessUser } from "./evaluationAccess";

const user = (over: Partial<AccessUser> & { id: number }): AccessUser =>
  ({ role: "supervisor_expert", extraRoles: null, college: null, supervisorScope: "school", ...over }) as AccessUser;

const 别人的评价 = { supervisorId: 999 };
const 我的评价 = { supervisorId: 1 };
const 法学院的课 = { college: "法学院" };
const 经济学院的课 = { college: "经济学院" };

describe("canViewEvaluation", () => {
  it("自己写的评价永远能看", () => {
    expect(canViewEvaluation(user({ id: 1 }), 我的评价, 法学院的课)).toBe(true);
  });

  it("校级督导专家看不了别人的评价 —— 这正是被报出的越权点", () => {
    expect(canViewEvaluation(user({ id: 1, supervisorScope: "school" }), 别人的评价, 法学院的课)).toBe(false);
  });

  it("院级督导专家也看不了别人的评价（院级范围只决定他能听哪些课）", () => {
    const u = user({ id: 1, supervisorScope: "college", college: "法学院" });
    expect(canViewEvaluation(u, 别人的评价, 法学院的课)).toBe(false);
  });

  it("督导组长（校级）能看全校的评价", () => {
    expect(canViewEvaluation(user({ id: 1, role: "supervisor_leader" }), 别人的评价, 法学院的课)).toBe(true);
  });

  it("院级督导组长只能看本学院的", () => {
    const u = user({ id: 1, role: "supervisor_leader", supervisorScope: "college", college: "法学院" });
    expect(canViewEvaluation(u, 别人的评价, 法学院的课)).toBe(true);
    expect(canViewEvaluation(u, 别人的评价, 经济学院的课)).toBe(false);
  });

  it("学院教学秘书只能看本学院的", () => {
    const u = user({ id: 1, role: "college_secretary", college: "法学院" });
    expect(canViewEvaluation(u, 别人的评价, 法学院的课)).toBe(true);
    expect(canViewEvaluation(u, 别人的评价, 经济学院的课)).toBe(false);
  });

  it("学院名的别名要认得出来，不能用字符串全等", () => {
    const u = user({ id: 1, role: "college_secretary", college: "法学院" });
    expect(canViewEvaluation(u, 别人的评价, { college: "法学院（知识产权学院）" })).toBe(true);
  });

  it("研究生院主管、系统管理员能看全校", () => {
    expect(canViewEvaluation(user({ id: 1, role: "graduate_admin" }), 别人的评价, 法学院的课)).toBe(true);
    expect(canViewEvaluation(user({ id: 1, role: "admin" }), 别人的评价, 法学院的课)).toBe(true);
  });

  it("普通用户什么都看不了", () => {
    expect(canViewEvaluation(user({ id: 1, role: "user" }), 别人的评价, 法学院的课)).toBe(false);
  });

  it("附加角色要生效：主角色普通用户 + 附加角色研究生院主管，能看全校", () => {
    const u = user({ id: 1, role: "user", extraRoles: ["graduate_admin"] });
    expect(canViewEvaluation(u, 别人的评价, 法学院的课)).toBe(true);
  });

  it("附加角色以 JSON 字符串形式存储时也要生效（MariaDB 的 json 列返回字符串）", () => {
    const u = user({ id: 1, role: "user", extraRoles: '["graduate_admin"]' as any });
    expect(canViewEvaluation(u, 别人的评价, 法学院的课)).toBe(true);
  });

  it("院级范围下查不到课程时一律拒绝，而不是放行", () => {
    const u = user({ id: 1, role: "college_secretary", college: "法学院" });
    expect(canViewEvaluation(u, 别人的评价, null)).toBe(false);
  });

  it("未登录、评价不存在都返回 false", () => {
    expect(canViewEvaluation(null, 别人的评价, 法学院的课)).toBe(false);
    expect(canViewEvaluation(user({ id: 1 }), null, 法学院的课)).toBe(false);
  });
});

describe("canMutateListeningPlan", () => {
  it("只能改自己的听课计划", () => {
    expect(canMutateListeningPlan(user({ id: 1 }), { supervisorId: 1 })).toBe(true);
    expect(canMutateListeningPlan(user({ id: 1 }), { supervisorId: 999 })).toBe(false);
  });

  it("督导组长也不能改别人的计划（组长不等于代办）", () => {
    expect(canMutateListeningPlan(user({ id: 1, role: "supervisor_leader" }), { supervisorId: 999 })).toBe(false);
  });

  it("研究生院主管、系统管理员可以清理任何人的计划", () => {
    expect(canMutateListeningPlan(user({ id: 1, role: "graduate_admin" }), { supervisorId: 999 })).toBe(true);
    expect(canMutateListeningPlan(user({ id: 1, role: "admin" }), { supervisorId: 999 })).toBe(true);
  });
});
