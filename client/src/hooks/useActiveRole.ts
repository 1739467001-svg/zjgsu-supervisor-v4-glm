import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getEffectiveRoles } from "@shared/roles";

const STORAGE_KEY = "active-role";

/**
 * 多角色切换：用户可能同时拥有主角色（role）和多个附加角色（extraRoles），
 * 此 hook 管理"当前身份"（activeRole），决定工作台/侧边栏菜单展示哪一套视图，
 * 选择结果持久化到 localStorage，随时可切换。
 *
 * 注意：这只影响导航/展示层面的"视图身份"，不是权限判断的唯一依据——
 * 后端权限校验始终基于用户的完整有效角色集合（effectiveRoles）。
 */
export function useActiveRole() {
  const { user } = useAuth();
  const effectiveRoles = getEffectiveRoles(user);

  const [activeRole, setActiveRoleState] = useState<string>(() => {
    if (typeof window === "undefined") return "user";
    return localStorage.getItem(STORAGE_KEY) || "user";
  });

  // 用户加载完成、或角色被管理员调整后，若当前激活身份已不在有效角色集合中，回退为主角色
  useEffect(() => {
    if (!user) return;
    if (effectiveRoles.length > 0 && !effectiveRoles.includes(activeRole)) {
      setActiveRoleState(user.role || effectiveRoles[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role, JSON.stringify(user?.extraRoles || [])]);

  const setActiveRole = useCallback((role: string) => {
    setActiveRoleState(role);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, role);
  }, []);

  return {
    activeRole: user ? activeRole : "user",
    setActiveRole,
    effectiveRoles,
    canSwitch: effectiveRoles.length > 1,
  };
}
