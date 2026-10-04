/**
 * 冒烟测试库种子数据（scripts/api-smoke.mjs 的前置条件）。
 *
 * 注意：server/db.integration.test.ts 会清空 users/listening_plans 等表，
 * 因此每次跑完集成测试后、跑冒烟前，都需要重新执行本脚本。
 *
 * 独立运行：DATABASE_URL='mysql://root@127.0.0.1:3306/zjgsu_test' npx tsx scripts/seed-smoke.mjs
 * 被 api-smoke.mjs 导入时（SMOKE_INLINE=1）只导出函数、不自动执行。
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

export async function seedSmoke(url) {
  if (!url || !new URL(url).pathname.includes("test")) {
    throw new Error("拒绝执行：DATABASE_URL 必须指向库名含 test 的专用测试库（本脚本会清空业务表）");
  }
  const conn = await mysql.createConnection(url);

  await conn.query("DELETE FROM notifications");
  await conn.query("DELETE FROM course_evaluations");
  await conn.query("DELETE FROM listening_plans");
  await conn.query("DELETE FROM user_admin_logs");
  await conn.query("DELETE FROM users");
  await conn.query("DELETE FROM courses");
  await conn.query("DELETE FROM semesters WHERE academicYear NOT IN ('2025-2026')");
  await conn.query(
    `INSERT INTO semesters (academicYear, name, startDate, totalWeeks, isActive)
     SELECT '2024-2025', '第二学期', '2025-03-03', 19, false
     WHERE NOT EXISTS (SELECT 1 FROM semesters WHERE academicYear = '2024-2025')`
  );

  await conn.query(
    `INSERT INTO users (openId, employeeId, name, role, extraRoles, college, supervisorScope) VALUES
     ('t-admin','T9001','测试主管','graduate_admin',NULL,'研究生院','school'),
     ('t-sec','T9002','测试秘书','college_secretary',NULL,'经济学院','college'),
     ('t-exp-college','T9003','院级督导甲','supervisor_expert',NULL,'经济学院','college'),
     ('t-exp-school','T9004','校级督导乙','supervisor_expert',NULL,'研究生院','school'),
     ('t-user','T9005','普通用户丙','user',NULL,NULL,'school')`
  );

  const courseSeed = (name, college, teacher, weekday, period, major, count, academicYear, semester, active) => `
    INSERT INTO courses (college, courseName, courseType, classroom, classId, teacher, campus, weekday, weekType, period, studentMajor, studentCount, academicYear, semester, semesterId, weekNumbers)
    SELECT '${college}','${name}','学位课','A101','T-C','${teacher}','下沙','${weekday}','全周','${period}','${major}',${count},'${academicYear}','${semester}',
      ${active ? "(SELECT id FROM semesters WHERE isActive = true)" : "(SELECT id FROM semesters WHERE isActive = false LIMIT 1)"},'[1,2,3]'`;

  await conn.query(courseSeed("计量经济学A", "经济学院", "张老师", "星期一", "第1-2节", "统计学", 30, "2025-2026", "第二学期", true));
  await conn.query(courseSeed("中级微观B", "经济学院", "李老师", "星期二", "第3-4节", "经济学", 28, "2025-2026", "第二学期", true));
  await conn.query(courseSeed("宪法学C", "法学院", "王老师", "星期三", "第5-6节", "法学", 25, "2025-2026", "第二学期", true));
  await conn.query(courseSeed("历史学期课D", "经济学院", "赵老师", "星期四", "第1-2节", "经济学", 20, "2024-2025", "第二学期", false));

  const [summary] = await conn.query(
    `SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM courses) AS courses,
            (SELECT COUNT(*) FROM semesters) AS semesters`
  );
  console.log("种子完成:", summary[0]);
  await conn.end();
}

if (process.env.SMOKE_INLINE !== "1") {
  const url = process.env.DATABASE_URL;
  try {
    await seedSmoke(url);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
