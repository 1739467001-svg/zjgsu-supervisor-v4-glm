#!/usr/bin/env node
/**
 * 一次性数据订正：把本学期（2026-2027 第一学期，起始日 2026-09-14）已导入的 MBA 课程
 * 中「9.12/9.13 提前开课」的周次从第 1 周改为第 0 周（开学前），全校校历统一口径。
 * 匹配键：课程名 + 教师 + 星期 + 节次（MBA 无节次，用起止时间），与导入时的归并键一致（去掉班级/教室更宽容）。
 */
const XLSX = require("xlsx");
const mysql = require("mysql2/promise");

function formatWeeks(weeks) {
  if (weeks.length === 0) return "";
  if (weeks.includes(0)) {
    const rest = weeks.filter((w) => w > 0);
    return `第0周（开学前）${rest.length > 0 ? `|第${rest.join("|")}周` : ""}`;
  }
  return `第${weeks.join("|")}周`;
}

async function main() {
  const wb = XLSX.readFile("/Users/mac/Documents/蒋献导师/2026国庆节3.0计划推出/2026-2027-1/MBA2026-2027（一）学期课表.xls");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i] && rows[i].includes("日期")) { headerRow = i; break; }
  }
  const idx = {};
  rows[headerRow].forEach((h, i) => { if (h) idx[h] = i; });

  const groups = new Map();
  for (const r of rows.slice(headerRow + 1)) {
    const courseName = r[idx["课程名称"]];
    if (!courseName) continue;
    if (/^[（(]考试[）)]/.test(courseName) || r[idx["考试"]] === "考试") continue;
    const date = r[idx["日期"]];
    if (!date || Number.isNaN(Date.parse(date + "T00:00:00Z"))) continue;
    const period = r[idx["上课时间"]] && r[idx["下课时间"]] ? `${r[idx["上课时间"]]}-${r[idx["下课时间"]]}` : r[idx["上课时间"]];
    const key = [courseName, r[idx["授课教师"]], r[idx["星期"]], period].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(date);
  }

  const START = Date.parse("2026-09-14T00:00:00Z");
  const updates = [];
  for (const [key, dates] of groups) {
    const [courseName, teacher, weekday, period] = key.split("|");
    const weeks = [...new Set(dates.map((d) => Math.floor((Date.parse(d + "T00:00:00Z") - START) / (7 * 86400000)) + 1))]
      .filter((w) => w >= 0 && w <= 18)
      .sort((a, b) => a - b);
    if (weeks.includes(0)) {
      updates.push({ courseName, teacher, weekday, period, weekNumbers: weeks, customWeeks: formatWeeks(weeks) });
    }
  }

  console.log(`课表中含第 0 周的课程：${updates.length} 门`);

  const conn = await mysql.createConnection("mysql://root@127.0.0.1:3306/zjgsu_supervisor");
  let matched = 0;
  let unmatched = [];
  for (const u of updates) {
    const [rowsDb] = await conn.execute(
      "SELECT id FROM courses WHERE semesterId = 2 AND college = 'MBA学院' AND courseName = ? AND teacher = ? AND weekday = ? AND period = ?",
      [u.courseName, u.teacher, u.weekday, u.period]
    );
    if (rowsDb.length === 0) {
      unmatched.push(`${u.courseName}/${u.teacher}/${u.weekday}/${u.period}`);
      continue;
    }
    for (const row of rowsDb) {
      await conn.execute(
        "UPDATE courses SET weekNumbers = ?, customWeeks = ?, weekType = ? WHERE id = ?",
        [JSON.stringify(u.weekNumbers), u.customWeeks, u.customWeeks, row.id]
      );
    }
    matched += rowsDb.length;
  }
  console.log(`数据库已更新 ${matched} 行`);
  if (unmatched.length > 0) {
    console.log("未匹配到数据库记录（需人工核对）:");
    for (const u of unmatched) console.log("  -", u);
  }
  await conn.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
