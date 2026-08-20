import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, BookOpen, MapPin, Clock, User, Plus, ChevronLeft, ChevronRight, Filter, X, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { hasAnyRole } from "@shared/roles";

const WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
const WEEKS = Array.from({ length: 19 }, (_, i) => i + 1);
const CAMPUSES = ["下沙", "教工路"];

const DEFAULT_FILTERS = {
  college: "",
  campus: "",
  weekday: "",
  week: undefined as number | undefined,
  teacher: "",
  courseName: "",
  page: 1,
  pageSize: 15,
};

export default function CourseList() {
  const { user } = useAuth();
  const canAddPlan = hasAnyRole(user, ["supervisor_expert", "supervisor_leader", "graduate_admin", "admin"]);

  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [planDialog, setPlanDialog] = useState<{ open: boolean; courseId?: number; courseName?: string }>({ open: false });
  const [planWeek, setPlanWeek] = useState<number | undefined>();

  // 查询当前课程已占用周次
  const { data: usedWeeksData } = trpc.plans.getUsedWeeks.useQuery(
    { courseId: planDialog.courseId! },
    { enabled: planDialog.open && !!planDialog.courseId }
  );
  const usedWeeks = usedWeeksData?.usedWeeks ?? [];
  const evaluatedWeeks = usedWeeksData?.evaluatedWeeks ?? [];

  // 构建传给后端的查询参数（过滤掉空字符串）
  const queryParams = useMemo(() => {
    const params: Record<string, any> = {
      page: filters.page,
      pageSize: filters.pageSize,
    };
    if (filters.college) params.college = filters.college;
    if (filters.campus) params.campus = filters.campus;
    if (filters.weekday) params.weekday = filters.weekday;
    if (filters.week) params.week = filters.week;
    if (filters.teacher.trim()) params.teacher = filters.teacher.trim();
    if (filters.courseName.trim()) params.courseName = filters.courseName.trim();
    return params;
  }, [filters]);

  const { data: coursesData, isLoading } = trpc.courses.list.useQuery(queryParams as any);
  const { data: colleges } = trpc.courses.getColleges.useQuery();
  const utils = trpc.useUtils();

  const addPlanMutation = trpc.plans.create.useMutation({
    onSuccess: () => {
      toast.success("已加入听课计划！");
      setPlanDialog({ open: false });
      utils.plans.myPlans.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleFilterChange = (key: string, value: any) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const handleClearFilter = (key: string) => {
    setFilters((prev) => ({ ...prev, [key]: key === "week" ? undefined : "", page: 1 }));
  };

  const handleClearAll = () => {
    setFilters({ ...DEFAULT_FILTERS });
  };

  const handleAddPlan = (courseId: number, courseName: string) => {
    setPlanDialog({ open: true, courseId, courseName });
    setPlanWeek(filters.week);
  };

  const confirmAddPlan = () => {
    if (!planDialog.courseId) return;
    addPlanMutation.mutate({ courseId: planDialog.courseId, planWeek });
  };

  const totalPages = Math.ceil((coursesData?.total || 0) / filters.pageSize);

  // 计算活跃筛选条件数量
  const activeFilterCount = [
    filters.college,
    filters.campus,
    filters.weekday,
    filters.week,
    filters.teacher.trim(),
    filters.courseName.trim(),
  ].filter(Boolean).length;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5 page-transition">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "oklch(0.18 0.025 240)" }}>课程浏览</h1>
            <p className="text-sm mt-0.5" style={{ color: "oklch(0.52 0.025 240)" }}>
              全校研究生课程 · 共 <span className="font-semibold" style={{ color: "oklch(0.35 0.13 245)" }}>{coursesData?.total || 0}</span> 条
              {activeFilterCount > 0 && <span className="ml-1">（已筛选）</span>}
            </p>
          </div>
          {activeFilterCount > 0 && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleClearAll}>
              <RefreshCw className="w-3 h-3" />
              清除全部筛选
            </Button>
          )}
        </div>

        {/* 筛选区 */}
        <div className="bg-white rounded-xl p-4 space-y-3" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4" style={{ color: "oklch(0.35 0.13 245)" }} />
              <span className="text-sm font-medium" style={{ color: "oklch(0.30 0.04 240)" }}>筛选条件</span>
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="text-xs h-5 px-1.5" style={{ background: "oklch(0.93 0.018 240)", color: "oklch(0.35 0.13 245)" }}>
                  {activeFilterCount} 项
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
            {/* 学院筛选 */}
            <div className="relative">
              <Select value={filters.college || "all"} onValueChange={(v) => handleFilterChange("college", v === "all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs" style={filters.college ? { borderColor: "oklch(0.55 0.18 245)", background: "oklch(0.96 0.012 240)" } : {}}>
                  <SelectValue placeholder="全部学院" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部学院</SelectItem>
                  {colleges?.map((c) => (
                    <SelectItem key={c} value={c || ""}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filters.college && (
                <button className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10" onClick={() => handleClearFilter("college")}>
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 校区筛选 */}
            <div className="relative">
              <Select value={filters.campus || "all"} onValueChange={(v) => handleFilterChange("campus", v === "all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs" style={filters.campus ? { borderColor: "oklch(0.55 0.18 245)", background: "oklch(0.96 0.012 240)" } : {}}>
                  <SelectValue placeholder="全部校区" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部校区</SelectItem>
                  {CAMPUSES.map((c) => (
                    <SelectItem key={c} value={c}>{c}校区</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filters.campus && (
                <button className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10" onClick={() => handleClearFilter("campus")}>
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 星期筛选 */}
            <div className="relative">
              <Select value={filters.weekday || "all"} onValueChange={(v) => handleFilterChange("weekday", v === "all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs" style={filters.weekday ? { borderColor: "oklch(0.55 0.18 245)", background: "oklch(0.96 0.012 240)" } : {}}>
                  <SelectValue placeholder="全部星期" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部星期</SelectItem>
                  {WEEKDAYS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filters.weekday && (
                <button className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10" onClick={() => handleClearFilter("weekday")}>
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 周次筛选 */}
            <div className="relative">
              <Select
                value={filters.week?.toString() || "all"}
                onValueChange={(v) => handleFilterChange("week", v === "all" ? undefined : parseInt(v))}
              >
                <SelectTrigger className="h-9 text-xs" style={filters.week ? { borderColor: "oklch(0.55 0.18 245)", background: "oklch(0.96 0.012 240)" } : {}}>
                  <SelectValue placeholder="全部周次" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部周次</SelectItem>
                  {WEEKS.map((w) => (
                    <SelectItem key={w} value={w.toString()}>第 {w} 周</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filters.week && (
                <button className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10" onClick={() => handleClearFilter("week")}>
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 教师搜索 */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="搜索教师姓名"
                value={filters.teacher}
                onChange={(e) => handleFilterChange("teacher", e.target.value)}
                className="h-9 pl-8 pr-7 text-xs"
                style={filters.teacher.trim() ? { borderColor: "oklch(0.55 0.18 245)", background: "oklch(0.96 0.012 240)" } : {}}
              />
              {filters.teacher && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => handleClearFilter("teacher")}>
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 课程名搜索 */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="搜索课程名称"
                value={filters.courseName}
                onChange={(e) => handleFilterChange("courseName", e.target.value)}
                className="h-9 pl-8 pr-7 text-xs"
                style={filters.courseName.trim() ? { borderColor: "oklch(0.55 0.18 245)", background: "oklch(0.96 0.012 240)" } : {}}
              />
              {filters.courseName && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => handleClearFilter("courseName")}>
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* 已选条件标签 */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t" style={{ borderColor: "oklch(0.93 0.006 240)" }}>
              <span className="text-xs text-muted-foreground self-center">已选：</span>
              {filters.college && (
                <Badge variant="outline" className="text-xs h-6 gap-1 cursor-pointer hover:bg-red-50" style={{ borderColor: "oklch(0.55 0.18 245)", color: "oklch(0.35 0.13 245)" }} onClick={() => handleClearFilter("college")}>
                  {filters.college} <X className="w-2.5 h-2.5" />
                </Badge>
              )}
              {filters.campus && (
                <Badge variant="outline" className="text-xs h-6 gap-1 cursor-pointer hover:bg-red-50" style={{ borderColor: "oklch(0.55 0.18 245)", color: "oklch(0.35 0.13 245)" }} onClick={() => handleClearFilter("campus")}>
                  {filters.campus}校区 <X className="w-2.5 h-2.5" />
                </Badge>
              )}
              {filters.weekday && (
                <Badge variant="outline" className="text-xs h-6 gap-1 cursor-pointer hover:bg-red-50" style={{ borderColor: "oklch(0.55 0.18 245)", color: "oklch(0.35 0.13 245)" }} onClick={() => handleClearFilter("weekday")}>
                  {filters.weekday} <X className="w-2.5 h-2.5" />
                </Badge>
              )}
              {filters.week && (
                <Badge variant="outline" className="text-xs h-6 gap-1 cursor-pointer hover:bg-red-50" style={{ borderColor: "oklch(0.55 0.18 245)", color: "oklch(0.35 0.13 245)" }} onClick={() => handleClearFilter("week")}>
                  第{filters.week}周 <X className="w-2.5 h-2.5" />
                </Badge>
              )}
              {filters.teacher.trim() && (
                <Badge variant="outline" className="text-xs h-6 gap-1 cursor-pointer hover:bg-red-50" style={{ borderColor: "oklch(0.55 0.18 245)", color: "oklch(0.35 0.13 245)" }} onClick={() => handleClearFilter("teacher")}>
                  教师: {filters.teacher.trim()} <X className="w-2.5 h-2.5" />
                </Badge>
              )}
              {filters.courseName.trim() && (
                <Badge variant="outline" className="text-xs h-6 gap-1 cursor-pointer hover:bg-red-50" style={{ borderColor: "oklch(0.55 0.18 245)", color: "oklch(0.35 0.13 245)" }} onClick={() => handleClearFilter("courseName")}>
                  课程: {filters.courseName.trim()} <X className="w-2.5 h-2.5" />
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* 课程列表 */}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground">加载中...</p>
              </div>
            </div>
          ) : coursesData?.data.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <BookOpen className="w-10 h-10" style={{ color: "oklch(0.75 0.01 240)" }} />
              <p className="text-sm" style={{ color: "oklch(0.55 0.02 240)" }}>暂无符合条件的课程</p>
              {activeFilterCount > 0 && (
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={handleClearAll}>
                  <RefreshCw className="w-3 h-3" /> 清除筛选条件
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* 桌面端表格 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ background: "oklch(0.97 0.004 240)", borderBottom: "1px solid oklch(0.90 0.01 240)" }}>
                      {["课程名称", "主讲教师", "开课院系", "校区", "星期", "节次", "周次", "教室", ...(canAddPlan ? ["操作"] : [])].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "oklch(0.40 0.025 240)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {coursesData?.data.map((course, idx) => (
                      <tr
                        key={course.id}
                        className="transition-colors"
                        style={{ borderBottom: "1px solid oklch(0.93 0.006 240)", background: idx % 2 === 0 ? "white" : "oklch(0.99 0.002 240)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "oklch(0.96 0.008 240)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? "white" : "oklch(0.99 0.002 240)")}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-sm max-w-[200px]" style={{ color: "oklch(0.20 0.025 240)" }}>{course.courseName}</div>
                          {course.courseType && <div className="text-xs mt-0.5" style={{ color: "oklch(0.55 0.02 240)" }}>{course.courseType}</div>}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium" style={{ color: "oklch(0.30 0.04 240)" }}>{course.teacher}</td>
                        <td className="px-4 py-3 text-xs max-w-[140px]" style={{ color: "oklch(0.40 0.025 240)" }}>{course.college}</td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                            style={{
                              background: course.campus === "下沙" ? "oklch(0.93 0.018 240)" : "oklch(0.93 0.018 200)",
                              color: course.campus === "下沙" ? "oklch(0.35 0.13 245)" : "oklch(0.35 0.16 200)"
                            }}
                          >
                            <MapPin className="w-3 h-3" />
                            {course.campus}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: "oklch(0.30 0.04 240)" }}>{course.weekday}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "oklch(0.40 0.025 240)" }}>{course.period}</td>
                        <td className="px-4 py-3 text-xs max-w-[150px]" style={{ color: "oklch(0.52 0.025 240)" }}>
                          <span title={course.weekType || ""}>{course.weekType}</span>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>{course.classroom}</td>
                        {canAddPlan && (
                          <td className="px-4 py-3">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              style={{ borderColor: "oklch(0.55 0.18 245)", color: "oklch(0.35 0.13 245)" }}
                              onClick={() => handleAddPlan(course.id, course.courseName || "")}
                            >
                              <Plus className="w-3 h-3" />
                              听课
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 移动端卡片 */}
              <div className="md:hidden divide-y" style={{ borderColor: "oklch(0.92 0.008 240)" }}>
                {coursesData?.data.map((course) => (
                  <div key={course.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm" style={{ color: "oklch(0.20 0.025 240)" }}>{course.courseName}</h3>
                        {course.courseType && <p className="text-xs mt-0.5" style={{ color: "oklch(0.52 0.025 240)" }}>{course.courseType}</p>}
                      </div>
                      {canAddPlan && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 flex-shrink-0"
                          style={{ borderColor: "oklch(0.55 0.18 245)", color: "oklch(0.35 0.13 245)" }}
                          onClick={() => handleAddPlan(course.id, course.courseName || "")}
                        >
                          <Plus className="w-3 h-3" />听课
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <span className="flex items-center gap-1" style={{ color: "oklch(0.35 0.13 245)" }}>
                        <User className="w-3 h-3" />{course.teacher}
                      </span>
                      <span className="flex items-center gap-1" style={{ color: "oklch(0.52 0.025 240)" }}>
                        <MapPin className="w-3 h-3" />{course.campus} · {course.classroom}
                      </span>
                      <span className="flex items-center gap-1" style={{ color: "oklch(0.52 0.025 240)" }}>
                        <Clock className="w-3 h-3" />{course.weekday} {course.period}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-xs h-5 px-1.5">{course.college}</Badge>
                      <Badge variant="outline" className="text-xs h-5 px-1.5" style={{ color: "oklch(0.52 0.025 240)" }}>{course.weekType}</Badge>
                    </div>
                  </div>
                ))}
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: "oklch(0.90 0.01 240)" }}>
                  <p className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>
                    共 {coursesData?.total} 条，第 {filters.page}/{totalPages} 页
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={filters.page <= 1}
                      onClick={() => setFilters((p) => ({ ...p, page: p.page - 1 }))}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let page = i + 1;
                      if (totalPages > 5) {
                        if (filters.page <= 3) page = i + 1;
                        else if (filters.page >= totalPages - 2) page = totalPages - 4 + i;
                        else page = filters.page - 2 + i;
                      }
                      return (
                        <Button
                          key={page}
                          variant={filters.page === page ? "default" : "outline"}
                          size="sm"
                          className="h-8 w-8 p-0 text-xs"
                          onClick={() => setFilters((p) => ({ ...p, page }))}
                        >
                          {page}
                        </Button>
                      );
                    })}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={filters.page >= totalPages}
                      onClick={() => setFilters((p) => ({ ...p, page: p.page + 1 }))}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 加入听课计划弹窗 */}
      <Dialog open={planDialog.open} onOpenChange={(open) => setPlanDialog((p) => ({ ...p, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>加入听课计划</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 rounded-lg" style={{ background: "oklch(0.96 0.008 240)" }}>
              <p className="text-sm font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>{planDialog.courseName}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">计划听课周次（可选）</Label>
              <Select value={planWeek?.toString() || "none"} onValueChange={(v) => setPlanWeek(v === "none" ? undefined : parseInt(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="选择周次（可不填）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不指定周次</SelectItem>
                  {WEEKS.map((w) => {
                    const isEvaluated = evaluatedWeeks.includes(w);
                    const isUsed = usedWeeks.includes(w);
                    const disabled = isEvaluated || isUsed;
                    const label = isEvaluated
                      ? `第 ${w} 周（已评价）`
                      : isUsed
                      ? `第 ${w} 周（已计划）`
                      : `第 ${w} 周`;
                    return (
                      <SelectItem
                        key={w}
                        value={w.toString()}
                        disabled={disabled}
                        className={disabled ? "opacity-40 cursor-not-allowed" : ""}
                      >
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialog({ open: false })}>取消</Button>
            <Button onClick={confirmAddPlan} disabled={addPlanMutation.isPending}>
              {addPlanMutation.isPending ? "添加中..." : "加入计划"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
