/**
 * 课程数据上传路由
 * POST /api/upload-courses
 * 仅研究生院主管（graduate_admin）和 admin 可访问
 *
 * 解析逻辑与命令行导入工具（scripts/import-courses.ts）共用 server/courseImport.ts，
 * 两条路径必须同源：此前上传接口自己按列序号解析，既读不了 MBA 课表，
 * 也会在换学期后把归档的旧课表当成「新课表里没有的课」删掉。
 *
 * 核心策略：限定在当前学期内 UPSERT（保持 ID 稳定）
 * - 用「学院+课程名+教师+星期+节次+教室」作为唯一标识
 * - 已存在的课程：保留原 ID，仅更新内容字段
 * - 新增课程：插入并分配新 ID
 * - 不再存在的课程：仅限当前学期内、且无关联评价/听课计划时才删除
 * - 其他学期（已归档）的课程一律不动
 * 这样可确保 course_evaluations 和 listening_plans 的 courseId 关联不断裂
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import { getDb, getActiveSemester } from "./db";
import { courses } from "../drizzle/schema";
import { sql, eq, and, isNull, or, inArray } from "drizzle-orm";
import { sdk } from "./_core/sdk";
import { parseCourseWorkbook, mergeDuplicateCourses, courseKey } from "./courseImport";

const router = Router();

// multer 内存存储（文件不落盘，直接在内存中处理）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB 限制
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase();
    if (ext.endsWith(".xls") || ext.endsWith(".xlsx")) {
      cb(null, true);
    } else {
      cb(new Error("只支持 .xls 或 .xlsx 格式的文件"));
    }
  },
});

// ============================================================
// 上传接口
// ============================================================
router.post(
  "/api/upload-courses",
  async (req: Request, res: Response, next) => {
    // 权限验证：仅 graduate_admin 和 admin 可访问
    try {
      const user = await sdk.authenticateRequest(req);
      if (!["graduate_admin", "admin"].includes(user.role || "")) {
        return res.status(403).json({
          success: false,
          message: "权限不足，仅研究生院主管可上传课程数据",
        });
      }
      (req as any).uploadUser = user;
    } catch {
      return res.status(401).json({ success: false, message: "请先登录" });
    }
    next();
  },
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "请选择要上传的文件" });
      }

      // ---- 解析（与命令行导入工具同一套解析器）----
      const active = await getActiveSemester();
      let parsed;
      try {
        parsed = parseCourseWorkbook(req.file.buffer, {
          // MBA 课表按日期换算周次，需要当前学期的起始日
          semesterStartDate: active?.startDate,
          totalWeeks: active?.totalWeeks,
        });
      } catch (err: any) {
        return res
          .status(400)
          .json({ success: false, message: err.message || "文件解析失败" });
      }

      // key 相同的记录合并，周次取并集（真实课表里同一门课会按周次拆成多行）
      const { merged: newCourseData } = mergeDuplicateCourses(parsed.courses);
      if (newCourseData.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "未找到有效课程数据，请检查文件格式" });
      }

      const teacherSet = new Set(newCourseData.map((r) => r.teacher).filter(Boolean));
      const collegeSet = new Set(newCourseData.map((r) => r.college).filter(Boolean));

      const db = await getDb();
      if (!db) {
        return res
          .status(500)
          .json({ success: false, message: "数据库连接失败" });
      }

      // ---- UPSERT：严格限定在当前学期内 ----
      // 归档学期的课程绝不参与比对，更不会被当成「新课表里没有的课」删掉
      const semesterScope = active
        ? or(eq(courses.semesterId, active.id), isNull(courses.semesterId))!
        : isNull(courses.semesterId);
      const existingCourses = await db.select().from(courses).where(semesterScope);

      const existingKeyMap = new Map<string, number>();
      for (const c of existingCourses) existingKeyMap.set(courseKey(c as any), c.id);

      const toUpdate: Array<{ id: number; data: (typeof newCourseData)[0] }> = [];
      const toInsert: Array<(typeof newCourseData)[0]> = [];
      const matchedIds = new Set<number>();

      for (const nc of newCourseData) {
        const id = existingKeyMap.get(courseKey(nc));
        if (id !== undefined) {
          toUpdate.push({ id, data: nc });
          matchedIds.add(id);
        } else {
          toInsert.push(nc);
        }
      }

      // 当前学期内、新课表里已不存在的课程
      const toDeleteIds = existingCourses.map((c) => c.id).filter((id) => !matchedIds.has(id));

      // 有评价或听课计划关联的一律保留，避免历史数据断链
      let safeToDeleteIds: number[] = toDeleteIds;
      if (toDeleteIds.length > 0) {
        const linked = (await db.execute(
          sql`SELECT DISTINCT courseId FROM course_evaluations WHERE courseId IN ${toDeleteIds}
              UNION SELECT DISTINCT courseId FROM listening_plans WHERE courseId IN ${toDeleteIds}`
        )) as any;
        const rows = Array.isArray(linked) ? linked[0] : linked;
        const linkedIds = new Set<number>(
          Array.isArray(rows) ? rows.map((r: any) => Number(r.courseId)) : []
        );
        safeToDeleteIds = toDeleteIds.filter((id) => !linkedIds.has(id));
      }

      const semesterId = active?.id ?? null;

      for (const { id, data } of toUpdate) {
        await db
          .update(courses)
          .set({ ...data, semesterId })
          .where(eq(courses.id, id));
      }

      if (toInsert.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < toInsert.length; i += batchSize) {
          await db.insert(courses).values(
            toInsert.slice(i, i + batchSize).map((c) => ({ ...c, semesterId }))
          );
        }
      }

      if (safeToDeleteIds.length > 0) {
        await db.delete(courses).where(inArray(courses.id, safeToDeleteIds));
      }

      // 统计的是当前学期的课程数，与「全校课程」列表口径一致
      const [finalStats] = await db
        .select({
          total: sql<number>`count(*)`,
          teachers: sql<number>`count(distinct ${courses.teacher})`,
          colleges: sql<number>`count(distinct ${courses.college})`,
        })
        .from(courses)
        .where(semesterScope);

      const formatLabel = parsed.format === "mba" ? "MBA 课表" : "研究生排课信息表";
      return res.json({
        success: true,
        message: `课程数据更新成功（识别为${formatLabel}）`,
        warnings: parsed.warnings,
        stats: {
          total: Number(finalStats?.total ?? newCourseData.length),
          teachers: Number(finalStats?.teachers ?? teacherSet.size),
          colleges: Number(finalStats?.colleges ?? collegeSet.size),
          updated: toUpdate.length,
          inserted: toInsert.length,
          deleted: safeToDeleteIds.length,
          preserved: toDeleteIds.length - safeToDeleteIds.length,
        },
      });
    } catch (err: any) {
      console.error("[upload-courses] 错误:", err);
      return res.status(500).json({
        success: false,
        message: "服务器内部错误：" + (err.message || "未知错误"),
      });
    }
  }
);

export default router;
