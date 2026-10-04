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
 * - 文件里未出现的课程仍保留，上传不承担清理历史数据的职责
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
import { hasAnyRole } from "@shared/roles";

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
      // hasAnyRole：否则「主角色普通用户 + 附加角色研究生院主管」会被挡在外面
      if (!hasAnyRole(user as any, ["graduate_admin", "admin"])) {
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

      // 两段式：mode=preview 只解析比对不写库，mode=confirm 才真正导入。
      // 会议纪要要求「上传 → 解析预览 → 确认导入」，防止格式错排的课表一次性落库。
      const mode = req.body.mode === "confirm" ? "confirm" : "preview";

      // ---- 解析（与命令行导入工具同一套解析器）----
      const active = await getActiveSemester();
      if (!active || Number(req.body.semesterId) !== active.id) {
        return res.status(400).json({ success: false, message: "仅可更新当前学期，请刷新页面后确认所选学期" });
      }
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

      // 双入口校验：所选入口与文件模板不符时明确拒绝（总课表 ≠ MBA 课表）
      const entry = String(req.body.entry ?? "");
      if ((entry === "standard" || entry === "mba") && parsed.format !== entry) {
        const expectLabel = entry === "mba" ? "MBA 课表" : "研究生排课信息表（总课表）";
        const gotLabel = parsed.format === "mba" ? "MBA 课表" : "研究生排课信息表";
        return res.status(400).json({
          success: false,
          message: `所选入口与文件模板不符：入口要求「${expectLabel}」，文件识别为「${gotLabel}」。请确认后重新选择入口或更换文件。`,
        });
      }

      // key 相同的记录合并，周次取并集（真实课表里同一门课会按周次拆成多行）
      const { merged: newCourseData } = mergeDuplicateCourses(parsed.courses);
      if (newCourseData.some(c => c.academicYear !== active.academicYear || c.semester !== active.name)) {
        return res.status(400).json({ success: false, message: "课表所属学期与当前学期不一致，已停止，未修改任何数据" });
      }
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

      // ---- 与当前学期现有课程比对（预览与确认共用同一份差异计算）----
      // 归档学期的课程绝不参与比对，更不会被当成「新课表里没有的课」删掉
      const semesterScope = eq(courses.semesterId, active.id);
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

      // 当前学期内、新课表里已不存在的课程（仅统计，不删除）
      const toDeleteIds = existingCourses.map((c) => c.id).filter((id) => !matchedIds.has(id));

      const formatLabel = parsed.format === "mba" ? "MBA 课表" : "研究生排课信息表";

      // 学院分布（预览展示用，最多 30 个学院）
      const collegeDist = [...collegeSet]
        .map((college) => ({
          college,
          count: newCourseData.filter((c) => c.college === college).length,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);

      if (mode === "preview") {
        // 预览：只读比对，绝不写库
        return res.json({
          success: true,
          preview: {
            format: parsed.format,
            formatLabel,
            sourceRows: parsed.sourceRows,
            courseCount: newCourseData.length,
            inserted: toInsert.length,
            updated: toUpdate.length,
            preserved: toDeleteIds.length,
            warnings: parsed.warnings,
            collegeDist,
            semesterLabel: `${active.academicYear} ${active.name}`,
          },
        });
      }

      // ---- 确认导入：UPSERT，严格限定在当前学期内 ----
      // 不删除任何课程。两份课表分次上传，也不会把另一份的课程清空。

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


      // 统计的是当前学期的课程数，与「全校课程」列表口径一致
      const [finalStats] = await db
        .select({
          total: sql<number>`count(*)`,
          teachers: sql<number>`count(distinct ${courses.teacher})`,
          colleges: sql<number>`count(distinct ${courses.college})`,
        })
        .from(courses)
        .where(semesterScope);

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
          deleted: 0,
          preserved: toDeleteIds.length,
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
