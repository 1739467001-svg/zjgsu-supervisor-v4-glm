import { createContext, useContext, useState, Fragment } from "react";
import { trpc } from "@/lib/trpc";
import { semesterLabel } from "@shared/semesterArchive";

type Semester = { id: number; academicYear: string; name: string; startDate: string; totalWeeks: number; isActive: boolean };
type Selection = { semester: Semester; semesterId: number; semesters: Semester[]; isHistorical: boolean; label: string; select: (id: number) => void };
const Context = createContext<Selection | null>(null);

export function SemesterSelectionProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error, refetch } = trpc.semesters.list.useQuery();
  const [chosen, setChosen] = useState<number | undefined>(() => {
    try { return Number(sessionStorage.getItem("view-semester")) || undefined; } catch { return undefined; }
  });
  const semester = data?.find(s => s.id === chosen) ?? data?.find(s => s.isActive) ?? data?.[0];
  if (isLoading) return <div className="p-8 text-sm" role="status">正在加载学期档案…</div>;
  if (error || !semester) return <div className="p-8" role="alert"><p>{error ? "学期档案加载失败，请重试。" : "尚未建立学期档案，请联系管理员。"}</p><button onClick={() => refetch()} className="mt-3 underline">重新加载</button></div>;
  return <Context.Provider value={{ semester, semesters: data!, semesterId: semester.id, isHistorical: !semester.isActive, label: semesterLabel(semester), select: id => {
    setChosen(id);
    try { sessionStorage.setItem("view-semester", String(id)); } catch { /* 本次会话仍可切换 */ }
  } }}>
    {/* 切换后重置筛选、分页和弹窗，防止前一学期的选择残留。 */}
    <Fragment key={semester.id}>{children}</Fragment>
  </Context.Provider>;
}

export function useSemesterSelection() {
  const value = useContext(Context);
  if (!value) throw new Error("SemesterSelectionProvider is required");
  return value;
}
