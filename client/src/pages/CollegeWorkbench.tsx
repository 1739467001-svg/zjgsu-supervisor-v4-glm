import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { Search, Eye, Star, Building2, BookOpen, CheckCircle, ChevronRight, BarChart3, Clock } from "lucide-react";
import { formatDateBJ } from "@shared/dateUtils";
import { hasAnyRole } from "@shared/roles";

export default function CollegeWorkbench() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [weekdayFilter, setWeekdayFilter] = useState("all");

  const { data: stats, isLoading } = trpc.stats.collegeStats.useQuery({});
  // hasAnyRole 而不是直接比较主角色：否则「主角色普通用户 + 附加角色学院教学秘书」
  // 后端放行了，前端却不发这个请求，页面上的进度卡片是空的
  const { data: progressSummary } = trpc.stats.courseProgress.useQuery(
    {},
    { enabled: hasAnyRole(user as any, ["college_secretary"]) }
  );

  const evaluations = (stats?.evaluations || []) as any[];
  const submittedEvals = evaluations.filter((e) => e.status === "submitted");

  const totalCourses = progressSummary?.length || 0;
  const evaluatedCourses = progressSummary?.filter((c: any) => c.isEvaluated)?.length || 0;
  const progressPct = totalCourses > 0 ? Math.round((evaluatedCourses / totalCourses) * 100) : 0;

  const filtered = submittedEvals.filter((e: any) => {
    const course = e.course;
    const matchSearch = !search || course?.courseName?.includes(search) || course?.teacher?.includes(search) || e.supervisor?.name?.includes(search);
    const matchWeekday = weekdayFilter === "all" || course?.weekday === weekdayFilter;
    return matchSearch && matchWeekday;
  });

  const WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5 page-transition">
        {/* 标题 */}
        <div className="rounded-xl p-5 text-white" style={{ background: "linear-gradient(135deg, oklch(0.35 0.13 245) 0%, oklch(0.45 0.15 220) 100%)" }}>
          <div className="flex items-center gap-3 mb-2">
            <Building2 className="w-6 h-6 opacity-80" />
            <h1 className="text-lg font-bold">{user?.college || "学院"} 工作台</h1>
          </div>
          <p className="text-sm opacity-80">查看本学院课程的督导评价情况</p>
          <div className="flex gap-6 mt-3">
            <div className="text-center">
              <div className="text-2xl font-bold">{submittedEvals.length}</div>
              <div className="text-xs opacity-70">督导评价次数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{evaluatedCourses}</div>
              <div className="text-xs opacity-70">已评价课程</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{totalCourses}</div>
              <div className="text-xs opacity-70">本学院课程</div>
            </div>
          </div>
        </div>

        {/* 课程评价进度板块 */}
        <div
          className="bg-white rounded-xl p-5 cursor-pointer transition-all duration-200 hover:shadow-md"
          style={{ border: "1px solid oklch(0.88 0.03 245)" }}
          onClick={() => navigate("/course-progress")}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" style={{ color: "oklch(0.35 0.13 245)" }} />
              <h2 className="text-sm font-semibold" style={{ color: "oklch(0.18 0.025 240)" }}>课程评价进度</h2>
            </div>
            <div className="flex items-center gap-1 text-xs" style={{ color: "oklch(0.35 0.13 245)" }}>
              查看详情 <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* 进度条 */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>督导覆盖率</span>
              <span className="text-sm font-bold" style={{ color: "oklch(0.35 0.13 245)" }}>{progressPct}%</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "oklch(0.93 0.01 240)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${progressPct}%`, background: progressPct >= 80 ? "oklch(0.55 0.15 160)" : progressPct >= 50 ? "oklch(0.55 0.15 245)" : "oklch(0.65 0.15 50)" }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-2 rounded-lg" style={{ background: "oklch(0.96 0.01 240)" }}>
              <div className="text-lg font-bold" style={{ color: "oklch(0.35 0.13 245)" }}>{totalCourses}</div>
              <div className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>课程总数</div>
            </div>
            <div className="text-center p-2 rounded-lg" style={{ background: "oklch(0.95 0.04 160)" }}>
              <div className="text-lg font-bold" style={{ color: "oklch(0.42 0.14 160)" }}>{evaluatedCourses}</div>
              <div className="text-xs" style={{ color: "oklch(0.42 0.14 160)" }}>已评价</div>
            </div>
            <div className="text-center p-2 rounded-lg" style={{ background: "oklch(0.96 0.04 50)" }}>
              <div className="text-lg font-bold" style={{ color: "oklch(0.55 0.12 50)" }}>{totalCourses - evaluatedCourses}</div>
              <div className="text-xs" style={{ color: "oklch(0.55 0.12 50)" }}>未评价</div>
            </div>
          </div>
        </div>

        {/* 筛选 */}
        <div className="bg-white rounded-xl p-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-4 h-4" style={{ color: "oklch(0.42 0.14 160)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "oklch(0.18 0.025 240)" }}>已督导评价记录</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="搜索课程/教师/督导专家" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-xs" />
            </div>
            <Select value={weekdayFilter} onValueChange={setWeekdayFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="选择星期" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部星期</SelectItem>
                {WEEKDAYS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 已督导课程列表 */}
        <div>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white rounded-xl" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
              <BookOpen className="w-12 h-12" style={{ color: "oklch(0.75 0.02 240)" }} />
              <p className="text-sm" style={{ color: "oklch(0.52 0.025 240)" }}>暂无督导评价记录</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((evaluation: any) => {
                const course = evaluation.course;
                const supervisor = evaluation.supervisor;
                return (
                  <div key={evaluation.id} className="bg-white rounded-xl p-5 cursor-pointer transition-all duration-200 hover:shadow-md" style={{ border: "1px solid oklch(0.90 0.01 240)" }} onClick={() => navigate(`/evaluations/${evaluation.id}`)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm" style={{ color: "oklch(0.18 0.025 240)" }}>{course?.courseName || "未知课程"}</h3>
                        <div className="flex flex-wrap gap-3 mt-1.5 text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>
                          {course?.teacher && <span>主讲：{course.teacher}</span>}
                          {course?.weekday && <span>{course.weekday} {course.period}</span>}
                          {course?.campus && <span>{course.campus}</span>}
                          {supervisor && <span className="font-medium" style={{ color: "oklch(0.35 0.13 245)" }}>督导：{supervisor.name}</span>}
                        </div>
                        {evaluation.overallScore && (
                          <div className="flex items-center gap-1 mt-2">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star key={i} className="w-3 h-3" fill={i < evaluation.overallScore ? "oklch(0.72 0.14 85)" : "none"} style={{ color: "oklch(0.72 0.14 85)" }} />
                            ))}
                            <span className="text-xs ml-1" style={{ color: "oklch(0.52 0.025 240)" }}>{(evaluation.overallScore || 0).toFixed(1)}/5</span>
                          </div>
                        )}
                        <p className="text-xs mt-1.5" style={{ color: "oklch(0.65 0.02 240)" }}>
                          评价时间：{formatDateBJ(evaluation.createdAt, { year: "numeric", month: "short", day: "numeric" })}
                        </p>
                      </div>
                      <Eye className="w-4 h-4 flex-shrink-0 mt-1" style={{ color: "oklch(0.65 0.02 240)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
