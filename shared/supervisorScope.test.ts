/**
 * 督导范围（校级/院级）判定。
 *
 * 回归背景：早先按「college 字段非空」推断院级，而 college 对督导而言是人事归属
 * 学院、几乎人人都有，导致全部校级督导被误判为院级，看不到本学院以外的课程。
 * 现改为由独立字段 supervisorScope 显式决定。
 */
import { describe, expect, it } from "vitest";
import { isCollegeScopedSupervisor, getScopedCollege, getSupervisorRoleLabel, getSupervisorScopeLabel, getEffectiveRoles, hasAnyRole } from "./roles";

const HUMANITIES = "人文学院";

describe("校级督导不因填写了人事归属学院而被降为院级", () => {
  it("督导专家填了归属学院但范围为 school —— 仍是校级，不受学院限制", () => {
    const u = { role: "supervisor_expert", college: HUMANITIES, supervisorScope: "school" };
    expect(isCollegeScopedSupervisor(u)).toBe(false);
    expect(getScopedCollege(u)).toBeUndefined();
    expect(getSupervisorRoleLabel(u)).toBe("督导专家（校级）");
  });

  it("范围字段缺失（老数据/未标记）时按校级处理，而不是院级", () => {
    const u = { role: "supervisor_expert", college: HUMANITIES };
    expect(isCollegeScopedSupervisor(u)).toBe(false);
    expect(getScopedCollege(u)).toBeUndefined();
  });

  it("督导组长同理", () => {
    const u = { role: "supervisor_leader", college: HUMANITIES, supervisorScope: "school" };
    expect(getScopedCollege(u)).toBeUndefined();
  });

  it("院长这类兼督导的研究生院主管，始终不受学院限制", () => {
    const u = { role: "graduate_admin", college: "研究生院", extraRoles: ["supervisor_expert"], supervisorScope: "college" };
    expect(getScopedCollege(u)).toBeUndefined();
  });
});

describe("显式标记为院级时才限定学院", () => {
  it("范围为 college 且填了学院 —— 限定本学院", () => {
    const u = { role: "supervisor_expert", college: HUMANITIES, supervisorScope: "college" };
    expect(isCollegeScopedSupervisor(u)).toBe(true);
    expect(getScopedCollege(u)).toBe(HUMANITIES);
    expect(getSupervisorRoleLabel(u)).toBe("督导专家（院级）");
  });

  it("标了院级却没填学院 —— 无法限定，按校级处理而不是把范围变成空", () => {
    const u = { role: "supervisor_expert", college: null, supervisorScope: "college" };
    expect(isCollegeScopedSupervisor(u)).toBe(false);
    expect(getScopedCollege(u)).toBeUndefined();
  });

  it("学院教学秘书的管辖范围仍由 college 决定，与督导范围无关", () => {
    const u = { role: "college_secretary", college: HUMANITIES, supervisorScope: "school" };
    expect(getScopedCollege(u)).toBe(HUMANITIES);
  });

  it("秘书兼院级督导 —— 限定本学院", () => {
    const u = { role: "college_secretary", extraRoles: ["supervisor_expert"], college: HUMANITIES, supervisorScope: "college" };
    expect(getScopedCollege(u)).toBe(HUMANITIES);
    expect(getSupervisorScopeLabel(u)).toBe("院级");
  });
});

describe("范围标签", () => {
  it("非督导角色没有督导范围", () => {
    expect(getSupervisorScopeLabel({ role: "college_secretary", college: HUMANITIES })).toBeUndefined();
    expect(getSupervisorScopeLabel({ role: "graduate_admin" })).toBeUndefined();
  });

  it("督导角色默认显示校级", () => {
    expect(getSupervisorScopeLabel({ role: "supervisor_expert" })).toBe("校级");
  });
});

/**
 * extraRoles 的跨数据库兼容：MariaDB 的 JSON 列实际是 LONGTEXT，
 * 驱动回传的是原始字符串。若直接遍历，会把字符串按字符拆成假角色，
 * 导致「多角色切换」菜单显示成一串单字、附加角色的权限也判不出来。
 */
describe("extraRoles 容错（数组或 JSON 字符串）", () => {
  it("数组形式正常合并", () => {
    expect(getEffectiveRoles({ role: "supervisor_expert", extraRoles: ["graduate_admin"] }))
      .toEqual(["supervisor_expert", "graduate_admin"]);
  });

  it("JSON 字符串形式也能解析出角色，而不是拆成单个字符", () => {
    const u = { role: "supervisor_expert", extraRoles: '["graduate_admin"]' };
    expect(getEffectiveRoles(u)).toEqual(["supervisor_expert", "graduate_admin"]);
    expect(hasAnyRole(u, ["graduate_admin"])).toBe(true);
  });

  it("JSON 字符串里的多个角色全部保留", () => {
    expect(getEffectiveRoles({ role: "supervisor_expert", extraRoles: '["graduate_admin","college_secretary"]' }))
      .toEqual(["supervisor_expert", "graduate_admin", "college_secretary"]);
  });

  it("非法 JSON / 空值只保留主角色，不抛异常", () => {
    expect(getEffectiveRoles({ role: "supervisor_expert", extraRoles: "not json" })).toEqual(["supervisor_expert"]);
    expect(getEffectiveRoles({ role: "supervisor_expert", extraRoles: "" })).toEqual(["supervisor_expert"]);
    expect(getEffectiveRoles({ role: "supervisor_expert", extraRoles: null })).toEqual(["supervisor_expert"]);
  });

  it("JSON 字符串形式的督导附加角色也能享受校级默认范围", () => {
    const u = { role: "college_secretary", extraRoles: '["supervisor_expert"]', college: "人文学院", supervisorScope: "school" };
    expect(getSupervisorScopeLabel(u)).toBe("校级");
  });
});
