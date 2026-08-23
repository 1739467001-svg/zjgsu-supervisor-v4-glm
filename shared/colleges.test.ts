import { describe, expect, it } from "vitest";
import { collegeVariants, resolveCollege, isCollegeInScope, OFFICIAL_COLLEGES } from "./colleges";

describe("collegeVariants", () => {
  it("把括号内容单独保留为一种写法", () => {
    expect(collegeVariants("工商管理学院（MBA学院）").sort()).toEqual(
      ["工商管理学院（MBA学院）", "工商管理学院", "MBA学院"].sort()
    );
  });

  it("无括号的名称只有一种写法", () => {
    expect(collegeVariants("经济学院")).toEqual(["经济学院"]);
  });

  it("空值返回空数组", () => {
    expect(collegeVariants(null)).toEqual([]);
    expect(collegeVariants("   ")).toEqual([]);
  });
});

describe("resolveCollege", () => {
  it("简称可解析为官方全称", () => {
    expect(resolveCollege("金融学院")).toBe("金融学院（浙商资产管理学院）");
    expect(resolveCollege("MBA学院")).toBe("工商管理学院（MBA学院）");
  });

  it("官方全称原样返回", () => {
    expect(resolveCollege("经济学院")).toBe("经济学院");
  });

  it("无法确定的名称原样返回，不臆测", () => {
    expect(resolveCollege("国际教育学院")).toBe("国际教育学院");
    expect(resolveCollege("人文学院")).toBe("人文学院");
  });
});

describe("isCollegeInScope", () => {
  it("简称能匹配到官方全称的课程", () => {
    expect(isCollegeInScope("金融学院", "金融学院（浙商资产管理学院）")).toBe(true);
    expect(isCollegeInScope("工商管理学院", "工商管理学院（MBA学院）")).toBe(true);
    expect(isCollegeInScope("法学院", "法学院（知识产权学院）")).toBe(true);
  });

  it("括号内的学院名也能匹配到合并口径的课程", () => {
    // 课表把 MBA 学院并在工商管理学院名下，人员表却已按拆分口径单独填「MBA学院」。
    // 这是早先「两侧都剥括号」的实现匹配不到的情形。
    expect(isCollegeInScope("MBA学院", "工商管理学院（MBA学院）")).toBe(true);
    expect(isCollegeInScope("知识产权学院", "法学院（知识产权学院）")).toBe(true);
  });

  it("完全一致时匹配", () => {
    expect(isCollegeInScope("经济学院", "经济学院")).toBe(true);
  });

  it("不同学院不应互相匹配", () => {
    expect(isCollegeInScope("经济学院", "金融学院（浙商资产管理学院）")).toBe(false);
    expect(isCollegeInScope("工商管理学院", "管理工程与电子商务学院（跨境电商学院）")).toBe(false);
    expect(isCollegeInScope("会计学院", "统计与数据科学学院")).toBe(false);
  });

  it("名称确有出入且无法推断时不匹配（留给人工确认，不臆测）", () => {
    expect(isCollegeInScope("人文学院", "人文与传播学院")).toBe(false);
  });

  it("支持一人管多个学院（顿号/逗号分隔）", () => {
    expect(isCollegeInScope("经济学院、会计学院", "会计学院")).toBe(true);
    expect(isCollegeInScope("经济学院,会计学院", "经济学院")).toBe(true);
    expect(isCollegeInScope("经济学院、会计学院", "外国语学院")).toBe(false);
  });

  it("课程学院为空时不应放行（避免无学院的课程对所有院级督导可见）", () => {
    expect(isCollegeInScope("经济学院", null)).toBe(false);
    expect(isCollegeInScope("经济学院", "")).toBe(false);
  });

  it("每个官方学院都能匹配到自身", () => {
    for (const c of OFFICIAL_COLLEGES) {
      expect(isCollegeInScope(c, c), c).toBe(true);
    }
  });

  it("官方学院之间不应出现交叉匹配", () => {
    const crossed: string[] = [];
    for (const a of OFFICIAL_COLLEGES) {
      for (const b of OFFICIAL_COLLEGES) {
        if (a !== b && isCollegeInScope(a, b)) crossed.push(`${a} → ${b}`);
      }
    }
    expect(crossed).toEqual([]);
  });
});
