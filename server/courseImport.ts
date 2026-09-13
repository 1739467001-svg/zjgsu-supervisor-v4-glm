/**
 * 课表解析（研究生院给的课表有两种完全不同的格式）
 *
 * 格式一「研究生排课信息表」：一行 = 一个开课记录，周次写在「自定义周次」列里
 *   学年 学期 开课院系 课程名称 课程性质 教室名称 班级编号 主讲教师 校区名称
 *   星期几 单双周 节次 自定义周次 学生专业 选中人数 备注
 *
 * 格式二「MBA 课表」：一行 = 一次上课，周次要靠具体日期换算
 *   学期 班级 课程名称 课程性质 考试 授课教师 教室 日期 星期 上课时间 下课时间 课程班人数
 *
 * 两种格式最终都归一成同一套 courses 字段。列一律按表头名定位，不按列序号 ——
 * 学校换个导出模板就挪动列的位置，按序号取值会静默错位。
 */

import * as XLSX from "xlsx";
import { MBA_COLLEGE, normalizeCourseCollege } from "../shared/colleges";

export type ParsedCourse = {
  academicYear: string;
  semester: string;
  college: string;
  courseName: string;
  courseType: string;
  classroom: string;
  classId: string;
  teacher: string;
  campus: string;
  weekday: string;
  weekType: string;
  period: string;
  customWeeks: string;
  weekNumbers: number[];
  studentMajor: string;
  studentCount: number;
};

export type CourseFileFormat = "standard" | "mba";

export type ParseResult = {
  format: CourseFileFormat;
  courses: ParsedCourse[];
  /** 原始数据行数（MBA 表是上课场次数，会多于课程数） */
  sourceRows: number;
  /** 需要人工留意但不阻断导入的问题 */
  warnings: string[];
};

export type ParseOptions = {
  /**
   * 学期第一周的周一。MBA 表只有具体日期，必须靠它换算周次；
   * 差一周，整张 MBA 课表的周次就整体错一周，所以不做猜测，必须显式传入。
   */
  semesterStartDate?: string;
  /** 学期总周数，用于校验换算出来的周次是否越界 */
  totalWeeks?: number;
};

// ============================================================
// 周次解析
// ============================================================

/**
 * 把「自定义周次」这一列的各种写法解析成周次数组。
 * 学校的课表里同时存在「第1|2|3周」「十六周」「前八周」「单周」等写法。
 */
export function parseWeekNumbers(weekStr: string): number[] {
  if (!weekStr || weekStr.trim() === "") return [];
  const str = weekStr.trim();
  const weeks = new Set<number>();

  if (str.includes("十六周")) {
    for (let i = 1; i <= 16; i++) weeks.add(i);
    if (str === "十六周") return [...weeks].sort((a, b) => a - b);
  }
  if (str.includes("前八周")) for (let i = 1; i <= 8; i++) weeks.add(i);
  if (str.includes("后八周")) for (let i = 9; i <= 16; i++) weeks.add(i);
  if (str.includes("前十一周")) for (let i = 1; i <= 11; i++) weeks.add(i);
  if (str.includes("单周")) for (let i = 1; i <= 18; i += 2) weeks.add(i);
  if (str.includes("双周")) for (let i = 2; i <= 18; i += 2) weeks.add(i);

  // 「第1|2|3周」与「第7周」两种写法
  for (const m of str.matchAll(/第([\d|]+)周/g)) {
    for (const n of m[1].split("|")) {
      const num = parseInt(n.trim(), 10);
      if (Number.isInteger(num) && num > 0) weeks.add(num);
    }
  }

  return [...weeks].sort((a, b) => a - b);
}

/** 把周次数组还原成「第1|2|3周」的写法，供界面展示 */
export function formatWeekNumbers(weeks: number[]): string {
  return weeks.length > 0 ? `第${weeks.join("|")}周` : "";
}

/** 某个日期落在学期第几周（第一周记为 1） */
export function weekOfDate(date: string, semesterStartDate: string): number {
  const d = Date.parse(date + "T00:00:00Z");
  const s = Date.parse(semesterStartDate + "T00:00:00Z");
  if (Number.isNaN(d) || Number.isNaN(s)) return 0;
  return Math.floor((d - s) / (7 * 86400000)) + 1;
}

// ============================================================
// 表头定位
// ============================================================

