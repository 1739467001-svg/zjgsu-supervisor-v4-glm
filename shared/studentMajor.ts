/**
 * 「学生专业」字段的解析。
 *
 * 课表里这一列是机器格式，多个专业用分号相连、每个专业内部用竖线分隔：
 *   2026|全日制硕士|企业管理;2026|全日制硕士|国别和区域研究;
 *
 * 一门课最多能挂四五个专业，整串接近 200 字符。直接原样塞进一个窄格子里，
 * 手机上必然显示不全 —— 所以先拆成结构化的条目，界面再逐条展示。
 */

export type StudentMajor = {
  /** 年级，如 "2026" */
  grade: string;
  /** 培养类型，如 "全日制硕士" "博士" "硕士留学生" */
  degreeType: string;
  /** 专业名称 */
  major: string;
};

/** 把课表的「学生专业」串拆成条目；识别不了的整段作为专业名保留，不丢信息 */
export function parseStudentMajors(raw: string | null | undefined): StudentMajor[] {
  const text = (raw || "").trim();
  if (!text) return [];

  const seen = new Set<string>();
  const result: StudentMajor[] = [];

  for (const chunk of text.split(/[;；]/)) {
    const entry = chunk.trim();
    if (!entry) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);

    const parts = entry.split(/[|｜]/).map((p) => p.trim());
    if (parts.length >= 3) {
      result.push({ grade: parts[0], degreeType: parts[1], major: parts.slice(2).join(" ") });
    } else if (parts.length === 2) {
      result.push({ grade: "", degreeType: parts[0], major: parts[1] });
    } else {
      // 不是预期格式（可能是手工填的），整段当专业名，宁可原样显示也不要丢掉
      result.push({ grade: "", degreeType: "", major: entry });
    }
  }

  return result;
}

/** 一个条目的展示文本，如 "2026 全日制硕士 · 企业管理" */
export function formatStudentMajor(m: StudentMajor): string {
  const prefix = [m.grade, m.degreeType].filter(Boolean).join(" ");
  return prefix ? `${prefix} · ${m.major}` : m.major;
}
