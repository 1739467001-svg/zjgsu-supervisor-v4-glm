/**
 * 数据库结构体检 / 修复工具
 *
 * 背景：course_evaluations 表中「四、教学过程」的 5 个评分列，在代码（drizzle/schema.ts）里
 * 曾被改名，但从未生成对应的迁移文件，导致「迁移历史记录的列名」与「代码使用的列名」不一致。
 * 本脚本用于查明生产库的真实状态，并在安全的前提下修复。
 *
 * 用法：
 *   node scripts/db-doctor.mjs                          # 只读体检，不做任何修改（默认）
 *   node scripts/db-doctor.mjs --fix                    # 修复：仅在安全时执行重命名
 *   node scripts/db-doctor.mjs --fix --accept-positional-mapping
 *                                                       # 旧列有数据时，确认按位置映射后再修复
 *
 * 安全原则：
 *   1. 只用 CHANGE COLUMN 重命名，绝不 DROP —— 迁移 0004 就是用 ADD+DROP 处理 text_* 改名，
 *      导致原有数据被删除后才发现无法找回。
 *   2. 旧列若存在真实数据，默认拒绝自动映射（这批列是指标体系重新设计，并非逐一对应改名，
 *      按位置映射会让分数张冠李戴），必须人工确认。
 *   3. 幂等：已经是新列名时为空操作，可重复运行。
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// 「四、教学过程」5 个评分列：迁移历史中的列名 -> 代码中的列名（按表单位置顺序对应）
const SCORE_RENAMES = [
  { from: "score_emotional_motivation", to: "score_interaction_quality", item: "1. 师生互动质量" },
  { from: "score_teaching_diversity", to: "score_method_diversity", item: "2. 教学方法多样性" },
  { from: "score_rhythm_transition", to: "score_equal_dialogue", item: "3. 平等交流氛围" },
  { from: "score_key_summary", to: "score_pace_control", item: "4. 节奏调控能力" },
  { from: "score_feedback_improvement", to: "score_feedback", item: "5. 即时反馈运用" },
];

const argv = process.argv.slice(2);
const shouldFix = argv.includes("--fix");
const acceptPositional = argv.includes("--accept-positional-mapping");

function log(...args) {
  console.log(...args);
}

async function getColumns(conn, table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return new Map(rows.map((r) => [r.COLUMN_NAME, r]));
}

/** 统计某列有多少行是非 NULL（判断旧列里是否存在真实评分数据） */
async function countNonNull(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${column}\` IS NOT NULL`
  );
  return Number(rows[0]?.n || 0);
}

