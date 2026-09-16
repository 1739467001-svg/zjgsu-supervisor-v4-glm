/**
 * 统计仪表盘里三张学院图表的共同数据源。
 *
 * 需求 6 反复没修掉的原因：前两次只统一了「数据从哪来」，没统一「怎么截断」。
 * 上一版三张图都取自 collegeStats，但柱状图 slice(0, 10) 直接把尾部学院丢掉、
 * 不留任何痕迹，饼图却把同一批尾部合成「其他 N 个学院」多出一个扇区 ——
 * 于是页面上是 10 / 11 / 10，研究生院看到的仍然是「三张图学院数量不一致」。
 *
 * 这次让三张图**共用同一个数组**：数量一致不再靠三处代码各自小心，而是由构造保证。
 * 想让它们不一致，得先把这个函数拆了。
 *
 * 为什么是前 7 名 + 「其他」而不是全部列出：
 * 分类色最多到 8 槽，再多就得循环取色，而循环出来的颜色在色盲视角下和已有槽位
 * 无法区分（这正是上一版饼图 11 个扇区的毛病）。逐个学院的明细在页面下方的
 * 「全校各学院课程评价进度」里本来就有，那里是列表，不受配色槽位限制。
 */

export type CollegeStat = {
  college: string | null;
  count: number;
  scoredCount: number;
  avgScore: number | null;
};

export type CollegeChartRow = {
  /** 图表上显示的名字；「其他」行是汇总标签 */
  name: string;
  /** 评价次数 */
  count: number;
  /** 平均分，保留两位；该组没有任何一条打了总分时为 null */
  score: number | null;
  /** 打了总分的评价条数，用于加权平均与提示文案 */
  scoredCount: number;
  /** 占全部评价的百分比，保留一位 */
  share: number;
  /** 是否是「其他 N 个学院」汇总行 */
  isOthers: boolean;
  /** 汇总行代表几个学院；非汇总行为 1 */
  collegeCount: number;
};

export const COLLEGE_CHART_TOP_N = 7;

/** 图表纵轴上学院名的字号（px），与组件里的 AXIS_TICK 保持一致 */
export const COLLEGE_NAME_FONT_SIZE = 10;
/** 刻度线与文字之间的留白（px） */
export const COLLEGE_NAME_AXIS_PADDING = 12;
/**
 * 横向条形图纵轴的宽度。
 *
 * 不够宽时 recharts 会把学院名从左边裁掉 —— 96px 时「食品科学与生物工程学院」
 * 变成「科学与生物工程学院」，正是研究生院一直在反馈的截断问题。
 * dashboardCharts.test.ts 里有一条测试拿真实学院名单校这个值，
 * 将来新增更长的学院名会直接测试失败，而不是悄悄被裁掉。
 */
export const COLLEGE_NAME_AXIS_WIDTH = 132;

/**
 * 把后端的学院聚合结果压成三张图共用的一份数据。
 *
 * @param stats 后端 collegeStats，已按评价次数降序；这里仍会重新排序，不依赖调用方
 * @param topN  单独成行的学院个数，其余合并为「其他」
 */
export function buildCollegeChartRows(
  stats: CollegeStat[] | null | undefined,
  topN: number = COLLEGE_CHART_TOP_N,
): CollegeChartRow[] {
  const list = (stats ?? []).filter((s) => s && s.count > 0);
  if (list.length === 0) return [];

  const total = list.reduce((sum, s) => sum + s.count, 0);
  const share = (count: number) => (total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0);

  // 不依赖调用方的排序；次数相同时按学院名排，保证每次渲染顺序稳定
  const sorted = [...list].sort(
    (a, b) => b.count - a.count || (a.college || "").localeCompare(b.college || "", "zh"),
  );

  const head = sorted.slice(0, topN);
  const tail = sorted.slice(topN);

  const rows: CollegeChartRow[] = head.map((c) => ({
    name: c.college || "未知学院",
    count: c.count,
    score: c.avgScore === null || c.avgScore === undefined ? null : Number(Number(c.avgScore).toFixed(2)),
    scoredCount: Number(c.scoredCount) || 0,
    share: share(c.count),
    isOthers: false,
    collegeCount: 1,
  }));

  if (tail.length > 0) {
    const tailCount = tail.reduce((sum, c) => sum + c.count, 0);
    const tailScored = tail.reduce((sum, c) => sum + (Number(c.scoredCount) || 0), 0);
    // 加权平均：把各学院的平均分按「打了总分的条数」还原成总分再求均值。
    // 直接对平均分取算术平均会让只有 1 条评价的学院和有 30 条的学院等权。
    const tailScoreSum = tail.reduce(
      (sum, c) => sum + (c.avgScore === null || c.avgScore === undefined ? 0 : Number(c.avgScore) * (Number(c.scoredCount) || 0)),
      0,
    );
    rows.push({
      // 不留空格：带空格时 recharts 会在纵轴上把它折成两行，压到坐标轴上
      name: `其他${tail.length}个学院`,
      count: tailCount,
      score: tailScored > 0 ? Number((tailScoreSum / tailScored).toFixed(2)) : null,
      scoredCount: tailScored,
      share: share(tailCount),
      isOthers: true,
      collegeCount: tail.length,
    });
  }

  return rows;
}
