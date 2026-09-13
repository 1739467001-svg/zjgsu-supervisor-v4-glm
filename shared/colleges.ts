/**
 * 学院名称口径统一
 *
 * 背景：同一个学院在不同来源里写法不一致 ——
 *   - 课表「开课院系」用的是简称，如「金融学院」「法学院」
 *   - 角色信息表的下拉列表用官方全称，如「金融学院（浙商资产管理学院）」
 *   - 工商管理学院与 MBA 学院在课表里曾合写成「工商管理学院（MBA学院）」，
 *     研究生院要求从 2026-2027 学年起按两个学院分开统计
 *
 * 本模块是学院名称比对的唯一事实来源，权限判定与人员/课表导入校验共用，
 * 避免出现「导入时校验通过、实际使用时无权限」的不一致。
 *
 * 下面这份学院清单以 2026-2027 学年第一学期研究生课表的「开课院系」为准
 * （课表是权限判定的实际比对对象，以它为准才不会出现匹配不上的情况）。
 */

/** MBA 学院（自 2026-2027 学年起从工商管理学院拆出，单独排课、单独统计） */
export const MBA_COLLEGE = "MBA学院";

/** 工商管理学院（拆分后仅含学术学位课程，MBA/MPM 专业学位归 MBA 学院） */
export const BUSINESS_COLLEGE = "工商管理学院";

/** 课表中出现过的开课院系（2026-2027 第一学期实际数据 + 拆分出的 MBA 学院） */
export const OFFICIAL_COLLEGES = [
  "工商管理学院",
  "MBA学院",
  "经济学院",
  "金融学院",
  "统计与数据科学学院",
  "会计学院",
  "旅游与城乡规划学院",
  "法学院",
  "法律硕士教育中心",
  "食品与生物工程学院",
  "信息与电子工程学院",
  "计算机科学与技术学院",
  "马克思主义学院",
  "公共管理学院",
  "外国语学院",
  "东方语言与哲学学院",
  "艺术设计学院",
  "环境科学与工程学院",
  "人文学院",
  "未来传播学院",
  "国际教育学院",
  "管理工程与电子商务学院",
  "萨塞克斯人工智能学院",
  "英贤慈善学院",
  "稻盛商学院",
] as const;

/**
 * 别名 → 本系统采用的学院名。
 *
 * 只登记「靠字面推不出来、必须人工确认」的对应关系；简称与带括号全称之间的
 * 差异（「金融学院」对「金融学院（浙商资产管理学院）」）由 collegeVariants 自动处理。
 *
 * 「工商管理学院（MBA学院）」的处理是本次拆分的关键：课表把两个学院合写在一起，
 * 而这批课全部是学术学位课程（企业管理/技术经济及管理/应用心理/会计学等），
 * MBA、MPM 等专业学位课程在另一张 MBA 课表里。因此合写的名字一律归入工商管理学院，
 * MBA 学院的课程来自 MBA 课表。
 */
export const COLLEGE_ALIASES: Record<string, string> = {
  // 合写口径必须显式登记：单靠剥括号会同时得到「工商管理学院」和「MBA学院」两种写法，
  // 那样 MBA 学院的督导会连带匹配上工商管理学院的课，拆分就失效了。
  "工商管理学院（MBA学院）": BUSINESS_COLLEGE,
  "工商管理学院(MBA学院)": BUSINESS_COLLEGE,
  // 原「人文与传播学院」在 2026-2027 课表里已拆成「人文学院」与「未来传播学院」，
  // 人员表里若仍写旧名，按人文学院处理
  "人文与传播学院": "人文学院",
};

// 说明：「金融学院（浙商资产管理学院）」「法学院（知识产权学院）」这类
// 「全称=简称+括号补充」的情况不必登记 —— collegeVariants 会自动剥括号，
// 括号内的写法也一并保留，两侧都能匹配上。

/**
 * 生成一个学院名的所有可比对写法。
 *
 * 「金融学院（浙商资产管理学院）」→ ["金融学院", "浙商资产管理学院"]（先经别名表归一为「金融学院」）
 *
 * 先过一遍别名表再展开，所以「工商管理学院（MBA学院）」会先归一成「工商管理学院」，
 * 不会再展开出「MBA学院」这个写法 —— 这正是本次拆分要的效果：MBA 学院的范围
 * 只覆盖 MBA 课表导入的课程，不会连带匹配上工商管理学院的学术学位课程。
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

/**
 * 把一个学院名（简称/全称/别名）解析为本系统采用的学院名；无法确定时原样返回。
 *
 * 比对的是双方的「写法集合」有没有交集，所以「法学院（知识产权学院）」和
 * 「知识产权学院」都能解析到「法学院」。
 */
export function resolveCollege(name: string | null | undefined): string {
  const raw = (name || "").trim();
  if (!raw) return "";
  if (COLLEGE_ALIASES[raw]) return COLLEGE_ALIASES[raw];
  const rawVariants = new Set(collegeVariants(raw));
  const hit = OFFICIAL_COLLEGES.find((official) =>
    collegeVariants(official).some((v) => rawVariants.has(v))
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

/**
 * 课表「开课院系」→ 本系统学院名。
 *
 * 导入课表时统一调用，确保库里存的就是拆分后的口径，
 * 而不是把「工商管理学院（MBA学院）」这种合写名字一路带到统计图表里。
 */
export function normalizeCourseCollege(raw: string | null | undefined): string {
  return resolveCollege(raw);
}

