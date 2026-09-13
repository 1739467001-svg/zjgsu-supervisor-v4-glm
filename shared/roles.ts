/**
 * 角色/权限相关的共享辅助函数（client 与 server 共用）。
 *
 * 学院名称的比对规则见 ./colleges.ts，此处转出以便调用方从单一入口引入。
 *
 * 支持"多角色"：用户除主角色（role）外，还可拥有若干附加角色（extraRoles），
 * 二者的并集即为该用户的"有效角色集合"，用于权限判断。
 *
 * 督导范围（校级/院级）由独立字段 supervisorScope 决定，不再从 college 是否有值推断。
 * college 对督导而言是人事归属学院，几乎人人都有；早先按"有 college 即院级"推断，
 * 导致全部校级督导被误判为院级、看不到本学院以外的课程。
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

/** 督导范围：校级可查看评价全校课程，院级仅限本学院 */
export type SupervisorScope = "school" | "college";

export type RoleAwareUser = {
  role?: string | null;
  /**
   * 附加角色。数据库里是 JSON 列，但不同引擎回传的类型不一样：
   * MySQL 8 / TiDB 回传已解析的数组，而 MariaDB 的 JSON 实际是 LONGTEXT，
   * 驱动只会回传原始字符串。所以这里两种都要接受。
   */
  extraRoles?: string[] | string | null;
  college?: string | null;
  supervisorScope?: SupervisorScope | string | null;
};

/**
 * 把 extraRoles 规整成字符串数组。
 *
 * 关键在于绝不能直接遍历字符串 —— 那会按字符拆开，
 * 把 '["graduate_admin"]' 变成 '[' '"' 'g' … 这一串假角色，
 * 结果是附加角色既判不出权限、又在切换菜单里显示成一堆单字。
 */
export function normalizeExtraRoles(value: RoleAwareUser["extraRoles"]): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : parseRoleArray(value);
  return list.filter((r): r is string => typeof r === "string" && r.length > 0);
}

function parseRoleArray(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 用户的有效角色集合（主角色 + 附加角色，去重） */
export function getEffectiveRoles(user?: RoleAwareUser | null): string[] {
  if (!user) return [];
  const roles = new Set<string>();
  if (user.role) roles.add(user.role);
  for (const r of normalizeExtraRoles(user.extraRoles)) {
    roles.add(r);
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

/**
 * 该用户是否为"院级督导"。
 *
 * 三个条件缺一不可：具备督导角色、范围显式标记为 college、且确实填了学院。
 * 未显式标记的一律按校级处理 —— 这是刻意的安全默认：宁可范围偏大也不要
 * 让督导突然看不到本该负责的课程（此前按 college 推断就造成了这种事故）。
 */
export function isCollegeScopedSupervisor(user?: RoleAwareUser | null): boolean {
  if (!user) return false;
  if (user.supervisorScope !== "college") return false;
  if (!user.college) return false;
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

export function getRoleLabel(role?: string | null): string {
  if (!role) return "—";
  return ROLE_LABELS[role] || role;
}

/** 该用户作为督导的范围；非督导角色返回 undefined */
export function getSupervisorScopeLabel(user?: RoleAwareUser | null): "校级" | "院级" | undefined {
  if (!hasAnyRole(user, SUPERVISOR_ROLES)) return undefined;
  return isCollegeScopedSupervisor(user) ? "院级" : "校级";
}

/** 督导角色标签，含校级/院级范围后缀，用于列表展示与报表导出 */
export function getSupervisorRoleLabel(user?: RoleAwareUser | null): string {
  if (!user || !user.role) return "—";
  const label = getRoleLabel(user.role);
  if (isSupervisorRole(user.role)) {
    return `${label}（${isCollegeScopedSupervisor(user) ? "院级" : "校级"}）`;
  }
  return label;
}

// 学院范围匹配统一由 ./colleges.ts 提供，此处转出保持调用方引入路径不变
export { isCollegeInScope, resolveCollege, collegeVariants, OFFICIAL_COLLEGES } from "./colleges";
