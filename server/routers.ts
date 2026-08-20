import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { hasAnyRole, getScopedCollege, ASSIGNABLE_ROLES } from "@shared/roles";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  completePendingPlanForEvaluation,
  createEvaluation,
  createListeningPlan,
  createNotification,
  deleteEvaluation,
  deleteListeningPlan,
  getAdminStats,
  getAllEvaluations,
  getAllUsers,
  getCourseById,
  getCourseEvaluationProgress,
  getAllCollegeEvaluationProgress,
  getCourses,
  getDistinctColleges,
  getDistinctTeachers,
  getEvaluationById,
  getEvaluationsBySupervisor,
  getListeningPlansBySupervisor,
  getUsedWeeksForCourse,
  getNotificationsByUser,
  getUnreadNotificationCount,
  getUserByEmployeeId,
  getUsersByRole,
  markAllNotificationsRead,
  markNotificationRead,
  updateEvaluation,
  updateListeningPlanStatus,
  updateUserCollege,
  updateUserExtraRoles,
  updateUserPassword,
  updateUserRole,
  upsertUser,
} from "./db";
import { sdk } from "./_core/sdk";
import { generateEvaluationExcel, generateEvaluationPdfHtml, generateEvaluationPdfBuffer } from "./exportUtils";

// ============================================================
// 角色权限中间件
// ============================================================
const supervisorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!hasAnyRole(ctx.user, ["supervisor_expert", "supervisor_leader", "graduate_admin", "admin"])) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要督导专家或以上权限" });
  }
  return next({ ctx });
});

const leaderProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!hasAnyRole(ctx.user, ["supervisor_leader", "graduate_admin", "admin"])) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要督导组长或以上权限" });
  }
  return next({ ctx });
});

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!hasAnyRole(ctx.user, ["graduate_admin", "admin"])) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要研究生院主管权限" });
  }
  return next({ ctx });
});

// ============================================================
// 评价表单 Zod Schema
// ============================================================
const evaluationSchema = z.object({
  courseId: z.number().int().positive("请选择有效课程"),
  planId: z.number().int().positive().optional(),
  listenDate: z.string().optional(),
  actualWeek: z.number().optional(),
  overallScore: z.number().min(1).max(5).optional(),
  // 定量评分（字段名与数据库 schema 保持一致）
  score_teaching_content: z.number().min(1).max(5).optional(),
  score_course_objective: z.number().min(1).max(5).optional(),
  score_reference_sharing: z.number().min(1).max(5).optional(),
  score_literature_humanities: z.number().min(1).max(5).optional(),
  score_teaching_organization: z.number().min(1).max(5).optional(),
  score_course_development: z.number().min(1).max(5).optional(),
  score_course_focus: z.number().min(1).max(5).optional(),
  score_language_logic: z.number().min(1).max(5).optional(),
  score_interaction: z.number().min(1).max(5).optional(),
  score_learning_preparation: z.number().min(1).max(5).optional(),
  score_teaching_quality: z.number().min(1).max(5).optional(),
  score_active_response: z.number().min(1).max(5).optional(),
  score_student_centered: z.number().min(1).max(5).optional(),
  score_research_teaching: z.number().min(1).max(5).optional(),
  score_learning_effect: z.number().min(1).max(5).optional(),
  score_learning_task_design: z.number().min(1).max(5).optional(),
  score_interaction_quality: z.number().min(1).max(5).optional(),
  score_method_diversity: z.number().min(1).max(5).optional(),
  score_equal_dialogue: z.number().min(1).max(5).optional(),
  score_pace_control: z.number().min(1).max(5).optional(),
  score_feedback: z.number().min(1).max(5).optional(),
  // 定性评价（字段名与数据库 schema 保持一致）
  highlights: z.string().optional(),
  suggestions: z.string().optional(),
  improvement_suggestion: z.string().optional(),
  development_suggestion: z.string().optional(),
  dimension_suggestion: z.string().optional(),
  resource_suggestion: z.string().optional(),
  status: z.enum(["draft", "submitted"]).optional(),
});

