import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { GraduationCap, Eye, EyeOff, Shield, Lock, User, BookOpenCheck, ClipboardCheck, BarChart3, UsersRound } from "lucide-react";

export default function Login() {
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // 登录页展示当前学期的真实规模（此前为写死的 1431/22/588 装饰数据）
  const { data: summary } = trpc.stats.loginPageSummary.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const summaryItems = [
    { value: summary ? String(summary.courses) : "—", label: "课程总数" },
    { value: summary ? String(summary.colleges) : "—", label: "覆盖学院" },
    { value: summary ? String(summary.teachers) : "—", label: "授课教师" },
  ];

  const loginMutation = trpc.auth.loginByEmployeeId.useMutation({
    onSuccess: (data) => {
      toast.success(`欢迎回来，${data.user?.name || data.user?.employeeId || ""}！`);
      window.location.href = "/";
    },
    onError: (err) => {
      toast.error(err.message || "登录失败，请检查工号和密码");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId.trim()) {
      toast.error("请输入工号");
      return;
    }
    if (!password.trim()) {
      toast.error("请输入密码");
      return;
    }
    loginMutation.mutate({ employeeId: employeeId.trim(), password: password.trim() });
  };

  return (
    <div
      className="min-h-screen flex"
      style={{
        background:
          "linear-gradient(135deg, oklch(0.20 0.045 245) 0%, oklch(0.30 0.08 240) 50%, oklch(0.22 0.05 250) 100%)",
      }}
    >
      {/* 左侧装饰区 —— 学术编辑式排版：编号索引 + 金色细线 + 校训 */}
      <div className="hidden lg:flex lg:w-1/2 flex-col relative overflow-hidden">
        {/* 背景：淡学术网格 + 水印大字 */}
        <div
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(oklch(0.80 0.02 240 / 0.4) 1px, transparent 1px), linear-gradient(90deg, oklch(0.80 0.02 240 / 0.4) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        <div
          className="absolute -bottom-8 -right-4 select-none pointer-events-none font-bold"
          style={{ fontSize: "200px", lineHeight: 1, color: "oklch(0.88 0.015 240 / 0.045)", letterSpacing: "0.05em" }}
        >
          督学
        </div>

        <div className="relative z-10 flex-1 flex flex-col justify-between max-w-lg mx-auto w-full py-10 pl-14 pr-6">
          {/* 顶部：校徽 + 校名 */}
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: "oklch(0.26 0.055 245)",
                border: "1px solid oklch(0.72 0.14 85 / 0.5)",
                boxShadow: "0 0 28px oklch(0.35 0.13 245 / 0.4)",
              }}
            >
              <GraduationCap className="w-7 h-7" style={{ color: "oklch(0.72 0.14 85)" }} />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-[0.08em]" style={{ color: "oklch(0.93 0.008 240)" }}>
                浙江工商大学
              </p>
              <p className="text-xs mt-0.5 tracking-[0.28em]" style={{ color: "oklch(0.60 0.02 240)" }}>
                研究生院 · 督导管理系统
              </p>
            </div>
          </div>

          {/* 中部：金色短线 + 主标题 + 特性索引 */}
          <div className="my-10">
            <div className="w-12 h-[3px] mb-7" style={{ background: "oklch(0.72 0.14 85)" }} />
            <h1
              className="font-bold leading-[1.25]"
              style={{ color: "oklch(0.95 0.008 240)", fontSize: "40px", letterSpacing: "0.02em" }}
            >
              研究生教学督导
              <br />
              评价管理平台
            </h1>
            <p className="text-[15px] mt-5 leading-relaxed max-w-md" style={{ color: "oklch(0.68 0.02 240)" }}>
              面向全校研究生课程的质量督导体系，覆盖听课计划、课堂评价与统计分析全流程。
            </p>

            <div className="mt-9">
              {[
                { icon: BookOpenCheck, title: "课程督导", desc: "全校与 MBA 课表双入口，按学期归档留存" },
                { icon: ClipboardCheck, title: "听课评价", desc: "二十项定量指标与亮点建议，草稿可续填" },
                { icon: BarChart3, title: "统计分析", desc: "学院口径三图与明细，历史数据随时可溯" },
                { icon: UsersRound, title: "多角色协作", desc: "双身份一键切换，权限边界清晰分明" },
              ].map((f, i) => (
                <div
                  key={f.title}
                  className="flex items-start gap-4 py-3"
                  style={{ borderTop: i === 0 ? "1px solid oklch(0.34 0.05 245)" : undefined, borderBottom: i === 3 ? "1px solid oklch(0.34 0.05 245)" : undefined }}
                >
                  <span className="text-xs font-semibold mt-1 w-7 flex-shrink-0" style={{ color: "oklch(0.72 0.14 85)" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold tracking-wide" style={{ color: "oklch(0.88 0.012 240)" }}>
                      {f.title}
                    </p>
                    <p className="text-xs mt-1" style={{ color: "oklch(0.58 0.02 240)" }}>
                      {f.desc}
                    </p>
                  </div>
                  <f.icon className="w-4 h-4 mt-1.5 flex-shrink-0" style={{ color: "oklch(0.66 0.09 205)" }} />
                </div>
              ))}
            </div>
          </div>

          {/* 底部：真实数据 + 校训 */}
          <div>
            <div className="grid grid-cols-3 gap-6 pt-6" style={{ borderTop: "1px solid oklch(0.34 0.05 245)" }}>
              {summaryItems.map(({ value, label }) => (
                <div key={label}>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: "oklch(0.72 0.14 85)" }}>
                    {value}
                  </div>
                  <div className="text-xs mt-1 tracking-wide" style={{ color: "oklch(0.58 0.02 240)" }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] mt-7 tracking-[0.6em]" style={{ color: "oklch(0.52 0.02 240)" }}>
              诚 毅 勤 朴
            </p>
          </div>
        </div>
      </div>

      {/* 右侧登录表单 */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* 移动端标题 */}
          <div className="lg:hidden text-center mb-8">
            <div className="flex justify-center mb-4">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "oklch(0.28 0.055 245)" }}
              >
                <GraduationCap className="w-8 h-8" style={{ color: "oklch(0.72 0.14 85)" }} />
              </div>
            </div>
            <h1 className="text-2xl font-bold" style={{ color: "oklch(0.95 0.008 240)" }}>
              浙江工商大学
            </h1>
            <p className="text-sm mt-1" style={{ color: "oklch(0.70 0.02 240)" }}>
              研究生院督导管理系统
            </p>
          </div>

          {/* 登录卡片 */}
          <div
            className="rounded-2xl p-8 shadow-2xl"
            style={{
              background: "oklch(1 0 0)",
              border: "1px solid oklch(0.87 0.012 240)",
            }}
          >
            {/* 标题 */}
            <div className="flex items-center gap-3 mb-8">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: "oklch(0.35 0.13 245)" }}
              >
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold" style={{ color: "oklch(0.18 0.025 240)" }}>
                  工号登录
                </h3>
                <p className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>
                  请使用您的教工工号和密码登录
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* 工号输入 */}
              <div className="space-y-2">
                <Label
                  htmlFor="employeeId"
                  className="text-sm font-medium"
                  style={{ color: "oklch(0.30 0.04 240)" }}
                >
                  工号
                </Label>
                <div className="relative">
                  <User
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: "oklch(0.60 0.025 240)" }}
                  />
                  <Input
                    id="employeeId"
                    type="text"
                    placeholder="请输入您的工号"
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    className="h-11 pl-10 text-base"
                    style={{ borderColor: "oklch(0.87 0.012 240)" }}
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              {/* 密码输入 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="password"
                    className="text-sm font-medium"
                    style={{ color: "oklch(0.30 0.04 240)" }}
                  >
                    密码
                  </Label>
                  <span className="text-xs" style={{ color: "oklch(0.60 0.025 240)" }}>
                    默认密码为工号
                  </span>
                </div>
                <div className="relative">
                  <Lock
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: "oklch(0.60 0.025 240)" }}
                  />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="请输入密码（默认为工号）"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 pl-10 pr-10 text-base"
                    style={{ borderColor: "oklch(0.87 0.012 240)" }}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: "oklch(0.60 0.025 240)" }}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* 登录按钮 */}
              <Button
                type="submit"
                className="w-full h-11 text-base font-medium mt-2"
                style={{ background: "oklch(0.35 0.13 245)", color: "white" }}
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    登录中...
                  </span>
                ) : (
                  "登 录"
                )}
              </Button>
            </form>

            {/* 提示信息 */}
            <div
              className="mt-5 p-3 rounded-lg text-xs"
              style={{
                background: "oklch(0.96 0.008 240)",
                color: "oklch(0.50 0.025 240)",
                border: "1px solid oklch(0.90 0.008 240)",
              }}
            >
              <p className="font-medium mb-1" style={{ color: "oklch(0.35 0.13 245)" }}>
                登录说明
              </p>
              <p>• 工号即您的教工编号，如：2023101</p>
              <p>• 初次登录密码与工号相同，请登录后及时修改</p>
              <p>• 如遇问题请联系研究生院管理员</p>
            </div>

            {/* 角色说明 */}
            <div
              className="mt-5 pt-5"
              style={{ borderTop: "1px solid oklch(0.92 0.008 240)" }}
            >
              <p
                className="text-xs text-center mb-3"
                style={{ color: "oklch(0.55 0.02 240)" }}
              >
                系统支持以下角色
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { role: "督导专家", color: "oklch(0.35 0.13 245)" },
                  { role: "督导组长", color: "oklch(0.52 0.16 200)" },
                  { role: "学院教学秘书", color: "oklch(0.62 0.14 160)" },
                  { role: "研究生院主管", color: "oklch(0.72 0.14 85)" },
                ].map(({ role, color }) => (
                  <div
                    key={role}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: "oklch(0.97 0.004 240)" }}
                  >
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: color }}
                    />
                    <span className="text-xs" style={{ color: "oklch(0.40 0.025 240)" }}>
                      {role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p
            className="text-center text-xs mt-6"
            style={{ color: "oklch(0.55 0.02 240)" }}
          >
            © 2026 浙江工商大学研究生院 · 督导管理系统
          </p>
        </div>
      </div>
    </div>
  );
}
