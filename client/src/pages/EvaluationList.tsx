import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Search, Eye, Edit, Trash2, Star, ClipboardList, Filter, Download, FileSpreadsheet, FileText, AlertTriangle } from "lucide-react";
import { formatDateOnlyBJ, formatDateBJ } from "@shared/dateUtils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hasAnyRole } from "@shared/roles";

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "草稿", color: "oklch(0.52 0.025 240)", bg: "oklch(0.93 0.01 240)" },
  submitted: { label: "已提交", color: "oklch(0.42 0.14 160)", bg: "oklch(0.93 0.018 160)" },
};

export default function EvaluationList() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const canEdit = hasAnyRole(user, ["supervisor_expert", "supervisor_leader", "graduate_admin", "admin"]);
  const canViewAll = hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"]);
  const canExport = hasAnyRole(user, ["graduate_admin", "admin", "college_secretary", "supervisor_leader", "supervisor_expert"]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [collegeFilter, setCollegeFilter] = useState("all");
  const [exporting, setExporting] = useState(false);

  const { data: evaluations, isLoading } = trpc.evaluations.allEvaluations.useQuery({});
  const { data: colleges } = trpc.courses.getColleges.useQuery();
  const utils = trpc.useUtils();

  const deleteMutation = trpc.evaluations.delete.useMutation({
    onSuccess: () => {
      toast.success("已删除评价");
      utils.evaluations.allEvaluations.invalidate();
      utils.evaluations.myEvaluations.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const exportExcelMutation = trpc.evaluations.exportToExcel.useMutation({
    onSuccess: (data) => {
      // 将 base64 转为 Blob 下载
      const byteCharacters = atob(data.buffer);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Excel 报表导出成功");
      setExporting(false);
    },
    onError: (err) => {
      toast.error(`导出失败：${err.message}`);
      setExporting(false);
    },
  });

  const exportPdfMutation = trpc.evaluations.exportToPdf.useMutation({
    onSuccess: (data) => {
      // 用新窗口打开 HTML 并触发打印（另存为 PDF）
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(data.html);
        printWindow.document.close();
        // 等待内容渲染后自动触发打印
        setTimeout(() => {
          printWindow.print();
        }, 800);
      } else {
        // 如果弹窗被拦截，降级为下载 HTML 文件
        const blob = new Blob([data.html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = data.filename.replace(".pdf", ".html");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.info("请在浏览器中打开下载的 HTML 文件，使用 Ctrl+P 打印为 PDF");
      }
      toast.success("PDF 报表已生成，请在打印对话框中选择\"另存为 PDF\"");
      setExporting(false);
    },
    onError: (err) => {
      toast.error(`导出失败：${err.message}`);
      setExporting(false);
    },
  });

  const handleExportExcel = () => {
    setExporting(true);
    const params: { college?: string } = {};
    if (collegeFilter !== "all") params.college = collegeFilter;
    exportExcelMutation.mutate(params);
  };

  const handleExportPdf = () => {
    setExporting(true);
    const params: { college?: string } = {};
    if (collegeFilter !== "all") params.college = collegeFilter;
    exportPdfMutation.mutate(params);
  };

  const filtered = evaluations?.filter((e) => {
    const course = (e as any).course;
    const supervisor = (e as any).supervisor;
    const matchSearch = !search ||
      course?.courseName?.includes(search) ||
      course?.teacher?.includes(search) ||
      supervisor?.name?.includes(search);
    const matchStatus = statusFilter === "all" || e.status === statusFilter;
    const matchCollege = collegeFilter === "all" || course?.college === collegeFilter;
    return matchSearch && matchStatus && matchCollege;
  }) || [];

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5 page-transition">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "oklch(0.18 0.025 240)" }}>
              {canViewAll ? "全部评价记录" : "我的评价记录"}
            </h1>
            <p className="text-sm mt-0.5" style={{ color: "oklch(0.52 0.025 240)" }}>
              共 {filtered.length} 条评价记录
            </p>
          </div>

          {/* 导出报表按钮 */}
          {canExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={exporting}
                  style={{ borderColor: "oklch(0.35 0.13 245)", color: "oklch(0.35 0.13 245)" }}
                >
                  <Download className="w-4 h-4" />
                  {exporting ? "导出中..." : "导出报表"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleExportExcel} className="gap-2 cursor-pointer">
                  <FileSpreadsheet className="w-4 h-4" style={{ color: "oklch(0.50 0.18 145)" }} />
                  <div>
                    <div className="text-sm font-medium">导出 Excel</div>
                    <div className="text-xs" style={{ color: "oklch(0.55 0.02 240)" }}>全部记录合并表格</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportPdf} className="gap-2 cursor-pointer">
                  <FileText className="w-4 h-4" style={{ color: "oklch(0.55 0.20 25)" }} />
                  <div>
                    <div className="text-sm font-medium">导出 PDF</div>
                    <div className="text-xs" style={{ color: "oklch(0.55 0.02 240)" }}>复刻评价表单格式</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* 筛选 */}
        <div className="bg-white rounded-xl p-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4" style={{ color: "oklch(0.35 0.13 245)" }} />
            <span className="text-sm font-medium" style={{ color: "oklch(0.30 0.04 240)" }}>筛选</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="搜索课程/教师/督导专家" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-xs" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="评价状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="submitted">已提交</SelectItem>
              </SelectContent>
            </Select>
            {canViewAll && (
              <Select value={collegeFilter} onValueChange={setCollegeFilter}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="选择学院" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部学院</SelectItem>
                  {colleges?.map((c) => <SelectItem key={c} value={c || ""}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* 评价列表 */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white rounded-xl" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <ClipboardList className="w-12 h-12" style={{ color: "oklch(0.75 0.02 240)" }} />
            <p className="text-sm" style={{ color: "oklch(0.52 0.025 240)" }}>暂无评价记录</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((evaluation) => {
              const course = (evaluation as any).course;
              const supervisor = (evaluation as any).supervisor;
              const status = STATUS_LABELS[evaluation.status] || STATUS_LABELS.draft;
              const isOwn = evaluation.supervisorId === user?.id;

              const isOrphan = !(evaluation as any).course;
              return (
                <div key={evaluation.id} className="bg-white rounded-xl p-5 transition-all duration-200 hover:shadow-md" style={{ border: `1px solid ${isOrphan ? "oklch(0.85 0.08 50)" : "oklch(0.90 0.01 240)"}` }}>
                  {/* 孤立评价警告横幅 */}
                  {isOrphan && (
                    <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "oklch(0.97 0.04 50)", color: "oklch(0.50 0.12 50)", border: "1px solid oklch(0.88 0.07 50)" }}>
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>课程信息缺失：该评价记录未关联到有效课程，请联系管理员处理</span>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-semibold text-sm" style={{ color: isOrphan ? "oklch(0.50 0.12 50)" : "oklch(0.18 0.025 240)" }}>
                          {course?.courseName || "（课程信息缺失）"}
                        </h3>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: status.bg, color: status.color }}>
                          {status.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-3 text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>
                        {course?.teacher && <span>主讲：{course.teacher}</span>}
                        {course?.college && <span className="truncate max-w-[200px]">{course.college}</span>}
                        {canViewAll && supervisor && <span className="font-medium" style={{ color: "oklch(0.35 0.13 245)" }}>督导：{supervisor.name}</span>}
                      </div>

                      {/* 评分展示 */}
                      {evaluation.overallScore && (
                        <div className="flex items-center gap-1 mt-2">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className="w-3.5 h-3.5" fill={i < evaluation.overallScore! ? "oklch(0.72 0.14 85)" : "none"} style={{ color: "oklch(0.72 0.14 85)" }} />
                          ))}
                          <span className="text-xs ml-1" style={{ color: "oklch(0.52 0.025 240)" }}>总体评分 {(evaluation.overallScore || 0).toFixed(1)}/5</span>
                        </div>
                      )}

                      <p className="text-xs mt-2" style={{ color: "oklch(0.65 0.02 240)" }}>
                        {evaluation.listenDate ? `听课日期：${formatDateOnlyBJ(evaluation.listenDate)}` : ""}
                        {evaluation.actualWeek ? ` · 第${evaluation.actualWeek}周` : ""}
                        {" · "}提交于 {formatDateBJ(evaluation.createdAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap justify-end">
                      <Button size="sm" variant="outline" className="h-8 px-2 sm:px-3 gap-1 text-xs" title="查看评价详情" onClick={() => navigate(`/evaluations/${evaluation.id}`)}>
                        <Eye className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">查看</span>
                      </Button>
                      {canEdit && isOwn && (
                        <Button size="sm" variant="outline" className="h-8 px-2 sm:px-3 gap-1 text-xs" title={evaluation.status === 'draft' ? '继续完成评价' : '修改已提交的评价'} onClick={() => navigate(`/evaluations/${evaluation.id}/edit`)}>
                          <Edit className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{evaluation.status === 'draft' ? '继续评价' : '修改'}</span>
                        </Button>
                      )}
                      {canEdit && isOwn && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-8 px-2 sm:px-3 gap-1 text-xs text-destructive hover:text-destructive" title="删除评价">
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">删除</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认删除</AlertDialogTitle>
                              <AlertDialogDescription>此操作不可撤销，确定要删除这条评价记录吗？</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(evaluation.id)}>删除</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
