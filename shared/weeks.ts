/**
 * 听课周次（「第几周」）的展示规则。
 *
 * 研究生院在「评价进度」页要求：已评价课程的课程信息预览里必须能直接看到第几周听的课。
 * 一门课可能被多位督导在不同周听过，所以这里把各条评价的 actualWeek 去重后升序合并，
 * 输出「第3、5周」这样的一行文字；按数字排序而不是按字符串，否则会出现「第10、2周」。
 */

type WeekBearing = { actualWeek?: number | string | null };

/** 从若干条评价里取出有效的听课周次，去重并按数字升序排列 */
export function collectEvaluatedWeeks(evaluations?: readonly WeekBearing[] | null): number[] {
  if (!evaluations) return [];
  const weeks = new Set<number>();
  for (const ev of evaluations) {
    const raw = ev?.actualWeek;
    if (raw === null || raw === undefined || raw === "") continue;
    const n = Number(raw);
    // 0 和负数不是合法周次，小数同理；这类脏数据宁可不显示也不要显示成「第0周」
    if (!Number.isInteger(n) || n <= 0) continue;
    weeks.add(n);
  }
  return Array.from(weeks).sort((a, b) => a - b);
}

/**
 * 「第几周」展示文本。没有任何可用周次时返回 fallback，
 * 让使用方明确区分「没听过」和「听了但没记周次」。
 */
export function formatEvaluatedWeeks(
  evaluations?: readonly WeekBearing[] | null,
  fallback = "周次未记录"
): string {
  const weeks = collectEvaluatedWeeks(evaluations);
  return weeks.length > 0 ? `第${weeks.join("、")}周` : fallback;
}
