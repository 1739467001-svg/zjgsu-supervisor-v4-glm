import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { CalendarRange, Plus, Check } from "lucide-react";

/**
 * 学期配置管理（研究生院主管）。
 *
 * 学期起始日与总周数原先写死在代码里，跨学期需要改代码重新部署；
 * 现在可在此直接配置，并通过切换「当前学期」实现历史数据按学期归档。
 */
export default function SemesterSettings() {
  const utils = trpc.useUtils();
  const { data: semesters, isLoading } = trpc.semesters.list.useQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ academicYear: "", name: "", startDate: "", totalWeeks: 19 });

  const invalidate = () => {
    utils.semesters.list.invalidate();
    utils.semesters.active.invalidate();
  };

  const createMutation = trpc.semesters.create.useMutation({
    onSuccess: () => {
      toast.success("学期已创建。需要启用时点击「设为当前」");
      setDialogOpen(false);
      setForm({ academicYear: "", name: "", startDate: "", totalWeeks: 19 });
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setActiveMutation = trpc.semesters.setActive.useMutation({
    onSuccess: () => {
      toast.success("当前学期已切换");
      invalidate();
      // 周次换算、可选日期范围、待听课列表均随当前学期变化
      utils.plans.myPlans.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreate = () => {
    if (!form.academicYear.trim() || !form.name.trim()) {
      toast.error("请填写学年与学期名称");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate)) {
      toast.error("开始日期格式应为 YYYY-MM-DD");
      return;
    }
    createMutation.mutate({
      academicYear: form.academicYear.trim(),
      name: form.name.trim(),
      startDate: form.startDate,
      totalWeeks: form.totalWeeks,
    });
  };

  return (
    <div className="bg-white rounded-xl p-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarRange className="w-5 h-5" style={{ color: "oklch(0.35 0.13 245)" }} />
          <h3 className="text-sm font-semibold" style={{ color: "oklch(0.18 0.025 240)" }}>
            学期配置
          </h3>
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
          <Plus className="w-3.5 h-3.5" />
          新建学期
        </Button>
      </div>

      <p className="text-xs mb-3" style={{ color: "oklch(0.55 0.02 240)" }}>
        周次换算与可选听课日期均以「当前学期」为准；切换后，听课计划与评价记录按学期各自归档，互不混淆。
      </p>

      {isLoading ? (
        <div className="py-6 text-center text-xs" style={{ color: "oklch(0.55 0.02 240)" }}>加载中…</div>
      ) : !semesters || semesters.length === 0 ? (
        <div className="py-6 text-center text-xs" style={{ color: "oklch(0.55 0.02 240)" }}>
          尚未配置学期，系统暂以内置默认值运行。建议新建一个学期并设为当前。
        </div>
      ) : (
        <div className="space-y-2">
          {semesters.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg"
              style={{
                background: s.isActive ? "oklch(0.96 0.02 160)" : "oklch(0.97 0.004 240)",
                border: `1px solid ${s.isActive ? "oklch(0.85 0.06 160)" : "oklch(0.92 0.008 240)"}`,
              }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>
                    {s.academicYear} {s.name}
                  </span>
                  {s.isActive && (
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1"
                      style={{ background: "oklch(0.93 0.018 160)", color: "oklch(0.42 0.14 160)" }}
                    >
                      <Check className="w-3 h-3" />
                      当前学期
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5" style={{ color: "oklch(0.55 0.02 240)" }}>
                  第一周起始 {s.startDate} · 共 {s.totalWeeks} 周
                </p>
              </div>
              {!s.isActive && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs flex-shrink-0"
                  disabled={setActiveMutation.isPending}
                  onClick={() => setActiveMutation.mutate({ id: s.id })}
                >
                  设为当前
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建学期</DialogTitle>
            <DialogDescription>
              新建后不会自动启用，需另行点击「设为当前」，避免误切影响正在进行的听课评价。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">学年</Label>
                <Input
                  placeholder="2026-2027"
                  value={form.academicYear}
                  onChange={(e) => setForm((p) => ({ ...p, academicYear: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">学期名称</Label>
                <Input
                  placeholder="第一学期"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">第一周开始日期</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
              />
              <p className="text-xs" style={{ color: "oklch(0.60 0.02 240)" }}>
                通常为开学第一周的周一，周次即由此日期推算。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">总周数</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={form.totalWeeks}
                onChange={(e) => setForm((p) => ({ ...p, totalWeeks: parseInt(e.target.value) || 0 }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              style={{ background: "oklch(0.35 0.13 245)" }}
            >
              {createMutation.isPending ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
