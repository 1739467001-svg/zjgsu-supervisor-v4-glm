import XLSX from "xlsx";
import { CourseEvaluation } from "../drizzle/schema";
import { formatDateOnlyBJ, formatDateBJ } from "../shared/dateUtils";
import { getSupervisorRoleLabel } from "../shared/roles";

interface EvaluationExportData extends CourseEvaluation {
  course?: {
    courseName: string | null;
    teacher: string | null;
    college: string | null;
    campus: string | null;
    courseType: string | null;
    studentMajor?: string | null;
    classId?: string | null;
    weekday?: string | null;
    period?: string | null;
    studentCount?: number | null;
    classroom?: string | null;
  };
  supervisor?: {
    name: string | null;
    email: string | null;
    role?: string | null;
    college?: string | null;
  };
}

// ============================================================
// 评价维度定义（与前端 EvaluationForm 完全一致）
// ============================================================
const SCORE_DIMENSIONS = [
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
      { key: "score_research_teaching", label: "4.1 科研转化融合度（学术学位课程）", description: "将自身科研成果或前沿课题有机转化为教学内容" },
      { key: "score_learning_effect", label: "4.2 前沿视野传递（专业学位课程）", description: "清晰关联教学内容与学科前沿、行业创新" },
      { key: "score_learning_task_design", label: "5. 学习任务设计", description: "阅读材料、课堂任务或课后作业具有一定挑战度" },
    ],
  },
  {
    title: "四、教学过程",
    items: [
      { key: "score_interaction_quality", label: "1. 师生互动质量", description: "互动是否频繁、自然，并能激发学生思考" },
      { key: "score_method_diversity", label: "2. 教学方法多样性", description: "是否根据内容灵活运用研讨、案例分析等多种方法" },
      { key: "score_equal_dialogue", label: "3. 平等交流氛围", description: "是否主动营造安全、平等的氛围" },
      { key: "score_pace_control", label: "4. 节奏调控能力", description: "能否根据学生现场反馈调整讲授速度与互动节奏" },
      { key: "score_feedback", label: "5. 即时反馈运用", description: "是否利用提问、小练习等方式即时诊断学习效果并回应" },
    ],
  },
];

// Excel 列头映射（与维度定义一致）
const SCORE_COLUMNS = SCORE_DIMENSIONS.flatMap((dim) =>
  dim.items.map((item) => ({ key: item.key, label: item.label.replace(/^\d+(\.\d+)?[\.\s]+/, "") }))
);

const EXCEL_SHEET_NAME_MAX_LENGTH = 31;
const EXCEL_SHEET_NAME_INVALID_CHARS = /[\\/?*:[\]]/g;

function normalizeExcelSheetName(name: string): string {
  const sanitized = name.replace(EXCEL_SHEET_NAME_INVALID_CHARS, " ").trim();
  return sanitized.length > 0 ? sanitized : "未命名工作表";
}

