import { useLocation } from "wouter";
import { useSemesterSelection } from "@/contexts/SemesterSelection";
import { semesterLabel } from "@shared/semesterArchive";

export default function SemesterSwitcher() {
  const { semesters, semesterId, select, isHistorical } = useSemesterSelection();
  const [path] = useLocation();
  const editing = path.includes("/evaluations/new/") || path.endsWith("/edit");
  return <section className="border-b bg-white px-4 py-3 sm:px-6 flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="学期档案">
    <label className="flex items-center gap-2 text-sm font-medium">查看学期
      <select aria-label="查看学期" value={semesterId} disabled={editing} onChange={e => select(Number(e.target.value))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-60">
        {semesters.map(s => <option key={s.id} value={s.id}>{semesterLabel(s)}{s.isActive ? " · 当前学期" : " · 历史档案"}</option>)}
      </select>
    </label>
    <p className="text-xs text-slate-500">{editing ? "填写期间请先保存或返回列表，再切换学期。" : isHistorical ? "历史档案只读，可查询、统计和导出；不会影响当前学期。" : "切换仅改变查看范围，不清空数据，也不更改全校当前学期。"}</p>
  </section>;
}
