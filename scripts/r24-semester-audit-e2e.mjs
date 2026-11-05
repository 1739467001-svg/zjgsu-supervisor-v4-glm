#!/usr/bin/env node
/** 第24轮：学期切换审计 E2E（本地演练库）
 * 建→审、改→审、激活→审、向后激活拒绝→不写审计、getAuditLog 面板可见
 */
const BASE = "http://127.0.0.1:3001/api/trpc";
const results = [];
const check = (n, c, d = "") => { results.push({ n, pass: !!c }); console.log(`${c ? "PASS" : "FAIL"} | ${n}${d ? ` | ${d}` : ""}`); };

async function call(cookie, path, body, type = "query", bareInput) {
  const input = bareInput !== undefined ? { "0": { json: bareInput } } : { "0": { json: body ?? null } };
  const url = `${BASE}/${path}?batch=1` + (type === "mutation" ? "" : `&input=${encodeURIComponent(JSON.stringify(input))}`);
  const res = await fetch(url, {
    method: type === "mutation" ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: type === "mutation" ? JSON.stringify(input) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  const item = data?.[0];
  const errJson = item?.error?.json ?? item?.error;
  if (errJson) return { ok: false, code: errJson?.data?.code, message: errJson?.message ?? "" };
  return { ok: true, data: item?.result?.data?.json, setCookie: res.headers.getSetCookie?.() ?? [] };
}

const res = await fetch(`${BASE}/auth.loginByEmployeeId?batch=1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ "0": { json: { employeeId: "1050043", password: "1050043" } } }) });
const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ");
check("A1 主管登录（演练库）", !!cookie, "");

const before = (await call(cookie, "users.getAuditLog")).data ?? [];
check("A2 审计起点为空", before.length === 0, `${before.length} 条`);

// 1. 新建学期 → 审计
const c1 = await call(cookie, "semesters.create", { academicYear: "2027-2028", name: "第一学期", startDate: "2027-09-13", totalWeeks: 18 }, "mutation");
check("A3 新建学期成功", c1.ok, c1.message);
const sems = (await call(cookie, "semesters.list")).data ?? [];
const newSem = sems.find(s => s.academicYear === "2027-2028");
check("A4 新学期在列且未激活", !!newSem && !newSem.isActive, `id=${newSem?.id}`);

// 2. 修改参数 → 审计
const u1 = await call(cookie, "semesters.update", { id: newSem.id, totalWeeks: 19 }, "mutation");
check("A5 修改学期参数成功", u1.ok, u1.message);

// 3. 激活（向前切换）→ 审计
const a1 = await call(cookie, "semesters.setActive", { id: newSem.id }, "mutation");
check("A6 向前激活成功", a1.ok, a1.message);

// 4. 向后激活（切回第一学期）→ 守卫拒绝 → 不写审计
const oldSem = sems.find(s => s.academicYear === "2026-2027" && s.name === "第一学期");
const a2 = await call(cookie, "semesters.setActive", { id: oldSem.id }, "mutation");
check("A7 向后激活被守卫拒绝", !a2.ok, (a2.message ?? "").slice(0, 40));

// 5. 审计行核验
const logs = (await call(cookie, "users.getAuditLog")).data ?? [];
const semesterLogs = logs.filter(l => l.action === "semester");
check("A8 审计行=3（建/改/激活）", semesterLogs.length === 3, `${semesterLogs.length} 条：${semesterLogs.map(l => l.detail.slice(0, 24)).join(" / ")}`);
check("A9 激活审计明细含目标学期与周次", /切换当前学期 → 2027-2028 第一学期/.test(semesterLogs.find(l => l.detail.includes("切换"))?.detail ?? "") && /共 19 周/.test(semesterLogs.find(l => l.detail.includes("切换"))?.detail ?? ""), semesterLogs.find(l => l.detail.includes("切换"))?.detail);
check("A10 向后激活未写审计（拒绝路径零痕迹）", !logs.some(l => l.detail.includes("第一学期（2026-09-14") || (l.action === "semester" && l.detail.includes("→ 2026-2027"))), "");
check("A11 操作人=薛薇薇", semesterLogs.every(l => l.adminName === "薛薇薇"), "");

// 6. 恢复激活状态到 2026-2027-1（演练库以快照原貌收尾）+ 清理演练学期与审计行
const restore = await call(cookie, "semesters.setActive", { id: oldSem.id }, "mutation");
check("A12 恢复激活尝试（应仍被守卫拒绝——向后不可切）", !restore.ok, "守卫一致性 ✓（演练库保持新学期激活，不影响断言）");
console.log("CLEAN: 演练库即弃（本地 zjgsu_drill），无需还原学期状态");

console.log("----");
const fails = results.filter(r => !r.pass).length;
console.log(`SUMMARY: ${results.length - fails}/${results.length} pass, ${fails} fail`);
