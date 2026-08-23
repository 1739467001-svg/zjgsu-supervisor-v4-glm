import { useState, useEffect, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";
import { ChevronLeft, Save, Send, Star } from "lucide-react";
import { useSemester } from "@/hooks/useSemester";
import { calculateWeekFromDate, calculateDateRangeFromWeek, getMinSelectableDate, getMaxSelectableDate, isValidFutureDate, getTodayBJ, formatTimeBJ } from "@shared/dateUtils";

// 评分按钮组件
function ScoreGroup({ value, onChange, max = 5 }: { value?: number; onChange: (v: number) => void; max?: number }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-medium transition-all duration-200"
          style={{
            borderColor: value === n ? "oklch(0.35 0.13 245)" : "oklch(0.80 0.04 240)",
            background: value === n ? "oklch(0.35 0.13 245)" : "white",
            color: value === n ? "white" : "oklch(0.52 0.025 240)",
          }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

// 评分项组件
function ScoreItem({ label, description, value, onChange, max = 5, required = false }: {
  label: string;
  description?: string;
  value?: number;
  onChange: (v: number) => void;
  max?: number;
  required?: boolean;
}) {
  return (
    <div className="space-y-2 py-3" style={{ borderBottom: "1px solid oklch(0.93 0.006 240)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <span className="text-sm font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </span>
          {description && <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "oklch(0.55 0.02 240)" }}>{description}</p>}
        </div>
        {value && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: "oklch(0.93 0.018 240)", color: "oklch(0.35 0.13 245)" }}>
            {value}/{max}分
          </span>
        )}
      </div>
      <ScoreGroup value={value} onChange={onChange} max={max} />
    </div>
  );
}


// 定量评分维度的标题和指标（与督导评价表格完全对应）
const EVALUATION_DIMENSIONS = {
  teacherBehavior: {
    title: "一、教师风范",
    items: [
      { key: "score_teaching_content", label: "1. 教学行为合规性", description: "按课表准时上下课、不擅自调课、不久坐讲台、不长时间用视频代讲，无不当言论" },
      { key: "score_course_objective", label: "2. 课堂秩序管理", description: "有效提醒并营造学生前排就坐、合理使用电子设备的氛围" },
      { key: "score_reference_sharing", label: "3. 教学准备充分度", description: "教学材料、设备调试到位，呈现专业严谨性" },
      { key: "score_literature_humanities", label: "4. 前沿视野传递", description: "清晰关联教学内容与学科前沿、关键科研问题，体现研究生培养深度" },
      { key: "score_teaching_organization", label: "5. 教学感染力", description: "眼神、手势、语调自然得体，能吸引学生注意力，课堂氛围有效调动" },
    ]
  },
  studentState: {
    title: "二、学生状态",
    items: [
      { key: "score_course_development", label: "1. 到课率与准时率", description: "实际到课人数占比高，迟到、缺课现象少" },
      { key: "score_course_focus", label: "2. 课堂专注度", description: "学生抬头追随教学焦点、主动参与思考的比例与持续性强" },
      { key: "score_language_logic", label: "3. 设备使用合理性", description: "电子设备用于课程相关学习而非无关活动的程度" },
      { key: "score_interaction", label: "4. 互动响应率", description: "对教师提问或讨论邀请的响应积极性和广度" },
      { key: "score_learning_preparation", label: "5. 学习准备情况", description: "学生普遍携带相关资料、主动记录课堂笔记" },
    ]
  },
  courseContent: {
    title: "三、课程内容",
    items: [
      { key: "score_teaching_quality", label: "1. 教学大纲贴合度", description: "严格按教学大纲授课，无擅自删减核心内容，教学进度合理" },
      { key: "score_active_response", label: "2. 深度与前沿性", description: "内容是否超越基础层面，融入最新研究进展与专业前沿动态" },
      { key: "score_student_centered", label: "3. 课件与案例质量", description: "PPT逻辑清晰、视觉辅助效果佳；案例典型时效强，具有启发性" },
      { key: "score_research_teaching", label: "4.1 科研转化融合度（学术学位课程）", description: "将自身科研成果或前沿课题有机转化为教学内容，助力学生科研思维培养" },
      { key: "score_learning_effect", label: "4.2 前沿视野传递（专业学位课程）", description: "清晰关联教学内容与学科前沿、行业创新、关键科研问题，体现研究生培养深度" },
      { key: "score_learning_task_design", label: "5. 学习任务设计（选填）", description: "阅读材料、课堂任务或课后作业具有一定挑战度，能引导学生深度思考与自主探究", optional: true },
    ]
  },
  teachingProcess: {
    title: "四、教学过程",
    items: [
      { key: "score_interaction_quality", label: "1. 师生互动质量", description: "互动是否频繁、自然，并能激发学生思考。是否设计有效课堂互动环节（如讨论、探究、实操等），引导学生动手动脑" },
      { key: "score_method_diversity", label: "2. 教学方法多样性", description: "是否根据内容灵活运用研讨、案例分析等多种方法。是否进行创新性教学设计，采用多样化教学方法" },
      { key: "score_equal_dialogue", label: "3. 平等交流氛围", description: "是否主动营造安全、平等的氛围，鼓励学生提出不同观点" },
      { key: "score_pace_control", label: "4. 节奏调控能力", description: "能否根据学生现场反馈调整讲授速度与互动节奏" },
      { key: "score_feedback", label: "5. 即时反馈运用", description: "是否利用提问、小练习等方式即时诊断学习效果并回应" },
    ]
  }
};

