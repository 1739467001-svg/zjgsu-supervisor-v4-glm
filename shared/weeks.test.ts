/**
 * 「第几周」展示规则的回归测试。
 *
 * 研究生院反馈此前这个字段「没改好」——既要出现在课程信息预览那一行，
 * 也要在一门课被多位督导在不同周听过时把周次完整列出来。
 */
import { describe, expect, it } from "vitest";
import { collectEvaluatedWeeks, formatEvaluatedWeeks } from "./weeks";

describe("collectEvaluatedWeeks", () => {
  it("单条评价取其周次", () => {
    expect(collectEvaluatedWeeks([{ actualWeek: 5 }])).toEqual([5]);
  });

  it("多条评价去重后升序", () => {
    expect(collectEvaluatedWeeks([{ actualWeek: 9 }, { actualWeek: 3 }, { actualWeek: 9 }])).toEqual([3, 9]);
  });

  it("按数字大小排序，不是按字符串（否则 10 会排到 2 前面）", () => {
    expect(collectEvaluatedWeeks([{ actualWeek: 10 }, { actualWeek: 2 }])).toEqual([2, 10]);
  });

  it("忽略空值与非法周次", () => {
    expect(
      collectEvaluatedWeeks([
        { actualWeek: null },
        { actualWeek: undefined },
        { actualWeek: "" },
        { actualWeek: 0 },
        { actualWeek: -1 },
        { actualWeek: 1.5 },
        { actualWeek: 7 },
      ])
    ).toEqual([7]);
  });

  it("接受字符串形式的周次（JSON 传输可能带过来）", () => {
    expect(collectEvaluatedWeeks([{ actualWeek: "4" }])).toEqual([4]);
  });

  it("空列表/缺省入参不报错", () => {
    expect(collectEvaluatedWeeks([])).toEqual([]);
    expect(collectEvaluatedWeeks(null)).toEqual([]);
    expect(collectEvaluatedWeeks(undefined)).toEqual([]);
  });
});

describe("formatEvaluatedWeeks", () => {
  it("单周显示为「第N周」", () => {
    expect(formatEvaluatedWeeks([{ actualWeek: 5 }])).toBe("第5周");
  });

  it("多周合并在一个「第…周」里，用顿号分隔", () => {
    expect(formatEvaluatedWeeks([{ actualWeek: 12 }, { actualWeek: 3 }])).toBe("第3、12周");
  });

  it("有评价但都没记周次时给出明确提示，而不是留空", () => {
    expect(formatEvaluatedWeeks([{ actualWeek: null }])).toBe("周次未记录");
  });

  it("fallback 可自定义", () => {
    expect(formatEvaluatedWeeks([], "—")).toBe("—");
  });
});
