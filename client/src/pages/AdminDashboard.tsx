import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useSemesterSelection } from "@/contexts/SemesterSelection";
import { SemesterCollegeChart } from "@/components/SemesterCollegeChart";

export default function AdminDashboard() {
  const { semesterId, label, isHistorical } = useSemesterSelection();
  const [, navigate] = useLocation();
  const { data: stats, isLoading, error, refetch } = trpc.stats.adminDashboard.useQuery({ semesterId });
  const rows = stats?.semesterColleges ?? [];
  const evaluated = rows.reduce((n, r) => n + r.evaluatedCourses, 0);
  const scored = rows.reduce((n, r) => n + r.scoredCount, 0);
  const scoreSum = rows.reduce((n, r) => n + (r.avgScore ?? 0) * r.scoredCount, 0);
  const coverage = stats?.totalCourses ? evaluated / stats.totalCourses * 100 : null;
  return <DashboardLayout>
    <div className="p-4 sm:p-6 space-y-6 max-w-[1440px] mx-auto">
      <header className="border-b border-slate-200 pb-5">
        <p className="text-xs text-slate-500 tracking-wider">浙江工商大学 · 研究生院</p>
        <h1 className="text-2xl font-semibold text-slate-900 mt-2">学期督导概览</h1>
        <p className="mt-2 text-sm text-slate-600">{label} · {isHistorical ? "历史学期档案" : "当前学期"} · 只统计该学期已提交的评价，草稿保留在评价记录中。</p>
      </header>
      {isLoading ? <p role="status">正在加载所选学期数据…</p> : error || !stats ?
        <div role="alert" className="rounded-lg border border-red-200 p-5"><p>统计数据加载失败，未将错误显示为 0。</p><button onClick={() => refetch()} className="underline mt-2">重新加载</button></div> : <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ["课程总数", stats.totalCourses, `${rows.filter(r => r.totalCourses > 0).length} 个实际开课学院`],
            ["已提交评价", stats.totalEvaluations, "次数不等于课程数，同一课程可多次评价"],
            ["课程评价覆盖率", coverage === null ? "—" : `${coverage.toFixed(1)}%`, `${evaluated} / ${stats.totalCourses} 门课程已评价`],
            ["整体平均评分", scored ? (scoreSum / scored).toFixed(2) : "—", `${scored} 条有效评分 · 满分 5 分`],
          ].map(([title, value, note]) => <section key={String(title)} className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5">
            <h2 className="text-xs sm:text-sm text-slate-600">{title}</h2><p className="text-2xl sm:text-3xl font-semibold tabular-nums text-slate-900 mt-3">{value}</p><p className="text-xs text-slate-500 mt-2 leading-relaxed">{note}</p>
          </section>)}
        </div>
        {stats.totalEvaluations === 0 && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">该学期暂无已提交评价。零次数表示尚未评价，不代表零分；请用顶部学期选择器查看历史记录。</p>}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <SemesterCollegeChart rows={rows} kind="coverage" />
          <SemesterCollegeChart rows={rows} kind="count" />
          <SemesterCollegeChart rows={rows} kind="score" />
        </div>
        <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap justify-between gap-3 mb-3"><h2 className="font-semibold">学院数据明细</h2><div className="flex gap-4 text-sm text-blue-800"><button className="underline" onClick={() => navigate("/course-progress")}>查看课程覆盖明细</button><button className="underline" onClick={() => navigate("/evaluations")}>查看／导出评价记录</button></div></div>
          <p className="text-xs text-slate-500 mb-4">学院名称沿用所选学期原始记录，不新增、不改名、不合并为“其他”。无评分显示“—”，不以 0 分代替。</p>
          <div className="overflow-x-auto"><table className="w-full text-sm text-left min-w-[620px]"><caption className="sr-only">{label}学院督导统计明细</caption>
            <thead className="border-b text-slate-500"><tr>{["学院", "课程数", "已评价课程", "覆盖率", "评价次数", "有效评分数", "平均评分"].map(t => <th key={t} scope="col" className="py-3 pr-4 font-medium">{t}</th>)}</tr></thead>
            <tbody>{rows.map(r => <tr key={r.college} className="border-b border-slate-100"><th scope="row" className="py-3 pr-4 font-medium">{r.college}</th><td>{r.totalCourses}</td><td>{r.evaluatedCourses}</td><td>{r.coverage === null ? "—" : `${r.coverage.toFixed(1)}%`}</td><td>{r.evaluationCount}</td><td>{r.scoredCount}</td><td>{r.avgScore === null ? "—" : r.avgScore.toFixed(2)}</td></tr>)}</tbody>
          </table></div>
          {rows.length === 0 && <p className="py-6 text-sm text-slate-500">该学期暂无学院数据。</p>}
        </section>
      </>}
    </div>
  </DashboardLayout>;
}
