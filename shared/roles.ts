/**
 * 角色/权限相关的共享辅助函数（client 与 server 共用）。
 *
 * 支持"多角色"：用户除主角色（role）外，还可拥有若干附加角色（extraRoles），
 * 二者的并集即为该用户的"有效角色集合"，用于权限判断。
 *
 * 督导范围（校级/院级）：督导专家/督导组长若设置了 college 字段，则仅能查看、
 * 听课、评价本学院课程（院级督导）；未设置则可查看全校课程（校级督导）。
 */

export const ROLE_LABELS: Record<string, string> = {
  supervisor_expert: "督导专家",
  supervisor_leader: "督导组长",
  college_secretary: "学院教学秘书",
  graduate_admin: "研究生院主管",
  admin: "系统管理员",
  user: "普通用户",
};

export const ASSIGNABLE_ROLES = [
  "supervisor_expert",
  "supervisor_leader",
  "college_secretary",
  "graduate_admin",
  "admin",
  "user",
] as const;

export const SUPERVISOR_ROLES = ["supervisor_expert", "supervisor_leader"] as const;

export type RoleAwareUser = {
  role?: string | null;
  extraRoles?: string[] | null;
  college?: string | null;
};

/** 用户的有效角色集合（主角色 + 附加角色，去重） */
export function getEffectiveRoles(user?: RoleAwareUser | null): string[] {
  if (!user) return [];
  const roles = new Set<string>();
  if (user.role) roles.add(user.role);
  for (const r of user.extraRoles || []) {
    if (r) roles.add(r);
  }
  return Array.from(roles);
}

/** 用户的有效角色集合中，是否包含 allowed 中的任意一个角色 */
export function hasAnyRole(user: RoleAwareUser | null | undefined, allowed: readonly string[]): boolean {
  const roles = getEffectiveRoles(user);
  return roles.some((r) => allowed.includes(r));
}

export function isSupervisorRole(role: string): boolean {
  return (SUPERVISOR_ROLES as readonly string[]).includes(role);
}

/** 该用户是否为"院级督导"（督导角色 + 设置了所属学院） */
export function isCollegeScopedSupervisor(user?: RoleAwareUser | null): boolean {
  if (!user || !user.college) return false;
  return hasAnyRole(user, SUPERVISOR_ROLES);
}

/**
 * 该用户查看/听课/评价课程时应受限的学院范围。
 * - 拥有全校权限的角色（研究生院主管/系统管理员）：无限制，返回 undefined
 * - 学院教学秘书：限制为其 college 字段（可能包含多个学院，用顿号/逗号分隔）
 * - 院级督导（督导专家/组长且设置了 college）：限制为其 college 字段
 * - 校级督导 / 其他：无限制
 */
export function getScopedCollege(user?: RoleAwareUser | null): string | undefined {
  if (!user) return undefined;
  if (hasAnyRole(user, ["graduate_admin", "admin"])) return undefined;
  if (hasAnyRole(user, ["college_secretary"]) && user.college) return user.college;
  if (isCollegeScopedSupervisor(user)) return user.college || undefined;
  return undefined;
}

/** 去掉学院名中的括号补充说明，如「金融学院（浙商资产管理学院）」→「金融学院」 */
function stripCollegeSuffix(name: string): string {
  return name.replace(/（.*?）/g, "").replace(/\(.*?\)/g, "").trim();
}

/**
 * 判断某门课程的开课学院是否落在给定的督导/管理范围内。
 *
 * scopedCollege 可包含多个学院（顿号/逗号分隔，供一人管多院的场景使用）；
 * 比对时两侧都会去掉括号补充说明，并做双向包含匹配，以容忍
 * 「金融学院」与「金融学院（浙商资产管理学院）」这类简称/全称差异。
 *
 * 注意：本函数是权限判定与人员导入校验的唯一事实来源，两处必须使用同一套规则，
 * 否则会出现「导入时校验通过、实际使用时无权限」的不一致。
 */
export function isCollegeInScope(scopedCollege: string, courseCollege: string | null | undefined): boolean {
  const scopedList = scopedCollege
    .split(/[、,，]/)
    .map((c) => stripCollegeSuffix(c))
    .filter(Boolean);
  const target = stripCollegeSuffix(courseCollege || "");
  return scopedList.some((sc) => target.includes(sc) || sc.includes(target));
}

export function getRoleLabel(role?: string | null): string {
  if (!role) return "—";
  return ROLE_LABELS[role] || role;
}

/** 督导角色标签，含校级/院级范围后缀，用于列表展示与报表导出 */
export function getSupervisorRoleLabel(user?: RoleAwareUser | null): string {
  if (!user || !user.role) return "—";
  const label = getRoleLabel(user.role);
  if (isSupervisorRole(user.role)) {
    return `${label}（${user.college ? "院级" : "校级"}）`;
  }
  return label;
}
