import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import {
  CourseEvaluation,
  InsertCourse,
  InsertCourseEvaluation,
  InsertListeningPlan,
  InsertNotification,
  InsertUser,
  courses,
  courseEvaluations,
  listeningPlans,
  notifications,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: any = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      if (!_pool) {
        _pool = mysql.createPool({
          uri: process.env.DATABASE_URL,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          enableKeepAlive: true,
        });
      }
      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

export async function closeDb() {
  if (_pool) {
    try {
      await _pool.end();
      _pool = null;
      _db = null;
      console.log("[Database] Connection pool closed");
    } catch (error) {
      console.warn("[Database] Error closing pool:", error);
    }
  }
}

// ============================================================
// 用户相关
// ============================================================
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach((field) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  });

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmployeeId(employeeId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.employeeId, employeeId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(users.role, users.name);
}

/**
 * 按角色查询用户，包含主角色匹配和附加角色（extraRoles）匹配，
 * 确保拥有"附加角色"的多角色用户也能被相应角色的通知/列表查询到。
 */
export async function getUsersByRole(role: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(users)
    .where(or(eq(users.role, role as any), sql`JSON_CONTAINS(${users.extraRoles}, ${JSON.stringify(role)})`));
}

export async function updateUserRole(userId: number, role: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ role: role as any }).where(eq(users.id, userId));
}

export async function updateUserExtraRoles(userId: number, extraRoles: string[]) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ extraRoles }).where(eq(users.id, userId));
}

export async function updateUserCollege(userId: number, college: string | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ college }).where(eq(users.id, userId));
}

/**
 * 直接更新用户密码，不经过upsertUser，确保密码可靠写入数据库
 */
export async function updateUserPassword(userId: number, newPassword: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ password: newPassword, updatedAt: new Date() }).where(eq(users.id, userId));
}

