import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { GraduationCap, Eye, EyeOff, Shield, Lock, User } from "lucide-react";

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
      {/* 左侧装饰区 */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center p-12 relative overflow-hidden">
        {/* 背景装饰圆 */}
        <div
          className="absolute top-20 left-20 w-72 h-72 rounded-full opacity-10"
          style={{ background: "oklch(0.62 0.14 200)" }}
        />
        <div
          className="absolute bottom-32 right-16 w-56 h-56 rounded-full opacity-8"
          style={{ background: "oklch(0.72 0.14 85)" }}
        />
        <div
          className="absolute top-1/2 left-1/3 w-40 h-40 rounded-full opacity-6"
          style={{ background: "oklch(0.52 0.16 200)" }}
        />

        <div className="relative z-10 text-center">
          {/* 校徽区域 */}
          <div className="flex justify-center mb-8">
            <div
              className="w-28 h-28 rounded-full flex items-center justify-center"
              style={{
                background: "oklch(0.28 0.055 245)",
                border: "2px solid oklch(0.62 0.14 200 / 0.4)",
                boxShadow: "0 0 40px oklch(0.35 0.13 245 / 0.3)",
              }}
            >
              <GraduationCap className="w-14 h-14" style={{ color: "oklch(0.72 0.14 85)" }} />
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-3" style={{ color: "oklch(0.95 0.008 240)" }}>
            浙江工商大学
          </h1>
          <h2 className="text-2xl font-light mb-2" style={{ color: "oklch(0.80 0.015 240)" }}>
            研究生院督导管理系统
          </h2>
          <p
            className="text-base mt-6 max-w-xs mx-auto leading-relaxed"
            style={{ color: "oklch(0.65 0.02 240)" }}
          >
            专业、高效的研究生课程督导评价平台，助力教学质量持续提升
          </p>

          {/* 功能标签 */}
          <div className="flex flex-wrap justify-center gap-2 mt-8">
            {["课程督导", "评价管理", "数据统计", "多角色协作"].map((tag) => (
              <span
                key={tag}
                className="px-3 py-1.5 rounded-full text-xs font-medium"
                style={{
                  background: "oklch(0.28 0.055 245)",
                  color: "oklch(0.75 0.06 200)",
                  border: "1px solid oklch(0.35 0.07 245)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>

          {/* 数据统计（当前学期真实数据） */}
          <div className="grid grid-cols-3 gap-4 mt-10">
            {summaryItems.map(({ value, label }) => (
              <div key={label} className="text-center">
                <div className="text-2xl font-bold" style={{ color: "oklch(0.72 0.14 85)" }}>
                  {value}
                </div>
                <div className="text-xs mt-1" style={{ color: "oklch(0.60 0.02 240)" }}>
                  {label}
                </div>
              </div>
            ))}
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
