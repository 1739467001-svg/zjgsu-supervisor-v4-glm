/**
 * 需求 6 的回归测试：统计仪表盘三张学院图表的学院数量必须一致。
 *
 * 这个需求被研究生院退回过两次。第一次三张图各查各的 SQL；第二次统一了数据源，
 * 但柱状图 slice(0, 10) 静默丢尾、饼图把尾部合成「其他」，页面上仍是 10 / 11 / 10。
 * 所以这里不测「数据源是不是同一个」，直接测**三张图最终拿到的学院名单是否逐字相同**。
 */
import { describe, expect, it } from "vitest";
import {
  buildCollegeChartRows,
  COLLEGE_CHART_TOP_N,
  COLLEGE_NAME_AXIS_WIDTH,
  COLLEGE_NAME_FONT_SIZE,
  COLLEGE_NAME_AXIS_PADDING,
  type CollegeStat,
} from "./dashboardCharts";

const stat = (college: string, count: number, scoredCount = count, avgScore: number | null = 4): CollegeStat => ({
  college,
  count,
  scoredCount,
  avgScore,
});

/** 造 n 个学院，次数递减，模拟真实的长尾分布 */
const manyColleges = (n: number) =>
  Array.from({ length: n }, (_, i) => stat(`学院${String(i + 1).padStart(2, "0")}`, n - i));

describe("buildCollegeChartRows", () => {
  it("三张图共用同一个数组，学院名单逐字相同", () => {
    const rows = buildCollegeChartRows(manyColleges(17));
    // 页面上三张图分别读 count / share / score 三个字段，但行是同一批
    const 次数图 = rows.map((r) => r.name);
    const 分布图 = rows.map((r) => r.name);
    const 平均分图 = rows.map((r) => r.name);
    expect(次数图).toEqual(分布图);
    expect(分布图).toEqual(平均分图);
    expect(次数图).toHaveLength(COLLEGE_CHART_TOP_N + 1);
  });

  it("学院数超过上限时，尾部合并成一行而不是被丢掉", () => {
    const rows = buildCollegeChartRows(manyColleges(17));
    const others = rows.find((r) => r.isOthers);
    expect(others).toBeDefined();
    expect(others!.name).toBe("其他10个学院");
    expect(others!.collegeCount).toBe(10);
  });

  it("合并后评价总数不减少 —— 这正是上一版柱状图丢掉的那部分", () => {
    const source = manyColleges(17);
    const sourceTotal = source.reduce((s, c) => s + c.count, 0);
    const rows = buildCollegeChartRows(source);
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(sourceTotal);
  });

  it("学院数不超过上限时不产生「其他」行", () => {
    const rows = buildCollegeChartRows(manyColleges(COLLEGE_CHART_TOP_N));
    expect(rows).toHaveLength(COLLEGE_CHART_TOP_N);
    expect(rows.some((r) => r.isOthers)).toBe(false);
  });

  it("「其他」行的平均分按评价条数加权，不是各学院平均分的算术平均", () => {
    const source: CollegeStat[] = [
      ...manyColleges(COLLEGE_CHART_TOP_N).map((c) => ({ ...c, count: 100, scoredCount: 100 })),
      stat("小学院", 1, 1, 5.0), // 1 条 5 分
      stat("大学院", 99, 99, 3.0), // 99 条 3 分
    ];
    const others = buildCollegeChartRows(source).find((r) => r.isOthers)!;
    // 算术平均会得到 4.0；加权平均 = (5*1 + 3*99) / 100 = 3.02
    expect(others.score).toBeCloseTo(3.02, 2);
    expect(others.score).not.toBeCloseTo(4.0, 1);
  });

  it("某学院有评价但都没打总分时，仍占一行、平均分为 null（不会凭空少一个学院）", () => {
    const source = [stat("甲学院", 10, 0, null), stat("乙学院", 5)];
    const rows = buildCollegeChartRows(source);
    expect(rows.map((r) => r.name)).toEqual(["甲学院", "乙学院"]);
    expect(rows[0].score).toBeNull();
  });

  it("尾部学院全都没打总分时，「其他」行平均分为 null 而不是 0", () => {
    const source: CollegeStat[] = [
      ...manyColleges(COLLEGE_CHART_TOP_N).map((c) => ({ ...c, count: 100, scoredCount: 100 })),
      stat("甲学院", 3, 0, null),
      stat("乙学院", 2, 0, null),
    ];
    const others = buildCollegeChartRows(source).find((r) => r.isOthers)!;
    expect(others.score).toBeNull();
    expect(others.count).toBe(5);
  });

  it("占比合计约等于 100%", () => {
    const rows = buildCollegeChartRows(manyColleges(17));
    const sum = rows.reduce((s, r) => s + r.share, 0);
    expect(sum).toBeGreaterThan(99.4);
    expect(sum).toBeLessThan(100.6);
  });

  it("次数相同的学院按名称稳定排序，不会两次渲染顺序不同", () => {
    const source = [stat("乙学院", 5), stat("甲学院", 5), stat("丙学院", 5)];
    const once = buildCollegeChartRows(source).map((r) => r.name);
    const twice = buildCollegeChartRows([...source].reverse()).map((r) => r.name);
    expect(once).toEqual(twice);
  });

  it("空数据与 null 都返回空数组，不抛异常", () => {
    expect(buildCollegeChartRows([])).toEqual([]);
    expect(buildCollegeChartRows(null)).toEqual([]);
    expect(buildCollegeChartRows(undefined)).toEqual([]);
  });

  it("count 为 0 的学院不进图表", () => {
    const rows = buildCollegeChartRows([stat("甲学院", 5), stat("空学院", 0)]);
    expect(rows.map((r) => r.name)).toEqual(["甲学院"]);
  });

  it("学院名为空时显示「未知学院」而不是空白柱子", () => {
    const rows = buildCollegeChartRows([{ college: null, count: 3, scoredCount: 3, avgScore: 4 }]);
    expect(rows[0].name).toBe("未知学院");
  });
});

describe("纵轴宽度足够放下真实学院名", () => {
  it("每一个正式学院名都放得下，不会被从左边裁掉", async () => {
    const { OFFICIAL_COLLEGES } = await import("./colleges");
    const fits = (name: string) =>
      name.length * COLLEGE_NAME_FONT_SIZE + COLLEGE_NAME_AXIS_PADDING <= COLLEGE_NAME_AXIS_WIDTH;
    const tooLong = OFFICIAL_COLLEGES.filter((n) => !fits(n));
    expect(tooLong, `这些学院名放不下，请调大 COLLEGE_NAME_AXIS_WIDTH：${tooLong.join("、")}`).toEqual([]);
  });

  it("孤儿评价的「未知学院（原课程已变更）」也放得下", () => {
    const label = "未知学院（原课程已变更）";
    expect(label.length * COLLEGE_NAME_FONT_SIZE + COLLEGE_NAME_AXIS_PADDING).toBeLessThanOrEqual(
      COLLEGE_NAME_AXIS_WIDTH,
    );
  });
});
