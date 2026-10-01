import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, ClipboardEdit, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useSemesterSelection } from "@/contexts/SemesterSelection";

// 星期顺序
const WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

// 节次时间对照表（按起始节次排序）
const PERIOD_SLOTS = [
  { label: "第1-2节", start: 1, end: 2, time: "08:00–09:40" },
  { label: "第3-4节", start: 3, end: 4, time: "10:00–11:40" },
  { label: "第5-6节", start: 5, end: 6, time: "13:00–14:40" },
  { label: "第7-8节", start: 7, end: 8, time: "15:00–16:40" },
  { label: "第9-10节", start: 9, end: 10, time: "17:00–18:40" },
  { label: "第11-12节", start: 11, end: 12, time: "19:00–20:40" },
];

// 解析 period 字符串，提取起始节次
function parsePeriodStart(period: string): number {
  const match = period.match(/第(\d+)/);
  return match ? parseInt(match[1]) : 99;
}

// 将 period 映射到最近的 PERIOD_SLOT
function mapToSlot(period: string): number {
  const start = parsePeriodStart(period);
  // 找最近的slot
  let best = 0;
  let bestDiff = 99;
  PERIOD_SLOTS.forEach((slot, idx) => {
    const diff = Math.abs(slot.start - start);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = idx;
    }
  });
  return best;
}

const STATUS_COLORS = {
  pending: {
    bg: "oklch(0.93 0.018 240)",
    border: "oklch(0.75 0.08 240)",
    text: "oklch(0.35 0.13 245)",
    badge: "待听课",
  },
  completed: {
    bg: "oklch(0.93 0.018 160)",
    border: "oklch(0.70 0.10 160)",
    text: "oklch(0.42 0.14 160)",
    badge: "已评价",
  },
  cancelled: {
    bg: "oklch(0.93 0.010 240)",
    border: "oklch(0.80 0.01 240)",
    text: "oklch(0.52 0.025 240)",
    badge: "已取消",
  },
};

interface Plan {
  id: number;
  courseId: number;
  planWeek: number | null;
  status: string;
  evaluationId?: number | null;
  evaluationStatus?: string | null;
  course?: {
    id: number;
    courseName: string | null;
    teacher: string | null;
    weekday: string | null;
    period: string | null;
    classroom: string | null;
    campus: string | null;
    college: string | null;
  };
}

interface Props {
  plans: Plan[];
  onStatusUpdate?: (planId: number, status: "cancelled") => void;
  isUpdating?: boolean;
}

