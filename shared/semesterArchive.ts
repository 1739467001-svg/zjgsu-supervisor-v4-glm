/** 学期标识来自档案，不根据当前日期推算或创建学期。 */
export function semesterLabel(s: { academicYear: string; name: string }) {
  const term = s.name === "第一学期" ? "1" : s.name === "第二学期" ? "2" : s.name;
  return `${s.academicYear}-${term}`;
}

/** 历史/未归档记录都只读；绝不能因切换查看学期重新归属。 */
export function isWritableSemester(recordId: number | null | undefined, activeId: number | null | undefined) {
  return recordId != null && activeId != null && recordId === activeId;
}
