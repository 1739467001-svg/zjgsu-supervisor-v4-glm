/**
 * 人员名单导入工具
 *
 * 从「浙江工商大学督导系统角色信息表」导入教师账号。
 *
 * 用法：
 *   npx tsx scripts/import-users.ts <xlsx路径>            # 试运行，只输出计划不写库（默认）
 *   npx tsx scripts/import-users.ts <xlsx路径> --apply    # 实际写入
 *   npx tsx scripts/import-users.ts <xlsx路径> --apply --allow-unmatched-college
 *                                                          # 允许导入学院名对不上课表的人员
 *
 * 安全设计：
 *   1. 按工号 UPSERT，绝不 DELETE —— 保留用户 id，避免已有评价/听课计划的关联断裂
 *   2. 绝不写 password 字段 —— 老师改过的密码不会被重置（密码为空时系统用工号校验）
 *   3. 名单外的已有用户不做任何处理，仅列出供人工核对
 *   4. 学院名以数据库 courses 表的「开课院系」为准做校验，校验规则直接复用
 *      shared/roles.ts 的 isCollegeInScope，与运行时权限判定完全一致
 *   5. 督导范围写入独立字段 supervisorScope（school/college），不靠 college 是否有值推断 ——
 *      校级督导同样保留人事归属学院，不会因此被误判为院级
 */

import XLSX from "xlsx";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { isCollegeInScope } from "../shared/roles";

dotenv.config();

// ============================================================
// 表格角色 → 系统角色映射
// ============================================================
type RoleSpec = {
  role: string;
  extras: string[];
  /** 是否按学院限定范围（院级）。false 表示全校范围，college 仅作人事归属记录 */
  scoped: boolean;
};

const ROLE_MAP: Record<string, RoleSpec> = {
  研究生院主管: { role: "graduate_admin", extras: [], scoped: false },
  校级督导专家: { role: "supervisor_expert", extras: [], scoped: false },
  院级督导专家: { role: "supervisor_expert", extras: [], scoped: true },
  学院教学秘书: { role: "college_secretary", extras: [], scoped: true },
  // 「同时负责各自学院的听课和管理工作」= 院级督导 + 本院管理
  学院分管领导: { role: "supervisor_expert", extras: ["college_secretary"], scoped: true },
};

/** 合并同一个人的多个角色时，用于挑选「主角色」的优先级（数字越大越优先） */
const ROLE_PRECEDENCE: Record<string, number> = {
  admin: 5,
  graduate_admin: 4,
  supervisor_leader: 3,
  college_secretary: 2,
  supervisor_expert: 1,
  user: 0,
};

const ROLE_LABEL: Record<string, string> = {
  graduate_admin: "研究生院主管",
  supervisor_leader: "督导组长",
  college_secretary: "学院教学秘书",
  supervisor_expert: "督导专家",
  admin: "系统管理员",
  user: "普通用户",
};

// ============================================================
// 参数
// ============================================================
const argv = process.argv.slice(2);
const filePath = argv.find((a) => !a.startsWith("--"));
const apply = argv.includes("--apply");
const allowUnmatched = argv.includes("--allow-unmatched-college");

if (!filePath) {
  console.error("用法：npx tsx scripts/import-users.ts <xlsx路径> [--apply] [--allow-unmatched-college]");
  process.exit(2);
}

type Person = {
  employeeId: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  extraRoles: string[];
  college: string | null;
  /** 督导范围，写入 users.supervisorScope */
  supervisorScope: "school" | "college";
  /** 该人员的可见范围是否真的被 college 限制（院级督导 / 学院教学秘书） */
  scopeLimited: boolean;
  remark: string | null;
  sourceRoles: string[];
  homeColleges: string[];
};