// ============================================================
// 课程相关
// ============================================================
export async function getCourses(filters: {
  college?: string;
  campus?: string;
  weekday?: string;
  week?: number;
  teacher?: string;
  courseName?: string;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  const conditions = [];
  // 严格过滤：只有非空字符串才作为筛选条件
  // 学院支持多学院字符串（顿号/逗号分隔，供学院秘书/院级督导多学院场景使用），用模糊匹配逐一比对
  if (filters.college && filters.college.trim()) {
    const collegeList = filters.college
      .split(/[、,，]/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (collegeList.length === 1) {
      conditions.push(like(courses.college, `%${collegeList[0]}%`));
    } else if (collegeList.length > 1) {
      conditions.push(or(...collegeList.map((c) => like(courses.college, `%${c}%`)))!);
    }
  }
  if (filters.campus && filters.campus.trim()) conditions.push(eq(courses.campus, filters.campus.trim()));
  if (filters.weekday && filters.weekday.trim()) conditions.push(eq(courses.weekday, filters.weekday.trim()));
  if (filters.teacher && filters.teacher.trim()) conditions.push(like(courses.teacher, `%${filters.teacher.trim()}%`));
  if (filters.courseName && filters.courseName.trim()) conditions.push(like(courses.courseName, `%${filters.courseName.trim()}%`));
  if (filters.week && filters.week > 0) {
    // 使用JSON_CONTAINS查询包含特定周次的课程（weekNumbers是JSON数组如[1,2,3,4,5]）
    conditions.push(sql`JSON_CONTAINS(${courses.weekNumbers}, CAST(${filters.week} AS JSON))`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const [data, countResult] = await Promise.all([
    db.select().from(courses).where(where).limit(pageSize).offset(offset).orderBy(courses.college, courses.courseName),
    db.select({ count: sql<number>`count(*)` }).from(courses).where(where),
  ]);

  return { data, total: Number(countResult[0]?.count || 0) };
}

export async function getCourseById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getCoursesByCollege(college: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(courses).where(eq(courses.college, college)).orderBy(courses.courseName);
}

export async function getDistinctColleges() {
  const db = await getDb();
  if (!db) return [];
  const result = await db
    .selectDistinct({ college: courses.college })
    .from(courses)
    .where(sql`${courses.college} != ''`)
    .orderBy(courses.college);
  return result.map((r) => r.college).filter(Boolean);
}

export async function getDistinctTeachers(college?: string) {
  const db = await getDb();
  if (!db) return [];
  const where = college ? eq(courses.college, college) : undefined;
  const result = await db
    .selectDistinct({ teacher: courses.teacher })
    .from(courses)
    .where(where)
    .orderBy(courses.teacher);
  return result.map((r) => r.teacher).filter(Boolean);
}

// ============================================================
// 听课计划相关
// ============================================================
export async function createListeningPlan(plan: InsertListeningPlan) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  // 唯一性校验：同一督导+同一课程+同一周次只能有一条记录
  if (plan.planWeek != null) {
    const existing = await db
      .select({ id: listeningPlans.id })
      .from(listeningPlans)
      .where(
        and(
          eq(listeningPlans.supervisorId, plan.supervisorId!),
          eq(listeningPlans.courseId, plan.courseId!),
          eq(listeningPlans.planWeek, plan.planWeek)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      throw new Error(`第 ${plan.planWeek} 周已加入过该课程的听课计划，不可重复添加`);
    }
  }

  await db.insert(listeningPlans).values(plan);
  const result = await db
    .select()
    .from(listeningPlans)
    .where(and(eq(listeningPlans.supervisorId, plan.supervisorId!), eq(listeningPlans.courseId, plan.courseId!)))
    .orderBy(desc(listeningPlans.createdAt))
    .limit(1);
  return result[0];
}

/**
 * 查询某督导对某课程已占用的周次（已有听课计划 或 已提交评价的周次）
 * 返回 { usedWeeks: number[], evaluatedWeeks: number[] }
 */
export async function getUsedWeeksForCourse(supervisorId: number, courseId: number) {
  const db = await getDb();
  if (!db) return { usedWeeks: [], evaluatedWeeks: [] };

  // 已有听课计划的周次（pending / completed / cancelled 均算占用）
  const planRows = await db
    .select({ planWeek: listeningPlans.planWeek, status: listeningPlans.status })
    .from(listeningPlans)
    .where(
      and(
        eq(listeningPlans.supervisorId, supervisorId),
        eq(listeningPlans.courseId, courseId)
      )
    );

  const usedWeeks: number[] = [];
  const evaluatedWeeks: number[] = [];
  for (const row of planRows) {
    if (row.planWeek != null) {
      usedWeeks.push(row.planWeek);
      if (row.status === "completed") {
        evaluatedWeeks.push(row.planWeek);
      }
    }
  }

  return { usedWeeks, evaluatedWeeks };
}

export async function getListeningPlansBySupervisor(supervisorId: number) {
  const db = await getDb();
  if (!db) return [];
  const plans = await db
    .select()
    .from(listeningPlans)
    .where(eq(listeningPlans.supervisorId, supervisorId))
    .orderBy(desc(listeningPlans.createdAt));

  // 关联课程信息
  const courseIds = Array.from(new Set(plans.map((p) => p.courseId)));
  if (courseIds.length === 0) return [];
  const courseList = await db.select().from(courses).where(inArray(courses.id, courseIds));
  const courseMap = new Map(courseList.map((c) => [c.id, c]));

  // 关联评价 ID 和状态：查询该督导专家对这些课程的评价记录
  const evaluationList = await db
    .select({ id: courseEvaluations.id, courseId: courseEvaluations.courseId, supervisorId: courseEvaluations.supervisorId, status: courseEvaluations.status })
    .from(courseEvaluations)
    .where(eq(courseEvaluations.supervisorId, supervisorId))
    .orderBy(desc(courseEvaluations.createdAt));
  // 按 courseId 建立映射（同一课程可能有多条评价，取最新的一条，同时记录评价状态）
  const evaluationMap = new Map<number, { id: number; status: string }>();
  for (const ev of evaluationList) {
    // 由于查询结果已按 createdAt desc 排序，第一次遇到的就是最新的
    if (!evaluationMap.has(ev.courseId)) {
      evaluationMap.set(ev.courseId, { id: ev.id, status: ev.status || 'draft' });
    }
  }

  return plans.map((p) => ({
    ...p,
    course: courseMap.get(p.courseId),
    evaluationId: evaluationMap.get(p.courseId)?.id ?? null,
    evaluationStatus: evaluationMap.get(p.courseId)?.status ?? null,
  }));
}

export async function updateListeningPlanStatus(planId: number, status: "pending" | "completed" | "cancelled") {
  const db = await getDb();
  if (!db) return;
  await db.update(listeningPlans).set({ status }).where(eq(listeningPlans.id, planId));
}

/**
 * 评价提交为"已提交"时，自动把对应督导专家在该课程下的待听课计划标记为"已评价"，
 * 避免出现"评价已提交但待听课列表仍显示该课程"的问题。
 * 优先匹配周次一致的计划，否则匹配任意一条待听课计划（含未指定周次的）。
 * 返回被更新的 planId（若有），供写回 courseEvaluations.planId 使用。
 */
export async function completePendingPlanForEvaluation(
  supervisorId: number,
  courseId: number,
  actualWeek?: number | null
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const pendingPlans = await db
    .select({ id: listeningPlans.id, planWeek: listeningPlans.planWeek })
    .from(listeningPlans)
    .where(
      and(
        eq(listeningPlans.supervisorId, supervisorId),
        eq(listeningPlans.courseId, courseId),
        eq(listeningPlans.status, "pending")
      )
    );

  if (pendingPlans.length === 0) return null;

  const matched =
    (actualWeek != null && pendingPlans.find((p) => p.planWeek === actualWeek)) ||
    pendingPlans.find((p) => p.planWeek == null) ||
    pendingPlans[0];

  await db.update(listeningPlans).set({ status: "completed" }).where(eq(listeningPlans.id, matched.id));
  return matched.id;
}

export async function deleteListeningPlan(planId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(listeningPlans).where(eq(listeningPlans.id, planId));
}

// ============================================================
// 课程评价相关
export async function createEvaluation(evaluation: InsertCourseEvaluation) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  
  await db.insert(courseEvaluations).values(evaluation);
  const result = await db
    .select()
    .from(courseEvaluations)
    .where(eq(courseEvaluations.supervisorId, evaluation.supervisorId!))
    .orderBy(desc(courseEvaluations.createdAt))
    .limit(1);
  return result[0];
}

export async function updateEvaluation(id: number, data: Partial<InsertCourseEvaluation>) {
  const db = await getDb();
  if (!db) return;
  await db.update(courseEvaluations).set(data).where(eq(courseEvaluations.id, id));
}

export async function deleteEvaluation(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(courseEvaluations).where(eq(courseEvaluations.id, id));
}

export async function getEvaluationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(courseEvaluations).where(eq(courseEvaluations.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getEvaluationsBySupervisor(supervisorId: number) {
  const db = await getDb();
  if (!db) return [];
  const evals = await db
    .select()
    .from(courseEvaluations)
    .where(eq(courseEvaluations.supervisorId, supervisorId))
    .orderBy(desc(courseEvaluations.createdAt));

  return enrichEvaluations(evals);
}

export async function getAllEvaluations(filters?: { college?: string; supervisorId?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.supervisorId) conditions.push(eq(courseEvaluations.supervisorId, filters.supervisorId));

  const evals = await db
    .select()
    .from(courseEvaluations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(courseEvaluations.createdAt));

  const enriched = await enrichEvaluations(evals);

  // 按学院过滤（支持秘书的多学院字段，用顿号/逗号分隔）
  if (filters?.college) {
    const filterColleges = filters.college
      .split(/[、,，]/)
      .map((c) => c.trim().replace(/（.*?）/g, "").replace(/\(.*?\)/g, ""))
      .filter(Boolean);
    return enriched.filter((e) => {
      const courseCollege = (e.course?.college || "").replace(/（.*?）/g, "").replace(/\(.*?\)/g, "").trim();
      return filterColleges.some((fc) => courseCollege.includes(fc) || fc.includes(courseCollege));
    });
  }
  return enriched;
}

async function enrichEvaluations(evals: CourseEvaluation[]) {
  if (evals.length === 0) return [];
  const db = await getDb();
  if (!db) return evals.map((e) => ({ ...e, course: null, supervisor: null }));

  // 过滤掉无效的 courseId（<= 0），避免 inArray 查询报错或返回脏数据
  const validCourseIds = Array.from(new Set(evals.map((e) => e.courseId).filter((id) => id > 0)));
  const supervisorIds = Array.from(new Set(evals.map((e) => e.supervisorId)));

  const [courseList, supervisorList] = await Promise.all([
    validCourseIds.length > 0
      ? db.select().from(courses).where(inArray(courses.id, validCourseIds))
      : Promise.resolve([]),
    db.select().from(users).where(inArray(users.id, supervisorIds)),
  ]);

  const courseMap = new Map(courseList.map((c) => [c.id, c]));
  const supervisorMap = new Map(supervisorList.map((u) => [u.id, u]));

  return evals.map((e) => ({
    ...e,
    // courseId <= 0 的孤立评价，course 明确置为 null（前端会显示警告标识）
    course: e.courseId > 0 ? (courseMap.get(e.courseId) || null) : null,
    supervisor: supervisorMap.get(e.supervisorId) || null,
  }));
}

// ============================================================
// 统计相关（研究生院主管仪表盘）
// ============================================================
export async function getAdminStats() {
  const db = await getDb();
  if (!db) return null;

  const [
    totalCourses,
    totalEvaluations,
    totalSupervisors,
    evalByCollege,
    evalByWeekday,
    recentEvals,
    topSupervisors,
    avgScoreByCollege,
  ] = await Promise.all([
    // 总课程数
    db.select({ count: sql<number>`count(*)` }).from(courses),
    // 总评价数
    db.select({ count: sql<number>`count(*)` }).from(courseEvaluations).where(eq(courseEvaluations.status, "submitted")),
    // 督导专家数
    db.select({ count: sql<number>`count(*)` }).from(users).where(inArray(users.role, ["supervisor_expert", "supervisor_leader"] as any[])),
    // 各学院评价次数（用 leftJoin 而非 innerJoin：课程被替换/删除后仍保留关联评价的行，
    // 避免"孤儿评价"从学院维度统计中被静默丢弃，导致与总数 KPI 对不上）
    db
      .select({
        college: sql<string>`COALESCE(${courses.college}, '未知学院（原课程已变更）')`,
        count: sql<number>`count(*)`,
      })
      .from(courseEvaluations)
      .leftJoin(courses, eq(courseEvaluations.courseId, courses.id))
      .where(eq(courseEvaluations.status, "submitted"))
      .groupBy(sql`COALESCE(${courses.college}, '未知学院（原课程已变更）')`)
      .orderBy(desc(sql`count(*)`)),
    // 按星期分布
    db
      .select({
        weekday: courses.weekday,
        count: sql<number>`count(*)`,
      })
      .from(courseEvaluations)
      .leftJoin(courses, eq(courseEvaluations.courseId, courses.id))
      .where(eq(courseEvaluations.status, "submitted"))
      .groupBy(courses.weekday),
    // 最近评价
    db
      .select()
      .from(courseEvaluations)
      .where(eq(courseEvaluations.status, "submitted"))
      .orderBy(desc(courseEvaluations.createdAt))
      .limit(10),
    // 最活跃督导专家
    db
      .select({
        supervisorId: courseEvaluations.supervisorId,
        count: sql<number>`count(*)`,
      })
      .from(courseEvaluations)
      .where(eq(courseEvaluations.status, "submitted"))
      .groupBy(courseEvaluations.supervisorId)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
    // 各学院平均评分（同样用 leftJoin 保留孤儿评价；按评价次数降序排列，
    // 与"各学院督导评价次数"图表口径一致，避免两张图表因排序不同而展示不同的学院集合）
    db
      .select({
        college: sql<string>`COALESCE(${courses.college}, '未知学院（原课程已变更）')`,
        avgScore: sql<number>`AVG(${courseEvaluations.overallScore})`,
        count: sql<number>`count(*)`,
      })
      .from(courseEvaluations)
      .leftJoin(courses, eq(courseEvaluations.courseId, courses.id))
      .where(and(eq(courseEvaluations.status, "submitted"), sql`${courseEvaluations.overallScore} IS NOT NULL`))
      .groupBy(sql`COALESCE(${courses.college}, '未知学院（原课程已变更）')`)
      .orderBy(desc(sql`count(*)`)),
  ]);

  // 获取最近评价的详细信息
  const recentEnriched = await enrichEvaluations(recentEvals);

  // 获取活跃督导专家详细信息
  const supervisorIds = topSupervisors.map((s) => s.supervisorId);
  const supervisorDetails = supervisorIds.length > 0
    ? await db.select().from(users).where(inArray(users.id, supervisorIds))
    : [];
  const supervisorMap = new Map(supervisorDetails.map((u) => [u.id, u]));

  return {
    totalCourses: Number(totalCourses[0]?.count || 0),
    totalEvaluations: Number(totalEvaluations[0]?.count || 0),
    totalSupervisors: Number(totalSupervisors[0]?.count || 0),
    evalByCollege: evalByCollege.map((r) => ({ college: r.college, count: Number(r.count) })),
    evalByWeekday: evalByWeekday.map((r) => ({ weekday: r.weekday, count: Number(r.count) })),
    recentEvals: recentEnriched,
    topSupervisors: topSupervisors.map((s) => ({
      supervisor: supervisorMap.get(s.supervisorId),
      count: Number(s.count),
    })),
    avgScoreByCollege: avgScoreByCollege.map((r) => ({
      college: r.college,
      avgScore: Number(r.avgScore || 0).toFixed(2),
      count: Number(r.count),
    })),
  };
}

// ============================================================
// 通知相关
// ============================================================
export async function createNotification(notification: InsertNotification) {
  const db = await getDb();
  if (!db) return;
  await db.insert(notifications).values(notification);
}

export async function getNotificationsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.recipientId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
}

export async function markNotificationRead(notificationId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, notificationId));
}

export async function markAllNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.recipientId, userId));
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.recipientId, userId), eq(notifications.isRead, false)));
  return Number(result[0]?.count || 0);
}

