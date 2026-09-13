import { useAuth } from "@/_core/hooks/useAuth";
import { useActiveRole } from "@/hooks/useActiveRole";
import { ROLE_LABELS, getSupervisorScopeLabel, isSupervisorRole } from "@shared/roles";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  BookOpen,
  ClipboardList,
  ClipboardCheck,
  Users,
  Building2,
  Bell,
  LogOut,
  PanelLeft,
  GraduationCap,
  ChevronRight,
  BarChart2,
  UploadCloud,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

// 根据角色返回导航菜单
function getMenuItems(role: string) {
  const base = [
    { icon: LayoutDashboard, label: "工作台", path: "/", key: "home" },
    { icon: BookOpen, label: "全校课程", path: "/courses", key: "courses" },
  ];

  if (["supervisor_expert", "supervisor_leader", "admin"].includes(role)) {
    base.push({ icon: ClipboardList, label: "听课计划", path: "/plans", key: "plans" });
    base.push({ icon: ClipboardCheck, label: "评价记录", path: "/evaluations", key: "evaluations-expert" });
  } else if (role === "college_secretary") {
    base.push({ icon: ClipboardCheck, label: "督导评价", path: "/evaluations", key: "evaluations-secretary" });
    base.push({ icon: BarChart2, label: "评价进度", path: "/course-progress", key: "course-progress-secretary" });
  } else if (["graduate_admin", "admin"].includes(role)) {
    base.push({ icon: ClipboardCheck, label: "全部评价", path: "/evaluations", key: "evaluations-admin" });
    base.push({ icon: BarChart2, label: "评价进度", path: "/course-progress", key: "course-progress-admin" });
    base.push({ icon: Building2, label: "统计仪表盘", path: "/admin", key: "admin" });
    base.push({ icon: Users, label: "用户管理", path: "/users", key: "users" });
    base.push({ icon: UploadCloud, label: "上传课程数据", path: "/upload-courses", key: "upload-courses" });
  }

  return base;
}

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 200;
const MAX_WIDTH = 360;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    window.location.href = "/login";
    return null;
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({ children, setSidebarWidth }: { children: React.ReactNode; setSidebarWidth: (w: number) => void }) {
  const { user, logout } = useAuth();
  const { activeRole, setActiveRole, effectiveRoles, canSwitch } = useActiveRole();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // 修改密码弹窗状态
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const changePasswordMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("密码修改成功！下次登录请使用新密码");
      setShowChangePwd(false);
      setOldPwd(""); setNewPwd(""); setConfirmPwd("");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleChangePwd = () => {
    if (!oldPwd || !newPwd || !confirmPwd) {
      toast.error("请填写所有密码字段"); return;
    }
    if (newPwd.length < 6) {
      toast.error("新密码至少6位"); return;
    }
    if (newPwd !== confirmPwd) {
      toast.error("两次输入的新密码不一致"); return;
    }
    changePasswordMutation.mutate({ oldPassword: oldPwd, newPassword: newPwd });
  };

  const role = activeRole;
  const menuItems = getMenuItems(role);

  // 督导角色才带校级/院级后缀；其余角色直接用角色名，避免把同一身份写两遍
  const scopeLabel = getSupervisorScopeLabel(user as any);
  const roleDisplay = (r: string) => {
    const label = ROLE_LABELS[r] || r;
    return isSupervisorRole(r) && scopeLabel ? `${label}（${scopeLabel}）` : label;
  };

  const { data: unreadCount = 0 } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const activeItem = menuItems.find((item) => {
    if (item.path === "/") return location === "/";
    return location.startsWith(item.path);
  });

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}
          style={{ background: "oklch(0.12 0.025 245)", borderRight: "1px solid oklch(0.20 0.03 245)" }}>
          {/* Logo */}
          <SidebarHeader className="h-16 justify-center px-3" style={{ borderBottom: "1px solid oklch(0.20 0.03 245)" }}>
            <div className="flex items-center gap-2.5">
              <button onClick={toggleSidebar} className="h-8 w-8 flex items-center justify-center rounded-lg transition-colors shrink-0 focus:outline-none" style={{ background: "oklch(0.20 0.04 245)" }}>
                <PanelLeft className="h-4 w-4" style={{ color: "oklch(0.70 0.04 245)" }} />
              </button>
              {!isCollapsed && (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: "oklch(0.45 0.15 245)" }}>
                    <GraduationCap className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate leading-none" style={{ color: "oklch(0.92 0.02 245)" }}>研究生院督导</p>
                    <p className="text-xs truncate mt-0.5" style={{ color: "oklch(0.55 0.03 245)" }}>浙江工商大学</p>
                  </div>
                </div>
              )}
            </div>
          </SidebarHeader>

          {/* 导航菜单 */}
          <SidebarContent className="gap-0 py-3">
            <SidebarMenu className="px-2 gap-0.5">
              {menuItems.map((item) => {
                const isActive = item.path === "/" ? location === "/" : location.startsWith(item.path);
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className="h-9 transition-all font-normal rounded-lg"
                      style={{
                        background: isActive ? "oklch(0.35 0.13 245)" : "transparent",
                        color: isActive ? "white" : "oklch(0.65 0.03 245)",
                      }}
                    >
                      <item.icon className="h-4 w-4 flex-shrink-0" />
                      <span className="text-sm">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          {/* 用户信息 */}
          <SidebarFooter className="p-3" style={{ borderTop: "1px solid oklch(0.20 0.03 245)" }}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors w-full text-left focus:outline-none" style={{ background: "oklch(0.18 0.03 245)" }}>
                  <Avatar className="h-8 w-8 shrink-0" style={{ border: "2px solid oklch(0.35 0.13 245)" }}>
                    <AvatarFallback className="text-xs font-bold" style={{ background: "oklch(0.35 0.13 245)", color: "white" }}>
                      {user?.name?.charAt(0) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  {!isCollapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate leading-none" style={{ color: "oklch(0.90 0.02 245)" }}>{user?.name || "-"}</p>
                      <p className="text-xs truncate mt-1" style={{ color: "oklch(0.55 0.03 245)" }}>
                        {roleDisplay(role)}
                        {canSwitch && <span className="ml-1">· 可切换</span>}
                      </p>
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              {/* 姓名与当前身份已显示在左下角的触发按钮上，菜单里不再重复一遍 */}
              <DropdownMenuContent side="top" align="start" className="w-56">
                {canSwitch && (
                  <>
                    <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">切换身份</div>
                    {effectiveRoles.map((r) => (
                      <DropdownMenuItem
                        key={r}
                        onClick={() => setActiveRole(r)}
                        className="cursor-pointer justify-between"
                      >
                        <span>{roleDisplay(r)}</span>
                        {activeRole === r && <span className="text-xs" style={{ color: "oklch(0.35 0.13 245)" }}>当前</span>}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => setLocation("/notifications")} className="cursor-pointer">
                  <Bell className="mr-2 h-4 w-4" />
                  <span>通知消息</span>
                  {(unreadCount || 0) > 0 && (
                    <Badge variant="destructive" className="ml-auto text-xs h-4 px-1">{unreadCount}</Badge>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowChangePwd(true)} className="cursor-pointer">
                  <KeyRound className="mr-2 h-4 w-4" />
                  <span>修改密码</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>退出登录</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        {/* 拖拽调整宽度 */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50, background: isResizing ? "oklch(0.35 0.13 245)" : "transparent" }}
        />
      </div>

      {/* 修改密码 Dialog */}
      <Dialog open={showChangePwd} onOpenChange={(open) => {
        setShowChangePwd(open);
        if (!open) { setOldPwd(""); setNewPwd(""); setConfirmPwd(""); }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5" style={{ color: "oklch(0.35 0.13 245)" }} />
              修改密码
            </DialogTitle>
            <DialogDescription>
              请输入原密码和新密码。首次登录的用户默认密码为工号。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="old-pwd">原密码</Label>
              <div className="relative">
                <Input
                  id="old-pwd"
                  type={showOld ? "text" : "password"}
                  placeholder="请输入原密码"
                  value={oldPwd}
                  onChange={(e) => setOldPwd(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowOld(!showOld)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-pwd">新密码</Label>
              <div className="relative">
                <Input
                  id="new-pwd"
                  type={showNew ? "text" : "password"}
                  placeholder="新密码（至少6位）"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pwd">确认新密码</Label>
              <div className="relative">
                <Input
                  id="confirm-pwd"
                  type={showConfirm ? "text" : "password"}
                  placeholder="再次输入新密码"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  className="pr-10"
                  onKeyDown={(e) => e.key === "Enter" && handleChangePwd()}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {newPwd && confirmPwd && newPwd !== confirmPwd && (
              <p className="text-xs text-destructive">两次输入的新密码不一致</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowChangePwd(false)}>取消</Button>
            <Button
              onClick={handleChangePwd}
              disabled={changePasswordMutation.isPending}
              style={{ background: "oklch(0.35 0.13 245)" }}
            >
              {changePasswordMutation.isPending ? "修改中..." : "确认修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SidebarInset style={{ background: "oklch(0.97 0.004 240)" }}>
        {/* 移动端顶栏 */}
        {isMobile && (
          <div className="flex h-14 items-center justify-between px-4 sticky top-0 z-40 bg-white" style={{ borderBottom: "1px solid oklch(0.90 0.01 240)" }}>
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg" />
              <span className="font-medium text-sm" style={{ color: "oklch(0.18 0.025 240)" }}>
                {activeItem?.label || "督导系统"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {(unreadCount || 0) > 0 && (
                <button onClick={() => setLocation("/notifications")} className="relative p-2">
                  <Bell className="w-5 h-5" style={{ color: "oklch(0.35 0.13 245)" }} />
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* 桌面端顶栏面包屑 */}
        {!isMobile && (
          <div className="flex h-12 items-center justify-between px-6 bg-white" style={{ borderBottom: "1px solid oklch(0.90 0.01 240)" }}>
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>
              <span>浙江工商大学研究生院</span>
              <ChevronRight className="w-3 h-3" />
              <span className="font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>{activeItem?.label || "督导系统"}</span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setLocation("/notifications")} className="relative p-1.5 rounded-lg transition-colors hover:bg-muted">
                <Bell className="w-4 h-4" style={{ color: "oklch(0.52 0.025 240)" }} />
                {(unreadCount || 0) > 0 && (
                  <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500" />
                )}
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-auto">{children}</main>
      </SidebarInset>
    </>
  );
}
