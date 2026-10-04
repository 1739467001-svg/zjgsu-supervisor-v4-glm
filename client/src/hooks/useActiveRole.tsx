import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getEffectiveRoles } from "@shared/roles";

type ActiveRoleState = {
  activeRole: string;
  setActiveRole: (role: string) => void;
  effectiveRoles: string[];
  canSwitch: boolean;
};

const ActiveRoleContext = createContext<ActiveRoleState | null>(null);

/**
 * 多角色切换：用户可能同时拥有主角色（role）和多个附加角色（extraRoles），
 * 此 Provider 管理"当前身份"（activeRole），决定工作台/侧边栏菜单展示哪一套视图。
 *
 * 身份选择按账号 + 浏览器标签页分别保存（sessionStorage，key 带用户 id）：
 * - 同一账号在同一标签页内刷新后保留选择；
 * - 换账号登录不继承上一个账号的身份；
 * - 新开标签页从主角色开始，多个标签页互不干扰，
 *   防止一个标签页悄悄改变另一个标签页的提交身份。
 *
 * 注意：这只影响导航/展示层面的"视图身份"，不是权限判断的唯一依据——
 * 后端权限校验始终基于用户的完整有效角色集合（effectiveRoles）。
 */
export function ActiveRoleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const effectiveRoles = getEffectiveRoles(user);

  const [activeRole, setActiveRoleState] = useState<string>("user");

  // 用户加载完成、切换账号、或角色被管理员调整后：
  // 只读本账号在本标签页保存的身份；没有保存值或已失效则回退主角色。
  useEffect(() => {
    if (!user) return;
    const saved = sessionStorage.getItem(`active-role:${user.id}`);
    const effective = getEffectiveRoles(user);
    if (saved && effective.includes(saved)) {
      setActiveRoleState(saved);
    } else {
      setActiveRoleState(user.role || effective[0] || "user");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role, JSON.stringify(user?.extraRoles || [])]);

  const setActiveRole = useCallback(
    (role: string) => {
      setActiveRoleState(role);
      if (user && typeof window !== "undefined") {
        sessionStorage.setItem(`active-role:${user.id}`, role);
      }
    },
    [user?.id]
  );

  return (
    <ActiveRoleContext.Provider
      value={{
        activeRole: user ? activeRole : "user",
        setActiveRole,
        effectiveRoles,
        canSwitch: effectiveRoles.length > 1,
      }}
    >
      {children}
    </ActiveRoleContext.Provider>
  );
}

export function useActiveRole(): ActiveRoleState {
  const ctx = useContext(ActiveRoleContext);
  if (!ctx) {
    throw new Error("useActiveRole 必须在 ActiveRoleProvider 内使用（Provider 挂在 ProtectedRoute 中）");
  }
  return ctx;
}
