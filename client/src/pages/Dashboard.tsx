import { useAuth } from "@/_core/hooks/useAuth";
import { useActiveRole } from "@/hooks/useActiveRole";
import { hasAnyRole } from "@shared/roles";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { BookOpen, ClipboardList, CheckCircle, Bell, TrendingUp, Users, Building2, Calendar } from "lucide-react";
import { useLocation } from "wouter";

const ROLE_LABELS: Record<string, string> = {
  supervisor_expert: "督导专家",
  supervisor_leader: "督导组长",
  college_secretary: "学院教学秘书",
  graduate_admin: "研究生院主管",
  admin: "系统管理员",
  user: "普通用户",
};

const ROLE_COLORS: Record<string, string> = {
  supervisor_expert: "oklch(0.35 0.13 245)",
  supervisor_leader: "oklch(0.52 0.16 200)",
  college_secretary: "oklch(0.42 0.14 160)",
  graduate_admin: "oklch(0.55 0.14 85)",
  admin: "oklch(0.55 0.14 85)",
};

export default function Dashboard() {
  const { user } = useAuth();
  const { activeRole } = useActiveRole();
  const [, navigate] = useLocation();
  // 工作台卡片展示按"当前身份"切换；数据请求按用户完整权限集合预取，避免切换身份时的加载闪烁
  const role = activeRole;
  const canSupervise = hasAnyRole(user, ["supervisor_expert", "supervisor_leader", "graduate_admin", "admin"]);
  const canViewAdminStats = hasAnyRole(user, ["graduate_admin", "admin"]);
  const isSecretary = hasAnyRole(user, ["college_secretary"]);

  const { data: notifications } = trpc.notifications.list.useQuery();
  const unreadCount = notifications?.filter((n) => !n.isRead).length || 0;

  const { data: plans } = trpc.plans.myPlans.useQuery(undefined, {
    enabled: canSupervise,
  });

  const { data: myEvals } = trpc.evaluations.myEvaluations.useQuery(undefined, {
    enabled: canSupervise,
  });

  const { data: adminStats } = trpc.stats.adminDashboard.useQuery(undefined, {
    enabled: canViewAdminStats,
  });

  const { data: collegeStats } = trpc.stats.collegeStats.useQuery({}, {
    enabled: isSecretary,
  });

  // 动态获取全校课程总数（督导专家/组长角色使用）
  const { data: courseCountData } = trpc.stats.courseCount.useQuery(undefined, {
    enabled: canSupervise,
  });
  const totalCourseCount = courseCountData?.total ?? "-";

  const pendingPlans = plans?.filter((p) => p.status === "pending").length || 0;
  const completedEvals = myEvals?.filter((e) => e.status === "submitted").length || 0;

  const getWelcomeMessage = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "早上好";
    if (hour < 18) return "下午好";
    return "晚上好";
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 page-transition">
        {/* 欢迎横幅 */}
        <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg, oklch(0.35 0.13 245) 0%, oklch(0.45 0.15 220) 100%)" }}>
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10" style={{ background: "white", transform: "translate(30%, -30%)" }} />
          <div className="absolute bottom-0 left-1/3 w-32 h-32 rounded-full opacity-8" style={{ background: "white", transform: "translateY(50%)" }} />
          <div className="relative z-10">
            <p className="text-sm opacity-80 mb-1">{getWelcomeMessage()}，</p>
            <h1 className="text-2xl font-bold mb-1">{user?.name || "老师"}</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: "oklch(1 0 0 / 0.2)", backdropFilter: "blur(4px)" }}>
                {ROLE_LABELS[role] || role}
              </span>
              {user?.college && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: "oklch(1 0 0 / 0.15)", backdropFilter: "blur(4px)" }}>
                  {user.college}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 督导专家/组长统计卡片 */}
        {["supervisor_expert", "supervisor_leader", "admin"].includes(role) && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "待听课计划",
                value: pendingPlans,
                icon: <Calendar className="w-5 h-5" />,
                color: "oklch(0.35 0.13 245)",
                bg: "oklch(0.93 0.018 240)",
                action: () => navigate("/plans"),
              },
              {
                label: "已完成评价",
                value: completedEvals,
                icon: <CheckCircle className="w-5 h-5" />,
                color: "oklch(0.42 0.14 160)",
                bg: "oklch(0.93 0.018 160)",
                action: () => navigate("/evaluations"),
              },
              {
                label: "未读通知",
                value: unreadCount,
                icon: <Bell className="w-5 h-5" />,
                color: "oklch(0.55 0.14 85)",
                bg: "oklch(0.95 0.02 85)",
                action: () => {},
              },
              {
                label: "全校课程",
                value: totalCourseCount,
                icon: <BookOpen className="w-5 h-5" />,
                color: "oklch(0.52 0.16 200)",
                bg: "oklch(0.93 0.018 200)",
                action: () => navigate("/courses"),
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-white rounded-xl p-5 cursor-pointer transition-all duration-200 hover:-translate-y-1"
                style={{ border: "1px solid oklch(0.90 0.01 240)", boxShadow: "0 2px 8px oklch(0.35 0.13 245 / 0.06)" }}
                onClick={stat.action}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: stat.bg, color: stat.color }}>
                    {stat.icon}
                  </div>
                </div>
                <div className="text-2xl font-bold mb-1" style={{ color: "oklch(0.18 0.025 240)" }}>{stat.value}</div>
                <div className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* 研究生院主管统计 */}
        {["graduate_admin", "admin"].includes(role) && adminStats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "全校课程总数", value: adminStats.totalCourses, icon: <BookOpen className="w-5 h-5" />, color: "oklch(0.35 0.13 245)", bg: "oklch(0.93 0.018 240)" },
              { label: "已完成督导评价", value: adminStats.totalEvaluations, icon: <CheckCircle className="w-5 h-5" />, color: "oklch(0.42 0.14 160)", bg: "oklch(0.93 0.018 160)" },
              { label: "督导专家人数", value: adminStats.totalSupervisors, icon: <Users className="w-5 h-5" />, color: "oklch(0.52 0.16 200)", bg: "oklch(0.93 0.018 200)" },
              { label: "覆盖学院数", value: adminStats.evalByCollege.length, icon: <Building2 className="w-5 h-5" />, color: "oklch(0.55 0.14 85)", bg: "oklch(0.95 0.02 85)" },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-xl p-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: stat.bg, color: stat.color }}>
                    {stat.icon}
                  </div>
                </div>
                <div className="text-2xl font-bold mb-1" style={{ color: "oklch(0.18 0.025 240)" }}>{stat.value}</div>
                <div className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* 学院教学秘书统计 */}
        {role === "college_secretary" && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { label: "本学院已督导课程", value: collegeStats?.submitted || 0, icon: <CheckCircle className="w-5 h-5" />, color: "oklch(0.42 0.14 160)", bg: "oklch(0.93 0.018 160)" },
              { label: "未读通知", value: unreadCount, icon: <Bell className="w-5 h-5" />, color: "oklch(0.55 0.14 85)", bg: "oklch(0.95 0.02 85)" },
              { label: "所属学院", value: user?.college || "-", icon: <Building2 className="w-5 h-5" />, color: "oklch(0.35 0.13 245)", bg: "oklch(0.93 0.018 240)" },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-xl p-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: stat.bg, color: stat.color }}>
                    {stat.icon}
                  </div>
                </div>
                <div className="text-xl font-bold mb-1 truncate" style={{ color: "oklch(0.18 0.025 240)" }}>{stat.value}</div>
                <div className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* 快速操作 */}
        <div className="bg-white rounded-xl p-6" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <h2 className="text-base font-semibold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>快速操作</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {(["supervisor_expert", "supervisor_leader", "admin"].includes(role)) && [
              { label: "浏览课程", icon: <BookOpen className="w-5 h-5" />, path: "/courses", color: "oklch(0.35 0.13 245)" },
              { label: "听课计划", icon: <Calendar className="w-5 h-5" />, path: "/plans", color: "oklch(0.52 0.16 200)" },
              { label: "我的评价", icon: <ClipboardList className="w-5 h-5" />, path: "/evaluations", color: "oklch(0.42 0.14 160)" },
              { label: "查看通知", icon: <Bell className="w-5 h-5" />, path: "/", color: "oklch(0.55 0.14 85)" },
            ].map((item) => (
              <button
                key={item.label}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all duration-200 hover:-translate-y-1 cursor-pointer"
                style={{ background: "oklch(0.97 0.004 240)", border: "1px solid oklch(0.90 0.01 240)" }}
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white" style={{ background: item.color }}>
                  {item.icon}
                </div>
                <span className="text-xs font-medium" style={{ color: "oklch(0.30 0.04 240)" }}>{item.label}</span>
              </button>
            ))}
            {["graduate_admin", "admin"].includes(role) && [
              { label: "数据统计", icon: <TrendingUp className="w-5 h-5" />, path: "/admin", color: "oklch(0.35 0.13 245)" },
              { label: "全部评价", icon: <ClipboardList className="w-5 h-5" />, path: "/evaluations", color: "oklch(0.52 0.16 200)" },
              { label: "用户管理", icon: <Users className="w-5 h-5" />, path: "/users", color: "oklch(0.42 0.14 160)" },
              { label: "课程浏览", icon: <BookOpen className="w-5 h-5" />, path: "/courses", color: "oklch(0.55 0.14 85)" },
            ].map((item) => (
              <button
                key={item.label}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all duration-200 hover:-translate-y-1 cursor-pointer"
                style={{ background: "oklch(0.97 0.004 240)", border: "1px solid oklch(0.90 0.01 240)" }}
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white" style={{ background: item.color }}>
                  {item.icon}
                </div>
                <span className="text-xs font-medium" style={{ color: "oklch(0.30 0.04 240)" }}>{item.label}</span>
              </button>
            ))}
            {role === "college_secretary" && [
              { label: "学院课程", icon: <BookOpen className="w-5 h-5" />, path: "/college", color: "oklch(0.35 0.13 245)" },
              { label: "督导评价", icon: <ClipboardList className="w-5 h-5" />, path: "/evaluations", color: "oklch(0.52 0.16 200)" },
            ].map((item) => (
              <button
                key={item.label}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all duration-200 hover:-translate-y-1 cursor-pointer"
                style={{ background: "oklch(0.97 0.004 240)", border: "1px solid oklch(0.90 0.01 240)" }}
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white" style={{ background: item.color }}>
                  {item.icon}
                </div>
                <span className="text-xs font-medium" style={{ color: "oklch(0.30 0.04 240)" }}>{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 最近通知 */}
        {notifications && notifications.length > 0 && (
          <div className="bg-white rounded-xl p-6" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <h2 className="text-base font-semibold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>最近通知</h2>
            <div className="space-y-3">
              {notifications.slice(0, 5).map((n) => (
                <div key={n.id} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: n.isRead ? "transparent" : "oklch(0.96 0.008 240)", border: "1px solid oklch(0.92 0.008 240)" }}>
                  <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: n.isRead ? "oklch(0.75 0.02 240)" : "oklch(0.35 0.13 245)" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "oklch(0.20 0.025 240)" }}>{n.title}</p>
                    <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "oklch(0.52 0.025 240)" }}>{n.content}</p>
                    <p className="text-xs mt-1" style={{ color: "oklch(0.65 0.02 240)" }}>
                      {new Date(n.createdAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
