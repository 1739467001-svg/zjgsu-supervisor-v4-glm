import { describe, expect, it } from "vitest";
import { buildSemesterCollegeRows } from "./semesterStats";
import { isWritableSemester, semesterLabel } from "./semesterArchive";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SemesterCollegeChart } from "../client/src/components/SemesterCollegeChart";

describe("真实学院统计", () => {
  const courses = [{ college: "法学院", totalCourses: 20, evaluatedCourses: 2 }, { college: "MBA学院", totalCourses: 30, evaluatedCourses: 0 }];
  const evals = [{ college: "法学院", count: 3, scoredCount: 2, avgScore: 4.25 }];
  it("只展示实际学院，保留无评价学院，不造评分", () => {
    const rows = buildSemesterCollegeRows(courses, evals);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.college === "MBA学院")).toMatchObject({ evaluationCount: 0, avgScore: null, coverage: 0 });
    expect(rows.find(r => r.college === "法学院")).toMatchObject({ evaluationCount: 3, evaluatedCourses: 2, coverage: 10 });
    expect(rows.reduce((n, r) => n + r.evaluationCount, 0)).toBe(3);
  });
  it("三个图同一学院集合，没有饼图或星期图", () => {
    const rows = buildSemesterCollegeRows(courses, evals);
    for (const kind of ["coverage", "count", "score"] as const) {
      const html = renderToStaticMarkup(createElement(SemesterCollegeChart, { rows, kind }));
      for (const row of rows) expect(html).toContain(row.college);
      expect(html.match(/<li>/g)).toHaveLength(2);
      expect(html).not.toContain("其他");
    }
  });
  it("异常关联不静默丢评价，也不伪装真实学院", () => {
    const rows = buildSemesterCollegeRows([], [{ college: null, count: 2, scoredCount: 0, avgScore: null }]);
    expect(rows[0]).toMatchObject({ college: "学院信息缺失（待核查）", evaluationCount: 2, coverage: null, avgScore: null });
  });
  it("空学期不复制其他学期的学院", () => expect(buildSemesterCollegeRows([], [])).toEqual([]));
  it("学期名称使用学校约定格式", () => {
    expect(semesterLabel({ academicYear: "2025-2026", name: "第二学期" })).toBe("2025-2026-2");
    expect(semesterLabel({ academicYear: "2026-2027", name: "第一学期" })).toBe("2026-2027-1");
  });
  it("历史或未归档记录均不可写", () => {
    expect(isWritableSemester(1, 2)).toBe(false);
    expect(isWritableSemester(null, 2)).toBe(false);
    expect(isWritableSemester(undefined, undefined)).toBe(false);
    expect(isWritableSemester(2, 2)).toBe(true);
  });
});
