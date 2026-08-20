import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { Search, CheckCircle2, Clock, ChevronLeft, Star, BookOpen, Eye } from "lucide-react";
import { formatDateOnlyBJ } from "@shared/dateUtils";
import { hasAnyRole } from "@shared/roles";

type ProgressTab = "all" | "evaluated" | "unevaluated";

export default function CourseProgress() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<ProgressTab>("all");
  const [search, setSearch] = useState("");
  const [collegeFilter, setCollegeFilter] = useState("");

  const isAdmin = hasAnyRole(user, ["graduate_admin", "admin"]);
  const isSecretary = hasAnyRole(user, ["college_secretary"]);

  const { data: progressData, isLoading } = trpc.stats.courseProgress.useQuery(
    { college: isAdmin ? (collegeFilter || undefined) : undefined },
    { enabled: isAdmin || isSecretary }
  );

  const { data: collegesData } = trpc.courses.getColleges.useQuery(undefined, { enabled: isAdmin });

  const courses = progressData || [];

  const filtered = useMemo(() => {
    return courses.filter((c) => {
      const matchTab =
        tab === "all" ||
        (tab === "evaluated" && c.isEvaluated) ||
        (tab === "unevaluated" && !c.isEvaluated);
      const matchSearch =
        !search ||
        c.courseName?.includes(search) ||
        c.teacher?.includes(search) ||
        c.college?.includes(search);
      return matchTab && matchSearch;
    });
  }, [courses, tab, search]);

  const totalCount = courses.length;
  const evaluatedCount = courses.filter((c) => c.isEvaluated).length;
  const unevaluatedCount = totalCount - evaluatedCount;
  const progressPct = totalCount > 0 ? Math.round((evaluatedCount / totalCount) * 100) : 0;

  const tabs: { key: ProgressTab; label: string; count: number; color: string }[] = [
    { key: "all", label: "全部课程", count: totalCount, color: "oklch(0.35 0.13 245)" },
    { key: "evaluated", label: "已评价", count: evaluatedCount, color: "oklch(0.42 0.14 160)" },
    { key: "unevaluated", label: "未评价", count: unevaluatedCount, color: "oklch(0.60 0.12 50)" },
  ];

  const collegeLabel = isSecretary
    ? (user?.college || "本学院")
    : (collegeFilter || "全校");

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5 page-transition">
        {/* 返回 */}
        <button
          onClick={() => navigate(-1 as any)}
          className="flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity"
          style={{ color: "oklch(0.35 0.13 245)" }}
        >
          <ChevronLeft className="w-4 h-4" />返回
        </button>

        {/* 标题卡片 */}
        <div className="rounded-xl p-5 text-white" style={{ background: "linear-gradient(135deg, oklch(0.35 0.13 245) 0%, oklch(0.45 0.15 220) 100%)" }}>
          <h1 className="text-lg font-bold mb-1">课程评价进度</h1>
          <p className="text-sm opacity-80">{collegeLabel} · 共 {totalCount} 门课程</p>

          {/* 进度条 */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs opacity-80">督导覆盖率</span>
              <span className="text-sm font-bold">{progressPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${progressPct}%`, background: "oklch(0.72 0.14 160)" }}
              />
            </div>
          </div>

          {/* 统计数字 */}
          <div className="flex gap-6 mt-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{evaluatedCount}</div>
              <div className="text-xs opacity-70">已评价</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{unevaluatedCount}</div>
              <div className="text-xs opacity-70">未评价</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{totalCount}</div>
              <div className="text-xs opacity-70">课程总数</div>
            </div>
          </div>
        </div>

        {/* 筛选区 */}
        <div className="bg-white rounded-xl p-4 space-y-3" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: tab === t.key ? t.color : "oklch(0.96 0.006 240)",
                  color: tab === t.key ? "white" : "oklch(0.40 0.025 240)",
                  border: `1px solid ${tab === t.key ? t.color : "oklch(0.88 0.01 240)"}`,
                }}
              >
                {t.label}
                <span
                  className="px-1.5 py-0.5 rounded-full text-xs font-bold"
                  style={{
                    background: tab === t.key ? "rgba(255,255,255,0.25)" : "oklch(0.88 0.01 240)",
                    color: tab === t.key ? "white" : "oklch(0.40 0.025 240)",
                  }}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="搜索课程名称/教师/学院"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8 text-xs"
              />
            </div>
            {isAdmin && (
              <Select value={collegeFilter || "all"} onValueChange={(v) => setCollegeFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="选择学院" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部学院</SelectItem>
                  {(collegesData || []).filter((c): c is string => c !== null).map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* 课程列表 */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white rounded-xl" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <BookOpen className="w-12 h-12" style={{ color: "oklch(0.75 0.02 240)" }} />
            <p className="text-sm" style={{ color: "oklch(0.52 0.025 240)" }}>暂无符合条件的课程</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((course: any) => (
              <div
                key={course.id}
                className="bg-white rounded-xl p-4 transition-all duration-200 hover:shadow-md"
                style={{ border: `1px solid ${course.isEvaluated ? "oklch(0.85 0.04 160)" : "oklch(0.90 0.01 240)"}` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm" style={{ color: "oklch(0.18 0.025 240)" }}>
                        {course.courseName || "未知课程"}
                      </h3>
                      {course.isEvaluated ? (
                        <Badge className="text-xs px-2 py-0 h-5 flex items-center gap-1" style={{ background: "oklch(0.93 0.06 160)", color: "oklch(0.35 0.12 160)", border: "none" }}>
                          <CheckCircle2 className="w-3 h-3" />
                          已评价 {course.evaluationCount > 1 ? `(${course.evaluationCount}次)` : ""}
                        </Badge>
                      ) : (
                        <Badge className="text-xs px-2 py-0 h-5 flex items-center gap-1" style={{ background: "oklch(0.96 0.04 50)", color: "oklch(0.55 0.12 50)", border: "none" }}>
                          <Clock className="w-3 h-3" />
                          未评价
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-3 mt-1.5 text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>
                      {course.teacher && <span>主讲：{course.teacher}</span>}
                      {course.college && <span>{course.college}</span>}
                      {course.campus && <span>{course.campus}</span>}
                      {course.weekday && <span>{course.weekday} {course.period}</span>}
                    </div>

                    {/* 已评价：显示评价摘要 */}
                    {course.isEvaluated && course.evaluations?.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {course.evaluations.map((ev: any) => (
                          <div
                            key={ev.id}
                            className="flex items-center justify-between p-2 rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                            style={{ background: "oklch(0.96 0.006 240)" }}
                            onClick={() => navigate(`/evaluations/${ev.id}`)}
                          >
                            <div className="flex items-center gap-2 text-xs" style={{ color: "oklch(0.40 0.025 240)" }}>
                              <Eye className="w-3 h-3" style={{ color: "oklch(0.35 0.13 245)" }} />
                              <span>督导：{ev.supervisor?.name || "未知"}</span>
                              {ev.actualWeek && (
                                <span className="px-1.5 py-0.5 rounded-full" style={{ background: "oklch(0.93 0.018 240)", color: "oklch(0.35 0.13 245)" }}>
                                  第{ev.actualWeek}周
                                </span>
                              )}
                              {ev.overallScore && (
                                <span className="flex items-center gap-0.5">
                                  {Array.from({ length: 5 }).map((_, i) => (
                                    <Star key={i} className="w-2.5 h-2.5" fill={i < ev.overallScore ? "oklch(0.72 0.14 85)" : "none"} style={{ color: "oklch(0.72 0.14 85)" }} />
                                  ))}
                                </span>
                              )}
                            </div>
                            <span className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>
                              {formatDateOnlyBJ(ev.createdAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