async function ensureCourseExists(courseId: number) {
  const course = await getCourseById(courseId);
  if (!course) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "课程不存在或已被删除，请重新选择课程" });
  }
  return course;
}

// 校验课程是否在用户的督导范围内（院级督导仅限本学院；校级督导/其他角色不限）
function ensureCourseInScope(
  user: { role?: string | null; extraRoles?: string[] | null; college?: string | null },
  course: { college: string | null }
) {
  const scopedCollege = getScopedCollege(user);
  if (!scopedCollege) return;
  const scopedList = scopedCollege
    .split(/[、,，]/)
    .map((c) => c.trim().replace(/（.*?）/g, "").replace(/\(.*?\)/g, ""))
    .filter(Boolean);
  const courseCollege = (course.college || "").replace(/（.*?）/g, "").replace(/\(.*?\)/g, "").trim();
  const inScope = scopedList.some((sc) => courseCollege.includes(sc) || sc.includes(courseCollege));
  if (!inScope) {
    throw new TRPCError({ code: "FORBIDDEN", message: "院级督导仅可听课/评价本学院课程" });
  }
}

export const appRouter = router({
  system: systemRouter,

  // ============================================================
  // 认证
  // ============================================================
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    // 工号登录
    loginByEmployeeId: publicProcedure
      .input(z.object({ employeeId: z.string().min(1), password: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const user = await getUserByEmployeeId(input.employeeId.trim());
        if (!user) {
          throw new TRPCError({ code: "NOT_FOUND", message: "工号不存在，请联系管理员" });
        }

        // 验证密码（默认密码为工号）
        const expectedPassword = user.password || user.employeeId || "";
        if (input.password !== expectedPassword) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "密码错误，默认密码为工号" });
        }

        // 更新最后登录时间
        await upsertUser({ ...user, lastSignedIn: new Date() });

        // 签发JWT（使用sdk.createSessionToken，openId格式为emp_工号）
        const token = await sdk.createSessionToken(user.openId, { name: user.name || user.employeeId || "" });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, cookieOptions);

        return { success: true, user };
      }),

    // 修改密码
    changePassword: protectedProcedure
      .input(z.object({ oldPassword: z.string().min(1), newPassword: z.string().min(6) }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        const dbUser = await getUserByEmployeeId(user.employeeId || "");
        if (!dbUser) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
        const expectedPassword = dbUser.password || dbUser.employeeId || "";
        if (input.oldPassword !== expectedPassword) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "原密码错误" });
        }
        // 使用专用的updateUserPassword函数，确保密码可靠写入数据库
        await updateUserPassword(dbUser.id, input.newPassword);
        return { success: true };
      }),
  }),

  // ============================================================
  // 课程
  // ============================================================
  courses: router({
    list: protectedProcedure
      .input(
        z.object({
          college: z.string().optional(),
          campus: z.string().optional(),
          weekday: z.string().optional(),
          week: z.number().optional(),
          teacher: z.string().optional(),
          courseName: z.string().optional(),
          page: z.number().default(1),
          pageSize: z.number().default(20),
        })
      )
      .query(async ({ input, ctx }) => {
        // 学院教学秘书 / 院级督导 只能查看本学院课程
        const user = ctx.user!;
        const scopedCollege = getScopedCollege(user);
        const college = scopedCollege || input.college;
        return getCourses({ ...input, college });
      }),

    getById: protectedProcedure.input(z.number()).query(async ({ input }) => {
      if (input <= 0) return null;
      const course = await getCourseById(input);
      return course || null;
    }),

    getColleges: protectedProcedure.query(async () => {
      const colleges = await getDistinctColleges();
      return colleges || [];
    }),

    getTeachers: protectedProcedure
      .input(z.object({ college: z.string().optional() }))
      .query(async ({ input }) => {
        const teachers = await getDistinctTeachers(input.college);
        return teachers || [];
      }),
  }),

  // ============================================================
  // 听课计划
  // ============================================================
  plans: router({
    create: supervisorProcedure
      .input(
        z.object({
          courseId: z.number(),
          planWeek: z.number().optional(),
          note: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const course = await ensureCourseExists(input.courseId);
        ensureCourseInScope(ctx.user!, course);
        return createListeningPlan({
          supervisorId: ctx.user!.id,
          courseId: input.courseId,
          planWeek: input.planWeek,
          note: input.note,
          status: "pending",
        });
      }),

    myPlans: supervisorProcedure.query(async ({ ctx }) => {
      return getListeningPlansBySupervisor(ctx.user!.id);
    }),

    updateStatus: supervisorProcedure
      .input(z.object({ planId: z.number(), status: z.enum(["pending", "completed", "cancelled"]) }))
      .mutation(async ({ input }) => {
        await updateListeningPlanStatus(input.planId, input.status);
        return { success: true };
      }),

    delete: supervisorProcedure.input(z.number()).mutation(async ({ input }) => {
      await deleteListeningPlan(input);
      return { success: true };
    }),
    getUsedWeeks: supervisorProcedure
      .input(z.object({ courseId: z.number() }))
      .query(async ({ input, ctx }) => {
        return getUsedWeeksForCourse(ctx.user!.id, input.courseId);
      }),
  }),

  // ============================================================
  // 课程评价
  // ============================================================
  evaluations: router({
    create: supervisorProcedure.input(evaluationSchema).mutation(async ({ input, ctx }) => {
      const course = await ensureCourseExists(input.courseId);
      ensureCourseInScope(ctx.user!, course);

      const evaluation = await createEvaluation({
        ...input,
        supervisorId: ctx.user!.id,
        listenDate: input.listenDate ? new Date(input.listenDate) : undefined,
      });

      // 如果提交评价，发送通知
      if (input.status === "submitted" && evaluation) {
        // 同步关联的听课计划状态为"已评价"，避免待听课列表仍显示该课程
        const matchedPlanId = await completePendingPlanForEvaluation(ctx.user!.id, input.courseId, input.actualWeek ?? null);
        if (matchedPlanId && !evaluation.planId) {
          await updateEvaluation(evaluation.id, { planId: matchedPlanId });
        }

        // 通知研究生院主管
        const admins = await getUsersByRole("graduate_admin");
        for (const admin of admins) {
          await createNotification({
            recipientId: admin.id,
            senderId: ctx.user!.id,
            type: "evaluation_complete",
            title: "新督导评价提交",
            content: `${ctx.user!.name} 完成了对 ${course?.courseName || "课程"} (${course?.teacher || ""}) 的督导评价`,
            evaluationId: evaluation.id,
          });
        }

        // 通知相关学院教学秘书
        if (course?.college) {
          const secretaries = await getUsersByRole("college_secretary");
          const collegeSecretaries = secretaries.filter(
            (s) => s.college && course.college && s.college.includes(course.college.replace(/（.*?）/g, "").replace(/\(.*?\)/g, ""))
          );
          for (const secretary of collegeSecretaries) {
            await createNotification({
              recipientId: secretary.id,
              senderId: ctx.user!.id,
              type: "evaluation_complete",
              title: "本学院课程督导评价",
              content: `${ctx.user!.name} 完成了对 ${course.courseName} (${course.teacher}) 的督导评价，请查看`,
              evaluationId: evaluation.id,
            });
          }
        }
      }

      return evaluation;
    }),

    update: supervisorProcedure
      .input(z.object({ id: z.number(), data: evaluationSchema }))
      .mutation(async ({ input, ctx }) => {
        const existing = await getEvaluationById(input.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (existing.supervisorId !== ctx.user!.id && !hasAnyRole(ctx.user, ["supervisor_leader", "graduate_admin", "admin"])) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const course = await ensureCourseExists(input.data.courseId);
        ensureCourseInScope(ctx.user!, course);

        await updateEvaluation(input.id, {
          ...input.data,
          listenDate: input.data.listenDate ? new Date(input.data.listenDate) : undefined,
        });

        // 首次提交（从草稿变为已提交）时，同步关联听课计划状态
        if (input.data.status === "submitted" && existing.status !== "submitted") {
          const matchedPlanId = await completePendingPlanForEvaluation(
            existing.supervisorId,
            input.data.courseId,
            input.data.actualWeek ?? existing.actualWeek ?? null
          );
          if (matchedPlanId && !existing.planId) {
            await updateEvaluation(input.id, { planId: matchedPlanId });
          }
        }
        return { success: true };
      }),

    delete: supervisorProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
      const existing = await getEvaluationById(input);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.supervisorId !== ctx.user!.id && !hasAnyRole(ctx.user, ["graduate_admin", "admin"])) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await deleteEvaluation(input);
      return { success: true };
    }),

    getById: protectedProcedure.input(z.number()).query(async ({ input, ctx }) => {
      const evaluation = await getEvaluationById(input);
      if (!evaluation) throw new TRPCError({ code: "NOT_FOUND" });

      // 学院教学秘书 / 院级督导 只能查看本学院的评价
      const scopedCollege = getScopedCollege(ctx.user);
      if (scopedCollege && evaluation.supervisorId !== ctx.user!.id) {
        const course = await getCourseById(evaluation.courseId);
        if (!course) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const scopedList = scopedCollege
          .split(/[、,，]/)
          .map((c: string) => c.trim().replace(/（.*?）/g, "").replace(/\(.*?\)/g, ""))
          .filter(Boolean);
        const courseCollege = (course.college || "").replace(/（.*?）/g, "").replace(/\(.*?\)/g, "").trim();
        const hasAccess = scopedList.some((sc: string) => courseCollege.includes(sc) || sc.includes(courseCollege));
        if (!hasAccess) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      }

      // 关联课程和督导专家数据
      const course = await getCourseById(evaluation.courseId);
      const allUsers = await getAllUsers();
      const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);

      return { ...evaluation, course, supervisor };
    }),

    myEvaluations: supervisorProcedure.query(async ({ ctx }) => {
      return getEvaluationsBySupervisor(ctx.user!.id);
    }),

    // 督导组长/主管/学院秘书查看所有评价（院级范围自动限定本学院）；督导专家（无更高角色）只能查看自己的评价，
    // 注意：督导专家即使设置了学院范围（院级督导）也只影响其"可听课/评价哪些课程"，不代表可以查看其他人的评价记录
    allEvaluations: protectedProcedure
      .input(z.object({ college: z.string().optional(), supervisorId: z.number().optional() }))
      .query(async ({ input, ctx }) => {
        const user = ctx.user!;
        const canViewAll = hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"]);
        if (!canViewAll) {
          return getEvaluationsBySupervisor(user.id);
        }
        const scopedCollege = getScopedCollege(user);
        return getAllEvaluations({ ...input, college: scopedCollege || input.college });
      }),

    exportToExcel: protectedProcedure
      .input(z.object({ college: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        const canViewAll = hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"]);
        let evaluations;
        if (canViewAll) {
          const scopedCollege = getScopedCollege(user);
          evaluations = await getAllEvaluations({ college: scopedCollege || input.college });
        } else if (hasAnyRole(user, ["supervisor_expert"])) {
          evaluations = await getEvaluationsBySupervisor(user.id);
        } else {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const allUsers = await getAllUsers();
        const enrichedEvaluations = await Promise.all(
          evaluations.map(async (evaluation) => {
            const course = await getCourseById(evaluation.courseId);
            const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);
            return { ...evaluation, course, supervisor };
          })
        );

        const buffer = generateEvaluationExcel(enrichedEvaluations);
        const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        return { buffer: buffer.toString("base64"), filename: `evaluations_${todayStr}.xlsx` };
      }),

    exportToPdf: protectedProcedure
      .input(z.object({ college: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        // 权限：研究生院主管/admin/督导组长 可导出全部，学院教学秘书/院级督导只能导出本学院，校级以外的督导专家只能导出本人记录
        if (!hasAnyRole(user, ["graduate_admin", "admin", "college_secretary", "supervisor_leader", "supervisor_expert"])) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无导出权限" });
        }

        const canViewAll = hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"]);
        let evaluations;
        if (canViewAll) {
          const scopedCollege = getScopedCollege(user);
          evaluations = await getAllEvaluations({ college: scopedCollege || input.college });
        } else {
          evaluations = await getEvaluationsBySupervisor(user.id);
        }

        const allUsers = await getAllUsers();
        const enrichedEvaluations = await Promise.all(
          evaluations.map(async (evaluation) => {
            const course = await getCourseById(evaluation.courseId);
            const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);
            return { ...evaluation, course, supervisor };
          })
        );

        const pdfHtml = generateEvaluationPdfHtml(enrichedEvaluations);
        const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        return { html: pdfHtml, filename: `evaluations_${todayStr}.pdf` };
      }),

    // 单份评价导出（Excel）
    exportSingleToExcel: protectedProcedure
      .input(z.object({ evalId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        if (!hasAnyRole(user, ["graduate_admin", "admin", "college_secretary", "supervisor_leader", "supervisor_expert"])) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无导出权限" });
        }
        const evaluation = await getEvaluationById(input.evalId);
        if (!evaluation) throw new TRPCError({ code: "NOT_FOUND", message: "评价记录不存在" });
        if (!hasAnyRole(user, ["supervisor_leader", "graduate_admin", "admin"]) && evaluation.supervisorId !== user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只能导出本人的评价记录" });
        }
        const course = await getCourseById(evaluation.courseId);
        const scopedCollege = getScopedCollege(user);
        if (scopedCollege && evaluation.supervisorId !== user.id) {
          const inScope = scopedCollege
            .split(/[、,，]/)
            .map((c) => c.trim().replace(/（.*?）/g, "").replace(/\(.*?\)/g, ""))
            .filter(Boolean)
            .some((sc) => (course?.college || "").includes(sc) || sc.includes(course?.college || ""));
          if (!inScope) {
            throw new TRPCError({ code: "FORBIDDEN", message: "无权限导出其他学院的评价" });
          }
        }
        const allUsers = await getAllUsers();
        const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);
        const enriched = { ...evaluation, course, supervisor };
        const buffer = generateEvaluationExcel([enriched]);
        const courseName = (course?.courseName || "evaluation").replace(/[/\\?%*:|"<>]/g, "-");
        return { buffer: buffer.toString("base64"), filename: `评价_${courseName}.xlsx` };
      }),

    // 单份评价导出（PDF）
    exportSingleToPdf: protectedProcedure
      .input(z.object({ evalId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        if (!hasAnyRole(user, ["graduate_admin", "admin", "college_secretary", "supervisor_leader", "supervisor_expert"])) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无导出权限" });
        }
        const evaluation = await getEvaluationById(input.evalId);
        if (!evaluation) throw new TRPCError({ code: "NOT_FOUND", message: "评价记录不存在" });
        if (!hasAnyRole(user, ["supervisor_leader", "graduate_admin", "admin"]) && evaluation.supervisorId !== user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只能导出本人的评价记录" });
        }
        const course = await getCourseById(evaluation.courseId);
        const scopedCollege = getScopedCollege(user);
        if (scopedCollege && evaluation.supervisorId !== user.id) {
          const inScope = scopedCollege
            .split(/[、,，]/)
            .map((c) => c.trim().replace(/（.*?）/g, "").replace(/\(.*?\)/g, ""))
            .filter(Boolean)
            .some((sc) => (course?.college || "").includes(sc) || sc.includes(course?.college || ""));
          if (!inScope) {
            throw new TRPCError({ code: "FORBIDDEN", message: "无权限导出其他学院的评价" });
          }
        }
        const allUsers = await getAllUsers();
        const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);
        const enriched = { ...evaluation, course, supervisor };
        const pdfBuffer = await generateEvaluationPdfBuffer([enriched]);
        const courseName = (course?.courseName || "evaluation").replace(/[/\\?%*:|"<>]/g, "-");
        return { buffer: pdfBuffer.toString("base64"), filename: `评价_${courseName}.pdf` };
      }),
  }),

  // ============================================================
  // 统计（研究生院主管）
  // ============================================================
   stats: router({
    adminDashboard: adminProcedure.query(async () => {
      return getAdminStats();
    }),
    collegeStats: protectedProcedure
      .input(z.object({ college: z.string().optional() }))
      .query(async ({ input, ctx }) => {
        const user = ctx.user!;
        const college = user.role === "college_secretary" ? (user.college || undefined) : input.college;
        const evals = await getAllEvaluations({ college });
        return {
          total: evals.length,
          submitted: evals.filter((e) => e.status === "submitted").length,
          evaluations: evals,
        };
      }),
    // 课程评价进度（学院秘书查本学院，主管查指定学院）
    courseProgress: protectedProcedure
      .input(z.object({ college: z.string().optional() }))
      .query(async ({ input, ctx }) => {
        const user = ctx.user!;
        let college: string | undefined;
        if (user.role === "college_secretary") {
          college = user.college || undefined;
        } else if (["graduate_admin", "admin"].includes(user.role || "")) {
          college = input.college;
        } else {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return getCourseEvaluationProgress(college);
      }),
    // 全校各学院评价进度汇总（研究生院主管专用）
    allCollegeProgress: adminProcedure.query(async () => {
      return getAllCollegeEvaluationProgress();
    }),
    // 全校课程总数（所有已登录用户可查）
    courseCount: protectedProcedure.query(async () => {
      const result = await getCourses({ page: 1, pageSize: 1 });
      return { total: result.total };
    }),
  }),

  // ============================================================
  // 通知
  // ============================================================
  notifications: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getNotificationsByUser(ctx.user!.id);
    }),

    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      return getUnreadNotificationCount(ctx.user!.id);
    }),

    markRead: protectedProcedure.input(z.number()).mutation(async ({ input }) => {
      await markNotificationRead(input);
      return { success: true };
    }),

    markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      await markAllNotificationsRead(ctx.user!.id);
      return { success: true };
    }),
  }),

  // ============================================================
  // 用户管理（研究生院主管）
  // ============================================================
  users: router({
    list: adminProcedure.query(async () => {
      return getAllUsers();
    }),

    updateRole: adminProcedure
      .input(z.object({ userId: z.number(), role: z.string() }))
      .mutation(async ({ input }) => {
        await updateUserRole(input.userId, input.role);
        return { success: true };
      }),

    // 更新附加角色（多角色切换用）
    updateExtraRoles: adminProcedure
      .input(z.object({ userId: z.number(), extraRoles: z.array(z.enum(ASSIGNABLE_ROLES)) }))
      .mutation(async ({ input }) => {
        await updateUserExtraRoles(input.userId, input.extraRoles);
        return { success: true };
      }),

    // 更新所属学院（学院教学秘书的管辖范围 / 督导专家、组长的院级督导范围；留空即为校级督导）
    updateCollege: adminProcedure
      .input(z.object({ userId: z.number(), college: z.string().nullable() }))
      .mutation(async ({ input }) => {
        await updateUserCollege(input.userId, input.college);
        return { success: true };
      }),

    getSupervisors: protectedProcedure.query(async () => {
      const experts = await getUsersByRole("supervisor_expert");
      const leaders = await getUsersByRole("supervisor_leader");
      return [...leaders, ...experts];
    }),
  }),
});

export type AppRouter = typeof appRouter;
