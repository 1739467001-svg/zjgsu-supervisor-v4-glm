/**
 * 课表导入工具（换学期用）
 *
 * 用法：
 *   # 试运行，只打印计划不写库（默认）
 *   npx tsx scripts/import-courses.ts 研究生课表.xls MBA课表.xls \
 *     --semester 2026-2027/第一学期 --start-date 2026-09-07 --weeks 18
 *
 *   # 确认无误后实际写入
 *   npx tsx scripts/import-courses.ts ... --apply
 *
 *   # 导入后把新学期设为当前学期（前端据此算周次、筛课程）
 *   npx tsx scripts/import-courses.ts ... --apply --activate
 *
 * 安全设计：
 *   1. 旧课表不删除，而是归档 —— 打上上一个学期的 semesterId 留在库里。
 *      去年的评价和听课计划仍然指得到它们评的是哪门课，历史数据不断裂。
 *   2. 同一学期内按「学院+课程+教师+星期+节次+教室」UPSERT，保留课程 id，
 *      重复导入不会让已有的评价/听课计划失去关联。
 *   3. 只在「本学期内、且没有任何评价/听课计划关联」时才删除多余课程。
 *   4. 默认试运行，必须显式加 --apply 才写库。
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { parseCourseWorkbook, mergeDuplicateCourses, courseKey, type ParsedCourse } from "../server/courseImport";

dotenv.config();

// ============================================================
// 参数
// ============================================================
const argv = process.argv.slice(2);

/** 需要带值的选项；其余 -- 开头的都是开关 */
const VALUE_FLAGS = new Set(["semester", "start-date", "weeks"]);

const options: Record<string, string> = {};
const switches = new Set<string>();
const files: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith("--")) {
    files.push(arg);
    continue;
  }
  const name = arg.slice(2);
  // 选项的值不能被当成文件名（--semester 2026-2027/第一学期 里的学期名尤其像路径）
  if (VALUE_FLAGS.has(name)) options[name] = argv[++i] ?? "";
  else switches.add(name);
}

const apply = switches.has("apply");
const activate = switches.has("activate");
const semesterArg = options["semester"];
const startDate = options["start-date"];
const totalWeeks = Number(options["weeks"] ?? 18);

function usage(message: string): never {
  console.error(`错误：${message}\n`);
  console.error("用法：npx tsx scripts/import-courses.ts <课表.xls...> --semester 学年/学期名 --start-date YYYY-MM-DD [--weeks 18] [--apply] [--activate]");
  console.error("例：  npx tsx scripts/import-courses.ts 课表.xls MBA课表.xls --semester 2026-2027/第一学期 --start-date 2026-09-07 --weeks 18");
  process.exit(2);
}

if (files.length === 0) usage("请至少指定一个课表文件");
if (!semesterArg || !semesterArg.includes("/")) usage("请用 --semester 指定学期，格式如 2026-2027/第一学期");
if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
  usage("请用 --start-date 指定学期第一周的周一（格式 YYYY-MM-DD）。MBA 课表只有具体日期，靠它换算周次，猜错整张表会整体错一周");
}

const [academicYear, semesterName] = semesterArg.split("/");

// ============================================================
// 工具
// ============================================================

function pad(n: number | string, w: number): string {
  return String(n).padStart(w);
}

/**
 * courses 表各 varchar 列的宽度（与 drizzle/schema.ts 保持一致）。
 * 写库前先自查，免得写到一半才被数据库拒绝 —— 那时事务虽会回滚，
 * 但报错信息只有「Data too long for column 'x'」，看不出是哪门课。
 */
const FIELD_LIMITS: Record<string, number> = {
  academicYear: 16, semester: 32, college: 128, courseName: 256, courseType: 64,
  classroom: 128, classId: 255, teacher: 64, campus: 32, weekday: 16,
  weekType: 128, period: 64,
};