// ============================================================
// 课程评价进度统计
// ============================================================

/**
 * 获取指定学院（或全部学院）的课程评价进度
 * 返回：每门课程的基本信息 + 是否已被评价 + 评价列表
 */
export async function getCourseEvaluationProgress(college?: string) {
  const db = await getDb();
  if (!db) return [];

  // 构建课程查询条件
  const conditions = [];
  if (college) {
    // 支持多学院字符串（顿号/逗号分隔）
    const colleges = college
      .split(/[、,，]/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (colleges.length === 1) {
      conditions.push(like(courses.college, `%${colleges[0]}%`));
    } else {
      conditions.push(or(...colleges.map((c) => like(courses.college, `%${c}%`)))!);
    }
  }

  const allCourses = await db
    .select()
    .from(courses)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(courses.college, courses.courseName);

  if (allCourses.length === 0) return [];

  // 获取已评价的课程ID集合（submitted状态）
  const courseIds = allCourses.map((c) => c.id);
  const evaluatedRecords = await db
    .select({
      courseId: courseEvaluations.courseId,
      id: courseEvaluations.id,
      supervisorId: courseEvaluations.supervisorId,
      overallScore: courseEvaluations.overallScore,
      status: courseEvaluations.status,
      actualWeek: courseEvaluations.actualWeek,
      createdAt: courseEvaluations.createdAt,
    })
    .from(courseEvaluations)
    .where(and(inArray(courseEvaluations.courseId, courseIds), eq(courseEvaluations.status, "submitted")));

  // 获取督导专家信息
  const supervisorIds = Array.from(new Set(evaluatedRecords.map((e) => e.supervisorId)));
  const supervisorList = supervisorIds.length > 0
    ? await db.select({ id: users.id, name: users.name, employeeId: users.employeeId }).from(users).where(inArray(users.id, supervisorIds))
    : [];
  const supervisorMap = new Map(supervisorList.map((u) => [u.id, u]));

  // 按课程ID分组评价记录
  const evalByCourse = new Map<number, typeof evaluatedRecords>();
  for (const ev of evaluatedRecords) {
    if (!evalByCourse.has(ev.courseId)) evalByCourse.set(ev.courseId, []);
    evalByCourse.get(ev.courseId)!.push(ev);
  }

  return allCourses.map((course) => {
    const evals = evalByCourse.get(course.id) || [];
    return {
      ...course,
      isEvaluated: evals.length > 0,
      evaluationCount: evals.length,
      evaluations: evals.map((e) => ({
        ...e,
        supervisor: supervisorMap.get(e.supervisorId) || null,
      })),
    };
  });
}

/**
 * 获取全校各学院的课程评价进度汇总（研究生院主管用）
 */
export async function getAllCollegeEvaluationProgress() {
  const db = await getDb();
  if (!db) return [];

  // 按学院统计课程总数
  const courseTotals = await db
    .select({
      college: courses.college,
      total: sql<number>`count(*)`,
    })
    .from(courses)
    .groupBy(courses.college)
    .orderBy(courses.college);

  // 按学院统计已评价课程数（distinct courseId）
  const evaluatedCounts = await db
    .select({
      college: courses.college,
      evaluatedCourses: sql<number>`count(DISTINCT ${courseEvaluations.courseId})`,
      totalEvaluations: sql<number>`count(*)`,
    })
    .from(courseEvaluations)
    .innerJoin(courses, eq(courseEvaluations.courseId, courses.id))
    .where(eq(courseEvaluations.status, "submitted"))
    .groupBy(courses.college);

  const evalMap = new Map(evaluatedCounts.map((e) => [e.college, e]));

  return courseTotals.map((ct) => {
    const evalData = evalMap.get(ct.college);
    return {
      college: ct.college || "未知学院",
      totalCourses: Number(ct.total),
      evaluatedCourses: Number(evalData?.evaluatedCourses || 0),
      totalEvaluations: Number(evalData?.totalEvaluations || 0),
    };
  });
}
