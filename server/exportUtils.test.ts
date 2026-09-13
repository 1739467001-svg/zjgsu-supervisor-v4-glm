/**
 * 打印/PDF 版式的回归测试。
 *
 * 背景：老师们拿到的 PDF 里看不出督导打了几分。原因不是颜色不够深，
 * 而是浏览器打印对话框的「背景图形」默认关闭，把 background 全部丢掉 ——
 * 选中的分数是「深色底 + 白字」，底色一丢就成了白纸上的白字，直接消失；
 * 分区标题同理。而且当时有两套各写一份的版式，只修好了其中一套。
 *
 * 这里守住三件事：两条导出路径必须同源、选中分数不得依赖底色、黑白模式可用。
 */
import { describe, expect, it } from "vitest";
import { generatePrintableHtml, generateEvaluationPdfHtml } from "./exportUtils";

function sampleEvaluation(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "submitted",
    overallScore: 4.2,
    actualWeek: 7,
    listenDate: new Date("2026-04-08T02:00:00Z"),
    highlights: "以顶刊论文为引子展开案例讨论",
    suggestions: "后半段节奏偏快",
    score_teaching_content: 5,
    score_course_objective: 4,
    score_reference_sharing: 3,
    course: { courseName: "企业战略管理", teacher: "陈老师", college: "工商管理学院" },
    supervisor: { name: "李靖华", employeeId: "1001", role: "supervisor_expert" },
    ...overrides,
  } as any;
}

/** 取出某条 CSS 规则的声明体 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(escaped + "\\s*\\{([^}]*)\\}"));
  if (!match) throw new Error(`样式里找不到选择器 ${selector}`);
  return match[1];
}

describe("两条导出路径必须同源", () => {
  it("批量导出 PDF 与单份打印页产出完全一致", () => {
    const evals = [sampleEvaluation(), sampleEvaluation({ id: 2, score_teaching_content: 2 })];
    expect(generateEvaluationPdfHtml(evals)).toBe(generatePrintableHtml(evals));
  });

  it("只有已提交的评价会进入打印页", () => {
    const html = generatePrintableHtml([
      sampleEvaluation({ course: { courseName: "已提交的课" } }),
      sampleEvaluation({ id: 9, status: "draft", course: { courseName: "还在草稿的课" } }),
    ]);
    expect(html).toContain("已提交的课");
    expect(html).not.toContain("还在草稿的课");
  });
});

describe("打印时底色不会丢失", () => {
  it("强制保留背景色，不受打印对话框「背景图形」开关影响", () => {
    const html = generatePrintableHtml([sampleEvaluation()]);
    expect(html).toContain("print-color-adjust: exact");
    expect(html).toContain("-webkit-print-color-adjust: exact");
  });
});

describe("选中的分数不依赖底色", () => {
  const html = generatePrintableHtml([sampleEvaluation()]);

  it("选中态不用白字 —— 底色万一被丢掉就会变成白纸白字", () => {
    const body = ruleBody(html, ".score-dot.active");
    expect(body).not.toMatch(/color:\s*(#fff\b|#ffffff\b|white\b)/i);
  });

  it("选中态用加粗深色数字", () => {
    const body = ruleBody(html, ".score-dot.active");
    expect(body).toMatch(/color:\s*var\(--ink\)/);
    expect(body).toMatch(/font-weight:\s*(?:[7-9]00|bold)/);
  });

  it("选中态的圆环明显比未选中粗，黑白打印也能一眼区分", () => {
    const active = ruleBody(html, ".score-dot.active").match(/border:\s*([\d.]+)px/);
    const inactive = ruleBody(html, ".score-dot.inactive").match(/border:\s*([\d.]+)px/);
    expect(active).not.toBeNull();
    expect(inactive).not.toBeNull();
    expect(Number(active![1])).toBeGreaterThanOrEqual(2);
    expect(Number(active![1])).toBeGreaterThan(Number(inactive![1]));
  });

  it("分区标题也不用白字（此前白字压在深蓝底上，一打印就没了）", () => {
    const body = ruleBody(html, ".section-header");
    expect(body).not.toMatch(/color:\s*(#fff\b|#ffffff\b|white\b)/i);
  });

  it("打分几分就点亮几个圆点，其余保持未选中", () => {
    const scoreCell = html.match(/教学行为合规性[\s\S]*?<td class="col-score">([\s\S]*?)<\/td>/);
    expect(scoreCell).not.toBeNull();
    const cell = scoreCell![1];
    expect((cell.match(/score-dot active/g) || []).length).toBe(5);
    expect((cell.match(/score-dot inactive/g) || []).length).toBe(0);
    expect(cell).toContain("5/5分");

    const three = html.match(/教学准备充分度[\s\S]*?<td class="col-score">([\s\S]*?)<\/td>/)![1];
    expect((three.match(/score-dot active/g) || []).length).toBe(3);
    expect((three.match(/score-dot inactive/g) || []).length).toBe(2);
    expect(three).toContain("3/5分");
  });
});

describe("黑白打印模式", () => {
  const html = generatePrintableHtml([sampleEvaluation()]);

  it("提供彩色/黑白两种选择并记住上次的选择", () => {
    expect(html).toContain('onclick="setPrintMode(\'color\')"');
    expect(html).toContain('onclick="setPrintMode(\'bw\')"');
    expect(html).toContain("localStorage");
  });

  it("黑白模式把墨色换成纯黑，底色换成灰阶", () => {
    const bw = ruleBody(html, "body.bw");
    expect(bw).toMatch(/--ink:\s*#000\b/);
    expect(bw).toMatch(/--mark:\s*#000\b/);
    // 灰阶底色不能带彩度
    const tint = bw.match(/--tint:\s*(#[0-9a-f]{6})/i)![1].toLowerCase();
    expect(tint.slice(1, 3)).toBe(tint.slice(3, 5));
    expect(tint.slice(3, 5)).toBe(tint.slice(5, 7));
  });

  it("默认仍是彩色模式", () => {
    expect(html).toMatch(/localStorage\.getItem\('print-mode'\)\s*\|\|\s*'color'/);
  });
});

describe("占位文字仍然印得出来", () => {
  it("未评分/未填写不使用几乎看不见的浅灰", () => {
    const html = generatePrintableHtml([
      sampleEvaluation({ highlights: null, suggestions: null, score_course_objective: null }),
    ]);
    expect(html).toContain('<span class="blank">未填写</span>');
    expect(html).toContain('<span class="blank">未评分</span>');
    expect(html).not.toContain("color:#999");
  });
});

describe("分页", () => {
  it("每份评价单独一页", () => {
    const html = generatePrintableHtml([sampleEvaluation(), sampleEvaluation({ id: 2 })]);
    expect((html.match(/class="page"/g) || []).length).toBe(2);
    expect(html).toContain("page-break-after: always");
  });

  it("表格不会被拦腰截断到两页", () => {
    const html = generatePrintableHtml([sampleEvaluation()]);
    expect(html).toMatch(/page-break-inside:\s*avoid/);
  });
});
