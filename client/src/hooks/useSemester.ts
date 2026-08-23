import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { DEFAULT_SEMESTER, type SemesterConfig } from "@shared/dateUtils";

/**
 * 当前学期配置。
 *
 * 学期起始日与总周数原本写死在 shared/const.ts，跨学期即失效；现由服务端
 * semesters 表提供。数据未就绪或尚未配置任何学期时回退到常量默认值，
 * 保证界面在任何情况下都能正常渲染。
 */
export function useSemester() {
  const { data, isLoading } = trpc.semesters.active.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    const semester: SemesterConfig = data
      ? { startDate: data.startDate, totalWeeks: data.totalWeeks }
      : DEFAULT_SEMESTER;

    return {
      semester,
      /** 周次下拉选项，如 [1..19] */
      weeks: Array.from({ length: semester.totalWeeks }, (_, i) => i + 1),
      /** 学期显示名，如 "2025-2026 第二学期"；未配置时为 undefined */
      label: data ? `${data.academicYear} ${data.name}` : undefined,
      isLoading,
    };
  }, [data, isLoading]);
}