const STANDARD_HEADERS = ["开课院系", "课程名称", "主讲教师", "自定义周次"];
const MBA_HEADERS = ["班级", "课程名称", "授课教师", "日期", "上课时间"];

function findHeaderRow(rows: any[][], required: string[]): number {
  // 表头不一定在第一行：正式课表第 0 行是「2026-2027学年第一学期研究生排课信息表」这种大标题
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").trim());
    if (required.every((h) => cells.includes(h))) return i;
  }
  return -1;
}

function columnIndex(header: string[], name: string): number {
  return header.findIndex((h) => h === name);
}

function cell(row: any[], idx: number): string {
  if (idx < 0) return "";
  return String(row[idx] ?? "").trim();
}

// ============================================================
// 格式一：研究生排课信息表
// ============================================================

function parseStandard(rows: any[][], headerRow: number): ParseResult {
  const header = (rows[headerRow] || []).map((c) => String(c ?? "").trim());
  const col = (name: string) => columnIndex(header, name);

  const idx = {
    academicYear: col("学年"),
    semester: col("学期"),
    college: col("开课院系"),
    courseName: col("课程名称"),
    courseType: col("课程性质"),
    classroom: col("教室名称"),
    classId: col("班级编号"),
    teacher: col("主讲教师"),
    campus: col("校区名称"),
    weekday: col("星期几"),
    weekType: col("单双周"),
    period: col("节次"),
    customWeeks: col("自定义周次"),
    studentMajor: col("学生专业"),
    studentCount: col("选中人数"),
  };

  const warnings: string[] = [];
  const courses: ParsedCourse[] = [];
  let skippedBlank = 0;
  let noWeeks = 0;

  for (const row of rows.slice(headerRow + 1)) {
    const courseName = cell(row, idx.courseName);
    const teacher = cell(row, idx.teacher);
    // 课程名和教师都为空的是表尾空行/合计行，直接跳过
    if (!courseName && !teacher) continue;
    if (!courseName) {
      skippedBlank++;
      continue;
    }

    const customWeeks = cell(row, idx.customWeeks);
    const weekNumbers = parseWeekNumbers(customWeeks || cell(row, idx.weekType));
    if (weekNumbers.length === 0) noWeeks++;

    const rawCount = cell(row, idx.studentCount);
    courses.push({
      academicYear: cell(row, idx.academicYear),
      semester: cell(row, idx.semester),
      college: normalizeCourseCollege(cell(row, idx.college)),
      courseName,
      courseType: cell(row, idx.courseType),
      classroom: cell(row, idx.classroom),
      classId: cell(row, idx.classId),
      teacher,
      campus: cell(row, idx.campus),
      weekday: cell(row, idx.weekday),
      weekType: cell(row, idx.weekType),
      period: cell(row, idx.period),
      customWeeks,
      weekNumbers,
      studentMajor: cell(row, idx.studentMajor),
      studentCount: rawCount ? Math.round(parseFloat(rawCount) || 0) : 0,
    });
  }

  if (skippedBlank > 0) warnings.push(`${skippedBlank} 行缺少课程名称，已跳过`);
  if (noWeeks > 0) warnings.push(`${noWeeks} 门课解析不出周次，督导按周次筛选时看不到它们`);

  return { format: "standard", courses, sourceRows: rows.length - headerRow - 1, warnings };
}

// ============================================================
// 格式二：MBA 课表（一行一次上课，需按日期归并成课程）
// ============================================================

/** 「2026-2027（一）学期」→ { academicYear: "2026-2027", semester: "第一学期" } */
export function parseMbaTerm(text: string): { academicYear: string; semester: string } {
  const year = text.match(/(\d{4}-\d{4})/)?.[1] ?? "";
  const map: Record<string, string> = { 一: "第一学期", 二: "第二学期", 三: "第三学期" };
  const cn = text.match(/[（(]([一二三])[）)]/)?.[1] ?? "";
  return { academicYear: year, semester: map[cn] ?? "" };
}

/**
 * 合班的班级写在一起且没有分隔符（「2026MPM1班2026MPM2班2026MPM3班」），
 * 按年份前缀切开再用顿号连接，否则界面上是一长串看不懂的字符。
 */
export function splitMbaClassNames(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const parts = text.split(/(?=20\d{2})/).filter(Boolean);
  return parts.length > 1 ? parts.join("、") : text;
}

