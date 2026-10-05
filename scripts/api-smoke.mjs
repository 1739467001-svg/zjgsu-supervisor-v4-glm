/**
 * L3 API 权限矩阵冒烟套件（软件工程测试轮次产出，2026-10-04）。
 * 前置：隔离测试库（库名含 test）+ 全量迁移 + 独立服务实例（端口默认 3002）。
 * 若本进程设置了指向测试库的 DATABASE_URL，会先自动重播种（保证可重复执行）。
 * 运行：BASE=http://localhost:3002 DATABASE_URL='…zjgsu_test' npx tsx scripts/api-smoke.mjs
 */
if (process.env.DATABASE_URL?.includes("test")) {
  process.env.SMOKE_INLINE = "1";
  const { seedSmoke } = await import("./seed-smoke.mjs");
  await seedSmoke(process.env.DATABASE_URL);
}
 const BASE = process.env.BASE ?? "http://localhost:3002/api/trpc";
const jars = {};
async function call(who, path, body, type = "query", bareInput) {
  const input = bareInput !== undefined ? { "0": { json: bareInput } } : { "0": { json: body ?? null } };
  const url = `${BASE}/${path}?batch=1` + (type === "mutation" ? "" : `&input=${encodeURIComponent(JSON.stringify(input))}`);
  const res = await fetch(url, {
    method: type === "mutation" ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(jars[who] ? { cookie: jars[who] } : {}) },
    body: type === "mutation" ? JSON.stringify(input) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length && who) jars[who] = sc.map(c => c.split(";")[0]).join("; ");
  const data = await res.json().catch(() => ({}));
  const item = data?.[0];
  if (item?.error) return { ok: false, status: item.error.data?.code ?? "ERR", message: item.error.message };
  return { ok: true, data: item?.result?.data?.json };
}
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "✓" : "✗"} ${name}${detail ? "  [" + detail + "]" : ""}`); };

for (const [id, name] of [["T9001","主管"],["T9002","秘书"],["T9003","院级督导"],["T9004","校级督导"],["T9005","普通用户"]]) {
  const r = await call(id, "auth.loginByEmployeeId", { employeeId: id, password: id }, "mutation");
  check(`登录 ${name}`, r.ok && r.data?.success === true);
  const me = await call(id, "auth.me");
  check(`会话生效 ${name}`, me.ok && me.data?.employeeId === id, me.data?.role);
}
const bad = await call(null, "auth.loginByEmployeeId", { employeeId: "T9001", password: "wrong" }, "mutation");
check("错误密码被拒绝", !bad.ok, bad.message);

// 动态解析种子数据的主键（种子可重建，自增 id 会变化）
let idCourseA = 0, idCourseLaw = 0, idCourseHist = 0, idExp = 0, idAdmin = 0;
{
  const usersList = (await call("T9001", "users.list")).data ?? [];
  idExp = usersList.find(u => u.employeeId === "T9003")?.id ?? 0;
  idAdmin = usersList.find(u => u.employeeId === "T9001")?.id ?? 0;
  if (process.env.DATABASE_URL?.includes("test")) {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    const [rows] = await conn.query("SELECT id, courseName FROM courses WHERE courseName IN ('计量经济学A','宪法学C','历史学期课D')");
    idCourseA = rows.find(r => r.courseName === "计量经济学A")?.id ?? 0;
    idCourseLaw = rows.find(r => r.courseName === "宪法学C")?.id ?? 0;
    idCourseHist = rows.find(r => r.courseName === "历史学期课D")?.id ?? 0;
    await conn.end();
  }
  check("种子主键解析(3课+2用户)", idCourseA > 0 && idCourseLaw > 0 && idCourseHist > 0 && idExp > 0 && idAdmin > 0, `课${idCourseA}/${idCourseLaw}/${idCourseHist} 人${idExp}/${idAdmin}`);
}

const listOwn = await call("T9003", "courses.list", { college: "经济学院" });
check("院级督导可查本学院课程", listOwn.ok && listOwn.data?.total === 2, `total=${listOwn.data?.total}`);
const listOther = await call("T9003", "courses.list", { college: "法学院" });
check("院级督导查他学院被钳制回本学院", listOther.ok && listOther.data?.total === 2, `total=${listOther.data?.total}`);
const listAdmin = await call("T9001", "courses.list", {});
check("主管查当前学期全校课程(3门)", listAdmin.ok && listAdmin.data?.total === 3, `total=${listAdmin.data?.total}`);

const planOwn = await call("T9003", "plans.create", { courseId: idCourseA, planWeek: 2, note: "" }, "mutation");
check("院级督导对本学院课程建计划", planOwn.ok, planOwn.ok ? "" : planOwn.message);
const planOther = await call("T9003", "plans.create", { courseId: idCourseLaw, planWeek: 2, note: "" }, "mutation");
check("院级督导对法学院课程建计划被拒", !planOther.ok, planOther.message);
const planUser = await call("T9005", "plans.create", { courseId: 26, planWeek: 5, note: "" }, "mutation");
check("普通用户建计划被拒", !planUser.ok, planUser.status);
const planHistory = await call("T9003", "plans.create", { courseId: idCourseHist, planWeek: 1, note: "" }, "mutation");
check("历史学期建计划被拒", !planHistory.ok, (planHistory.message ?? "").slice(0, 36));

const evalBySec = await call("T9002", "evaluations.create", { courseId: idCourseA, listenDate: "2026-03-09", status: "draft" }, "mutation");
check("教学秘书创建评价被拒", !evalBySec.ok, evalBySec.status);
const evalByExp = await call("T9003", "evaluations.create", { courseId: idCourseA, listenDate: "2026-03-09", status: "submitted", overallScore: 4.2 }, "mutation");
check("院级督导提交本人评价", evalByExp.ok, evalByExp.ok ? "" : evalByExp.message);
const evalSecond = await call("T9004", "evaluations.create", { courseId: idCourseA, listenDate: "2026-03-09", status: "submitted", overallScore: 4.0 }, "mutation");
check("评价独占：第二位督导提交被拒", !evalSecond.ok, (evalSecond.message ?? "").slice(0, 30));

const myEvalId = evalByExp.ok ? evalByExp.data?.id : null;
if (myEvalId) {
  const own = await call("T9003", "evaluations.getById", null, "query", myEvalId);
  check("督导读本人评价详情", own.ok);
  const other = await call("T9004", "evaluations.getById", null, "query", myEvalId);
  check("校级督导凭 ID 读他人评价被拒", !other.ok, other.status);
  const sec = await call("T9002", "evaluations.getById", null, "query", myEvalId);
  check("秘书（本院）可读该评价", sec.ok);
}

const clearCollege = await call("T9001", "users.updateCollege", { userId: idExp, college: null }, "mutation");
check("清空院级督导学院被拒", !clearCollege.ok, (clearCollege.message ?? "").slice(0, 28));
const selfDemote = await call("T9001", "users.updateRole", { userId: idAdmin, role: "supervisor_expert" }, "mutation");
check("主管自我降级被拒", !selfDemote.ok, (selfDemote.message ?? "").slice(0, 28));
const audit = await call("T9001", "users.getAuditLog");
check("审计日志接口可用", audit.ok && Array.isArray(audit.data), `${audit.data?.length ?? 0} 条`);
const auditBySec = await call("T9002", "users.getAuditLog");
check("秘书可查本院授权变更留痕（旧断言更新）", auditBySec.ok && Array.isArray(auditBySec.data), `${auditBySec.data?.length ?? 0} 条`);

// 统计仪表盘口径：主管=全校（2 学院）；秘书/分管领导=本院（仅经济学院）；纯院级督导=拒绝
const stats = await call("T9001", "stats.adminDashboard", {});
check("主管统计仪表盘=全校口径(2学院/3门课)", stats.ok && stats.data?.semesterColleges?.length === 2 && stats.data?.totalCourses === 3, stats.ok ? `学院数=${stats.data?.semesterColleges?.length} 课程=${stats.data?.totalCourses}` : stats.message);
const statsSec = await call("T9002", "stats.adminDashboard", {});
check("秘书统计仪表盘=本院口径(仅经济学院)", statsSec.ok && statsSec.data?.semesterColleges?.length === 1 && statsSec.data?.semesterColleges?.[0]?.college === "经济学院" && statsSec.data?.totalCourses === 2, statsSec.ok ? `学院数=${statsSec.data?.semesterColleges?.length}` : statsSec.status + " " + (statsSec.message ?? "").slice(0, 40));
const statsExp = await call("T9003", "stats.adminDashboard", {});
check("纯院级督导统计仪表盘被拒", !statsExp.ok, statsExp.status + " " + (statsExp.message ?? "").slice(0, 30));

const semBySec = await call("T9002", "semesters.create", { academicYear: "2027-2028", name: "第一学期", startDate: "2027-09-13", totalWeeks: 18 }, "mutation");
check("秘书建学期被拒", !semBySec.ok, semBySec.status);
const semByAdmin = await call("T9001", "semesters.create", { academicYear: "2027-2028", name: "第一学期", startDate: "2027-09-13", totalWeeks: 18 }, "mutation");
check("主管建新学期", semByAdmin.ok, semByAdmin.ok ? "" : semByAdmin.message);
const anon = await call(null, "users.list");
check("未登录访问用户列表被拒", !anon.ok, anon.status);

// ── 导出 Excel 与打印的授权矩阵 ──
const expAdmin = await call("T9001", "evaluations.exportToExcel", {}, "mutation");
check("主管导出全校评价 Excel", expAdmin.ok && typeof expAdmin.data?.buffer === "string" && expAdmin.data.buffer.length > 100, expAdmin.ok ? `filename=${expAdmin.data?.filename}` : expAdmin.status);
const expExp = await call("T9003", "evaluations.exportToExcel", {}, "mutation");
check("院级督导导出本人评价 Excel", expExp.ok && typeof expExp.data?.buffer === "string", expExp.ok ? "" : expExp.status);
const expSec = await call("T9002", "evaluations.exportToExcel", {}, "mutation");
check("秘书导出本院评价 Excel", expSec.ok && typeof expSec.data?.buffer === "string", expSec.ok ? "" : expSec.status);
const expUser = await call("T9005", "evaluations.exportToExcel", {}, "mutation");
check("普通用户导出被拒", !expUser.ok, expUser.status);

const evalIdForPrint = (await call("T9003", "evaluations.myEvaluations", {})).data?.[0]?.id;
if (evalIdForPrint) {
  const printOwn = await fetch(`${BASE.replace("/api/trpc", "")}/api/print/evaluation/${evalIdForPrint}`, { headers: { cookie: jars["T9003"] } });
  check("督导打印本人评价页", printOwn.status === 200, String(printOwn.status));
  const printOther = await fetch(`${BASE.replace("/api/trpc", "")}/api/print/evaluation/${evalIdForPrint}`, { headers: { cookie: jars["T9004"] } });
  check("校级督导打印他人评价被拒", printOther.status >= 400, String(printOther.status));
  const printAnon = await fetch(`${BASE.replace("/api/trpc", "")}/api/print/evaluation/${evalIdForPrint}`);
  check("未登录打印被拒", printAnon.status >= 400, String(printAnon.status));
}

// ── 课表上传：双入口校验 + 预览不写库 + 确认导入 ──
import * as XLSX from "xlsx";
function buildStandardXlsx() {
  const header = ["学年", "学期", "开课院系", "课程名称", "课程性质", "教室名称", "班级编号", "主讲教师", "校区名称", "星期几", "单双周", "节次", "自定义周次", "学生专业", "选中人数", "备注"];
  const row = ["2025-2026", "第二学期", "经济学院", "冒烟测试课程", "学位课", "A999", "SMOKE-1", "冒烟教师", "下沙", "星期五", "全周", "第1-2节", "第2周", "统计学", 10, ""];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, row]), "课表");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
async function upload(who, entry, mode) {
  const form = new FormData();
  form.append("file", new Blob([buildStandardXlsx()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "smoke.xlsx");
  form.append("semesterId", "1");
  form.append("entry", entry);
  form.append("mode", mode);
  const res = await fetch(`${BASE.replace("/api/trpc", "")}/api/upload-courses`, {
    method: "POST",
    headers: { cookie: jars[who] },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const upBySec = await upload("T9002", "standard", "preview");
check("秘书上传课表被拒", upBySec.status === 403, String(upBySec.status));
const upWrongEntry = await upload("T9001", "mba", "preview");
check("入口与模板不符被拒(总课表文件进MBA入口)", upWrongEntry.status === 400 && /不符/.test(upWrongEntry.body?.message ?? ""), upWrongEntry.body?.message?.slice(0, 40));
const upPreview = await upload("T9001", "standard", "preview");
check("解析预览成功(识别总课表/新增1门)", upPreview.status === 200 && upPreview.body?.preview?.formatLabel === "研究生排课信息表" && upPreview.body?.preview?.inserted >= 1, `inserted=${upPreview.body?.preview?.inserted}`);
const beforeCount = (await call("T9001", "courses.list", {})).data?.total;
const upConfirm = await upload("T9001", "standard", "confirm");
const afterCount = (await call("T9001", "courses.list", {})).data?.total;
check("确认导入成功且课程数+1", upConfirm.status === 200 && upConfirm.body?.success === true && afterCount === beforeCount + 1, `before=${beforeCount} after=${afterCount}`);
const upPreviewNoWrite = await upload("T9001", "standard", "preview");
check("预览不重复写入(合并后无新增)", upPreviewNoWrite.body?.preview?.inserted === 0, `inserted=${upPreviewNoWrite.body?.preview?.inserted}`);

// ── 账号管理（上线前会议补充：秘书可重置本院账号密码；主管可重置任意账号）──
const userListSec = await call("T9002", "users.list", {});
const secVisible = userListSec.ok ? userListSec.data : [];
check("秘书账号列表=仅本院账号(经济学院)", userListSec.ok && secVisible.length >= 2 && secVisible.every((u) => (u.college ?? "").includes("经济学院")), `数量=${secVisible.length}`);
const userListAdmin = await call("T9001", "users.list", {});
check("主管账号列表=全校", userListAdmin.ok && userListAdmin.data?.length >= 5, `数量=${userListAdmin.data?.length}`);
const t9003Id = userListAdmin.data?.find((u) => u.employeeId === "T9003")?.id;
const t9004Id = userListAdmin.data?.find((u) => u.employeeId === "T9004")?.id;
const resetOwn = await call("T9002", "users.resetPassword", { userId: t9003Id, newPassword: "smoke666" }, "mutation");
check("秘书重置本院账号密码", resetOwn.ok, resetOwn.ok ? "" : resetOwn.message);
const resetCross = await call("T9002", "users.resetPassword", { userId: t9004Id, newPassword: "smoke666" }, "mutation");
check("秘书重置外院账号密码被拒", !resetCross.ok, (resetCross.message ?? "").slice(0, 30));
const resetByExp = await call("T9003", "users.resetPassword", { userId: t9003Id, newPassword: "smoke666" }, "mutation");
check("院级督导重置密码被拒", !resetByExp.ok, resetByExp.status);
const roleBySec = await call("T9002", "users.updateRole", { userId: t9003Id, role: "graduate_admin" }, "mutation");
check("秘书修改他人角色被拒（权限归主管）", !roleBySec.ok, roleBySec.status);
const auditSec = await call("T9002", "users.getAuditLog", {});
check("秘书可查本院授权变更留痕", auditSec.ok && Array.isArray(auditSec.data), `${auditSec.data?.length ?? 0} 条`);
// 恢复 T9003 密码为工号，保证套件可重复执行
await call("T9002", "users.resetPassword", { userId: t9003Id, newPassword: "T9003" }, "mutation");

const passed = results.filter(r=>r.pass).length;
console.log(`\n===== L3 冒烟结果：${passed}/${results.length} 通过 =====`);
process.exit(passed === results.length ? 0 : 1);