async function reportMigrationState(conn) {
  log("\n── drizzle 迁移状态 ──");
  try {
    const [rows] = await conn.query(
      "SELECT hash, created_at FROM `__drizzle_migrations` ORDER BY created_at DESC LIMIT 1"
    );
    if (rows.length === 0) {
      log("  __drizzle_migrations 表为空（尚未应用任何迁移）");
      return;
    }
    const last = Number(rows[0].created_at);
    log(`  最后应用的迁移时间戳：${last}（${new Date(last).toISOString()}）`);
    log("  drizzle 只按此时间戳判断是否跳过迁移，不校验 hash；");
    log("  即：journal 中 when > 该值的迁移会在下次 drizzle-kit migrate 时执行。");
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE") {
      log("  未找到 __drizzle_migrations 表（该库可能不是通过 drizzle 迁移建立的）");
    } else {
      log(`  查询失败：${err.message}`);
    }
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("错误：未设置 DATABASE_URL 环境变量。");
    console.error("请先设置后重试，例如：DATABASE_URL='mysql://...' node scripts/db-doctor.mjs");
    process.exit(2);
  }

  const conn = await mysql.createConnection(url);
  try {
    // 只打印主机与库名，避免把账号密码写进日志
    const { host, pathname } = new URL(url);
    log(`已连接：${host}${pathname}`);
    log(`模式：${shouldFix ? "修复（--fix）" : "只读体检"}`);

    // ---- 1. course_evaluations 的 5 个评分列 ----
    log("\n── course_evaluations「四、教学过程」评分列 ──");
    const evalCols = await getColumns(conn, "course_evaluations");
    if (evalCols.size === 0) {
      console.error("未找到 course_evaluations 表，请确认 DATABASE_URL 指向正确的库。");
      process.exit(2);
    }

    const pending = []; // 需要重命名的列
    let ambiguous = false;
    let healthy = true;

    for (const r of SCORE_RENAMES) {
      const hasOld = evalCols.has(r.from);
      const hasNew = evalCols.has(r.to);

      if (hasNew && !hasOld) {
        log(`  ✓ ${r.item}：${r.to}（与代码一致）`);
      } else if (hasOld && !hasNew) {
        const n = await countNonNull(conn, "course_evaluations", r.from);
        pending.push({ ...r, dataRows: n });
        healthy = false;
        log(`  ✗ ${r.item}：数据库仍是旧列名 ${r.from}，代码要求 ${r.to}（该列有 ${n} 行非空数据）`);
      } else if (hasOld && hasNew) {
        ambiguous = true;
        healthy = false;
        const nOld = await countNonNull(conn, "course_evaluations", r.from);
        const nNew = await countNonNull(conn, "course_evaluations", r.to);
        log(`  ! ${r.item}：新旧列同时存在（${r.from}=${nOld} 行数据，${r.to}=${nNew} 行数据）—— 需人工判断保留哪个`);
      } else {
        healthy = false;
        log(`  ! ${r.item}：新旧列都不存在（${r.from} / ${r.to}）—— 表结构异常`);
      }
    }

    // ---- 2. users.extraRoles（多角色功能）----
    log("\n── users.extraRoles（多角色切换功能所需）──");
    const userCols = await getColumns(conn, "users");
    if (userCols.has("extraRoles")) {
      log("  ✓ 已存在");
    } else {
      log("  ✗ 不存在 —— 需执行迁移 0005_add_user_extra_roles（pnpm db:push）");
      healthy = false;
    }

    // ---- 3. 学期配置 ----
    log("\n── 学期配置（semesters）──");
    try {
      const [semRows] = await conn.query(
        "SELECT id, academicYear, name, startDate, totalWeeks, isActive FROM `semesters` ORDER BY startDate DESC"
      );
      if (semRows.length === 0) {
        log("  ! 未配置任何学期，系统以内置默认值运行（建议在「统计仪表盘 → 学期配置」新建）");
        healthy = false;
      } else {
        const actives = semRows.filter((r) => r.isActive);
        for (const r of semRows) {
          log(`  ${r.isActive ? "▶" : " "} ${r.academicYear} ${r.name}：起始 ${r.startDate}，共 ${r.totalWeeks} 周${r.isActive ? "（当前学期）" : ""}`);
        }
        if (actives.length !== 1) {
          log(`  ! 当前学期应有且仅有 1 个，实际为 ${actives.length} 个`);
          healthy = false;
        }
        const [orphan] = await conn.query(
          "SELECT COUNT(*) AS n FROM `course_evaluations` WHERE `semesterId` IS NULL"
        );
        if (Number(orphan[0]?.n || 0) > 0) {
          log(`  ! 有 ${orphan[0].n} 条评价未归属任何学期（跨学期统计会遗漏）`);
          healthy = false;
        }
      }
    } catch (err) {
      if (err?.code === "ER_NO_SUCH_TABLE") {
        log("  ✗ semesters 表不存在 —— 需执行迁移 0006（pnpm db:push）");
        healthy = false;
      } else {
        log(`  查询失败：${err.message}`);
      }
    }

    await reportMigrationState(conn);

    // ---- 4. 结论与处置 ----
    log("\n── 结论 ──");

    if (healthy) {
      log("  数据库结构与代码一致，无需处理。");
      return;
    }

    if (ambiguous) {
      log("  检测到新旧列并存，情况不明确，脚本不会自动修改。");
      log("  请人工确认哪一列保存着有效评分数据后再处理。");
      process.exitCode = 1;
      return;
    }

    if (pending.length === 0) {
      log("  评分列本身无需重命名（其余问题见上）。");
      process.exitCode = 1;
      return;
    }

    const withData = pending.filter((p) => p.dataRows > 0);

    if (withData.length > 0 && !acceptPositional) {
      log(`  需要重命名 ${pending.length} 个评分列，但其中 ${withData.length} 个列含有真实评分数据：`);
      for (const p of withData) {
        log(`    - ${p.from} → ${p.to}（${p.dataRows} 行）`);
      }
      log("");
      log("  ⚠ 这批列是评价指标体系重新设计，并非逐一对应改名。");
      log("    例如 score_rhythm_transition（节奏过渡）按位置会映射到 score_equal_dialogue（平等交流氛围），");
      log("    而语义上它更接近 score_pace_control（节奏调控能力）。");
      log("    强行按位置重命名不会丢数据，但会让历史评分张冠李戴。");
      log("");
      log("  请先人工确认映射关系。确认按位置映射无误后，执行：");
      log("    node scripts/db-doctor.mjs --fix --accept-positional-mapping");
      process.exitCode = 1;
      return;
    }

    if (!shouldFix) {
      log(`  需要重命名 ${pending.length} 个评分列（均无历史数据，重命名安全）。`);
      log("  执行修复：node scripts/db-doctor.mjs --fix");
      process.exitCode = 1;
      return;
    }

    // ---- 执行重命名 ----
    log("  开始重命名（使用 CHANGE COLUMN，保留列内数据）：");
    for (const p of pending) {
      const sql = `ALTER TABLE \`course_evaluations\` CHANGE COLUMN \`${p.from}\` \`${p.to}\` int`;
      log(`    ${sql}`);
      await conn.query(sql);
    }
    log(`  完成，已重命名 ${pending.length} 个列。请重新运行本脚本确认。`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\n执行失败：", err.message);
  process.exit(2);
});