function parseMba(rows: any[][], headerRow: number, opts: ParseOptions): ParseResult {
  const header = (rows[headerRow] || []).map((c) => String(c ?? "").trim());
  const col = (name: string) => columnIndex(header, name);

  const idx = {
    term: col("学期"),
    classId: col("班级"),
    courseName: col("课程名称"),
    courseType: col("课程性质"),
    exam: col("考试"),
    teacher: col("授课教师"),
    classroom: col("教室"),
    date: col("日期"),
    weekday: col("星期"),
    startTime: col("上课时间"),
    endTime: col("下课时间"),
    studentCount: col("课程班人数"),
  };

  const warnings: string[] = [];
  const start = opts.semesterStartDate;
  if (!start) {
    throw new Error(
      "MBA 课表只有具体日期，必须提供学期第一周的周一（--start-date）才能换算周次"
    );
  }

  // 同一门课的多次上课归并成一条记录：
  // 班级+课程+教师+星期+起止时间+教室 相同的视为同一个开课记录，日期集合即周次集合
  type Group = { first: any[]; dates: string[] };
  const groups = new Map<string, Group>();
  let examSessions = 0;
  let noTeacher = 0;
  let badDate = 0;

  for (const row of rows.slice(headerRow + 1)) {
    const courseName = cell(row, idx.courseName);
    if (!courseName) continue;

    // 「(考试)xxx」是考试场次，不是授课，督导听课表里不应出现
    if (/^[（(]考试[）)]/.test(courseName) || cell(row, idx.exam) === "考试") {
      examSessions++;
      continue;
    }
    if (!cell(row, idx.teacher)) noTeacher++;

    const date = cell(row, idx.date);
    if (!date || Number.isNaN(Date.parse(date + "T00:00:00Z"))) {
      badDate++;
      continue;
    }

    const key = [
      cell(row, idx.classId),
      courseName,
      cell(row, idx.teacher),
      cell(row, idx.weekday),
      cell(row, idx.startTime),
      cell(row, idx.endTime),
      cell(row, idx.classroom),
    ].join("|");

    if (!groups.has(key)) groups.set(key, { first: row, dates: [] });
    groups.get(key)!.dates.push(date);
  }

  const totalWeeks = opts.totalWeeks ?? 0;
  const outOfRange = new Set<number>();
  const courses: ParsedCourse[] = [];

  for (const { first: row, dates } of groups.values()) {
    const courseName = cell(row, idx.courseName);
    const weeks = [...new Set(dates.map((d) => weekOfDate(d, start)))]
      .filter((w) => {
        if (w < 1 || (totalWeeks > 0 && w > totalWeeks)) {
          outOfRange.add(w);
          return false;
        }
        return true;
      })
      .sort((a, b) => a - b);

    const term = parseMbaTerm(cell(row, idx.term));
    const startTime = cell(row, idx.startTime);
    const endTime = cell(row, idx.endTime);
    const rawCount = cell(row, idx.studentCount);

    courses.push({
      academicYear: term.academicYear,
      semester: term.semester,
      college: MBA_COLLEGE,
      courseName,
      courseType: cell(row, idx.courseType),
      classroom: cell(row, idx.classroom),
      classId: splitMbaClassNames(cell(row, idx.classId)),
      teacher: cell(row, idx.teacher),
      // MBA 课表没有校区列，不臆测，留空由管理端确认
      campus: "",
      weekday: cell(row, idx.weekday),
      weekType: "",
      // 没有节次，用实际起止时间代替，督导据此找得到课
      period: startTime && endTime ? `${startTime}-${endTime}` : startTime,
      customWeeks: formatWeekNumbers(weeks),
      weekNumbers: weeks,
      // MBA 课表没有学生专业列；不塞别的内容进来，免得界面上「学生专业」显示驴唇不对马嘴
      studentMajor: "",
      studentCount: rawCount ? Math.round(parseFloat(rawCount) || 0) : 0,
    });
  }

  warnings.push(`按「班级+课程+教师+星期+时间+教室」归并：${rows.length - headerRow - 1} 条上课记录 → ${courses.length} 门课`);
  warnings.push(`周次按学期起始日 ${start} 换算（第一周的周一）`);
  warnings.push("MBA 课表没有校区列与学生专业列，导入后这两项为空，如需填写请在课程管理中补充");
  if (examSessions > 0) warnings.push(`${examSessions} 条考试场次已排除（考试不是授课，不安排听课）`);
  if (noTeacher > 0) warnings.push(`${noTeacher} 条记录没有授课教师`);
  if (badDate > 0) warnings.push(`${badDate} 条记录日期无法解析，已跳过`);
  if (outOfRange.size > 0) {
    warnings.push(
      `有日期换算出第 ${[...outOfRange].sort((a, b) => a - b).join("、")} 周，超出 1~${totalWeeks || "?"} 周范围，已剔除；请核对学期起始日`
    );
  }

  return { format: "mba", courses, sourceRows: rows.length - headerRow - 1, warnings };
}