export default function PlanCalendarView({ plans, onStatusUpdate, isUpdating }: Props) {
  const { isHistorical } = useSemesterSelection();
  const [, navigate] = useLocation();
  const [currentWeek, setCurrentWeek] = useState<number>(() => {
    // 默认选择有计划的最小周次，或第1周
    const weeks = plans.map((p) => p.planWeek).filter((w): w is number => w !== null);
    return weeks.length > 0 ? Math.min(...weeks) : 1;
  });
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  // 获取所有有计划的周次
  const availableWeeks = useMemo(() => {
    const weeks = new Set(plans.map((p) => p.planWeek).filter((w): w is number => w !== null));
    return Array.from(weeks).sort((a, b) => a - b);
  }, [plans]);

  // 当前周的计划
  const weekPlans = useMemo(() => {
    return plans.filter((p) => p.planWeek === currentWeek);
  }, [plans, currentWeek]);

  // 构建日历网格：slotIndex -> weekday -> plans[]
  const grid = useMemo(() => {
    const g: Record<number, Record<string, Plan[]>> = {};
    PERIOD_SLOTS.forEach((_, idx) => {
      g[idx] = {};
      WEEKDAYS.forEach((wd) => {
        g[idx][wd] = [];
      });
    });
    weekPlans.forEach((plan) => {
      const wd = plan.course?.weekday;
      const period = plan.course?.period;
      if (!wd || !period) return;
      const slotIdx = mapToSlot(period);
      if (g[slotIdx] && g[slotIdx][wd] !== undefined) {
        g[slotIdx][wd].push(plan);
      }
    });
    return g;
  }, [weekPlans]);

  // 检查某天是否有任何计划
  const dayHasPlan = (weekday: string) => weekPlans.some((p) => p.course?.weekday === weekday);

  const handlePrevWeek = () => {
    const idx = availableWeeks.indexOf(currentWeek);
    if (idx > 0) setCurrentWeek(availableWeeks[idx - 1]);
    else if (currentWeek > 1) setCurrentWeek(currentWeek - 1);
  };

  const handleNextWeek = () => {
    const idx = availableWeeks.indexOf(currentWeek);
    if (idx < availableWeeks.length - 1) setCurrentWeek(availableWeeks[idx + 1]);
    else if (currentWeek < 19) setCurrentWeek(currentWeek + 1);
  };

  return (
    <div className="space-y-4">
      {/* 周次导航 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={handlePrevWeek}
            disabled={currentWeek <= 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="text-center min-w-[80px]">
            <span className="text-base font-semibold" style={{ color: "oklch(0.18 0.025 240)" }}>
              第 {currentWeek} 周
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={handleNextWeek}
            disabled={currentWeek >= 19}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* 快速跳转到有计划的周 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs" style={{ color: "oklch(0.55 0.025 240)" }}>
            有计划：
          </span>
          {availableWeeks.slice(0, 8).map((w) => (
            <button
              key={w}
              onClick={() => setCurrentWeek(w)}
              className="px-2 py-0.5 rounded text-xs font-medium transition-all"
              style={{
                background:
                  w === currentWeek ? "oklch(0.35 0.13 245)" : "oklch(0.93 0.010 240)",
                color: w === currentWeek ? "white" : "oklch(0.40 0.025 240)",
              }}
            >
              第{w}周
            </button>
          ))}
          {availableWeeks.length > 8 && (
            <span className="text-xs" style={{ color: "oklch(0.60 0.025 240)" }}>
              +{availableWeeks.length - 8}周
            </span>
          )}
        </div>
      </div>

      {/* 本周统计 */}
      <div className="flex gap-3 text-xs">
        {(["pending", "completed", "cancelled"] as const).map((s) => {
          const count = weekPlans.filter((p) => p.status === s).length;
          const c = STATUS_COLORS[s];
          return (
            <span
              key={s}
              className="flex items-center gap-1 px-2 py-1 rounded-full"
              style={{ background: c.bg, color: c.text }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: c.text }}
              />
              {c.badge} {count}
            </span>
          );
        })}
      </div>

      {/* 日历网格 */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid oklch(0.90 0.010 240)" }}>
        {/* 表头：星期 */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: "80px repeat(7, 1fr)",
            background: "oklch(0.96 0.008 240)",
            borderBottom: "1px solid oklch(0.90 0.010 240)",
          }}
        >
          <div
            className="p-2 text-xs font-medium text-center"
            style={{ color: "oklch(0.52 0.025 240)", borderRight: "1px solid oklch(0.90 0.010 240)" }}
          >
            节次
          </div>
          {WEEKDAYS.map((wd) => (
            <div
              key={wd}
              className="p-2 text-xs font-medium text-center"
              style={{
                color: dayHasPlan(wd) ? "oklch(0.35 0.13 245)" : "oklch(0.52 0.025 240)",
                fontWeight: dayHasPlan(wd) ? "600" : "400",
                borderRight: "1px solid oklch(0.90 0.010 240)",
              }}
            >
              {wd.replace("星期", "周")}
              {dayHasPlan(wd) && (
                <span
                  className="ml-1 inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: "oklch(0.35 0.13 245)", verticalAlign: "middle" }}
                />
              )}
            </div>
          ))}
        </div>

        {/* 时间槽行 */}
        {PERIOD_SLOTS.map((slot, slotIdx) => {
          const rowHasPlan = WEEKDAYS.some((wd) => grid[slotIdx][wd].length > 0);
          return (
            <div
              key={slot.label}
              className="grid"
              style={{
                gridTemplateColumns: "80px repeat(7, 1fr)",
                borderBottom: slotIdx < PERIOD_SLOTS.length - 1 ? "1px solid oklch(0.93 0.008 240)" : "none",
                background: rowHasPlan ? "oklch(0.99 0.003 240)" : "white",
                minHeight: "72px",
              }}
            >
              {/* 节次标签 */}
              <div
                className="flex flex-col items-center justify-center p-2 gap-0.5"
                style={{
                  borderRight: "1px solid oklch(0.90 0.010 240)",
                  background: rowHasPlan ? "oklch(0.96 0.010 240)" : "oklch(0.97 0.004 240)",
                }}
              >
                <span
                  className="text-xs font-medium"
                  style={{ color: rowHasPlan ? "oklch(0.35 0.13 245)" : "oklch(0.52 0.025 240)" }}
                >
                  {slot.label}
                </span>
                <span className="text-[10px]" style={{ color: "oklch(0.65 0.02 240)" }}>
                  {slot.time}
                </span>
              </div>

              {/* 每天的格子 */}
              {WEEKDAYS.map((wd) => {
                const cellPlans = grid[slotIdx][wd];
                return (
                  <div
                    key={wd}
                    className="p-1.5 flex flex-col gap-1"
                    style={{ borderRight: "1px solid oklch(0.93 0.008 240)" }}
                  >
                    {cellPlans.map((plan) => {
                      const c = STATUS_COLORS[plan.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.pending;
                      const course = plan.course;
                      return (
                        <button
                          key={plan.id}
                          onClick={() => setSelectedPlan(selectedPlan?.id === plan.id ? null : plan)}
                          className="w-full text-left rounded-lg p-1.5 transition-all duration-150 hover:opacity-90 hover:shadow-sm"
                          style={{
                            background: c.bg,
                            border: `1px solid ${c.border}`,
                          }}
                        >
                          <div
                            className="text-[11px] font-semibold leading-tight truncate"
                            style={{ color: c.text }}
                          >
                            {course?.courseName || "未知课程"}
                          </div>
                          <div
                            className="text-[10px] mt-0.5 truncate"
                            style={{ color: "oklch(0.55 0.025 240)" }}
                          >
                            {course?.teacher}
                          </div>
                          <div
                            className="text-[10px] truncate"
                            style={{ color: "oklch(0.60 0.02 240)" }}
                          >
                            {course?.classroom}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* 空状态 */}
      {weekPlans.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-10 rounded-xl gap-3"
          style={{ background: "oklch(0.97 0.004 240)", border: "1px dashed oklch(0.85 0.012 240)" }}
        >
          <BookOpen className="w-10 h-10" style={{ color: "oklch(0.75 0.02 240)" }} />
          <p className="text-sm" style={{ color: "oklch(0.55 0.025 240)" }}>
            第 {currentWeek} 周暂无听课计划
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/courses")}
          >
            去添加听课计划
          </Button>
        </div>
      )}

      {/* 选中计划详情弹出 */}
      {selectedPlan && (
        <div
          className="rounded-xl p-5 shadow-lg"
          style={{
            background: "white",
            border: "1px solid oklch(0.85 0.015 240)",
            boxShadow: "0 4px 24px oklch(0.35 0.13 245 / 0.12)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <h4 className="font-semibold text-sm" style={{ color: "oklch(0.18 0.025 240)" }}>
                  {selectedPlan.course?.courseName}
                </h4>
                {(() => {
                  const c = STATUS_COLORS[selectedPlan.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.pending;
                  return (
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ background: c.bg, color: c.text }}
                    >
                      {c.badge}
                    </span>
                  );
                })()}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" style={{ color: "oklch(0.45 0.025 240)" }}>
                <span>教师：{selectedPlan.course?.teacher || "-"}</span>
                <span>校区：{selectedPlan.course?.campus || "-"}</span>
                <span>教室：{selectedPlan.course?.classroom || "-"}</span>
                <span>学院：{selectedPlan.course?.college || "-"}</span>
                <span>时间：{selectedPlan.course?.weekday} {selectedPlan.course?.period}</span>
                <span>计划周次：第{selectedPlan.planWeek}周</span>
              </div>
            </div>
            <button
              onClick={() => setSelectedPlan(null)}
              className="text-xs px-2 py-1 rounded"
              style={{ color: "oklch(0.55 0.025 240)", background: "oklch(0.94 0.008 240)" }}
            >
              关闭
            </button>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 mt-4">
            {selectedPlan.status === "pending" && !isHistorical && (
              <>
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={() => {
                    // 若该课程已有草稿评价，直接跳转到续编模式；否则新建
                    if (selectedPlan.evaluationId && selectedPlan.evaluationStatus === 'draft') {
                      navigate(`/evaluations/${selectedPlan.evaluationId}/edit`);
                    } else {
                      navigate(`/evaluations/new/${selectedPlan.course?.id || selectedPlan.courseId}`);
                    }
                    setSelectedPlan(null);
                  }}
                >
                  <ClipboardEdit className="w-3.5 h-3.5" />
                  {selectedPlan.evaluationId && selectedPlan.evaluationStatus === 'draft' ? '继续评价' : '填写评价'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => {
                    onStatusUpdate?.(selectedPlan.id, "cancelled");
                    setSelectedPlan(null);
                  }}
                  disabled={isUpdating}
                >
                  取消计划
                </Button>
              </>
            )}
            {selectedPlan.status === "completed" && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1"
                onClick={() => {
                  // 直接跳转到该评价记录，而非评价列表首页
                  if (selectedPlan.evaluationId) {
                    navigate(`/evaluations/${selectedPlan.evaluationId}`);
                  } else {
                    navigate("/evaluations");
                  }
                }}
              >
                <ClipboardEdit className="w-3.5 h-3.5" />
                查看评价
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 图例 */}
      <div className="flex items-center gap-4 text-xs" style={{ color: "oklch(0.55 0.025 240)" }}>
        <span>图例：</span>
        {(["pending", "completed", "cancelled"] as const).map((s) => {
          const c = STATUS_COLORS[s];
          return (
            <span key={s} className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-3 rounded"
                style={{ background: c.bg, border: `1px solid ${c.border}` }}
              />
              {c.badge}
            </span>
          );
        })}
      </div>
    </div>
  );
}
