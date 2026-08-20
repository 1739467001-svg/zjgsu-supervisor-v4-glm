import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLocation, useParams } from "wouter";
import { ChevronLeft, Edit, Star, MapPin, Clock, User, Building2, Download, FileSpreadsheet, FileText } from "lucide-react";
import { formatDateOnlyBJ } from "@shared/dateUtils";
import { hasAnyRole } from "@shared/roles";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

// 与 EvaluationForm 完全一致的评分维度定义
const SCORE_SECTIONS = [
  {
    title: "一、教师风范",
    items: [
      { key: "score_teaching_content", label: "1. 教学行为合规性", description: "按课表准时上下课、不擅自调课、不久坐讲台、不长时间用视频代讲，无不当言论" },
      { key: "score_course_objective", label: "2. 课堂秩序管理", description: "有效提醒并营造学生前排就坐、合理使用电子设备的氛围" },
      { key: "score_reference_sharing", label: "3. 教学准备充分度", description: "教学材料、设备调试到位，呈现专业严谨性" },
      { key: "score_literature_humanities", label: "4. 前沿视野传递", description: "清晰关联教学内容与学科前沿、关键科研问题，体现研究生培养深度" },
      { key: "score_teaching_organization", label: "5. 教学感染力", description: "眼神、手势、语调自然得体，能吸引学生注意力，课堂氛围有效调动" },
    ],
  },
  {
    title: "二、学生状态",
    items: [
      { key: "score_course_development", label: "1. 到课率与准时率", description: "实际到课人数占比高，迟到、缺课现象少" },
      { key: "score_course_focus", label: "2. 课堂专注度", description: "学生抬头追随教学焦点、主动参与思考的比例与持续性强" },
      { key: "score_language_logic", label: "3. 设备使用合理性", description: "电子设备用于课程相关学习而非无关活动的程度" },
      { key: "score_interaction", label: "4. 互动响应率", description: "对教师提问或讨论邀请的响应积极性和广度" },
      { key: "score_learning_preparation", label: "5. 学习准备情况", description: "学生普遍携带相关资料、主动记录课堂笔记" },
    ],
  },
  {
    title: "三、课程内容",
    items: [
      { key: "score_teaching_quality", label: "1. 教学大纲贴合度", description: "严格按教学大纲授课，无擅自删减核心内容，教学进度合理" },
      { key: "score_active_response", label: "2. 深度与前沿性", description: "内容是否超越基础层面，融入最新研究进展与专业前沿动态" },
      { key: "score_student_centered", label: "3. 课件与案例质量", description: "PPT逻辑清晰、视觉辅助效果佳；案例典型时效强，具有启发性" },
      { key: "score_research_teaching", label: "4.1 科研转化融合度（学术学位课程）", description: "将自身科研成果或前沿课题有机转化为教学内容，助力学生科研思维培养", optional: true },
      { key: "score_learning_effect", label: "4.2 前沿视野传递（专业学位课程）", description: "清晰关联教学内容与学科前沿、行业创新、关键科研问题，体现研究生培养深度", optional: true },
      { key: "score_learning_task_design", label: "5. 学习任务设计（选填）", description: "阅读材料、课堂任务或课后作业具有一定挑战度，能引导学生深度思考与自主探究", optional: true },
    ],
  },
  {
    title: "四、教学过程",
    items: [
      { key: "score_interaction_quality", label: "1. 师生互动质量", description: "互动是否频繁、自然，并能激发学生思考。是否设计有效课堂互动环节（如讨论、探究、实操等），引导学生动手动脑" },
      { key: "score_method_diversity", label: "2. 教学方法多样性", description: "是否根据内容灵活运用研讨、案例分析等多种方法。是否进行创新性教学设计，采用多样化教学方法" },
      { key: "score_equal_dialogue", label: "3. 平等交流氛围", description: "是否主动营造安全、平等的氛围，鼓励学生提出不同观点" },
      { key: "score_pace_control", label: "4. 节奏调控能力", description: "能否根据学生现场反馈调整讲授速度与互动节奏" },
      { key: "score_feedback", label: "5. 即时反馈运用", description: "是否利用提问、小练习等方式即时诊断学习效果并回应" },
    ],
  },
];

function ScoreDisplay({ value, max = 5 }: { value?: number | null; max?: number }) {
  if (!value) return <span className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>未评分</span>;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <div key={i} className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium" style={{
            background: i < value ? "oklch(0.35 0.13 245)" : "oklch(0.93 0.01 240)",
            color: i < value ? "white" : "oklch(0.65 0.02 240)",
          }}>
            {i + 1}
          </div>
        ))}
      </div>
      <span className="text-xs font-medium ml-1" style={{ color: "oklch(0.35 0.13 245)" }}>{value}/{max}分</span>
    </div>
  );
}