// ============================================================
// 入口
// ============================================================

/** 识别课表格式；两种都不匹配时返回 null */
export function detectFormat(rows: any[][]): { format: CourseFileFormat; headerRow: number } | null {
  const standardRow = findHeaderRow(rows, STANDARD_HEADERS);
  if (standardRow >= 0) return { format: "standard", headerRow: standardRow };
  const mbaRow = findHeaderRow(rows, MBA_HEADERS);
  if (mbaRow >= 0) return { format: "mba", headerRow: mbaRow };
  return null;
}

/** 解析一个课表工作簿（.xls/.xlsx 均可），自动识别两种格式 */
export function parseCourseWorkbook(buffer: Buffer | ArrayBuffer, opts: ParseOptions = {}): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("工作簿里没有任何工作表");

  const rows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  const detected = detectFormat(rows);
  if (!detected) {
    throw new Error(
      "认不出这个课表的格式。支持两种：研究生排课信息表（需含「开课院系/课程名称/主讲教师/自定义周次」列）" +
        "和 MBA 课表（需含「班级/课程名称/授课教师/日期/上课时间」列）"
    );
  }

  return detected.format === "standard"
    ? parseStandard(rows, detected.headerRow)
    : parseMba(rows, detected.headerRow, opts);
}

// ============================================================
// 合并同一门课的重复记录
// ============================================================

/** 同一学期内判定「是不是同一门课」的依据；导入脚本与上传接口共用 */
export function courseKey(c: {
  college: string; courseName: string; teacher: string;
  weekday: string; period: string; classroom: string;
}): string {
  return [c.college, c.courseName, c.teacher, c.weekday, c.period, c.classroom]
    .map((x) => (x || "").trim())
    .join("||");
}

function uniqueJoin(values: string[], sep: string): string {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].join(sep);
}

/**
 * 把 key 相同的课程记录合并成一条，周次取并集。
 *
 * 这一步不能省：真实课表里有 36 组记录「学院+课程+教师+星期+节次+教室」完全一样、
 * 只有周次不同（同一位老师同一门课分散在第 1 周和第 5 周上）。若按 key 直接覆盖，
 * 只会留下最后一条的周次，其余周次凭空消失 —— 督导按那些周筛选就再也找不到这门课。
 * 合班的情况（MBA 的「商道论坛」同一场次多个班一起上）则把班级并列保留。
 */
export function mergeDuplicateCourses(courses: ParsedCourse[]): {
  merged: ParsedCourse[];
  mergedGroups: number;
  weeksRecovered: number;
} {
  const groups = new Map<string, ParsedCourse[]>();
  for (const c of courses) {
    const k = courseKey(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }

  let mergedGroups = 0;
  let weeksRecovered = 0;
  const merged: ParsedCourse[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    mergedGroups++;

    const weeks = [...new Set(group.flatMap((c) => c.weekNumbers))].sort((a, b) => a - b);
    // 直接覆盖会只剩最后一条的周次，这里统计被救回来的周次数量
    weeksRecovered += weeks.length - group[group.length - 1].weekNumbers.length;

    merged.push({
      ...group[0],
      classId: uniqueJoin(group.map((c) => c.classId), "、"),
      studentMajor: uniqueJoin(group.map((c) => c.studentMajor), ";"),
      // 合班时各班人数分开写，取最大值而不是求和：同一门课分周次拆成多行的情况求和会翻倍
      studentCount: Math.max(...group.map((c) => c.studentCount)),
      weekNumbers: weeks,
      customWeeks: formatWeekNumbers(weeks),
      weekType: uniqueJoin(group.map((c) => c.weekType), "；"),
    });
  }

  return { merged, mergedGroups, weeksRecovered };
}
