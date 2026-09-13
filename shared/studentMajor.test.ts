/**
 * 「学生专业」解析的回归测试。
 *
 * 研究生院反馈「手机端学生专业显示不全」。根子是课表里这一列是机器格式，
 * 一门课能挂四五个专业、整串近 200 字符，此前直接塞进一个窄格子里再 line-clamp-2，
 * 手机上必然被截断。现在拆成条目逐条展示，这里守住拆分口径。
 */
import { describe, expect, it } from "vitest";
import { parseStudentMajors, formatStudentMajor } from "./studentMajor";

describe("parseStudentMajors", () => {
  it("拆出年级、培养类型与专业名", () => {
    expect(parseStudentMajors("2026|全日制硕士|企业管理")).toEqual([
      { grade: "2026", degreeType: "全日制硕士", major: "企业管理" },
    ]);
  });

  it("多个专业按分号拆开，末尾的空分号不产生空条目", () => {
    const list = parseStudentMajors("2026|全日制硕士|企业管理;2026|全日制硕士|国别和区域研究;");
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.major)).toEqual(["企业管理", "国别和区域研究"]);
  });

  it("真实课表里最长的那一串能完整拆出 4 个专业", () => {
    const raw =
      "2026|全日制硕士|食品科学与工程（食品营养）;2026|全日制硕士|食品科学与工程（食安）;" +
      "2026|全日制硕士|食品科学与工程（农产品）;2026|全日制硕士|食品科学与工程";
    const list = parseStudentMajors(raw);
    expect(list).toHaveLength(4);
    // 括号里的方向必须保留，否则四个专业看起来一模一样
    expect(list.map((m) => m.major)).toEqual([
      "食品科学与工程（食品营养）",
      "食品科学与工程（食安）",
      "食品科学与工程（农产品）",
      "食品科学与工程",
    ]);
  });

  it("重复条目去重（同一专业在课表里可能写两遍）", () => {
    const list = parseStudentMajors("2026|博士|企业管理;2026|博士|企业管理");
    expect(list).toHaveLength(1);
  });

  it("博士、留学生等各种培养类型都能拆", () => {
    const list = parseStudentMajors("2025|硕士留学生|工商管理学;2026|直博生|企业管理");
    expect(list.map((m) => m.degreeType)).toEqual(["硕士留学生", "直博生"]);
  });

  it("不是预期格式时整段保留，不丢信息", () => {
    expect(parseStudentMajors("手工填的说明")).toEqual([
      { grade: "", degreeType: "", major: "手工填的说明" },
    ]);
  });

  it("空值返回空数组", () => {
    expect(parseStudentMajors("")).toEqual([]);
    expect(parseStudentMajors(null)).toEqual([]);
    expect(parseStudentMajors(undefined)).toEqual([]);
  });
});

describe("formatStudentMajor", () => {
  it("完整条目拼成一行可读文本", () => {
    expect(formatStudentMajor({ grade: "2026", degreeType: "全日制硕士", major: "企业管理" }))
      .toBe("2026 全日制硕士 · 企业管理");
  });

  it("缺年级/培养类型时不留多余的分隔符", () => {
    expect(formatStudentMajor({ grade: "", degreeType: "", major: "企业管理" })).toBe("企业管理");
  });
});