// ============================================================
// 解析表格
// ============================================================
function parseWorkbook(path: string) {
  const wb = XLSX.readFile(path);
  const sheetName = wb.SheetNames.find((n) => n.includes("人员")) ?? wb.SheetNames[0];
  const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { range: 1, defval: "", raw: false });

  const raw = rows
    .filter((r) => String(r["姓名"] ?? "").trim())
    .map((r) => ({
      name: String(r["姓名"]).trim(),
      employeeId: String(r["工号"] ?? "").trim(),
      phone: String(r["手机号/办公电话"] ?? "").trim() || null,
      college: String(r["所属学院"] ?? "").trim(),
      roleStr: String(r["拟分配角色"] ?? "").trim(),
      email: String(r["电子邮箱"] ?? "").trim() || null,
      remark: String(r["备注"] ?? "").trim() || null,
    }));

  const problems: string[] = [];
  const valid = raw.filter((r) => {
    if (!r.employeeId) { problems.push(`${r.name}：缺少工号，已跳过`); return false; }
    if (!/^\d+$/.test(r.employeeId)) { problems.push(`${r.name}（${r.employeeId}）：工号非纯数字，已跳过`); return false; }
    if (!ROLE_MAP[r.roleStr]) { problems.push(`${r.name}（${r.employeeId}）：无法识别的角色「${r.roleStr}」，已跳过`); return false; }
    if (ROLE_MAP[r.roleStr].scoped && !r.college) {
      problems.push(`${r.name}（${r.employeeId}）：角色「${r.roleStr}」需要所属学院但为空，已跳过`);
      return false;
    }
    return true;
  });

  // 按工号合并（同一工号 = 同一人身兼多职）
  const byId = new Map<string, typeof valid>();
  for (const r of valid) {
    if (!byId.has(r.employeeId)) byId.set(r.employeeId, []);
    byId.get(r.employeeId)!.push(r);
  }

  const people: Person[] = [];
  for (const [employeeId, group] of byId) {
    const systemRoles = new Set<string>();
    const scopedColleges = new Set<string>();
    const homeColleges = new Set<string>();

    for (const r of group) {
      const spec = ROLE_MAP[r.roleStr];
      systemRoles.add(spec.role);
      spec.extras.forEach((e) => systemRoles.add(e));
      if (spec.scoped) scopedColleges.add(r.college);
      else if (r.college) homeColleges.add(r.college);
    }

    // 只有一种来源角色时，尊重 ROLE_MAP 里显式指定的主/附角色划分
    // （如「学院分管领导」应以督导专家为主角色，而不是按优先级被判成学院教学秘书）；
    // 只有同一人身兼多种来源角色需要合并时，才按优先级挑主角色。
    const distinctSourceRoles = [...new Set(group.map((r) => r.roleStr))];
    let primary: string;
    let extras: string[];
    if (distinctSourceRoles.length === 1) {
      const spec = ROLE_MAP[distinctSourceRoles[0]];
      primary = spec.role;
      extras = [...systemRoles].filter((r) => r !== primary);
    } else {
      const sorted = [...systemRoles].sort((a, b) => (ROLE_PRECEDENCE[b] ?? 0) - (ROLE_PRECEDENCE[a] ?? 0));
      primary = sorted[0];
      extras = sorted.slice(1);
    }

    // 范围由 supervisorScope 显式决定，college 只表达「哪个学院」：
    // 院级角色填管辖学院，校级角色填人事归属学院 —— 后者不再影响可见范围，
    // 因此不必再像以前那样为了避免被误判成院级而把归属学院塞进备注。
    const scopeLimited = scopedColleges.size > 0;
    const college = scopeLimited
      ? [...scopedColleges].join("、")
      : homeColleges.size > 0
        ? [...homeColleges].join("、")
        : null;
    const remarkParts = [
      ...new Set(group.map((r) => r.remark).filter(Boolean) as string[]),
    ];

    people.push({
      employeeId,
      name: group[0].name,
      phone: group.find((r) => r.phone)?.phone ?? null,
      email: group.find((r) => r.email)?.email ?? null,
      role: primary,
      extraRoles: extras,
      college,
      supervisorScope: scopeLimited ? "college" : "school",
      scopeLimited,
      remark: remarkParts.length ? remarkParts.join("；") : null,
      sourceRoles: [...new Set(group.map((r) => r.roleStr))],
      homeColleges: [...homeColleges],
    });
  }

  return { people, problems, mergedCount: valid.length - people.length };
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("错误：未设置 DATABASE_URL。");
    process.exit(2);
  }

  const { people, problems, mergedCount } = parseWorkbook(filePath!);

  console.log(`模式：${apply ? "实际写入（--apply）" : "试运行（不写库）"}`);
  console.log(`解析出 ${people.length} 位人员${mergedCount > 0 ? `（含 ${mergedCount} 条因同工号合并）` : ""}`);

  if (problems.length) {
    console.log(`\n── 已跳过的问题行（${problems.length}）──`);
    problems.forEach((p) => console.log("  ! " + p));
  }

  const conn = await mysql.createConnection(url);
  try {
    const { host, pathname } = new URL(url);
    console.log(`\n数据库：${host}${pathname}`);

    // 以课表实际「开课院系」为准校验学院名
    const [courseRows] = await conn.query<any[]>(
      "SELECT DISTINCT college FROM courses WHERE college IS NOT NULL AND college <> ''"
    );
    const courseColleges: string[] = courseRows.map((r) => r.college);
    console.log(`课表中的开课院系：${courseColleges.length} 个`);

    const unmatched: Person[] = [];
    if (courseColleges.length > 0) {
      for (const p of people) {
        // 校级人员的 college 只是人事归属、并不限制可见范围，对不上课表也无妨
        if (!p.scopeLimited || !p.college) continue;
        const hit = courseColleges.some((cc) => isCollegeInScope(p.college!, cc));
        if (!hit) unmatched.push(p);
      }
    }

    if (unmatched.length > 0) {
      console.log(`\n── ⚠ 学院名与课表对不上（${unmatched.length} 人）──`);
      console.log("   这些人员的可见范围将为空：看不到任何课程，也无法听课/评价。");
      const byCollege = new Map<string, string[]>();
      for (const p of unmatched) {
        if (!byCollege.has(p.college!)) byCollege.set(p.college!, []);
        byCollege.get(p.college!)!.push(p.name);
      }
      for (const [c, names] of byCollege) {
        console.log(`   「${c}」${names.length} 人：${names.join("、")}`);
      }
      console.log("\n   课表中的开课院系为：");
      courseColleges.forEach((c) => console.log(`     - ${c}`));
    }

    // 现有用户
    const [existingRows] = await conn.query<any[]>("SELECT employeeId, name, role FROM users WHERE employeeId IS NOT NULL");
    const existing = new Map<string, any>(existingRows.map((r) => [String(r.employeeId), r]));
    const toCreate = people.filter((p) => !existing.has(p.employeeId));
    const toUpdate = people.filter((p) => existing.has(p.employeeId));
    const notInFile = existingRows.filter((r) => !people.some((p) => p.employeeId === String(r.employeeId)));

    console.log(`\n── 变更计划 ──`);
    console.log(`  新增 ${toCreate.length} 人 / 更新 ${toUpdate.length} 人`);
    if (notInFile.length) {
      console.log(`  名单外的已有用户 ${notInFile.length} 人（不做任何改动，请人工核对是否需要停用）：`);
      notInFile.forEach((r) => console.log(`     ${r.name}（${r.employeeId}，${ROLE_LABEL[r.role] ?? r.role}）`));
    }

    console.log(`\n── 角色分配明细 ──`);
    const byRole = new Map<string, Person[]>();
    for (const p of people) {
      const key = `${ROLE_LABEL[p.role] ?? p.role}${p.extraRoles.length ? " + " + p.extraRoles.map((r) => ROLE_LABEL[r] ?? r).join("/") : ""}${p.scopeLimited ? "（院级）" : "（全校）"}`;
      if (!byRole.has(key)) byRole.set(key, []);
      byRole.get(key)!.push(p);
    }
    for (const [key, list] of [...byRole.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${String(list.length).padStart(3)} 人  ${key}`);
      console.log(`         来源角色：${[...new Set(list.flatMap((p) => p.sourceRoles))].join("、")}`);
    }

    if (unmatched.length > 0 && !allowUnmatched) {
      console.log(`\n结论：存在学院名对不上课表的人员，已中止。`);
      console.log(`  请先统一学院名称（修改表格，或先上传对应学期的课表），`);
      console.log(`  确认无误后可加 --allow-unmatched-college 强制导入。`);
      process.exitCode = 1;
      return;
    }

    if (!apply) {
      console.log(`\n试运行结束，未写入任何数据。确认无误后加 --apply 执行。`);
      return;
    }

    // 执行 UPSERT（不含 password，不做删除）
    let created = 0, updated = 0;
    for (const p of people) {
      const openId = `emp_${p.employeeId}`;
      await conn.execute(
        `INSERT INTO users (openId, employeeId, name, email, phone, role, extraRoles, college, supervisorScope, remark, loginMethod, lastSignedIn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'employee_id', NOW())
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), email = VALUES(email), phone = VALUES(phone),
           role = VALUES(role), extraRoles = VALUES(extraRoles),
           college = VALUES(college), supervisorScope = VALUES(supervisorScope),
           remark = VALUES(remark)`,
        [
          openId, p.employeeId, p.name, p.email, p.phone, p.role,
          p.extraRoles.length ? JSON.stringify(p.extraRoles) : null,
          p.college, p.supervisorScope, p.remark,
        ]
      );
      existing.has(p.employeeId) ? updated++ : created++;
    }

    console.log(`\n完成：新增 ${created} 人，更新 ${updated} 人。`);
    console.log(`  未改动任何人的密码（密码为空时系统以工号校验）。`);
    console.log(`  未删除任何已有用户。`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\n执行失败：", err.message);
  process.exit(2);
});