export default function EvaluationForm() {
  const [, navigate] = useLocation();
  const { courseId: courseIdStr } = useParams();
  // 学期起始日与周数来自服务端配置；加载完成前回退到默认值
  const { semester, weeks: WEEKS } = useSemester();
  
  // 编辑模式：路径包含 /edit 即为编辑模式（同步判断，避免异步问题）
  const isEditMode = window.location.pathname.includes('/edit');
  
  // 从 URL 路径中提取评价 ID（用于 /evaluations/:id/edit 路由）
  const pathEvalId = (() => {
    const match = window.location.pathname.match(/\/evaluations\/(\d+)/);
    return match ? parseInt(match[1]) : null;
  })();
  
  // 根据路由格式提取参数
  const courseId = !isEditMode && courseIdStr ? parseInt(courseIdStr) : null;
  const evalId = isEditMode ? pathEvalId : null;
  
  const actualEvalId = evalId || 0;
  const isEdit = !!actualEvalId && actualEvalId > 0;
  const isValidCourseId = courseId && courseId > 0;

  // 计算当天日期和对应周次的默认值
  const getTodayDefaults = () => {
    const today = getTodayBJ();
    const week = calculateWeekFromDate(today, semester);
    return { listenDate: today, actualWeek: week };
  };

  const todayDefaults = getTodayDefaults();

  const [form, setForm] = useState({
    listenDate: todayDefaults.listenDate,
    actualWeek: todayDefaults.actualWeek,
    score_teaching_content: undefined as number | undefined,
    score_course_objective: undefined as number | undefined,
    score_reference_sharing: undefined as number | undefined,
    score_literature_humanities: undefined as number | undefined,
    score_teaching_organization: undefined as number | undefined,
    score_course_development: undefined as number | undefined,
    score_course_focus: undefined as number | undefined,
    score_language_logic: undefined as number | undefined,
    score_interaction: undefined as number | undefined,
    score_learning_preparation: undefined as number | undefined,
    score_teaching_quality: undefined as number | undefined,
    score_active_response: undefined as number | undefined,
    score_student_centered: undefined as number | undefined,
    score_research_teaching: undefined as number | undefined,
    score_learning_effect: undefined as number | undefined,
    score_learning_task_design: undefined as number | undefined,
    score_interaction_quality: undefined as number | undefined,
    // 4.1 和 4.2 的选择标记：'academic' 表示选择 4.1（学术学位），'professional' 表示选择 4.2（专业学位）
    courseTypeChoice: undefined as 'academic' | 'professional' | undefined,
    score_method_diversity: undefined as number | undefined,
    score_equal_dialogue: undefined as number | undefined,
    score_pace_control: undefined as number | undefined,
    score_feedback: undefined as number | undefined,
    highlights: "",
    suggestions: "",
    improvement_suggestion: "",
    development_suggestion: "",
    dimension_suggestion: "",
    resource_suggestion: "",
    overallScore: undefined as number | undefined,
  });

  const { data: course } = trpc.courses.getById.useQuery(courseId || 0, { enabled: !!isValidCourseId });
  const { data: existingEval } = trpc.evaluations.getById.useQuery(evalId || 0, { enabled: isEdit });

  // 编辑模式下，用已有数据覆盖默认值
  const [hasLoadedEval, setHasLoadedEval] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null);
  useEffect(() => {
    if (isEdit && existingEval && !hasLoadedEval) {
      const evalData = existingEval as any;
      const listenDateStr = evalData.listenDate
        ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(evalData.listenDate))
        : todayDefaults.listenDate;
      setForm((prev) => ({
        ...prev,
        listenDate: listenDateStr,
        actualWeek: evalData.actualWeek || todayDefaults.actualWeek,
        score_teaching_content: evalData.score_teaching_content || undefined,
        score_course_objective: evalData.score_course_objective || undefined,
        score_reference_sharing: evalData.score_reference_sharing || undefined,
        score_literature_humanities: evalData.score_literature_humanities || undefined,
        score_teaching_organization: evalData.score_teaching_organization || undefined,
        score_course_development: evalData.score_course_development || undefined,
        score_course_focus: evalData.score_course_focus || undefined,
        score_language_logic: evalData.score_language_logic || undefined,
        score_interaction: evalData.score_interaction || undefined,
        score_learning_preparation: evalData.score_learning_preparation || undefined,
        score_teaching_quality: evalData.score_teaching_quality || undefined,
        score_active_response: evalData.score_active_response || undefined,
        score_student_centered: evalData.score_student_centered || undefined,
        score_research_teaching: evalData.score_research_teaching || undefined,
        score_learning_effect: evalData.score_learning_effect || undefined,
        score_learning_task_design: evalData.score_learning_task_design || undefined,
        // 根据哪个字段有值来推断 courseTypeChoice
        courseTypeChoice: evalData.score_research_teaching ? 'academic' : (evalData.score_learning_effect ? 'professional' : undefined),
        score_interaction_quality: evalData.score_interaction_quality || undefined,
        score_method_diversity: evalData.score_method_diversity || undefined,
        score_equal_dialogue: evalData.score_equal_dialogue || undefined,
        score_pace_control: evalData.score_pace_control || undefined,
        score_feedback: evalData.score_feedback || undefined,
        highlights: evalData.highlights || "",
        suggestions: evalData.suggestions || "",
        improvement_suggestion: evalData.improvement_suggestion || "",
        development_suggestion: evalData.development_suggestion || "",
        dimension_suggestion: evalData.dimension_suggestion || "",
        resource_suggestion: evalData.resource_suggestion || "",
        overallScore: evalData.overallScore || undefined,
      }));
      setHasLoadedEval(true);
    }
  }, [isEdit, existingEval, hasLoadedEval]);

  // 学期配置是异步取回的，首屏用的是默认值。若此时用户尚未改动过日期，
  // 需按真实学期重算默认周次，否则新学期下会显示上一学期的周次。
  const semesterStartRef = useRef(semester.startDate);
  useEffect(() => {
    if (semesterStartRef.current === semester.startDate) return;
    semesterStartRef.current = semester.startDate;
    if (isEdit) return;
    setForm((p) =>
      p.listenDate === todayDefaults.listenDate
        ? { ...p, actualWeek: calculateWeekFromDate(p.listenDate, semester) }
        : p
    );
  }, [semester.startDate, semester.totalWeeks, isEdit, todayDefaults.listenDate]);

  const minDate = getMinSelectableDate(semester);
  const maxDate = getMaxSelectableDate(semester);

  const utils = trpc.useUtils();

  // 用 ref 记录手动操作的目标状态，供 mutation onSuccess 使用
  const pendingActionRef = useRef<'draft' | 'submitted' | null>(null);
  // 用 ref 持有最新 form 数据，供自动保存使用（避免闭包过期）
  const formRef = useRef(form);
  formRef.current = form;
  // 用 ref 持有最新 existingEval，供自动保存闭包使用（避免闭包捕获初始 undefined）
  const existingEvalRef = useRef<any>(null);
  existingEvalRef.current = existingEval ?? null;

  const createMutation = trpc.evaluations.create.useMutation({
    onSuccess: (data) => {
      utils.evaluations.myEvaluations.invalidate();
      utils.evaluations.allEvaluations.invalidate();
      utils.plans.myPlans.invalidate();
      if ((data as any)?.id && (data as any)?.status === 'draft') {
        toast.success("草稿已保存！");
        navigate(`/evaluations/${(data as any).id}/edit`);
      } else {
        toast.success("评价已提交！");
        navigate("/evaluations");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // 手动保存/提交专用 mutation
  const updateMutation = trpc.evaluations.update.useMutation({
    onSuccess: () => {
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      // 强制刷新所有相关缓存，确保查看时是最新数据
      utils.evaluations.myEvaluations.invalidate();
      utils.evaluations.allEvaluations.invalidate();
      if (actualEvalId > 0) {
        utils.evaluations.getById.invalidate(actualEvalId);
      }
      if (action === 'draft') {
        toast.success("草稿已保存！");
        navigate("/evaluations");
      } else if (action === 'submitted') {
        toast.success("评价已提交！");
        navigate("/evaluations");
      }
    },
    onError: (err) => {
      pendingActionRef.current = null;
      toast.error(err.message);
    },
  });

  // 自动保存专用 mutation（独立，不影响手动保存状态）
  const autoSaveMutation = trpc.evaluations.update.useMutation({
    onSuccess: () => {
      setAutoSaveStatus('saved');
      setLastSavedTime(new Date());
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    },
    onError: () => {
      setAutoSaveStatus('idle');
    },
  });

  const getResolvedCourseId = () => {
    const existingCourseId = (existingEval as any)?.courseId || 0;
    return courseId || existingCourseId;
  };
  // 供自动保存闭包使用的版本（通过 ref 读取，避免闭包过期）
  const getResolvedCourseIdFromRef = () => {
    const existingCourseId = existingEvalRef.current?.courseId || 0;
    return courseId || existingCourseId;
  };

  const hasValidResolvedCourse = () => getResolvedCourseId() > 0;

  // 自动保存草稿 - 每30秒保存一次
  useEffect(() => {
    if (!isEdit) return;
    
    const autoSaveInterval = setInterval(() => {
      // 如果手动操作正在进行中，跳过自动保存
      if (pendingActionRef.current) return;
      setAutoSaveStatus('saving');
      const currentForm = formRef.current;
      // 使用 ref 版本读取 courseId，避免闭包捕获初始 undefined 的 existingEval
      const resolvedCourseId = getResolvedCourseIdFromRef();
      if (resolvedCourseId <= 0) {
        setAutoSaveStatus('idle');
        return;
      }
      // 保留当前评价的实际状态（已提交的记录在被打开编辑时不应被自动保存悄悄改回草稿）
      const currentStatus = (existingEvalRef.current?.status as 'draft' | 'submitted' | undefined) || 'draft';
      const payload = { ...currentForm, courseId: resolvedCourseId, status: currentStatus };
      autoSaveMutation.mutate({ id: actualEvalId, data: payload as any });
    }, 30000);
    
    return () => clearInterval(autoSaveInterval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, actualEvalId]);

  // 计算综合评分 - 所有20个定量指标的平均值
  const calculateOverallScore = (formData: typeof form): number | undefined => {
    const scoreKeys = [
      'score_teaching_content', 'score_course_objective', 'score_reference_sharing', 'score_literature_humanities', 'score_teaching_organization',
      'score_course_development', 'score_course_focus', 'score_language_logic', 'score_interaction', 'score_learning_preparation',
      'score_teaching_quality', 'score_active_response', 'score_student_centered', 'score_research_teaching', 'score_learning_effect',
      'score_learning_task_design',
      'score_interaction_quality', 'score_method_diversity', 'score_equal_dialogue', 'score_pace_control', 'score_feedback'
    ];
    
    const scores = scoreKeys.map(key => (formData as any)[key]).filter((s): s is number => s != null);
    if (scores.length === 0) return undefined;
    
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    return Math.round(average * 10) / 10; // 保留一位小数
  };

  const setScore = (key: string) => (value: number) => {
    setForm((prev) => {
      const updated = { ...prev, [key]: value };
      // 自动计算综合评分（如果用户未手动设置）
      const calculatedScore = calculateOverallScore(updated);
      // 只在用户未手动设置时才自动更新
      if (!updated.overallScore || updated.overallScore === form.overallScore) {
        updated.overallScore = calculatedScore;
      }
      return updated;
    });
  };

  // 处理听课日期变化 - 自动计算周次
  const handleListenDateChange = (date: string) => {
    if (!isValidFutureDate(date, semester)) {
      toast.error("请选择本学期范围内的日期");
      return;
    }

    const week = calculateWeekFromDate(date, semester);
    setForm((p) => ({ ...p, listenDate: date, actualWeek: week }));
  };

  // 处理周次变化 - 自动计算日期范围
  const handleWeekChange = (weekStr: string) => {
    if (weekStr === "none") {
      setForm((p) => ({ ...p, actualWeek: undefined }));
      return;
    }
    
    const week = parseInt(weekStr);
    const dateRange = calculateDateRangeFromWeek(week, semester);
    if (dateRange) {
      setForm((p) => ({ ...p, actualWeek: week, listenDate: dateRange.startDate }));
    }
  };

  // 验证表单是否完整
  const validateForm = (status: "draft" | "submitted"): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];

    // 如果是提交状态，检查所有必填项
    if (status === "submitted") {
      // 检查必填的文本字段（二、三部分的红色星号项）
      const trimmedHighlights = form.highlights.trim();
      const trimmedSuggestions = form.suggestions.trim();
      const trimmedImprovement = form.improvement_suggestion.trim();
      const trimmedDevelopment = form.development_suggestion.trim();
      const trimmedDimension = form.dimension_suggestion.trim();

      if (!trimmedHighlights) {
        errors.push("请填写最突出的教学亮点");
      }
      if (!trimmedSuggestions) {
        errors.push("请填写存在不足与提升建议");
      }
    }

    return { valid: errors.length === 0, errors };
  };

  const handleSubmit = (status: "draft" | "submitted") => {
    const resolvedCourseId = getResolvedCourseId();
    if (resolvedCourseId <= 0) {
      toast.error("请先选择有效课程后再保存评价");
      return;
    }

    // 如果是提交状态，进行验证
    if (status === "submitted") {
      const validation = validateForm(status);
      if (!validation.valid) {
        validation.errors.forEach((error) => toast.error(error));
        return;
      }
    }

    const payload = { ...form, courseId: resolvedCourseId, status };
    if (isEdit) {
      // 记录操作意图，供 mutation onSuccess 使用
      pendingActionRef.current = status;
      updateMutation.mutate({ id: actualEvalId, data: payload as any });
    } else {
      createMutation.mutate(payload as any);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  // 检查提交按钮是否应该被禁用
  const isSubmitDisabled = () => {
    if (isPending) return true;
    if (!hasValidResolvedCourse()) return true;
    const validation = validateForm("submitted");
    return !validation.valid;
  };
  const targetCourse = course || (existingEval as any)?.course;

  if (!isEdit && !isValidCourseId) {
    navigate('/evaluations', { replace: true });
    return null;
  }

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto page-transition">
        {/* 表单头部 - 返回按针和保存状态 */}
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => navigate(isEditMode ? '/evaluations' : -1 as any)} className="flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity" style={{ color: "oklch(0.35 0.13 245)" }}>
            <ChevronLeft className="w-4 h-4" />返回
          </button>
          
          {/* 保存状态指示器 */}
          {isEdit && (
            <div className="flex items-center gap-2 text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>
              {autoSaveStatus === 'saving' && (
                <>
                  <div className="w-3 h-3 rounded-full border-2 border-transparent border-t-current animate-spin" />
                  <span>正在保存...</span>
                </>
              )}
              {autoSaveStatus === 'saved' && (
                <>
                  <div className="w-3 h-3 rounded-full" style={{ background: "oklch(0.42 0.14 160)" }} />
                  <span>已保存</span>
                  {lastSavedTime && (
                    <span style={{ color: "oklch(0.65 0.02 240)" }}>
                      于 {formatTimeBJ(lastSavedTime)}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 课程信息卡片 */}
        <div className="bg-white rounded-xl p-5 mb-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h2 className="text-base font-bold" style={{ color: "oklch(0.18 0.025 240)" }}>
                {targetCourse?.courseName || "课程评价"}
              </h2>
              <div className="flex flex-wrap gap-3 mt-2 text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>
                {targetCourse?.teacher && <span>主讲：{targetCourse.teacher}</span>}
                {targetCourse?.college && <span>院系：{targetCourse.college}</span>}
                {targetCourse?.campus && <span>校区：{targetCourse.campus}</span>}
              </div>
              
              {/* 课程详细信息网格 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-4 pt-4" style={{ borderTop: "1px solid oklch(0.93 0.006 240)" }}>
                {/* 课程性质 */}
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: "oklch(0.52 0.025 240)" }}>课程性质</p>
                  {targetCourse?.courseType ? (
                    <div className="inline-block px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: "oklch(0.93 0.018 240)", color: "oklch(0.35 0.13 245)" }}>
                      {targetCourse.courseType}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>—</p>
                  )}
                </div>

                {/* 教室名称 */}
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: "oklch(0.52 0.025 240)" }}>教室名称</p>
                  <p className="text-xs" style={{ color: "oklch(0.20 0.025 240)" }}>
                    {targetCourse?.classroom || "—"}
                  </p>
                </div>

                {/* 学生专业 */}
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: "oklch(0.52 0.025 240)" }}>学生专业</p>
                  <p className="text-xs break-words" style={{ color: "oklch(0.20 0.025 240)" }}>
                    {targetCourse?.studentMajor ? (
                      <span className="line-clamp-2">{targetCourse.studentMajor}</span>
                    ) : (
                      "—"
                    )}
                  </p>
                </div>

                {/* 所选人数 */}
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: "oklch(0.52 0.025 240)" }}>所选人数</p>
                  <p className="text-xs font-semibold" style={{ color: "oklch(0.35 0.13 245)" }}>
                    {targetCourse?.studentCount ?? "—"}
                  </p>
                </div>

                {/* 班级编号 */}
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: "oklch(0.52 0.025 240)" }}>班级编号</p>
                  <p className="text-xs" style={{ color: "oklch(0.20 0.025 240)" }}>
                    {targetCourse?.classId || "—"}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {form.overallScore ? Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="w-4 h-4" fill={i < (form.overallScore || 0) ? "oklch(0.72 0.14 85)" : "none"} style={{ color: "oklch(0.72 0.14 85)" }} />
              )) : null}
            </div>
          </div>

          {/* 听课基本信息 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 pt-4" style={{ borderTop: "1px solid oklch(0.93 0.006 240)" }}>
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>听课日期</Label>
              <Input type="date" value={form.listenDate} onChange={(e) => handleListenDateChange(e.target.value)} min={minDate} max={maxDate} className="h-8 text-xs" />
              <p className="text-xs mt-0.5" style={{ color: "oklch(0.65 0.02 240)" }}>周次：第{form.actualWeek || "—"}周</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>实际周次</Label>
              <Select value={form.actualWeek?.toString() || "none"} onValueChange={handleWeekChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="选择周次" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未指定</SelectItem>
                  {WEEKS.map((w) => <SelectItem key={w} value={w.toString()}>第{w}周</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>综合评分</Label>
              <div className="flex gap-1 mt-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, overallScore: i + 1 }))}
                    className="flex-1 h-8 rounded transition-all"
                    style={{
                      background: form.overallScore && i < form.overallScore ? "oklch(0.72 0.14 85)" : "oklch(0.93 0.018 240)",
                      color: form.overallScore && i < form.overallScore ? "white" : "oklch(0.52 0.025 240)",
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              {(() => {
                const calculated = calculateOverallScore(form);
                return calculated ? (
                  <p className="text-xs mt-1" style={{ color: "oklch(0.52 0.025 240)" }}>
                    自动计算: {calculated.toFixed(1)} 分
                  </p>
                ) : null;
              })()}
            </div>
          </div>
        </div>

        {/* 定量评分部分 */}
        {Object.entries(EVALUATION_DIMENSIONS).map(([key, dimension]) => {
          // 特殊处理“三、课程内容”部分，处理 4.1 和 4.2 的二选一
          if (key === 'courseContent') {
            return (
              <div key={key} className="bg-white rounded-xl p-5 mb-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
                <h3 className="text-sm font-bold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>
                  {dimension.title}
                </h3>
                {dimension.items.map((item, idx) => {
                  // 处理 4.1 和 4.2 的二选一逻辑
                  if (item.key === 'score_research_teaching' || item.key === 'score_learning_effect') {
                    const isAcademic = item.key === 'score_research_teaching';
                    const isSelected = isAcademic ? form.courseTypeChoice === 'academic' : form.courseTypeChoice === 'professional';
                    
                    return (
                      <div
                        key={item.key}
                        className="space-y-2 py-3 cursor-pointer rounded-lg p-3 transition-colors"
                        style={{
                          borderBottom: idx < dimension.items.length - 1 ? "1px solid oklch(0.93 0.006 240)" : "none",
                          background: isSelected ? "oklch(0.95 0.01 245)" : "transparent",
                        }}
                        onClick={() => {
                          const newChoice = isAcademic ? 'academic' : 'professional';
                          setForm((prev) => {
                            const updated: typeof form = { ...prev, courseTypeChoice: newChoice as 'academic' | 'professional' | undefined };
                            // 清除未选中的一项
                            if (isAcademic) {
                              updated.score_learning_effect = undefined;
                            } else {
                              updated.score_research_teaching = undefined;
                            }
                            // 自动计算综合评分
                            const calculatedScore = calculateOverallScore(updated as typeof form);
                            if (!updated.overallScore || updated.overallScore === form.overallScore) {
                              updated.overallScore = calculatedScore;
                            }
                            return updated;
                          });
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="courseTypeChoice"
                                checked={isSelected}
                                onChange={() => {}}
                                className="w-4 h-4"
                              />
                              <span className="text-sm font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>
                                {item.label}
                              </span>
                            </div>
                            {item.description && <p className="text-xs mt-0.5 leading-relaxed ml-6" style={{ color: "oklch(0.55 0.02 240)" }}>{item.description}</p>}
                          </div>
                          {isSelected && form[item.key as keyof typeof form] && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: "oklch(0.93 0.018 240)", color: "oklch(0.35 0.13 245)" }}>
                              {form[item.key as keyof typeof form]}/5分
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <div className="ml-6 mt-2">
                            <ScoreGroup value={form[item.key as keyof typeof form] as number | undefined} onChange={setScore(item.key)} max={5} />
                          </div>
                        )}
                      </div>
                    );
                  }
                  
                  // 其他项目正常渲染
                  return (
                    <ScoreItem
                      key={item.key}
                      label={item.label}
                      description={item.description}
                      value={form[item.key as keyof typeof form] as number | undefined}
                      onChange={setScore(item.key)}
                    />
                  );
                })}
              </div>
            );
          }
          
          // 其他维度正常渲染
          return (
            <div key={key} className="bg-white rounded-xl p-5 mb-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
              <h3 className="text-sm font-bold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>
                {dimension.title}
              </h3>
              {dimension.items.map((item) => (
                <ScoreItem
                  key={item.key}
                  label={item.label}
                  description={item.description}
                  value={form[item.key as keyof typeof form] as number | undefined}
                  onChange={setScore(item.key)}
                />
              ))}
            </div>
          );
        })}

        {/* 二、课程亮点与评价 */}
        <div className="bg-white rounded-xl p-5 mb-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <h3 className="text-sm font-bold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>二、课程亮点与评价</h3>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>
                最突出的教学亮点 <span className="text-red-500">*</span>
              </Label>
              <Textarea
                placeholder="请描述本次课程最突出的教学亮点..."
                value={form.highlights}
                onChange={(e) => setForm((p) => ({ ...p, highlights: e.target.value }))}
                className="min-h-24 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>
                存在不足与提升建议 <span className="text-red-500">*</span>
              </Label>
              <Textarea
                placeholder="请描述课程存在的不足之处及改进建议..."
                value={form.suggestions}
                onChange={(e) => setForm((p) => ({ ...p, suggestions: e.target.value }))}
                className="min-h-24 text-sm"
              />
            </div>
          </div>
        </div>

                {/* 三、其他建议（可填） */}
        <div className="bg-white rounded-xl p-5 mb-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <h3 className="text-sm font-bold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>三、其他建议（可填）</h3>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>
                综合改进建议 <span className="text-gray-400">(选填)</span>
              </Label>
              <Textarea
                placeholder="针对课程教学内容、方式及评分维度的整体改进意见..."
                value={form.improvement_suggestion}
                onChange={(e) => setForm((p) => ({ ...p, improvement_suggestion: e.target.value }))}
                className="min-h-24 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>
                发展与支持建议 <span className="text-gray-400">(选填)</span>
              </Label>
              <Textarea
                placeholder="课程未来发展方向、所需资源或学校支持的建议..."
                value={form.development_suggestion}
                onChange={(e) => setForm((p) => ({ ...p, development_suggestion: e.target.value }))}
                className="min-h-24 text-sm"
              />
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-5">
          <Button
            variant="outline"
            onClick={() => handleSubmit("draft")}
            disabled={isPending}
            className="flex-1 h-10 sm:h-9"
          >
            <Save className="w-4 h-4 mr-2" />
            保存草稿
          </Button>
          <Button
            onClick={() => handleSubmit("submitted")}
            disabled={isSubmitDisabled()}
            className="flex-1 h-10 sm:h-9"
            style={{ background: isSubmitDisabled() ? "oklch(0.80 0.04 240)" : "oklch(0.35 0.13 245)", cursor: isSubmitDisabled() ? "not-allowed" : "pointer" }}
            title={isSubmitDisabled() ? "请完成所有必填项后再提交" : ""}
          >
            <Send className="w-4 h-4 mr-2" />
            提交评价
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
