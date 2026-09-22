/**
 * 权限自检（只读）。
 *
 * 用途：部署后在服务器上跑一遍，用**真实数据库里的行**验证权限判定，
 * 不需要任何人的密码，也不需要浏览器。
 *
 * 为什么需要它：单元测试用的是手工构造的对象，照不到「数据形状」这一类问题。
 * 真实踩过的坑——MariaDB 的 json 列会把 extraRoles 返回成字符串而不是数组，
 * 于是多角色权限整个失效，而所有单元测试照样全绿。这个脚本拿真行跑，能逮住这类问题。
 *
 * 全程只有 SELECT，不写任何数据。
 *
 * 用法：
 *   npx tsx scripts/permission-selfcheck.ts
 */
import mysql from "mysql2/promise";
import { canViewEvaluation, canMutateListeningPlan } from "../shared/evaluationAccess";
import { getEffectiveRoles, normalizeExtraRoles, getScopedCollege, hasAnyRole } from "../shared/roles";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("错误：未设置 DATABASE_URL。");
  process.exit(2);
}

let failures = 0;
const fail = (msg: string) => { failures++; console.log("  ✗ " + msg); };
const ok = (msg: string) => console.log("  ✓ " + msg);

const conn = await mysql.createConnection(url);
try {
  const [users] = await conn.query<any[]>(
    "SELECT id, employeeId, name, role, extraRoles, college, supervisorScope FROM users"
  );
  const [evals] = await conn.query<any[]>(
    "SELECT id, supervisorId, courseId, status FROM course_evaluations"
  );
  const [plans] = await conn.query<any[]>("SELECT id, supervisorId FROM listening_plans");
  const [courses] = await conn.query<any[]>("SELECT id, college FROM courses");
  const courseById = new Map(courses.map((c) => [c.id, c]));

  console.log(`用户 ${users.length} · 评价 ${evals.length} · 听课计划 ${plans.length} · 课程 ${courses.length}\n`);

  // ── 1. extraRoles 的数据形状（MariaDB 会把 json 列返回成字符串）──
  console.log("【1】附加角色能否正确解析");
  const withExtra = users.filter((u) => u.extraRoles != null && u.extraRoles !== "");
  let shapeBad = 0;
  for (const u of withExtra) {
    const parsed = normalizeExtraRoles(u.extraRoles);
    // 解析出单字符说明被当成字符串逐字拆了 —— 正是之前踩过的坑
    if (parsed.some((r) => r.length <= 1)) {
      fail(`${u.name}(${u.employeeId}) 的 extraRoles 被拆成了单字符：${JSON.stringify(parsed.slice(0, 5))}`);
      shapeBad++;
    }
  }
  if (withExtra.length === 0) console.log("  · 没有配置附加角色的用户，跳过");
  else if (shapeBad === 0) ok(`${withExtra.length} 个多角色账号的 extraRoles 全部解析正常`);

  // ── 2. 每个人都能看自己写的评价 ──
  console.log("\n【2】本人能否查看自己写的评价（这条挂了＝督导打不开自己的评价）");
  const userById = new Map(users.map((u) => [u.id, u]));
  let ownChecked = 0, ownBad = 0;
  for (const e of evals) {
    const u = userById.get(e.supervisorId);
    if (!u) continue;
    ownChecked++;
    if (!canViewEvaluation(u, e, courseById.get(e.courseId) ?? null)) {
      fail(`${u.name}(${u.employeeId}) 看不到自己的评价 #${e.id}`);
      ownBad++;
    }
  }
  if (ownChecked === 0) console.log("  · 当前没有评价数据，跳过");
  else if (ownBad === 0) ok(`${ownChecked} 条评价，作者本人全部可见`);

  // ── 3. 普通督导专家不能看别人的评价 ──
  console.log("\n【3】普通督导专家不能查看他人评价");
  const plainExperts = users.filter(
    (u) => hasAnyRole(u, ["supervisor_expert"]) &&
           !hasAnyRole(u, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"])
  );
  let leak = 0;
  for (const u of plainExperts) {
    for (const e of evals) {
      if (e.supervisorId === u.id) continue;
      if (canViewEvaluation(u, e, courseById.get(e.courseId) ?? null)) {
        if (leak < 5) fail(`${u.name}(${u.employeeId}) 能看到他人评价 #${e.id} —— 越权`);
        leak++;
      }
    }
  }
  if (plainExperts.length === 0) console.log("  · 没有纯督导专家账号，跳过");
  else if (leak === 0) ok(`${plainExperts.length} 个纯督导专家，均看不到他人评价`);
  else fail(`共 ${leak} 处越权`);

  // ── 4. 院级范围的人只能看本学院 ──
  console.log("\n【4】院级范围用户只能查看本学院的评价");
  const scoped = users.filter((u) => getScopedCollege(u));
  let crossCollege = 0;
  for (const u of scoped) {
    for (const e of evals) {
      if (e.supervisorId === u.id) continue;
      const course = courseById.get(e.courseId) ?? null;
      if (!course) continue;
      const visible = canViewEvaluation(u, e, course);
      const sameCollege = getScopedCollege(u) === course.college;
      if (visible && !sameCollege && course.college) {
        // 别名（如「法学院（知识产权学院）」）属于正常匹配，这里只报完全不相干的
        const a = getScopedCollege(u)!.replace(/[（(].*?[）)]/g, "");
        const b = String(course.college).replace(/[（(].*?[）)]/g, "");
        if (!a.includes(b) && !b.includes(a)) {
          if (crossCollege < 5) fail(`${u.name}(${u.employeeId}, 范围「${getScopedCollege(u)}」) 能看到「${course.college}」的评价 #${e.id}`);
          crossCollege++;
        }
      }
    }
  }
  if (scoped.length === 0) console.log("  · 没有院级范围用户，跳过");
  else if (crossCollege === 0) ok(`${scoped.length} 个院级范围用户，均未跨学院`);

  // ── 5. 听课计划只有本人（或主管）能改 ──
  console.log("\n【5】听课计划的归属校验");
  let planLeak = 0, planSelfBad = 0;
  for (const p of plans) {
    const owner = userById.get(p.supervisorId);
    if (owner && !canMutateListeningPlan(owner, p)) {
      fail(`${owner.name} 改不了自己的计划 #${p.id}`); planSelfBad++;
    }
    for (const u of plainExperts) {
      if (u.id === p.supervisorId) continue;
      if (canMutateListeningPlan(u, p)) {
        if (planLeak < 3) fail(`${u.name}(${u.employeeId}) 能改他人的计划 #${p.id} —— 越权`);
        planLeak++;
      }
    }
  }
  if (plans.length === 0) console.log("  · 当前没有听课计划，跳过");
  else if (planLeak === 0 && planSelfBad === 0) ok(`${plans.length} 条计划，归属校验正常`);

  // ── 6. 角色分布speak ──
  console.log("\n【6】角色分布（人工核对是否符合预期）");
  const dist = new Map<string, number>();
  for (const u of users) {
    const key = getEffectiveRoles(u).sort().join("+") + (getScopedCollege(u) ? "（院级）" : "（全校）");
    dist.set(key, (dist.get(key) ?? 0) + 1);
  }
  [...dist.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)} 人  ${k}`));

  console.log("\n" + "=".repeat(60));
  if (failures === 0) console.log("权限自检全部通过（本脚本全程只读，未修改任何数据）");
  else console.log(`权限自检发现 ${failures} 处问题，请贴出上面的输出`);
} finally {
  await conn.end();
}
process.exit(failures === 0 ? 0 : 1);
