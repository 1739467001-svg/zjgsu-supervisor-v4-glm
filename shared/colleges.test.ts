import { describe, expect, it } from "vitest";
import { collegeVariants, resolveCollege, isCollegeInScope, OFFICIAL_COLLEGES } from "./colleges";

describe("collegeVariants", () => {
  it("合写的「工商管理学院（MBA学院）」归一为工商管理学院，不再展开出 MBA学院", () => {
    // 2026-2027 学年起两院拆分：MBA 学院的课程来自单独的 MBA 课表，
    // 合写名下的全是工商管理学院的学术学位课程。若仍展开出「MBA学院」这种写法，
    // MBA 学院的督导会连带匹配上工商管理学院的课，拆分就白做了。
    expect(collegeVariants("工商管理学院（MBA学院）")).toEqual(["工商管理学院"]);
  });

  it("带括号的官方全称仍保留括号内写法，便于匹配历史数据", () => {
    expect(collegeVariants("法学院（知识产权学院）").sort()).toEqual(
      ["法学院（知识产权学院）", "法学院", "知识产权学院"].sort()
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
  it("角色表的全称解析为课表使用的简称（课表是权限比对的实际对象）", () => {
    expect(resolveCollege("金融学院（浙商资产管理学院）")).toBe("金融学院");
    expect(resolveCollege("法学院（知识产权学院）")).toBe("法学院");
  });

  it("MBA学院是独立学院，不再被解析成工商管理学院", () => {
    expect(resolveCollege("MBA学院")).toBe("MBA学院");
    expect(resolveCollege("工商管理学院")).toBe("工商管理学院");
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

  it("括号内的学院名也能匹配到带括号全称的课程", () => {
    expect(isCollegeInScope("知识产权学院", "法学院（知识产权学院）")).toBe(true);
  });

  it("工商管理学院与 MBA 学院互不匹配（本学年起两院拆分）", () => {
    expect(isCollegeInScope("MBA学院", "工商管理学院")).toBe(false);
    expect(isCollegeInScope("工商管理学院", "MBA学院")).toBe(false);
    // 各自的课程仍各自匹配得上
    expect(isCollegeInScope("MBA学院", "MBA学院")).toBe(true);
    expect(isCollegeInScope("工商管理学院", "工商管理学院")).toBe(true);
  });

  it("完全一致时匹配", () => {
    expect(isCollegeInScope("经济学院", "经济学院")).toBe(true);
  });

  it("不同学院不应互相匹配", () => {
    expect(isCollegeInScope("经济学院", "金融学院（浙商资产管理学院）")).toBe(false);
    expect(isCollegeInScope("工商管理学院", "管理工程与电子商务学院（跨境电商学院）")).toBe(false);
    expect(isCollegeInScope("会计学院", "统计与数据科学学院")).toBe(false);
  });

  it("已按真实课表确认的别名可以匹配（人文与传播学院在课表里就叫人文学院）", () => {
    expect(isCollegeInScope("人文学院", "人文与传播学院")).toBe(true);
  });

  it("确实不同的学院不会因为字面相近而误配", () => {
    expect(isCollegeInScope("人文学院", "未来传播学院")).toBe(false);
    expect(isCollegeInScope("法学院", "法律硕士教育中心")).toBe(false);
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