function createUniqueExcelSheetName(name: string, usedNames: Set<string>): string {
  const baseName = normalizeExcelSheetName(name);
  const truncatedBase = baseName.slice(0, EXCEL_SHEET_NAME_MAX_LENGTH);

  if (!usedNames.has(truncatedBase)) {
    usedNames.add(truncatedBase);
    return truncatedBase;
  }

  let index = 2;
  while (true) {
    const suffix = ` (${index})`;
    const maxBaseLength = EXCEL_SHEET_NAME_MAX_LENGTH - suffix.length;
    const candidate = `${baseName.slice(0, maxBaseLength)}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    index += 1;
  }
}

// ============================================================
// Excel 导出：全部记录合并为一张数据表 + 一张专业汇总表
// ============================================================
export function generateEvaluationExcel(evaluations: EvaluationExportData[]): Buffer {
  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  // 只导出已提交的评价
  const submitted = evaluations.filter((e) => e.status === "submitted");

  // 如果没有数据，创建空表
  if (submitted.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([["暂无已提交的评价数据"]]);
    XLSX.utils.book_append_sheet(workbook, ws, createUniqueExcelSheetName("无数据", usedSheetNames));
    return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  }

  // 全部记录合并为一张数据表
  const rows = submitted.map((ev) => {
    const c = (ev as any).course || {};
    const s = (ev as any).supervisor || {};
    const row: Record<string, any> = {
      "课程名称": c.courseName || "—",
      "主讲教师": c.teacher || "—",
      "所属学院": c.college || "—",
      "课程性质": c.courseType || "—",
      "校区": c.campus || "—",
      "班级编号": c.classId || "—",
      "教室": c.classroom || "—",
      "上课时间": `${c.weekday || ""} ${c.period || ""}`.trim() || "—",
      "学生专业": c.studentMajor || "—",
      "学生人数": c.studentCount || "—",
      "督导专家": s.name || "—",
      "督导角色": getSupervisorRoleLabel(s),
      "听课日期": ev.listenDate ? formatDateOnlyBJ(ev.listenDate) : "—",
      "实际周次": ev.actualWeek ? `第${ev.actualWeek}周` : "—",
      "综合评分": ev.overallScore || "—",
    };
    // 添加所有评分维度列
    for (const col of SCORE_COLUMNS) {
      row[col.label] = (ev as any)[col.key] || "—";
    }
    // 文字评价
    row["教学亮点"] = ev.highlights || "—";
    row["不足与建议"] = ev.suggestions || "—";
    row["综合改进建议"] = ev.improvement_suggestion || "—";
    row["发展与支持建议"] = ev.development_suggestion || "—";
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // 设置列宽
  const colWidths: { wch: number }[] = [
    { wch: 22 }, // 课程名称
    { wch: 12 }, // 主讲教师
    { wch: 18 }, // 所属学院
    { wch: 12 }, // 课程性质
    { wch: 10 }, // 校区
    { wch: 14 }, // 班级编号
    { wch: 14 }, // 教室
    { wch: 14 }, // 上课时间
    { wch: 20 }, // 学生专业
    { wch: 10 }, // 学生人数
    { wch: 12 }, // 督导专家
    { wch: 16 }, // 督导角色
    { wch: 12 }, // 听课日期
    { wch: 10 }, // 实际周次
    { wch: 10 }, // 综合评分
  ];
  // 评分列
  for (let i = 0; i < SCORE_COLUMNS.length; i++) {
    colWidths.push({ wch: 14 });
  }
  // 文字评价列
  colWidths.push({ wch: 30 }, { wch: 30 }, { wch: 30 }, { wch: 30 });
  ws["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(workbook, ws, createUniqueExcelSheetName("评价数据", usedSheetNames));

  // 按学生专业分组，添加汇总 Sheet
  const majorMap = new Map<string, EvaluationExportData[]>();
  for (const ev of submitted) {
    const major = (ev as any).course?.studentMajor || "未分类专业";
    if (!majorMap.has(major)) majorMap.set(major, []);
    majorMap.get(major)!.push(ev);
  }
  const summaryRows = Array.from(majorMap.entries()).map(([major, evals]) => {
    const scores = evals.filter((e) => e.overallScore).map((e) => e.overallScore!);
    const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : "—";
    return {
      "专业": major,
      "评价总数": evals.length,
      "平均综合评分": avgScore,
      "最高分": scores.length > 0 ? Math.max(...scores).toFixed(1) : "—",
      "最低分": scores.length > 0 ? Math.min(...scores).toFixed(1) : "—",
    };
  });
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  summaryWs["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(workbook, summaryWs, createUniqueExcelSheetName("专业汇总", usedSheetNames));

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

// ============================================================
// PDF 导出：复刻督导评价表单（生成 HTML 转 PDF）
// ============================================================

function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br/>");
}

/**
 * 生成所有评价的 PDF HTML（每个评价一页）。
 *
 * 与单份打印路由 /api/print/evaluation/:id 共用同一套版式与打印样式：
 * 此前两条路径各写了一份（一份用 CSS 类、一份用内联样式），
 * 结果是修好一份、另一份照旧 —— 评分底色打印不出来的问题就是这么漏掉的。
 */
export function generateEvaluationPdfHtml(evaluations: EvaluationExportData[]): string {
  return generatePrintableHtml(evaluations);
}

/**
 * 调用 wkhtmltopdf 将评价 HTML 转为 PDF 二进制 Buffer
 */
export async function generateEvaluationPdfBuffer(evaluations: EvaluationExportData[]): Promise<Buffer> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const { writeFile, readFile, unlink } = await import("fs/promises");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const execFileAsync = promisify(execFile);
  const html = generateEvaluationPdfHtml(evaluations);
  const tmpHtml = join(tmpdir(), `eval_${Date.now()}.html`);
  const tmpPdf = join(tmpdir(), `eval_${Date.now()}.pdf`);
  try {
    await writeFile(tmpHtml, html, "utf-8");
    await execFileAsync("wkhtmltopdf", [
      "--encoding", "utf-8",
      "--page-size", "A4",
      "--margin-top", "15mm",
      "--margin-bottom", "15mm",
      "--margin-left", "12mm",
      "--margin-right", "12mm",
      "--enable-local-file-access",
      "--no-stop-slow-scripts",
      "--quiet",
      tmpHtml,
      tmpPdf,
    ], { timeout: 60000 });
    const pdfBuffer = await readFile(tmpPdf);
    return pdfBuffer;
  } finally {
    await unlink(tmpHtml).catch(() => {});
    await unlink(tmpPdf).catch(() => {});
  }
}

/**
 * 生成统计汇总 Excel 文件（保留兼容）
 */
export function generateStatisticsExcel(
  evaluations: EvaluationExportData[],
  colleges: string[]
): Buffer {
  const collegeStats = colleges.map((college) => {
    const collegeEvals = evaluations.filter((e) => (e as any).course?.college === college);
    const submitted = collegeEvals.filter((e) => e.status === "submitted").length;
    const avgScore =
      collegeEvals.length > 0
        ? (
            collegeEvals.reduce((sum, e) => sum + (e.overallScore || 0), 0) /
            collegeEvals.filter((e) => e.overallScore).length
          ).toFixed(2)
        : "—";

    return {
      "学院": college,
      "总课程数": collegeEvals.length,
      "已评价": submitted,
      "未评价": collegeEvals.length - submitted,
      "完成率": collegeEvals.length > 0 ? `${((submitted / collegeEvals.length) * 100).toFixed(1)}%` : "—",
      "平均评分": avgScore,
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(collegeStats);
  worksheet["!cols"] = [
    { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "统计汇总");

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

/**
 * 生成可在浏览器中直接打印的 HTML 页面（每份评价一页）
 * 用于 /api/print/evaluation/:id 路由，前端 window.open 打开后 Ctrl+P 打印
 */
export function generatePrintableHtml(evaluations: EvaluationExportData[]): string {
  const submitted = evaluations.filter((e) => e.status === "submitted");
  if (submitted.length === 0) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>督导评价表</title></head><body style="text-align:center;padding:60px;font-family:sans-serif;"><h2>暂无已提交的评价数据</h2></body></html>';
  }

  const CSS = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>浙江工商大学研究生课程督导评价表</title>
  <style>
    /*
     * 打印稳健性说明（老师们多数用激光打印机黑白打印）：
     * 1. 浏览器打印对话框里的「背景图形」默认是关闭的，所有 background 都会被丢掉。
     *    因此 print-color-adjust:exact 强制保留底色，且任何信息都不能只靠底色表达 ——
     *    绝不使用「深色底 + 白字」，否则底色一丢就是白纸上的白字，等于消失。
     * 2. 选中的分数用「粗深色圆环 + 加粗深色数字」标注，底色只是锦上添花：
     *    背景打不出来时仍然一眼可见，转成灰度也不会糊成一团。
     * 3. body.bw 为黑白模式，把所有色彩换成纯黑白灰，适合黑白激光打印。
     */
    :root {
      --ink: #003c78;        /* 主墨色：标题、选中分数、强调 */
      --ink-soft: #2c5282;   /* 次级墨色：分区标题 */
      --tint: #dce8f5;       /* 浅底色，仅作辅助 */
      --label-bg: #eef2f7;   /* 表格标签底色 */
      --rule: #7f8c99;       /* 表格线 */
      --rule-soft: #b0bec5;
      --muted: #555;         /* 说明文字 */
      --dot-off-line: #c5ccd4;
      --dot-off-text: #9aa5b1;
      --mark: #c0392b;       /* 必填星号 */
    }
    body.bw {
      --ink: #000;
      --ink-soft: #000;
      --tint: #e2e2e2;
      --label-bg: #ededed;
      --rule: #4a4a4a;
      --rule-soft: #6f6f6f;
      --muted: #3d3d3d;
      --dot-off-line: #b8b8b8;
      --dot-off-text: #8c8c8c;
      --mark: #000;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'SimSun','Microsoft YaHei','PingFang SC',Arial,sans-serif; font-size: 13px; color: #1a202c; background: #f5f5f5; padding: 20px; }
    .page { background: #fff; width: 210mm; min-height: 297mm; margin: 0 auto 30px auto; padding: 15mm 12mm; box-shadow: 0 2px 12px rgba(0,0,0,0.15); }
    .doc-title { text-align: center; border-bottom: 2px solid var(--ink); padding-bottom: 10px; margin-bottom: 14px; }
    .doc-title h1 { font-size: 18px; font-weight: bold; color: #1a202c; }
    .doc-title p { font-size: 12px; color: var(--muted); margin-top: 3px; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 12px; }
    .info-table td { border: 1px solid var(--rule-soft); padding: 5px 7px; }
    .info-table .label { background: var(--label-bg); font-weight: bold; width: 13%; white-space: nowrap; }
    .info-table .value { width: 37%; }
    /* 分区标题：深色字 + 粗左条 + 下划线，背景打不出来时依然醒目 */
    .section-header { font-size: 14px; font-weight: bold; color: var(--ink); background: var(--tint); padding: 5px 10px; margin: 12px 0 8px 0; border-left: 5px solid var(--ink); border-bottom: 1.5px solid var(--ink); letter-spacing: 0.5px; }
    .dim-header { font-size: 12px; font-weight: bold; color: var(--ink-soft); background: var(--label-bg); padding: 4px 8px; margin-bottom: 4px; border-left: 3px solid var(--ink-soft); }
    .score-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
    .score-table th, .score-table td { border: 1px solid var(--rule-soft); padding: 4px 6px; }
    .score-table th { background: var(--label-bg); font-weight: bold; }
    .col-indicator { width: 28%; font-weight: 500; }
    .col-desc { width: 45%; color: var(--muted); font-size: 10px; }
    .col-score { width: 27%; text-align: center; }
    .score-dot { display: inline-block; width: 20px; height: 20px; border-radius: 50%; font-size: 10px; text-align: center; margin-right: 2px; vertical-align: middle; }
    /* 未选中：细浅环 + 浅字，主动后退 */
    .score-dot.inactive { border: 1px solid var(--dot-off-line); background: #fff; color: var(--dot-off-text); line-height: 18px; font-weight: normal; }
    /* 选中：粗深环 + 加粗深字（不靠底色），浅底色只是锦上添花 */
    .score-dot.active { border: 2.5px solid var(--ink); background: var(--tint); color: var(--ink); line-height: 15px; font-weight: 800; }
    .score-label { font-size: 12px; font-weight: bold; color: var(--ink); margin-left: 5px; vertical-align: middle; }
    .text-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 12px; }
    .text-table td { border: 1px solid var(--rule-soft); padding: 6px 8px; }
    .text-table .label { background: var(--label-bg); font-weight: bold; width: 22%; vertical-align: top; }
    .text-table .value { line-height: 1.7; }
    .req { color: var(--mark); font-weight: bold; }
    .blank { color: var(--dot-off-text); font-size: 12px; }
    .sign-table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
    .sign-table td { border: 1px solid var(--rule-soft); padding: 8px; width: 50%; }
    .print-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 999; background: #2c5282; color: #fff; padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
    .print-bar .actions { display: flex; align-items: center; gap: 8px; }
    .print-bar .hint { font-size: 12px; opacity: 0.85; }
    /* 窗口变窄时收起说明文字，避免工具栏换行压住正文 */
    @media (max-width: 900px) { .print-bar .hint-long { display: none; } }
    .mode-group { display: inline-flex; border: 1px solid rgba(255,255,255,0.55); border-radius: 4px; overflow: hidden; }
    .mode-group button { background: transparent; color: #fff; border: none; padding: 5px 12px; font-size: 13px; cursor: pointer; }
    .mode-group button.on { background: #fff; color: #2c5282; font-weight: bold; }
    .print-bar .go { background: #fff; color: #2c5282; border: none; border-radius: 4px; padding: 6px 18px; font-size: 14px; font-weight: bold; cursor: pointer; }
    .print-bar .go:hover { background: #e8f0fb; }
    .content-wrap { margin-top: 60px; }
    @media print {
      @page { size: A4; margin: 15mm 12mm; }
      body { background: #fff; padding: 0; }
      .print-bar { display: none !important; }
      .content-wrap { margin-top: 0; }
      .page { box-shadow: none; margin: 0; padding: 0; width: 100%; min-height: auto; page-break-after: always; }
      .page:last-child { page-break-after: auto; }
      .score-table, .text-table, .info-table, .sign-table { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <span>浙江工商大学研究生课程督导评价表</span>
    <div class="actions">
      <span class="hint">打印方式：</span>
      <span class="mode-group">
        <button id="mode-color" onclick="setPrintMode('color')">彩色</button>
        <button id="mode-bw" onclick="setPrintMode('bw')">黑白</button>
      </span>
      <span class="hint hint-long">黑白模式已针对激光打印机优化</span>
      <button class="go" onclick="window.print()">打印 / 另存为 PDF</button>
    </div>
  </div>
  <script>
    function setPrintMode(mode) {
      document.body.classList.toggle('bw', mode === 'bw');
      document.getElementById('mode-bw').classList.toggle('on', mode === 'bw');
      document.getElementById('mode-color').classList.toggle('on', mode !== 'bw');
      try { localStorage.setItem('print-mode', mode); } catch (e) { /* 隐私模式下忽略 */ }
    }
    var saved = 'color';
    try { saved = localStorage.getItem('print-mode') || 'color'; } catch (e) { /* 同上 */ }
    setPrintMode(saved);
  </script>
  <div class="content-wrap">
`;

  function buildScoreCircles(score: number | null | undefined): string {
    if (!score) return '<span class="blank">未评分</span>';
    let html = '<span style="white-space:nowrap;">';
    for (let i = 1; i <= 5; i++) {
      html += '<span class="score-dot ' + (i <= score ? 'active' : 'inactive') + '">' + i + '</span>';
    }
    html += '<span class="score-label">' + score + '/5分</span></span>';
    return html;
  }

  function buildInfoRow(k1: string, v1: string, k2: string, v2: string): string {
    return '<tr><td class="label">' + k1 + '</td><td class="value">' + v1 + '</td><td class="label">' + k2 + '</td><td class="value">' + v2 + '</td></tr>';
  }

  let pages = '';
  for (const ev of submitted) {
    const c = (ev as any).course || {};
    const s = (ev as any).supervisor || {};
    const weekdayPeriod = ((escapeHtml(c.weekday) || '') + ' ' + (escapeHtml(c.period) || '')).trim() || '—';
    const listenDateStr = ev.listenDate ? formatDateOnlyBJ(ev.listenDate) : '—';
    const weekStr = ev.actualWeek ? '第' + ev.actualWeek + '周' : '—';
    const scoreStr = ev.overallScore ? '<strong style="color:var(--ink);">' + ev.overallScore.toFixed(1) + '/5</strong>' : '—';

    let infoHtml = '';
    infoHtml += buildInfoRow('课程名称', escapeHtml(c.courseName) || '—', '主讲教师', escapeHtml(c.teacher) || '—');
    infoHtml += buildInfoRow('所属学院', escapeHtml(c.college) || '—', '课程性质', escapeHtml(c.courseType) || '—');
    infoHtml += buildInfoRow('校区', escapeHtml(c.campus) || '—', '教室', escapeHtml(c.classroom) || '—');
    infoHtml += buildInfoRow('上课时间', weekdayPeriod, '学生人数', String(c.studentCount || '—'));
    infoHtml += buildInfoRow('督导专家', escapeHtml(s.name) || '—', '听课日期', listenDateStr);
    infoHtml += buildInfoRow('实际周次', weekStr, '综合评分', scoreStr);

    let dimHtml = '';
    for (const dim of SCORE_DIMENSIONS) {
      let rows = '';
      for (const item of dim.items) {
        const score = (ev as any)[item.key];
        if ((item.key === 'score_research_teaching' || item.key === 'score_learning_effect') && !score) continue;
        if (item.key === 'score_learning_task_design' && !score) continue;
        rows += '<tr>'
          + '<td class="col-indicator">' + escapeHtml(item.label) + '</td>'
          + '<td class="col-desc">' + escapeHtml(item.description) + '</td>'
          + '<td class="col-score">' + buildScoreCircles(score) + '</td>'
          + '</tr>';
      }
      dimHtml += '<div class="dim-header">' + dim.title + '</div>'
        + '<table class="score-table">'
        + '<tr><th class="col-indicator">评价指标</th><th class="col-desc">说明</th><th class="col-score">评分</th></tr>'
        + rows
        + '</table>';
    }

    const highlightsHtml = escapeHtml(ev.highlights) || '<span class="blank">未填写</span>';
    const suggestionsHtml = escapeHtml(ev.suggestions) || '<span class="blank">未填写</span>';
    const improvementHtml = escapeHtml(ev.improvement_suggestion) || '<span class="blank">未填写</span>';
    const developmentHtml = escapeHtml(ev.development_suggestion) || '<span class="blank">未填写</span>';
    const signDateStr = ev.listenDate ? formatDateOnlyBJ(ev.listenDate) : '　　　　年　　月　　日';

    pages += '<div class="page">'
      + '<div class="doc-title"><h1>浙江工商大学研究生课程督导评价表</h1><p>浙江工商大学研究生院</p></div>'
      + '<table class="info-table">' + infoHtml + '</table>'
      + '<div class="section-header">一、定量督导评分</div>'
      + dimHtml
      + '<div class="section-header">二、课程亮点与评价</div>'
      + '<table class="text-table">'
      + '<tr><td class="label">最突出的教学亮点 <span class="req">*</span></td><td class="value">' + highlightsHtml + '</td></tr>'
      + '<tr><td class="label">存在不足与提升建议 <span class="req">*</span></td><td class="value">' + suggestionsHtml + '</td></tr>'
      + '</table>'
      + '<div class="section-header">三、其他建议（可填）</div>'
      + '<table class="text-table">'
      + '<tr><td class="label">综合改进建议</td><td class="value">' + improvementHtml + '</td></tr>'
      + '<tr><td class="label">发展与支持建议</td><td class="value">' + developmentHtml + '</td></tr>'
      + '</table>'
      + '<table class="sign-table"><tr><td>督导专家签名：</td><td>填写日期：' + signDateStr + '</td></tr></table>'
      + '</div>';
  }

  return CSS + pages + '\n  </div>\n</body>\n</html>';
}
