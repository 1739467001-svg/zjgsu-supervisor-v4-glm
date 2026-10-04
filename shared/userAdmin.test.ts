/**
 * 用户角色管理变更校验（shared/userAdmin.ts）的回归测试。
 *
 * 对应一次功能升级：此前用户管理的四个接口没有任何服务端校验，
 * 可以把院级秘书的学院清空、管理员可以把自己降级锁死、也可以把
 * 系统里最后一个管理员降级。三条硬约束都收敛在 validateUserAdminChange。
 */
import { describe, expect, it } from "vitest";
import { validateUserAdminChange, mergeUserChange, type UserAdminTarget } from "./userAdmin";

const 管理员 = (id: number): UserAdminTarget =>
  ({ id, role: "graduate_admin", extraRoles: null, college: "研究生院", supervisorScope: "school" }) as UserAdminTarget;

const 秘书 = (id: number, college: string | null): UserAdminTarget =>
  ({ id, role: "college_secretary", extraRoles: null, college, supervisorScope: "college" }) as UserAdminTarget;

describe("学院必填（受限岗位不能没有学院）", () => {
  it("把秘书的学院清空 → 拒绝", () => {
    const err = validateUserAdminChange({
      actorId: 1,
      target: 秘书(2, "法学院"),
      change: { college: null },
      otherAdminCount: 3,
    });
    expect(err).toContain("所属学院");
  });

  it("把督导范围改成院级但没填学院 → 拒绝", () => {
    const err = validateUserAdminChange({
      actorId: 1,
      target: { id: 2, role: "supervisor_expert", extraRoles: null, college: null, supervisorScope: "school" } as UserAdminTarget,
      change: { supervisorScope: "college" },
      otherAdminCount: 3,
    });
    expect(err).toContain("所属学院");
  });

  it("院级督导补上学院后允许保存", () => {
    const err = validateUserAdminChange({
      actorId: 1,
      target: 管理员(2),
      change: { supervisorScope: "college", role: "supervisor_expert", college: "法学院" },
      otherAdminCount: 3,
    });
    expect(err).toBeNull();
  });
});

describe("自我锁定保护", () => {
  it("管理员不能移除自己的管理角色 → 拒绝", () => {
    const err = validateUserAdminChange({
      actorId: 1,
      target: 管理员(1),
      change: { role: "supervisor_expert" },
      otherAdminCount: 5,
    });
    expect(err).toContain("自己的管理权限");
  });

  it("管理员给别的管理员降级 → 允许（还有其他管理员时）", () => {
    const err = validateUserAdminChange({
      actorId: 1,
      target: 管理员(2),
      change: { role: "supervisor_expert" },
      otherAdminCount: 4,
    });
    expect(err).toBeNull();
  });
});

describe("最后管理员保护", () => {
  it("系统里没有其他管理员时，不能降级最后一个管理账号 → 拒绝", () => {
    const err = validateUserAdminChange({
      actorId: 1,
      target: 管理员(2),
      change: { role: "user" },
      otherAdminCount: 0,
    });
    expect(err).toContain("至少需要保留一名管理员");
  });

  it("还有其他管理员时可以正常降级 → 允许", () => {
    const err = validateUserAdminChange({
      actorId: 1,
      target: 管理员(2),
      change: { role: "user" },
      otherAdminCount: 1,
    });
    expect(err).toBeNull();
  });
});

describe("正常变更", () => {
  it("给督导加秘书附加角色（分管领导）且学院齐全 → 允许", () => {
    const err = validateUserAdminChange({
      actorId: 1,
      target: { id: 2, role: "supervisor_expert", extraRoles: null, college: "金融学院", supervisorScope: "college" } as UserAdminTarget,
      change: { extraRoles: ["college_secretary"] },
      otherAdminCount: 3,
    });
    expect(err).toBeNull();
  });

  it("mergeUserChange 只覆盖传入的字段", () => {
    const merged = mergeUserChange(秘书(2, "法学院"), { supervisorScope: "school" });
    expect(merged).toMatchObject({ role: "college_secretary", college: "法学院", supervisorScope: "school" });
  });
});
