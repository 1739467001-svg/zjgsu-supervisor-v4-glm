import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { hasAnyRole } from "@shared/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Search, Users, Shield, GraduationCap, Building2, User, Settings2 } from "lucide-react";
import { ASSIGNABLE_ROLES, getSupervisorScopeLabel, normalizeExtraRoles, type SupervisorScope } from "@shared/roles";

const ROLE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  supervisor_expert: { label: "督导专家", icon: <GraduationCap className="w-3.5 h-3.5" />, color: "oklch(0.35 0.13 245)", bg: "oklch(0.93 0.018 240)" },
  supervisor_leader: { label: "督导组长", icon: <Shield className="w-3.5 h-3.5" />, color: "oklch(0.42 0.14 160)", bg: "oklch(0.93 0.018 160)" },
  college_secretary: { label: "学院教学秘书", icon: <Building2 className="w-3.5 h-3.5" />, color: "oklch(0.55 0.14 85)", bg: "oklch(0.95 0.02 85)" },
  graduate_admin: { label: "研究生院主管", icon: <Users className="w-3.5 h-3.5" />, color: "oklch(0.55 0.14 300)", bg: "oklch(0.95 0.02 300)" },
  admin: { label: "系统管理员", icon: <Shield className="w-3.5 h-3.5" />, color: "oklch(0.55 0.14 30)", bg: "oklch(0.95 0.02 30)" },
  user: { label: "普通用户", icon: <User className="w-3.5 h-3.5" />, color: "oklch(0.52 0.025 240)", bg: "oklch(0.93 0.01 240)" },
};

const SUPERVISOR_ROLES = ["supervisor_expert", "supervisor_leader"];

/** 前端脱敏（会议纪要安全底线：页面上不得出现完整手机号）：保留前 3 后 4，中间打码 */
function maskPhone(phone?: string | null): string {
  const p = (phone || "").trim();
  if (!p) return "-";
  if (p.length >= 7) return p.slice(0, 3) + "****" + p.slice(-4);
  return p.slice(0, 1) + "****";
}

