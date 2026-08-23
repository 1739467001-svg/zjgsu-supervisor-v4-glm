/**
 * 学院名称口径统一
 *
 * 背景：同一个学院在不同来源里写法不一致 ——
 *   - 课表「开课院系」用官方全称，如「金融学院（浙商资产管理学院）」
 *   - 人员名单常用简称，如「金融学院」
 *   - 有的学院在官方全称里是合并的（「工商管理学院（MBA学院）」），
 *     而人员名单已按将来拆分后的口径分开填写（「工商管理学院」「MBA学院」）
 *
 * 本模块是学院名称比对的唯一事实来源，权限判定与人员导入校验共用，
 * 避免出现「导入时校验通过、实际使用时无权限」的不一致。
 */

/** 学校官方学院全称（取自角色信息表的 Colleges 下拉列表） */
export const OFFICIAL_COLLEGES = [
  "工商管理学院（MBA学院）",
  "经济学院",
  "金融学院（浙商资产管理学院）",
  "统计与数据科学学院",
  "会计学院",
  "旅游与城乡规划学院",
  "法学院（知识产权学院）",
  "食品与生物工程学院",
  "信息与电子工程学院",
  "计算机科学与技术学院",
  "马克思主义学院",
  "公共管理学院",
  "外国语学院",
  "东方语言与哲学学院",
  "艺术设计学院",
  "环境科学与工程学院",
  "人文与传播学院",
  "管理工程与电子商务学院（跨境电商学院）",
  "萨塞克斯人工智能学院",
  "英贤慈善学院",
  "稻盛商学院",
] as const;

/**
 * 别名 → 官方全称。
 *
 * 仅登记「靠字面无法推断、必须人工确认」的对应关系。
 * 简称与全称之间的差异（如「金融学院」对「金融学院（浙商资产管理学院）」）
 * 由 collegeVariants 自动处理，不必写在这里。
 *
 * 待确认（需以实际课表的「开课院系」为准，确认后在此登记）：
 *   - 人文学院          → 疑似「人文与传播学院」，但课表中也可能就叫「人文学院」
 *   - 未来传播学院      → 官方列表中无对应项
 *   - 国际教育学院      → 官方列表中无对应项
 *   - 法律硕士教育中心  → 官方列表中无对应项
 */
export const COLLEGE_ALIASES: Record<string, string> = {};

/**
 * 生成一个学院名的所有可比对写法。
 *
 * 「工商管理学院（MBA学院）」→ ["工商管理学院（MBA学院）", "工商管理学院", "MBA学院"]
 *
 * 括号内的内容必须单独作为一个写法保留：课表把 MBA 学院并在工商管理学院名下，
 * 人员名单却已按拆分后的口径单独填「MBA学院」。若像早先实现那样把括号内容
 * 一律剥掉，「MBA学院」就再也匹配不到任何课程了。
 */
export function collegeVariants(name: string | null | undefined): string[] {
  const raw = (name || "").trim();
  if (!raw) return [];

  const canonical = COLLEGE_ALIASES[raw] ?? raw;
  const variants = new Set<string>();

  const add = (v: string) => {
    const t = v.trim();
    if (t) variants.add(t);
  };

  add(canonical);
  // 去掉括号补充说明后的主体名
  add(canonical.replace(/（.*?）/g, "").replace(/\(.*?\)/g, ""));
  // 括号内的内容本身
  for (const m of canonical.matchAll(/[（(]([^）)]*)[）)]/g)) add(m[1]);

  return [...variants];
}

/** 把一个学院名（可能是简称/别名）解析为官方全称；无法确定时原样返回 */
export function resolveCollege(name: string | null | undefined): string {
  const raw = (name || "").trim();
  if (!raw) return "";
  if (COLLEGE_ALIASES[raw]) return COLLEGE_ALIASES[raw];
  const hit = OFFICIAL_COLLEGES.find((official) =>
    collegeVariants(official).some((v) => v === raw)
  );
  return hit ?? raw;
}

/**
 * 判断某门课程的开课学院是否落在给定的督导/管理范围内。
 *
 * scopedCollege 可包含多个学院（顿号/逗号分隔，供一人管多院的场景使用）。
 * 两侧都会展开成各自的写法集合后再做双向包含匹配，以容忍简称/全称差异。
 */
export function isCollegeInScope(
  scopedCollege: string,
  courseCollege: string | null | undefined
): boolean {
  const courseVariants = collegeVariants(courseCollege);
  if (courseVariants.length === 0) return false;

  return scopedCollege
    .split(/[、,，]/)
    .flatMap((part) => collegeVariants(part))
    .some((sv) => courseVariants.some((cv) => cv.includes(sv) || sv.includes(cv)));
}