function checkFieldLengths(list: ParsedCourse[]): string[] {
  const problems: string[] = [];
  for (const c of list) {
    for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
      const value = String((c as any)[field] ?? "");
      if (value.length > limit) {
        problems.push(`「${c.college} / ${c.courseName} / ${c.teacher}」的 ${field} 长 ${value.length} 字符，超过上限 ${limit}：${value.slice(0, 60)}…`);
      }
    }
  }
  return problems;
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

  console.log(`模式：${apply ? "实际写入（--apply）" : "试运行（不写库）"}`);
  console.log(`目标学期：${academicYear} ${semesterName}，第一周起 ${startDate}，共 ${totalWeeks} 周\n`);

  // ---------- 解析所有课表 ----------
  const parsed: ParsedCourse[] = [];
  for (const file of files) {
    const name = file.split("/").pop();
    let res;
    try {
      res = parseCourseWorkbook(readFileSync(file), { semesterStartDate: startDate, totalWeeks });
    } catch (err: any) {
      console.error(`✗ ${name}：${err.message}`);
      process.exit(2);
    }
    const label = res.format === "mba" ? "MBA 课表" : "研究生排课信息表";
    console.log(`── ${name}`);
    console.log(`   识别为：${label}；原始 ${res.sourceRows} 行 → ${res.courses.length} 门课`);
    res.warnings.forEach((w) => console.log(`   · ${w}`));
    console.log();
    parsed.push(...res.courses);
  }

  // ---------- 合并重复记录（周次取并集） ----------
  const { merged: courseList, mergedGroups, weeksRecovered } = mergeDuplicateCourses(parsed);
  if (mergedGroups > 0) {
    console.log(`── 合并重复记录 ──`);
    console.log(`   ${parsed.length} 条 → ${courseList.length} 门课：${mergedGroups} 组「学院+课程+教师+星期+节次+教室」相同的记录已合并`);
    console.log(`   周次取并集，多保住 ${weeksRecovered} 个周次（直接覆盖的话这些周次会丢失）\n`);
  }

  // ---------- 学院分布 ----------
  const byCollege = new Map<string, number>();
  for (const c of courseList) byCollege.set(c.college, (byCollege.get(c.college) || 0) + 1);
  console.log(`── 学院分布（共 ${byCollege.size} 个学院，${courseList.length} 门课）──`);
  for (const [college, n] of [...byCollege.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${pad(n, 5)}  ${college || "（空）"}`);
  }

  const noWeeks = courseList.filter((c) => c.weekNumbers.length === 0).length;
  if (noWeeks > 0) console.log(`\n   ⚠ ${noWeeks} 门课没有周次，督导按周次筛选时看不到`);

  // ---------- 字段长度自查 ----------
  const tooLong = checkFieldLengths(courseList);
  if (tooLong.length > 0) {
    console.log(`\n── ✗ 有 ${tooLong.length} 处字段超出数据库列宽，已中止 ──`);
    tooLong.slice(0, 10).forEach((p) => console.log(`   ${p}`));
    if (tooLong.length > 10) console.log(`   …还有 ${tooLong.length - 10} 处`);
    console.log(`\n   请先调整 drizzle/schema.ts 的列宽并生成迁移，再重新导入。`);
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    const { host, pathname } = new URL(url);
    console.log(`\n数据库：${host}${pathname}`);

    // ---------- 目标学期 ----------
    const [semRows] = await conn.query<any[]>(
      "SELECT * FROM semesters WHERE academicYear = ? AND name = ? LIMIT 1",
      [academicYear, semesterName]
    );
    let targetSemesterId: number | null = semRows.length > 0 ? Number(semRows[0].id) : null;
    if (targetSemesterId) {
      console.log(`目标学期已存在（id=${targetSemesterId}）`);
      if (semRows[0].startDate !== startDate) {
        console.log(`   ⚠ 库里记录的起始日是 ${semRows[0].startDate}，与本次传入的 ${startDate} 不一致`);
        console.log(`     起始日决定全系统的「第几周」，导入将把它更新为 ${startDate}`);
      }
    } else {
      console.log(`目标学期不存在，将新建：${academicYear} ${semesterName}`);
    }

    // ---------- 待归档的旧课程 ----------
    const [oldRows] = await conn.query<any[]>(
      `SELECT semesterId, academicYear, semester, COUNT(*) AS n
         FROM courses
        WHERE semesterId IS NULL OR semesterId <> ?
        GROUP BY semesterId, academicYear, semester`,
      [targetSemesterId ?? -1]
    );
    const toArchive = oldRows.filter((r: any) => r.semesterId === null);
    const alreadyArchived = oldRows.filter((r: any) => r.semesterId !== null);

    console.log(`\n── 旧课表处理 ──`);
    if (toArchive.length === 0) {
      console.log("   没有需要归档的课程（库里没有未归档的旧课表）");
    } else {
      for (const r of toArchive) {
        console.log(`   ${pad(r.n, 5)} 门课（${r.academicYear || "?"} ${r.semester || "?"}）将归档到上一学期，不删除`);
      }
    }
    for (const r of alreadyArchived) {
      console.log(`   ${pad(r.n, 5)} 门课已归档在学期 id=${r.semesterId}（${r.academicYear || "?"} ${r.semester || "?"}），保持不动`);
    }

    // ---------- 本学期内的增删改 ----------
    const [existingRows] = await conn.query<any[]>(
      "SELECT id, college, courseName, teacher, weekday, period, classroom FROM courses WHERE semesterId = ?",
      [targetSemesterId ?? -1]
    );
    const existingByKey = new Map<string, number>();
    for (const r of existingRows) existingByKey.set(courseKey(r), Number(r.id));

    const seen = new Set<string>();
    let willUpdate = 0;
    let willInsert = 0;
    for (const c of courseList) {
      seen.add(courseKey(c));
      if (existingByKey.has(courseKey(c))) willUpdate++;
      else willInsert++;
    }
    const staleIds = [...existingByKey.entries()].filter(([k]) => !seen.has(k)).map(([, id]) => id);

    // 有评价/听课计划关联的课程一律不删
    let lockedIds: number[] = [];
    if (staleIds.length > 0) {
      const [linked] = await conn.query<any[]>(
        `SELECT DISTINCT courseId FROM course_evaluations WHERE courseId IN (?)
         UNION SELECT DISTINCT courseId FROM listening_plans WHERE courseId IN (?)`,
        [staleIds, staleIds]
      );
      lockedIds = linked.map((r: any) => Number(r.courseId));
    }
    const deletableIds = staleIds.filter((id) => !lockedIds.includes(id));

    console.log(`\n── 本学期课表变更 ──`);
    console.log(`   新增 ${willInsert} 门 / 更新 ${willUpdate} 门`);
    if (staleIds.length > 0) {
      console.log(`   本学期内已不在新课表中的 ${staleIds.length} 门课：删除 ${deletableIds.length} 门，保留 ${lockedIds.length} 门（有评价或听课计划关联）`);
    }

    if (!apply) {
      console.log(`\n试运行结束，未写入任何数据。确认无误后加 --apply 执行。`);
      return;
    }

    // ================= 实际写入 =================
    await conn.beginTransaction();
    try {
      // 1. 归档旧课表：为未归档的旧课程建一个归档学期
      if (toArchive.length > 0) {
        for (const r of toArchive) {
          const ay = r.academicYear || "历史数据";
          const sn = r.semester || "未标注学期";
          const [found] = await conn.query<any[]>(
            "SELECT id FROM semesters WHERE academicYear = ? AND name = ? LIMIT 1",
            [ay, sn]
          );
          let archiveId: number;
          if (found.length > 0) {
            archiveId = Number(found[0].id);
          } else {
            // 归档学期只是个容器，起始日取目标学期前一天，保证排序在它之前
            const prevDay = new Date(Date.parse(startDate + "T00:00:00Z") - 86400000)
              .toISOString()
              .slice(0, 10);
            const [ins] = await conn.execute<any>(
              "INSERT INTO semesters (academicYear, name, startDate, totalWeeks, isActive) VALUES (?, ?, ?, ?, 0)",
              [ay, sn, prevDay, 18]
            );
            archiveId = Number(ins.insertId);
            console.log(`   已建归档学期「${ay} ${sn}」(id=${archiveId})`);
          }
          const [res] = await conn.execute<any>(
            `UPDATE courses SET semesterId = ?
              WHERE semesterId IS NULL AND academicYear <=> ? AND semester <=> ?`,
            [archiveId, r.academicYear, r.semester]
          );
          console.log(`   已归档 ${res.affectedRows} 门课到「${ay} ${sn}」`);
        }
      }

      // 2. 目标学期
      if (targetSemesterId) {
        await conn.execute(
          "UPDATE semesters SET startDate = ?, totalWeeks = ? WHERE id = ?",
          [startDate, totalWeeks, targetSemesterId]
        );
      } else {
        const [ins] = await conn.execute<any>(
          "INSERT INTO semesters (academicYear, name, startDate, totalWeeks, isActive) VALUES (?, ?, ?, ?, 0)",
          [academicYear, semesterName, startDate, totalWeeks]
        );
        targetSemesterId = Number(ins.insertId);
        console.log(`   已新建学期「${academicYear} ${semesterName}」(id=${targetSemesterId})`);
      }

      // 3. UPSERT 本学期课程
      let inserted = 0;
      let updated = 0;
      for (const c of courseList) {
        const k = courseKey(c);
        const values = [
          targetSemesterId, c.academicYear, c.semester, c.college, c.courseName, c.courseType,
          c.classroom, c.classId, c.teacher, c.campus, c.weekday, c.weekType, c.period,
          c.customWeeks, JSON.stringify(c.weekNumbers), c.studentMajor, c.studentCount,
        ];
        const existingId = existingByKey.get(k);
        if (existingId) {
          await conn.execute(
            `UPDATE courses SET semesterId=?, academicYear=?, semester=?, college=?, courseName=?,
                    courseType=?, classroom=?, classId=?, teacher=?, campus=?, weekday=?, weekType=?,
                    period=?, customWeeks=?, weekNumbers=?, studentMajor=?, studentCount=?
              WHERE id=?`,
            [...values, existingId]
          );
          updated++;
        } else {
          await conn.execute(
            `INSERT INTO courses (semesterId, academicYear, semester, college, courseName, courseType,
                    classroom, classId, teacher, campus, weekday, weekType, period,
                    customWeeks, weekNumbers, studentMajor, studentCount)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            values
          );
          inserted++;
        }
      }

      // 4. 清理本学期内多余且无关联的课程
      if (deletableIds.length > 0) {
        await conn.query("DELETE FROM courses WHERE id IN (?)", [deletableIds]);
      }

      // 5. 可选：设为当前学期
      if (activate) {
        await conn.execute("UPDATE semesters SET isActive = 0");
        await conn.execute("UPDATE semesters SET isActive = 1 WHERE id = ?", [targetSemesterId]);
        console.log(`   已把「${academicYear} ${semesterName}」设为当前学期`);
      }

      await conn.commit();

      console.log(`\n完成：新增 ${inserted} 门，更新 ${updated} 门，删除 ${deletableIds.length} 门。`);
      console.log(`  旧课表已归档保留，未删除任何历史数据。`);
      if (lockedIds.length > 0) {
        console.log(`  ${lockedIds.length} 门有评价/听课计划关联的课程被保留。`);
      }
      if (!activate) {
        console.log(`\n  注意：新学期尚未设为「当前学期」。确认课表无误后，`);
        console.log(`  在「系统设置 → 学期管理」里切换，或重跑本命令并加 --activate。`);
      }
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\n执行失败：", err.message);
  process.exit(2);
});
