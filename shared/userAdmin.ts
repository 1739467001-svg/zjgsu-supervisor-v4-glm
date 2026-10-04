/**
 * 用户角色管理的服务端校验规则（唯一判定）。
 *
 * 背景：用户管理的四个变更接口（主角色/附加角色/学院/督导范围）此前没有任何
 * 服务端校验——可以把院级秘书的学院清空（受限却无范围可依）、管理员可以把自己
 * 降级锁死、也可以把系统里最后一个管理员降级。升级方案 9.2 要求
 * 「院级管理员不能未经检查直接映射」「普通用户不得自行扩展权限」，本模块
 * 把这三条硬约束收敛成一个纯函数，供路由层在写库前调用。
 */
import { hasAnyRole, normalizeExtraRoles, type RoleAwareUser } from "./roles";

/** 管理类角色：系统至少要保留一个，且管理员不能把自己降级 */
export const ADMIN_ROLES = ["graduate_admin", "admin"] as const;

/** 受限岗位：必须有所属学院才能成立（院级秘书 / 院级督导） */
export const COLLEGE_SCOPED_ROLES = ["college_secretary"] as const;

export type UserAdminTarget = RoleAwareUser & { id: number };

export type ProposedUserAdminChange = {
  role?: string;
  extraRoles?: string[];
  college?: string | null;
  supervisorScope?: "school" | "college";
};

export type MergedUserAccount = {
  role: string;
  extraRoles: string[];
  college: string | null;
  supervisorScope: "school" | "college";
};

/** 把变更合并进当前用户，得到变更后的完整账号状态 */
export function mergeUserChange(
  target: UserAdminTarget,
  change: ProposedUserAdminChange,
): MergedUserAccount {
  const role = change.role ?? target.role ?? "user";
  const extraRoles = normalizeExtraRoles(change.extraRoles !== undefined ? change.extraRoles : target.extraRoles);
  const college = change.college !== undefined ? change.college : (target.college ?? null);
  const supervisorScope =
    change.supervisorScope ?? ((target.supervisorScope as "school" | "college") || "school");
  return { role, extraRoles, college, supervisorScope };
}

/** 变更后的账号是否属于「受限岗位但没填学院」的危险组合 */
export function isCollegeRestrictedWithoutCollege(
  role: string,
  extraRoles: string[],
  college: string | null | undefined,
  supervisorScope: string,
): boolean {
  const merged: RoleAwareUser = { role, extraRoles, college, supervisorScope };
  const hasRestricted = hasAnyRole(merged, COLLEGE_SCOPED_ROLES) || (hasAnyRole(merged, ["supervisor_expert", "supervisor_leader"]) && supervisorScope === "college");
  if (!hasRestricted) return false;
  return !college?.split(/[、,，]/).some((part) => part.trim().length > 0);
}

/**
 * 校验一次用户角色/范围变更。返回错误信息（拒绝原因），null 表示允许。
 *
 * - 学院必填：变更后存在受限岗位但学院为空 → 拒绝；
 * - 自我锁定保护：管理员不能通过变更移除自己的管理角色；
 * - 最后管理员保护：系统至少保留一名拥有管理角色的账号。
 */
export function validateUserAdminChange(opts: {
  actorId: number;
  target: UserAdminTarget;
  change: ProposedUserAdminChange;
  /** 除 target 以外、当前拥有管理角色的账号数量 */
  otherAdminCount: number;
}): string | null {
  const merged = mergeUserChange(opts.target, opts.change);
  const rolesAfter = new Set([merged.role, ...merged.extraRoles]);

  if (isCollegeRestrictedWithoutCollege(merged.role, merged.extraRoles, merged.college, merged.supervisorScope)) {
    return "该账号包含需要学院范围的岗位（学院教学秘书或院级督导），请先填写所属学院再保存";
  }

  const hadAdmin = hasAnyRole(opts.target, ADMIN_ROLES);
  const hasAdminAfter = [...rolesAfter].some((r) => (ADMIN_ROLES as readonly string[]).includes(r));

  if (opts.actorId === opts.target.id && hadAdmin && !hasAdminAfter) {
    return "不能移除自己的管理权限，请联系其他管理员操作";
  }

  if (hadAdmin && !hasAdminAfter && opts.otherAdminCount <= 0) {
    return "系统至少需要保留一名管理员，不能降级最后一个管理账号";
  }

  return null;
}