export default function UserManagement() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    userId?: number;
    name?: string;
    extraRoles: string[];
    college: string;
    supervisorScope: SupervisorScope;
  }>({
    open: false,
    extraRoles: [],
    college: "",
    supervisorScope: "school",
  });
  const utils = trpc.useUtils();

  const { data: users, isLoading } = trpc.users.list.useQuery();
  const { data: auditLogs } = trpc.users.getAuditLog.useQuery();
  const { user: authUser } = useAuth();
  // 有限视图：学院教学秘书（无主管/系统管理员角色）只能查看本院账号并重置密码，
  // 不能改角色/学院/督导范围（那是研究生院主管的职权）
  const limitedView = !hasAnyRole(authUser as any, ["graduate_admin", "admin"]) && hasAnyRole(authUser as any, ["college_secretary"]);

  const [resetDialog, setResetDialog] = useState<{ open: boolean; userId?: number; name?: string; pwd: string }>({ open: false, pwd: "" });
  const resetPwdMutation = trpc.users.resetPassword.useMutation({
    onSuccess: () => {
      toast.success("密码已重置");
      utils.users.getAuditLog.invalidate();
      setResetDialog({ open: false, pwd: "" });
    },
    onError: (err) => toast.error(err.message),
  });

  const updateRoleMutation = trpc.users.updateRole.useMutation({
    onSuccess: () => {
      toast.success("角色已更新");
      utils.users.list.invalidate();
      utils.users.getAuditLog.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateExtraRolesMutation = trpc.users.updateExtraRoles.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const updateCollegeMutation = trpc.users.updateCollege.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const updateScopeMutation = trpc.users.updateSupervisorScope.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const openEditDialog = (u: NonNullable<typeof users>[number]) => {
    setEditDialog({
      open: true,
      userId: u.id,
      name: u.name || "",
      extraRoles: normalizeExtraRoles((u as any).extraRoles),
      college: u.college || "",
      supervisorScope: (u as any).supervisorScope === "college" ? "college" : "school",
    });
  };

  const toggleExtraRole = (role: string, checked: boolean) => {
    setEditDialog((prev) => ({
      ...prev,
      extraRoles: checked ? Array.from(new Set([...prev.extraRoles, role])) : prev.extraRoles.filter((r) => r !== role),
    }));
  };

  const handleSaveEdit = async () => {
    if (!editDialog.userId) return;
    const college = editDialog.college.trim() || null;
    // 与服务端 shared/userAdmin.ts 同一条规则：受限岗位（院级督导/学院秘书）必须有学院，
    // 不再静默降级为校级——那会让管理员以为设了院级、实际却是全校范围
    const scope: SupervisorScope = editDialog.supervisorScope === "college" && college ? "college" : "school";
    if (editDialog.supervisorScope === "college" && !college) {
      toast.error("院级督导必须填写所属学院，请补全学院或把范围改为校级");
      return;
    }
    try {
      await Promise.all([
        updateExtraRolesMutation.mutateAsync({ userId: editDialog.userId, extraRoles: editDialog.extraRoles as any }),
        updateCollegeMutation.mutateAsync({ userId: editDialog.userId, college }),
        updateScopeMutation.mutateAsync({ userId: editDialog.userId, scope }),
      ]);
      toast.success("已保存");
      utils.users.list.invalidate();
      utils.users.getAuditLog.invalidate();
      setEditDialog({ open: false, extraRoles: [], college: "", supervisorScope: "school" });
    } catch (err: any) {
      toast.error(err.message || "保存失败");
    }
  };

  const filtered = users?.filter((u) => {
    const matchSearch = !search || u.name?.includes(search) || u.employeeId?.includes(search) || u.college?.includes(search);
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  }) || [];

  const roleCounts = users?.reduce((acc, u) => {
    acc[u.role || "user"] = (acc[u.role || "user"] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5 page-transition">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "oklch(0.18 0.025 240)" }}>{limitedView ? "账号管理（本院）" : "用户管理"}</h1>
          <p className="text-sm mt-0.5" style={{ color: "oklch(0.52 0.025 240)" }}>
            {limitedView
              ? "查看本院账号并重置密码；角色与督导范围由研究生院主管统一管理"
              : "管理系统用户角色与权限"}
          </p>
        </div>

        {/* 角色统计 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(ROLE_CONFIG).filter(([k]) => k !== "user" && k !== "admin").map(([role, config]) => (
            <div key={role} className="bg-white rounded-xl p-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: config.bg, color: config.color }}>
                  {config.icon}
                </div>
              </div>
              <div className="text-xl font-bold" style={{ color: "oklch(0.18 0.025 240)" }}>{roleCounts[role] || 0}</div>
              <div className="text-xs mt-0.5" style={{ color: "oklch(0.52 0.025 240)" }}>{config.label}</div>
            </div>
          ))}
        </div>

        {/* 筛选 */}
        <div className="bg-white rounded-xl p-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="搜索姓名/工号/学院" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-xs" />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="角色筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部角色</SelectItem>
                {Object.entries(ROLE_CONFIG).map(([role, config]) => (
                  <SelectItem key={role} value={role}>{config.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 用户列表 */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "oklch(0.97 0.004 240)", borderBottom: "1px solid oklch(0.90 0.01 240)" }}>
                    {["姓名", "工号", "学院/督导范围", "联系方式", "角色", "附加角色", "操作"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: "oklch(0.52 0.025 240)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => {
                    const roleConf = ROLE_CONFIG[user.role || "user"] || ROLE_CONFIG.user;
                    const isSupervisor = SUPERVISOR_ROLES.includes(user.role || "");
                    const extraRoles = normalizeExtraRoles((user as any).extraRoles);
                    // 范围来自 supervisorScope 字段本身，不再由"有没有填学院"推断
                    const scopeLabel = getSupervisorScopeLabel(user as any);
                    return (
                      <tr key={user.id} className="hover:bg-muted/30 transition-colors" style={{ borderBottom: "1px solid oklch(0.93 0.006 240)" }}>
                        <td className="px-4 py-3 font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>{user.name}</td>
                        <td className="px-4 py-3 text-xs font-mono" style={{ color: "oklch(0.52 0.025 240)" }}>{user.employeeId}</td>
                        <td className="px-4 py-3 text-xs max-w-[160px]" style={{ color: "oklch(0.52 0.025 240)" }}>
                          <span className="truncate block">{user.college || (isSupervisor ? "（未设置）" : "-")}</span>
                          {scopeLabel && (
                            <span
                              className="inline-block mt-0.5 px-1.5 py-0.5 rounded-full text-xs"
                              style={{
                                background: scopeLabel === "院级" ? "oklch(0.93 0.018 160)" : "oklch(0.93 0.018 240)",
                                color: scopeLabel === "院级" ? "oklch(0.42 0.14 160)" : "oklch(0.35 0.13 245)",
                              }}
                            >
                              {scopeLabel}督导
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>{maskPhone(user.phone)}</td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: roleConf.bg, color: roleConf.color }}>
                            {roleConf.icon}{roleConf.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1 max-w-[160px]">
                            {extraRoles.length > 0 ? (
                              extraRoles.map((r) => (
                                <Badge key={r} variant="outline" className="text-xs h-5 px-1.5">{ROLE_CONFIG[r]?.label || r}</Badge>
                              ))
                            ) : (
                              <span className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {limitedView ? (
                              <>
                                <span className="flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: roleConf.bg, color: roleConf.color }}>
                                  {roleConf.icon}{roleConf.label}
                                </span>
                                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" title="重置该账号密码" onClick={() => setResetDialog({ open: true, userId: user.id, name: user.name || "", pwd: "" })}>
                                  重置密码
                                </Button>
                              </>
                            ) : (
                              <>
                                <Select
                                  value={user.role || "user"}
                                  onValueChange={(newRole) => updateRoleMutation.mutate({ userId: user.id, role: newRole as any })}
                                >
                                  <SelectTrigger className="h-7 w-28 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(ROLE_CONFIG).map(([role, config]) => (
                                      <SelectItem key={role} value={role} className="text-xs">{config.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button variant="outline" size="sm" className="h-7 w-7 p-0" title="设置附加角色 / 督导范围" onClick={() => openEditDialog(user)}>
                                  <Settings2 className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" title="重置该账号密码" onClick={() => setResetDialog({ open: true, userId: user.id, name: user.name || "", pwd: "" })}>
                                  重置密码
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 text-xs" style={{ color: "oklch(0.52 0.025 240)", borderTop: "1px solid oklch(0.90 0.01 240)" }}>
              共 {filtered.length} 位用户
            </div>
          </div>
        )}
        {/* 授权变更记录（谁在何时把谁的什么权限改成了什么） */}
        <div className="bg-white rounded-xl p-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4" style={{ color: "oklch(0.35 0.13 245)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "oklch(0.18 0.025 240)" }}>最近授权变更</h2>
            <span className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>角色、学院、督导范围、密码重置的每次操作都会留痕，最多保留 50 条</span>
          </div>
          {!auditLogs || auditLogs.length === 0 ? (
            <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>暂无变更记录。</p>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {auditLogs.map((log) => (
                <li key={log.id} className="text-xs flex flex-wrap items-baseline gap-x-2" style={{ color: "oklch(0.35 0.02 240)" }}>
                  <span style={{ color: "oklch(0.52 0.025 240)" }}>
                    {new Date(log.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="font-medium">{log.adminName || "管理员"}</span>
                  <span style={{ color: "oklch(0.52 0.025 240)" }}>调整了</span>
                  <span className="font-medium">{log.targetName || `用户#${log.targetUserId}`}</span>
                  <span>{log.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 附加角色 / 督导范围 设置弹窗 */}
      <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog((p) => ({ ...p, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>设置附加角色与督导范围</DialogTitle>
            <DialogDescription>
              {editDialog.name} · 多角色切换允许该用户在多个身份间随时切换；督导范围决定其可查看与评价的课程范围，校级为全校、院级仅限所属学院。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm">附加角色（在主角色之外，可同时拥有）</Label>
              <div className="grid grid-cols-2 gap-2">
                {ASSIGNABLE_ROLES.filter((r) => r !== "user").map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={editDialog.extraRoles.includes(r)}
                      onCheckedChange={(checked) => toggleExtraRole(r, checked === true)}
                    />
                    {ROLE_CONFIG[r]?.label || r}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">督导范围</Label>
              <Select
                value={editDialog.supervisorScope}
                onValueChange={(v) => setEditDialog((p) => ({ ...p, supervisorScope: v as SupervisorScope }))}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="school">校级督导 —— 可查看并评价全校课程</SelectItem>
                  <SelectItem value="college">院级督导 —— 仅限所属学院课程</SelectItem>
                </SelectContent>
              </Select>
              {editDialog.supervisorScope === "college" && !editDialog.college.trim() && (
                <p className="text-xs" style={{ color: "oklch(0.55 0.14 30)" }}>
                  院级督导必须填写所属学院，未填写时无法保存；请补全学院或把范围改为校级。
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="college-scope" className="text-sm">所属学院（院级督导范围 / 学院秘书管辖学院）</Label>
              <Input
                id="college-scope"
                placeholder="如：经济学院；多个学院用顿号分隔"
                value={editDialog.college}
                onChange={(e) => setEditDialog((p) => ({ ...p, college: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditDialog({ open: false, extraRoles: [], college: "", supervisorScope: "school" })}>取消</Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateExtraRolesMutation.isPending || updateCollegeMutation.isPending || updateScopeMutation.isPending}
              style={{ background: "oklch(0.35 0.13 245)" }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置密码弹窗（主管=任意账号；教学秘书=本院账号） */}
      <Dialog open={resetDialog.open} onOpenChange={(open) => setResetDialog((p) => ({ ...p, open }))}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
            <DialogDescription>
              为 {resetDialog.name || "该用户"} 设置新密码（至少 6 位）。设置后请告知本人用新密码登录；操作将记入授权变更留痕。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="new-password" className="text-sm">新密码</Label>
            <Input
              id="new-password"
              type="text"
              placeholder="至少 6 位"
              value={resetDialog.pwd}
              onChange={(e) => setResetDialog((p) => ({ ...p, pwd: e.target.value }))}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResetDialog({ open: false, pwd: "" })}>取消</Button>
            <Button
              disabled={resetDialog.pwd.length < 6 || resetPwdMutation.isPending}
              onClick={() => {
                if (!resetDialog.userId) return;
                resetPwdMutation.mutate({ userId: resetDialog.userId, newPassword: resetDialog.pwd });
              }}
              style={{ background: "oklch(0.35 0.13 245)" }}
            >
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
