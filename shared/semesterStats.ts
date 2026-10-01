import type { CollegeStat } from "./dashboardCharts";

export type SemesterCollegeRow = {
  college: string; totalCourses: number; evaluatedCourses: number;
  evaluationCount: number; scoredCount: number; avgScore: number | null; coverage: number | null;
};

/** 仅合并数据库实际返回的学院。没有评分不是零分；没有课程不能计算覆盖率。 */
export function buildSemesterCollegeRows(
  courses: { college: string; totalCourses: number; evaluatedCourses: number }[],
  evaluations: CollegeStat[],
): SemesterCollegeRow[] {
  const rows = new Map<string, SemesterCollegeRow>();
  for (const c of courses) rows.set(c.college, {
    college: c.college, totalCourses: c.totalCourses, evaluatedCourses: c.evaluatedCourses,
    evaluationCount: 0, scoredCount: 0, avgScore: null,
    coverage: c.totalCourses ? c.evaluatedCourses / c.totalCourses * 100 : null,
  });
  for (const e of evaluations) {
    const college = e.college || "学院信息缺失（待核查）";
    const row = rows.get(college) ?? { college, totalCourses: 0, evaluatedCourses: 0, coverage: null, evaluationCount: 0, scoredCount: 0, avgScore: null };
    row.evaluationCount = e.count;
    row.scoredCount = e.scoredCount;
    row.avgScore = e.scoredCount > 0 ? e.avgScore : null;
    rows.set(college, row);
  }
  return [...rows.values()].sort((a, b) => a.college.localeCompare(b.college, "zh-CN"));
}