export default function EvaluationDetail() {
  const params = useParams();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const evalId = parseInt(params.id || "0");
  const { data: evaluation, isLoading, error } = trpc.evaluations.getById.useQuery(evalId, { enabled: evalId > 0 });
  const canEdit = hasAnyRole(user, ["supervisor_expert", "supervisor_leader", "graduate_admin", "admin"]) && evaluation?.supervisorId === user?.id;
  const canExport =
    hasAnyRole(user, ["graduate_admin", "admin", "college_secretary", "supervisor_leader"]) ||
    (hasAnyRole(user, ["supervisor_expert"]) && evaluation?.supervisorId === user?.id);

  const exportExcelMutation = trpc.evaluations.exportSingleToExcel.useMutation({
    onSuccess: (data) => {
      const bytes = Uint8Array.from(atob(data.buffer), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Excel 导出成功！");
    },
    onError: (err) => toast.error(err.message),
  });

  const handlePrint = () => {
    window.open(`/api/print/evaluation/${evalId}`, '_blank');
  };

  // Handle invalid ID
  if (evalId <= 0) {
    navigate('/evaluations', { replace: true });
    return null;
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  if (error || !evaluation) {
    navigate('/evaluations', { replace: true });
    return null;
  }

  const course = (evaluation as any).course;
  const supervisor = (evaluation as any).supervisor;

  // 计算各维度平均分（跳过 optional 且无值的项）
  const sectionAverages = SCORE_SECTIONS.map((section) => {
    const scores = section.items
      .map((item) => (evaluation as any)[item.key])
      .filter((s): s is number => s != null && s > 0);
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    return { title: section.title, avg };
  });

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto page-transition">
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => navigate('/evaluations')} className="flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity" style={{ color: "oklch(0.35 0.13 245)" }}>
            <ChevronLeft className="w-4 h-4" />返回
          </button>
          <div className="flex items-center gap-2">
            {canExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={exportExcelMutation.isPending}>
                    <Download className="w-4 h-4 mr-1.5" />
                    {exportExcelMutation.isPending ? "导出中..." : "导出记录"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportExcelMutation.mutate({ evalId })}>
                    <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600" />
                    导出 Excel
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handlePrint}>
                    <FileText className="w-4 h-4 mr-2 text-red-500" />
                    打印 / 导出 PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/evaluations/${evalId}/edit`)}>
                <Edit className="w-4 h-4 mr-1.5" />
                {evaluation?.status === "submitted" ? "修改评价" : "继续评价"}
              </Button>
            )}
          </div>
        </div>

        {/* 课程信息 */}
        <div className="bg-white rounded-xl p-5 mb-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h1 className="text-lg font-bold" style={{ color: "oklch(0.18 0.025 240)" }}>{course?.courseName || "未知课程"}</h1>
              <div className="flex flex-wrap gap-3 mt-2 text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>
                {course?.teacher && <span className="flex items-center gap-1"><User className="w-3 h-3" />{course.teacher}</span>}
                {course?.college && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{course.college}</span>}
                {course?.campus && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{course.campus}</span>}
                {course?.weekday && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{course.weekday} {course.period}</span>}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              {evaluation.overallScore && (
                <>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className="w-4 h-4" fill={i < evaluation.overallScore! ? "oklch(0.72 0.14 85)" : "none"} style={{ color: "oklch(0.72 0.14 85)" }} />
                    ))}
                  </div>
                  <p className="text-xs mt-1" style={{ color: "oklch(0.52 0.025 240)" }}>总体 {(evaluation.overallScore || 0).toFixed(1)}/5</p>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 pt-4 text-xs" style={{ borderTop: "1px solid oklch(0.93 0.006 240)" }}>
            <div><span style={{ color: "oklch(0.52 0.025 240)" }}>督导专家：</span><span className="font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>{supervisor?.name || "-"}</span></div>
            <div><span style={{ color: "oklch(0.52 0.025 240)" }}>听课日期：</span><span className="font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>{evaluation.listenDate ? formatDateOnlyBJ(evaluation.listenDate) : "-"}</span></div>
            <div><span style={{ color: "oklch(0.52 0.025 240)" }}>实际周次：</span><span className="font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>{evaluation.actualWeek ? `第${evaluation.actualWeek}周` : "-"}</span></div>
            <div><span style={{ color: "oklch(0.52 0.025 240)" }}>评价状态：</span>
              <span className="font-medium px-1.5 py-0.5 rounded-full text-xs" style={{
                background: evaluation.status === "submitted" ? "oklch(0.93 0.018 160)" : "oklch(0.93 0.01 240)",
                color: evaluation.status === "submitted" ? "oklch(0.42 0.14 160)" : "oklch(0.52 0.025 240)",
              }}>
                {evaluation.status === "submitted" ? "已提交" : "草稿"}
              </span>
            </div>
          </div>
        </div>

        {/* 各维度评分概览 */}
        <div className="bg-white rounded-xl p-5 mb-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>各维度评分概览</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {sectionAverages.map(({ title, avg }) => (
              <div key={title} className="text-center p-3 rounded-lg" style={{ background: "oklch(0.97 0.004 240)" }}>
                <div className="text-xl font-bold mb-1" style={{ color: avg ? "oklch(0.35 0.13 245)" : "oklch(0.65 0.02 240)" }}>
                  {avg ? avg.toFixed(1) : "-"}
                </div>
                <div className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>{title.replace(/[一二三四五六七八九十]、/, "")}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 定量评分详情 - 与填写表单结构完全一致 */}
        {SCORE_SECTIONS.map((section) => (
          <div key={section.title} className="bg-white rounded-xl p-5 mb-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <h3 className="text-sm font-bold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>{section.title}</h3>
            <div className="space-y-0">
              {section.items.map((item, idx) => {
                const score = (evaluation as any)[item.key];
                // 4.1 和 4.2 二选一：只显示有值的那项
                if (item.key === 'score_research_teaching' || item.key === 'score_learning_effect') {
                  if (!score) return null;
                  return (
                    <div key={item.key} className="py-3" style={{ borderBottom: idx < section.items.length - 1 ? "1px solid oklch(0.93 0.006 240)" : "none" }}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "oklch(0.93 0.018 240)", color: "oklch(0.35 0.13 245)", fontSize: "10px" }}>已选</span>
                            <span className="text-sm font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>{item.label}</span>
                          </div>
                          {item.description && <p className="text-xs mt-1 leading-relaxed ml-8" style={{ color: "oklch(0.55 0.02 240)" }}>{item.description}</p>}
                        </div>
                      </div>
                      <div className="ml-8">
                        <ScoreDisplay value={score} max={5} />
                      </div>
                    </div>
                  );
                }
                // 选填项无值时跳过
                if ((item as any).optional && !score) return null;
                return (
                  <div key={item.key} className="py-3" style={{ borderBottom: idx < section.items.length - 1 ? "1px solid oklch(0.93 0.006 240)" : "none" }}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1">
                        <span className="text-sm font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>{item.label}</span>
                        {item.description && <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "oklch(0.55 0.02 240)" }}>{item.description}</p>}
                      </div>
                    </div>
                    <ScoreDisplay value={score} max={5} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* 二、课程亮点与评价 */}
        <div className="bg-white rounded-xl p-5 mb-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <h3 className="text-sm font-bold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>二、课程亮点与评价</h3>
          <div className="space-y-4">
            {[
              { key: "highlights", label: "最突出的教学亮点", required: true },
              { key: "suggestions", label: "存在不足与提升建议", required: true },
            ].map(({ key, label, required }) => (
              <div key={key}>
                <h4 className="text-sm font-medium mb-2" style={{ color: "oklch(0.20 0.025 240)" }}>
                  {label}{required && <span className="text-red-500 ml-0.5">*</span>}
                </h4>
                <div className="p-3 rounded-lg text-sm leading-relaxed" style={{ background: "oklch(0.97 0.004 240)", color: "oklch(0.25 0.025 240)", minHeight: "60px", whiteSpace: "pre-wrap" }}>
                  {(evaluation as any)[key] || <span style={{ color: "oklch(0.65 0.02 240)" }}>未填写</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 三、其他建议（可填） */}
        {((evaluation as any).improvement_suggestion || (evaluation as any).development_suggestion) && (
          <div className="bg-white rounded-xl p-5 mb-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <h3 className="text-sm font-bold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>三、其他建议（可填）</h3>
            <div className="space-y-4">
              {[
                { key: "improvement_suggestion", label: "综合改进建议" },
                { key: "development_suggestion", label: "发展与支持建议" },
              ].map(({ key, label }) => {
                const val = (evaluation as any)[key];
                if (!val) return null;
                return (
                  <div key={key}>
                    <h4 className="text-sm font-medium mb-2" style={{ color: "oklch(0.20 0.025 240)" }}>
                      {label}<span className="text-xs ml-1" style={{ color: "oklch(0.65 0.02 240)" }}>(选填)</span>
                    </h4>
                    <div className="p-3 rounded-lg text-sm leading-relaxed" style={{ background: "oklch(0.97 0.004 240)", color: "oklch(0.25 0.025 240)", minHeight: "50px", whiteSpace: "pre-wrap" }}>
                      {val}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
