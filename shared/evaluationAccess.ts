/**
 * 「谁能看这条评价」的唯一判定。
 *
 * 这条规则此前有三份实现：tRPC 的 allEvaluations（列表）、getById（详情）、
 * 以及 Express 的 /api/print/evaluation/:id（打印）。三份各写各的，于是：
 *   - 列表只给督导看自己的，详情却对同一个人放行了别人的记录
 *   - 打印路由用 user.role 直接比较，附加角色（extraRoles）完全不起作用
 *   - 打印路由的学院判断是字符串全等，不认「法学院（知识产权学院）」这类别名
 * 收敛成一个函数后，三个入口的口径只能一致。
 */
import { getScopedCollege, hasAnyRole, type RoleAwareUser } from "./roles";
import { isCollegeInScope } from "./colleges";

/** 能查看他人评价的角色；督导专家不在其中——院级范围只决定他能听哪些课，不代表能看别人的记录 */
export const EVALUATION_VIEWER_ROLES = [
  "supervisor_leader",
  "college_secretary",
  "graduate_admin",
  "admin",
] as const;

export type AccessUser = RoleAwareUser & { id: number };

export function canViewEvaluation(
  user: AccessUser | null | undefined,
  evaluation: { supervisorId: number } | null | undefined,
  course: { college: string | null } | null | undefined,
): boolean {
  if (!user || !evaluation) return false;

  // 自己写的永远能看
  if (evaluation.supervisorId === user.id) return true;

  // 没有查看他人评价资格的（普通督导专家、普通用户）到此为止
  if (!hasAnyRole(user, EVALUATION_VIEWER_ROLES)) return false;

  const scopedCollege = getScopedCollege(user);
  // 全校范围（研究生院主管、系统管理员、校级督导组长）
  if (!scopedCollege) return true;

  // 院级范围：必须知道课程属于哪个学院才能判断；查不到课程一律拒绝
  if (!course) return false;
  return isCollegeInScope(scopedCollege, course.college);
}

/** 能否改动/删除这条听课计划：本人，或研究生院主管/系统管理员（清理用） */
export function canMutateListeningPlan(
  user: AccessUser | null | undefined,
  plan: { supervisorId: number } | null | undefined,
): boolean {
  if (!user || !plan) return false;
  if (plan.supervisorId === user.id) return true;
  return hasAnyRole(user, ["graduate_admin", "admin"]);
}
