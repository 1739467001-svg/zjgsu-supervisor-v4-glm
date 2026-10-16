import { SEMESTER_START_DATE, WEEKS_IN_SEMESTER, TIMEZONE } from "./const";

/**
 * 学期配置。学期起始日与总周数原本写死在 shared/const.ts，跨学期即失效；
 * 现改为可传入，未传时回退到常量默认值，保持既有调用方不受影响。
 * 服务端从 semesters 表读取当前学期，前端经 tRPC 取得后传入。
 */
export type SemesterConfig = { startDate: string; totalWeeks: number };

export const DEFAULT_SEMESTER: SemesterConfig = {
  startDate: SEMESTER_START_DATE,
  totalWeeks: WEEKS_IN_SEMESTER,
};

/**
 * 获取北京时间的今天日期字符串（YYYY-MM-DD）
 * 无论浏览器/服务器在哪个时区，都返回北京时间的日期
 */
export function getTodayBJ(): string {
  const now = new Date();
  // 使用 Intl 格式化为北京时间
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA 格式就是 YYYY-MM-DD
}

/**
 * 将日期字符串解析为 Date 对象（按北京时间的零点）
 * @param dateStr YYYY-MM-DD 格式
 */
function parseDateBJ(dateStr: string): Date {
  // 使用 +08:00 确保按北京时间解析
  return new Date(dateStr + "T00:00:00+08:00");
}

/**
 * 根据听课日期计算对应的周次。全校校历统一口径：学期第一周的周一是第 1 周第 1 天，
 * 早于它的日期（如 MBA 提前开学的课）记为第 0 周，全校周次才能对得上校历。
 * @param listenDate 听课日期 (YYYY-MM-DD 格式或 Date 对象)
 * @returns 周次 (0~totalWeeks) 或 undefined 如果日期超出学期范围
 */
export function calculateWeekFromDate(listenDate: string | Date, semester: SemesterConfig = DEFAULT_SEMESTER): number | undefined {
  let dateStr: string;
  if (typeof listenDate === "string") {
    dateStr = listenDate;
  } else {
    // Date 对象转为北京时间日期字符串
    dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(listenDate);
  }

  const date = parseDateBJ(dateStr);
  const startDate = parseDateBJ(semester.startDate);

  // 计算天数差
  const diffMs = date.getTime() - startDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // 计算周次（第一周是第 0-6 天；开学前 diffDays 为负，Math.floor 落到 0 或负数）
  const week = Math.floor(diffDays / 7) + 1;

  // 开学前统一记为第 0 周（负数周收敛到 0），过晚则超出学期范围
  if (week < 1) return 0;
  if (week > semester.totalWeeks) {
    return undefined;
  }

  return week;
}

/**
 * 根据周次计算该周的日期范围（周一到周日）。
 * 第 0 周是「开学前」，其起点不早于学期起始日往前推 6 天（保留开学前一周内
 * 最早可能开课的日期）；更早的历史日期不属于本学期，不应可选。
 * @param week 周次 (0-19)
 * @returns { startDate, endDate } 该周的起始和结束日期 (YYYY-MM-DD)，或 undefined 如果周次无效
 */
export function calculateDateRangeFromWeek(week: number, semester: SemesterConfig = DEFAULT_SEMESTER): { startDate: string; endDate: string } | undefined {
  if (week < 0 || week > semester.totalWeeks) {
    return undefined;
  }

  if (week === 0) {
    // 开学前一周：起点为起始日前推 6 天，终点为起始日前一天
    const endDate = parseDateBJ(semester.startDate);
    endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    return formatRange(startDate, endDate);
  }

  const startDate = parseDateBJ(semester.startDate);
  startDate.setDate(startDate.getDate() + (week - 1) * 7);

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);

  return formatRange(startDate, endDate);
}

function formatRange(start: Date, end: Date): { startDate: string; endDate: string } {
  // 使用北京时间格式化
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  return {
    startDate: fmt(start),
    endDate: fmt(end),
  };
}

/**
 * 获取当前时间对应的周次
 * @returns 当前周次 (1-19) 或 undefined 如果当前时间超出学期范围
 */
export function getCurrentWeek(semester: SemesterConfig = DEFAULT_SEMESTER): number | undefined {
  return calculateWeekFromDate(new Date(), semester);
}

/**
 * 检查日期是否可选。允许的范围是「开学前 6 天」到学期最后一天：
 * 开学前一周内的补课/提前开课（记第 0 周）可选，更早的日期属于上学期不可选。
 */
export function isValidFutureDate(date: string | Date, semester: SemesterConfig = DEFAULT_SEMESTER): boolean {
  let dateStr: string;
  if (typeof date === "string") {
    dateStr = date;
  } else {
    dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  const checkDate = parseDateBJ(dateStr);
  const startDate = parseDateBJ(semester.startDate);

  const minDate = parseDateBJ(semester.startDate);
  minDate.setDate(minDate.getDate() - 6);

  const endDate = parseDateBJ(semester.startDate);
  endDate.setDate(endDate.getDate() + (semester.totalWeeks - 1) * 7 + 6);

  return checkDate.getTime() >= minDate.getTime() && checkDate.getTime() <= endDate.getTime();
}

/**
 * 获取最小可选日期（第 0 周的第一天，即开学前一周的周一）
 * @returns 最小日期的 YYYY-MM-DD 格式字符串
 */
export function getMinSelectableDate(semester: SemesterConfig = DEFAULT_SEMESTER): string {
  const minDate = parseDateBJ(semester.startDate);
  minDate.setDate(minDate.getDate() - 7);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(minDate);
}

/**
 * 获取最大可选日期（学期最后一天）
 * @returns 最大日期的 YYYY-MM-DD 格式字符串
 */
export function getMaxSelectableDate(semester: SemesterConfig = DEFAULT_SEMESTER): string {
  const endDate = parseDateBJ(semester.startDate);
  endDate.setDate(endDate.getDate() + (semester.totalWeeks - 1) * 7 + 6);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(endDate);
}

/**
 * 格式化日期为北京时间的本地化字符串
 * @param date Date 对象或日期字符串
 * @param options Intl.DateTimeFormatOptions 选项
 * @returns 格式化后的字符串
 */
export function formatDateBJ(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("zh-CN", { timeZone: TIMEZONE, ...options });
}

/**
 * 格式化日期为北京时间的日期部分（年月日）
 */
export function formatDateOnlyBJ(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("zh-CN", { timeZone: TIMEZONE });
}

/**
 * 格式化日期为北京时间的时间部分（时分）
 */
export function formatTimeBJ(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("zh-CN", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" });
}
