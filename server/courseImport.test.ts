/**
 * 课表解析的回归测试。
 *
 * 用真实课表（2026-2027 学年第一学期）验证，不是造几行假数据糊弄过去：
 * 研究生院给的是两张结构完全不同的表，一张按开课记录、一张按上课场次，
 * 解析口径一旦出错，督导就会看到错误的周次或找不到课。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import * as XLSX from "xlsx";
import {
  parseCourseWorkbook,
  parseWeekNumbers,
  weekOfDate,
  parseMbaTerm,
  splitMbaClassNames,
  detectFormat,
  formatWeekNumbers,
  mergeDuplicateCourses,
  courseKey,
} from "./courseImport";
import { normalizeCourseCollege } from "../shared/colleges";

const SEMESTER_START = "2026-09-07";
const TOTAL_WEEKS = 18;

/** 构造一个内存工作簿，用于不依赖真实文件的用例 */
function workbook(rows: any[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
}

const STANDARD_HEADER = [
  "学年", "学期", "开课院系", "课程名称", "课程性质", "教室名称", "班级编号",
  "主讲教师", "校区名称", "星期几", "单双周", "节次", "自定义周次", "学生专业", "选中人数", "备注",
];
const MBA_HEADER = [
  "学期", "班级", "课程名称", "课程性质", "考试", "授课教师", "教室",
  "日期", "星期", "上课时间", "下课时间", "课程班人数",
];

describe("周次解析", () => {
  it("解析「第1|2|3周」这种竖线写法", () => {
    expect(parseWeekNumbers("第8|9|10|11|16周")).toEqual([8, 9, 10, 11, 16]);
  });

  it("解析单周次", () => {
    expect(parseWeekNumbers("第12周")).toEqual([12]);
  });

  it("解析「十六周」「前八周」「后八周」", () => {
    expect(parseWeekNumbers("十六周")).toHaveLength(16);
    expect(parseWeekNumbers("前八周")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseWeekNumbers("后八周")).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it("空值不报错", () => {
    expect(parseWeekNumbers("")).toEqual([]);
    expect(parseWeekNumbers("   ")).toEqual([]);
  });

  it("周次数组可还原成课表写法", () => {
    expect(formatWeekNumbers([1, 6, 7])).toBe("第1|6|7周");
    expect(formatWeekNumbers([])).toBe("");
  });
});

describe("日期换算周次", () => {
  it("学期第一周的周一算第 1 周", () => {
    expect(weekOfDate("2026-09-07", SEMESTER_START)).toBe(1);
  });

  it("第一周的周日仍算第 1 周", () => {
    expect(weekOfDate("2026-09-13", SEMESTER_START)).toBe(1);
  });

  it("跨到下周一就进第 2 周", () => {
    expect(weekOfDate("2026-09-14", SEMESTER_START)).toBe(2);
  });

  it("学期末尾的日期落在第 18 周", () => {
    expect(weekOfDate("2027-01-10", SEMESTER_START)).toBe(18);
  });
});

describe("MBA 表的字段处理", () => {
  it("「2026-2027（一）学期」拆成学年与学期", () => {
    expect(parseMbaTerm("2026-2027（一）学期")).toEqual({
      academicYear: "2026-2027",
      semester: "第一学期",
    });
  });

  it("合班的班级名按年份切开，不再是一长串", () => {
    expect(splitMbaClassNames("2026MPM1班2026MPM2班2026MPM3班")).toBe("2026MPM1班、2026MPM2班、2026MPM3班");
    expect(splitMbaClassNames("2025MPM12025MPM22025MPM3")).toBe("2025MPM1、2025MPM2、2025MPM3");
  });

  it("单个班级名保持原样", () => {
    expect(splitMbaClassNames("2025MBA数领班")).toBe("2025MBA数领班");
  });
});

describe("格式识别", () => {
  it("大标题占了第一行时仍能找到表头", () => {
    const rows = [["2026-2027学年第一学期研究生排课信息表"], STANDARD_HEADER];
    expect(detectFormat(rows)).toEqual({ format: "standard", headerRow: 1 });
  });

  it("MBA 表表头在第一行", () => {
    expect(detectFormat([MBA_HEADER])).toEqual({ format: "mba", headerRow: 0 });
  });

  it("认不出的表格给出明确提示，而不是解析出一堆空课程", () => {
    expect(() => parseCourseWorkbook(workbook([["姓名", "工号"], ["张三", "1001"]]))).toThrow(/认不出这个课表的格式/);
  });
});

describe("标准排课表：按表头名取列，不按列序号", () => {
  it("列的顺序被调换后依然解析正确", () => {
    // 把「开课院系」挪到最后一列，模拟学校换导出模板
    const shuffled = ["课程名称", "主讲教师", "自定义周次", "星期几", "节次", "开课院系"];
    const buf = workbook([shuffled, ["企业战略管理", "陈老师", "第3|4周", "星期一", "第3-4节", "经济学院"]]);
    const { courses } = parseCourseWorkbook(buf);
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({
      courseName: "企业战略管理",
      teacher: "陈老师",
      college: "经济学院",
      weekday: "星期一",
      period: "第3-4节",
      weekNumbers: [3, 4],
    });
  });

  it("没有课程名称的行被跳过并计入提示", () => {
    const buf = workbook([STANDARD_HEADER,
      ["2026-2027", "第一学期", "经济学院", "有名字的课", "", "", "", "陈老师", "", "", "", "", "第1周", "", "10", ""],
      ["2026-2027", "第一学期", "经济学院", "", "", "", "", "李老师", "", "", "", "", "第1周", "", "10", ""],
    ]);
    const res = parseCourseWorkbook(buf);
    expect(res.courses).toHaveLength(1);
    expect(res.warnings.join()).toMatch(/1 行缺少课程名称/);
  });

  it("「工商管理学院（MBA学院）」归入工商管理学院", () => {
    const buf = workbook([STANDARD_HEADER,
      ["2026-2027", "第一学期", "工商管理学院（MBA学院）", "组织行为学", "", "", "", "王老师", "", "", "", "", "第1周", "", "10", ""],
    ]);
    expect(parseCourseWorkbook(buf).courses[0].college).toBe("工商管理学院");
  });
});

describe("MBA 课表：把上课场次归并成课程", () => {
  const rows = [MBA_HEADER,
    ["2026-2027（一）学期", "2025MBA数领班", "数据模型与决策", "必修", "", "马龙", "315", "2026-09-12", "星期六", "09:00", "12:00", "18"],
    ["2026-2027（一）学期", "2025MBA数领班", "数据模型与决策", "必修", "", "马龙", "315", "2026-10-17", "星期六", "09:00", "12:00", "18"],
    ["2026-2027（一）学期", "2025MBA数领班", "(考试)数据模型与决策", "必修", "", "", "315", "2026-11-28", "星期六", "09:00", "12:00", "18"],
  ];

  it("同一门课的多次上课合并成一条，周次取并集", () => {
    const res = parseCourseWorkbook(workbook(rows), {
      semesterStartDate: SEMESTER_START, totalWeeks: TOTAL_WEEKS,
    });
    expect(res.format).toBe("mba");
    expect(res.courses).toHaveLength(1);
    expect(res.courses[0]).toMatchObject({
      college: "MBA学院",
      courseName: "数据模型与决策",
      teacher: "马龙",
      weekday: "星期六",
      period: "09:00-12:00",
      academicYear: "2026-2027",
      semester: "第一学期",
      weekNumbers: [1, 6],
      studentCount: 18,
    });
  });

  it("考试场次不算授课，不进课表", () => {
    const res = parseCourseWorkbook(workbook(rows), {
      semesterStartDate: SEMESTER_START, totalWeeks: TOTAL_WEEKS,
    });
    expect(res.courses.map((c) => c.courseName)).not.toContain("(考试)数据模型与决策");
    expect(res.warnings.join()).toMatch(/1 条考试场次已排除/);
  });

  it("不给学期起始日就直接报错，绝不猜 —— 猜错会让整张表周次错位", () => {
    expect(() => parseCourseWorkbook(workbook(rows))).toThrow(/必须提供学期第一周的周一/);
  });

  it("越界周次被剔除并告警，提醒核对学期起始日", () => {
    const bad = [MBA_HEADER,
      ["2026-2027（一）学期", "X班", "某课", "必修", "", "某师", "101", "2027-06-01", "星期二", "09:00", "12:00", "10"],
    ];
    const res = parseCourseWorkbook(workbook(bad), {
      semesterStartDate: SEMESTER_START, totalWeeks: TOTAL_WEEKS,
    });
    expect(res.courses[0].weekNumbers).toEqual([]);
    expect(res.warnings.join()).toMatch(/超出 1~18 周范围/);
  });

  it("MBA 课程不臆造校区", () => {
    const res = parseCourseWorkbook(workbook(rows), {
      semesterStartDate: SEMESTER_START, totalWeeks: TOTAL_WEEKS,
    });
    expect(res.courses[0].campus).toBe("");
    expect(res.warnings.join()).toMatch(/没有校区列/);
  });
});

describe("学院口径", () => {
  it("课表简称与角色表全称归一到同一个名字", () => {
    expect(normalizeCourseCollege("金融学院（浙商资产管理学院）")).toBe("金融学院");
    expect(normalizeCourseCollege("法学院（知识产权学院）")).toBe("法学院");
    expect(normalizeCourseCollege("人文与传播学院")).toBe("人文学院");
  });

  it("未登记的学院原样保留，不被瞎改", () => {
    expect(normalizeCourseCollege("法律硕士教育中心")).toBe("法律硕士教育中心");
    expect(normalizeCourseCollege("未来传播学院")).toBe("未来传播学院");
  });
});

// ============================================================
// 真实课表（文件存在时才跑，避免在没有样例数据的环境里失败）
// ============================================================
const REAL_STANDARD = process.env.REAL_COURSE_XLS;
const REAL_MBA = process.env.REAL_MBA_XLS;

describe.runIf(REAL_STANDARD && existsSync(REAL_STANDARD))("真实课表：研究生排课信息表", () => {
  it("1498 行全部解析成功，学院按拆分后的口径落库", () => {
    const res = parseCourseWorkbook(readFileSync(REAL_STANDARD!));
    expect(res.format).toBe("standard");
    expect(res.courses).toHaveLength(1498);
    const colleges = new Set(res.courses.map((c) => c.college));
    expect(colleges.has("工商管理学院")).toBe(true);
    // 合写的名字不应再出现在库里
    expect(colleges.has("工商管理学院（MBA学院）")).toBe(false);
    // 这张表里不该有 MBA 学院的课（MBA 课程在另一张表）
    expect(colleges.has("MBA学院")).toBe(false);
  });
});

describe.runIf(REAL_MBA && existsSync(REAL_MBA))("真实课表：MBA 课表", () => {
  it("817 条上课场次归并为 MBA 学院的课程，周次落在 1~18 周内", () => {
    const res = parseCourseWorkbook(readFileSync(REAL_MBA!), {
      semesterStartDate: SEMESTER_START, totalWeeks: TOTAL_WEEKS,
    });
    expect(res.format).toBe("mba");
    expect(res.courses.length).toBeGreaterThan(0);
    expect(res.courses.length).toBeLessThan(res.sourceRows);
    expect(new Set(res.courses.map((c) => c.college))).toEqual(new Set(["MBA学院"]));

    const allWeeks = res.courses.flatMap((c) => c.weekNumbers);
    expect(Math.min(...allWeeks)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...allWeeks)).toBeLessThanOrEqual(TOTAL_WEEKS);
    // 起始日正确时不应有越界周次
    expect(res.warnings.join()).not.toMatch(/超出/);
  });
});

describe("合并重复课程记录", () => {
  const base = {
    academicYear: "2026-2027", semester: "第一学期", college: "法律硕士教育中心",
    courseName: "英语(法学)", courseType: "学位公共课", classroom: "F213", classId: "1192001001",
    teacher: "李先玉", campus: "下沙", weekday: "星期五", weekType: "", period: "第6-7-8-9节",
    customWeeks: "", weekNumbers: [] as number[], studentMajor: "", studentCount: 30,
  };

  it("同一门课分散在不同周的多条记录，周次取并集而不是被覆盖", () => {
    const { merged, mergedGroups, weeksRecovered } = mergeDuplicateCourses([
      { ...base, weekNumbers: [5], customWeeks: "第5周" },
      { ...base, weekNumbers: [1], customWeeks: "第1周" },
    ]);
    expect(merged).toHaveLength(1);
    expect(mergedGroups).toBe(1);
    expect(merged[0].weekNumbers).toEqual([1, 5]);
    expect(merged[0].customWeeks).toBe("第1|5周");
    // 直接覆盖只会留下最后一条的 [1]，这里救回了 1 个周次
    expect(weeksRecovered).toBe(1);
  });

  it("合班的班级名并列保留，不是只留一个班", () => {
    const { merged } = mergeDuplicateCourses([
      { ...base, college: "MBA学院", courseName: "商道论坛", classId: "2026MBAF1班", weekNumbers: [7], studentCount: 40 },
      { ...base, college: "MBA学院", courseName: "商道论坛", classId: "2026MBAP1班", weekNumbers: [7], studentCount: 45 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].classId).toBe("2026MBAF1班、2026MBAP1班");
    // 同一门课按周次拆成多行的情况求和会翻倍，所以取最大值
    expect(merged[0].studentCount).toBe(45);
  });

  it("不同课程不会被误并", () => {
    const { merged, mergedGroups } = mergeDuplicateCourses([
      { ...base, teacher: "李先玉", weekNumbers: [1] },
      { ...base, teacher: "张三", weekNumbers: [1] },
    ]);
    expect(merged).toHaveLength(2);
    expect(mergedGroups).toBe(0);
  });

  it("真实课表合并后不丢周次", () => {
    if (!REAL_STANDARD || !existsSync(REAL_STANDARD)) return;
    const parsed = parseCourseWorkbook(readFileSync(REAL_STANDARD)).courses;
    const { merged } = mergeDuplicateCourses(parsed);
    // 合并前后，每门课覆盖的「课程+周次」对不能减少
    const before = new Set(parsed.flatMap((c) => c.weekNumbers.map((w) => courseKey(c) + "#" + w)));
    const after = new Set(merged.flatMap((c) => c.weekNumbers.map((w) => courseKey(c) + "#" + w)));
    expect(after.size).toBe(before.size);
    for (const k of before) expect(after.has(k)).toBe(true);
  });
});
