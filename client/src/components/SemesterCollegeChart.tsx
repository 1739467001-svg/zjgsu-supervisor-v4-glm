import React from "react";
import type { SemesterCollegeRow } from "@shared/semesterStats";

const CONFIG = {
  coverage: { title: "各学院课程评价覆盖率", note: "已评价课程 / 该学院课程总数", color: "#1d4f80" },
  count: { title: "各学院督导评价次数", note: "所选学期已提交评价，含全部学院", color: "#397785" },
  score: { title: "各学院平均评分", note: "仅计有效评分；1—5 分，零起点坐标", color: "#746347" },
};

/** 三图同一学院集合、同一顺序；每行保留可读数值，不依赖颜色或悬浮。 */
export function SemesterCollegeChart({ rows, kind }: { rows: SemesterCollegeRow[]; kind: keyof typeof CONFIG }) {
  const config = CONFIG[kind];
  const max = kind === "coverage" ? 100 : kind === "score" ? 5 : Math.max(1, ...rows.map(r => r.evaluationCount));
  return <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5" aria-label={config.title}>
    <h2 className="text-sm font-semibold text-slate-900">{config.title}</h2>
    <p className="text-xs text-slate-500 mt-1 mb-5">{config.note}</p>
    <ul className="space-y-4">{rows.map(r => {
      const value = kind === "coverage" ? r.coverage : kind === "score" ? r.avgScore : r.evaluationCount;
      const display = value === null ? (kind === "score" ? "暂无评分" : "无课程") : kind === "score" ? `${value.toFixed(2)} 分` : kind === "coverage" ? `${value.toFixed(1)}%` : `${value} 次`;
      return <li key={r.college}>
        <div className="flex items-start justify-between gap-2 text-xs leading-5"><span className="text-slate-700 break-words">{r.college}</span><span className="text-slate-900 font-medium tabular-nums whitespace-nowrap">{display}</span></div>
        <div className="h-2 mt-1 rounded-sm bg-slate-100" aria-hidden="true"><div className="h-full rounded-sm" style={{ width: `${Math.min(100, (value ?? 0) / max * 100)}%`, backgroundColor: config.color }} /></div>
      </li>;
    })}</ul>
    {rows.length === 0 && <p className="text-sm text-slate-500 py-6">该学期暂无数据</p>}
    <p className="text-xs text-slate-400 mt-5">范围：0—{max}{kind === "coverage" ? "%" : kind === "score" ? " 分" : " 次"}</p>
  </section>;
}
