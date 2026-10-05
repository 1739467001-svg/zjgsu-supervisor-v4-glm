import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { hasAnyRole, getRoleLabel, normalizeExtraRoles, getScopedCollege as resolveScopedCollege, MissingCollegeScopeError, isCollegeInScope, ASSIGNABLE_ROLES, type RoleAwareUser } from "@shared/roles";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  completePendingPlanForEvaluation,
  createEvaluation,
  createSemester,
  getActiveSemester,
  getSemesterById,
  listSemesters,
  setActiveSemester,
  updateSemester,
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
  getSubmittedEvaluationByCourse,
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
  getListeningPlanById,
  getNotificationById,
  updateListeningPlanStatus,
  updateUserCollege,
  updateUserSupervisorScope,
  updateUserExtraRoles,
  updateUserPassword,
  updateUserRole,
  upsertUser,
  getUserById,
  countOtherAdmins,
  logUserAdminChange,
  getRecentUserAdminLogs,
} from "./db";
import { canViewEvaluation, canMutateListeningPlan } from "@shared/evaluationAccess";
import { isWritableSemester } from "@shared/semesterArchive";
import { maskPhone, maskPhoneInEmail, validateUserAdminChange, type ProposedUserAdminChange } from "@shared/userAdmin";
import { sdk } from "./_core/sdk";
import { generateEvaluationExcel, generateEvaluationPdfHtml, generateEvaluationPdfBuffer } from "./exportUtils";

// ============================================================
// 角色权限中间件
// ============================================================
function getScopedCollege(user: RoleAwareUser | null | undefined) {
  try {
    return resolveScopedCollege(user);
  } catch (error) {
    if (error instanceof MissingCollegeScopeError) {
      throw new TRPCError({ code: "FORBIDDEN", message: error.message });
    }
    throw error;
  }
}

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

const semesterInput = z.object({ semesterId: z.number().int().positive().optional() }).optional();
async function selectedSemesterId(id?: number) {
  const semester = id == null ? await getActiveSemester() : await getSemesterById(id);
  if (!semester) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择已建立档案的学期" });
  return semester.id;
}
async function requireCurrentSemester(recordId: number | null | undefined) {
  const active = await getActiveSemester();
  if (!isWritableSemester(recordId, active?.id)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "历史学期档案只读，不允许新增、修改或删除；请返回当前学期" });
  }
  return active!.id;
}

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
function ensureCourseInScope(user: RoleAwareUser, course: { college: string | null }) {
  const scopedCollege = getScopedCollege(user);
  if (!scopedCollege) return;
  if (!isCollegeInScope(scopedCollege, course.college)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "院级督导仅可听课/评价本学院课程" });
  }
}

// 用户角色变更的写库前校验：学院必填 / 防自我锁定 / 最后管理员保护（规则见 shared/userAdmin.ts）
async function guardUserAdminChange(actorId: number, userId: number, change: ProposedUserAdminChange) {
  const target = await getUserById(userId);
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
  const otherAdminCount = await countOtherAdmins(userId);
  const error = validateUserAdminChange({ actorId, target, change, otherAdminCount });
  if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error });
  return target;
}

// 授权变更落审计日志（升级方案 3.2：保留必要的授权变更记录）
async function recordUserAdminChange(
  actor: { id: number; name?: string | null },
  target: { id: number; name?: string | null },
  action: "role" | "extraRoles" | "college" | "supervisorScope" | "passwordReset",
  detail: string
) {
  await logUserAdminChange({
    adminId: actor.id,
    adminName: actor.name ?? null,
    targetUserId: target.id,
    targetName: target.name ?? null,
    action,
    detail,
  });
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
          semesterId: z.number().int().positive().optional(),
        })
      )
      .query(async ({ input, ctx }) => {
        // 学院教学秘书 / 院级督导 只能查看本学院课程
        const user = ctx.user!;
        const scopedCollege = getScopedCollege(user);
        const college = scopedCollege || input.college;
        return getCourses({ ...input, college, semesterId: await selectedSemesterId(input.semesterId) });
      }),

    getById: protectedProcedure.input(z.number()).query(async ({ input }) => {
      if (input <= 0) return null;
      const course = await getCourseById(input);
      return course || null;
    }),

    getColleges: protectedProcedure.input(semesterInput).query(async ({ input }) => {
      const colleges = await getDistinctColleges(await selectedSemesterId(input?.semesterId));
      return colleges || [];
    }),

    getTeachers: protectedProcedure
      .input(z.object({ college: z.string().optional(), semesterId: z.number().int().positive().optional() }))
      .query(async ({ input }) => {
        const teachers = await getDistinctTeachers(input.college, await selectedSemesterId(input.semesterId));
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
        const activeSemester = await getActiveSemester();
        await requireCurrentSemester(course.semesterId);
        return createListeningPlan({
          supervisorId: ctx.user!.id,
          courseId: input.courseId,
          semesterId: activeSemester?.id,
          planWeek: input.planWeek,
          note: input.note,
          status: "pending",
        });
      }),

    myPlans: supervisorProcedure.input(semesterInput).query(async ({ ctx, input }) => {
      // 只返回当前学期的计划，避免混入往期遗留
      return getListeningPlansBySupervisor(ctx.user!.id, await selectedSemesterId(input?.semesterId));
    }),

    updateStatus: supervisorProcedure
      .input(z.object({ planId: z.number(), status: z.enum(["pending", "completed", "cancelled"]) }))
      .mutation(async ({ input, ctx }) => {
        // 只验「是不是督导」不够：那样任何督导都能改别人的计划
        const plan = await getListeningPlanById(input.planId);
        if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
        if (!canMutateListeningPlan(ctx.user, plan)) throw new TRPCError({ code: "FORBIDDEN" });
        await requireCurrentSemester(plan.semesterId);
        await updateListeningPlanStatus(input.planId, input.status);
        return { success: true };
      }),

    delete: supervisorProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
      const plan = await getListeningPlanById(input);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canMutateListeningPlan(ctx.user, plan)) throw new TRPCError({ code: "FORBIDDEN" });
      await requireCurrentSemester(plan.semesterId);
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

      // 评价独占（服务端兜底）：一门课程只允许一条已提交评价，防止直连接口绕过前端
      if (input.status === "submitted") {
        const submitted = await getSubmittedEvaluationByCourse(input.courseId);
        if (submitted) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              submitted.supervisorId === ctx.user!.id
                ? "该课程已有本人提交的评价，请在评价记录中修改"
                : "该课程已被其他督导评价，不能再评",
          });
        }
      }

      const activeSemester = await getActiveSemester();
      await requireCurrentSemester(course.semesterId);
      const evaluation = await createEvaluation({
        ...input,
        supervisorId: ctx.user!.id,
        semesterId: activeSemester?.id,
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
        await requireCurrentSemester(existing.semesterId);
        await requireCurrentSemester(course.semesterId);
        if (existing.courseId !== input.data.courseId) throw new TRPCError({ code: "BAD_REQUEST", message: "不能改变评价关联的原课程" });
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
      await requireCurrentSemester(existing.semesterId);
      await deleteEvaluation(input);
      return { success: true };
    }),

    getById: protectedProcedure.input(z.number()).query(async ({ input, ctx }) => {
      const evaluation = await getEvaluationById(input);
      if (!evaluation) throw new TRPCError({ code: "NOT_FOUND" });

      const course = await getCourseById(evaluation.courseId);
      // 与列表、打印路由共用同一条判定：此前详情只拦了院级范围，
      // 校级督导专家只要知道别人的评价 ID 就能直接读到详情。
      if (!canViewEvaluation(ctx.user, evaluation, course)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const allUsers = await getAllUsers();
      const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);

      return { ...evaluation, course, supervisor };
    }),

    myEvaluations: supervisorProcedure.input(semesterInput).query(async ({ ctx, input }) => {
      return getEvaluationsBySupervisor(ctx.user!.id, await selectedSemesterId(input?.semesterId));
    }),

    // 督导组长/主管/学院秘书查看所有评价（院级范围自动限定本学院）；督导专家（无更高角色）只能查看自己的评价，
    // 注意：督导专家即使设置了学院范围（院级督导）也只影响其"可听课/评价哪些课程"，不代表可以查看其他人的评价记录
    allEvaluations: protectedProcedure
      .input(z.object({ college: z.string().optional(), supervisorId: z.number().optional(), semesterId: z.number().int().positive().optional() }))
      .query(async ({ input, ctx }) => {
        const user = ctx.user!;
        const canViewAll = hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"]);
        const semesterId = await selectedSemesterId(input.semesterId);
        if (!canViewAll) {
          return getEvaluationsBySupervisor(user.id, semesterId);
        }
        const scopedCollege = getScopedCollege(user);
        return getAllEvaluations({ ...input, college: scopedCollege || input.college, semesterId });
      }),

    exportToExcel: protectedProcedure
      .input(z.object({ college: z.string().optional(), semesterId: z.number().int().positive().optional() }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        const canViewAll = hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"]);
        const semesterId = await selectedSemesterId(input.semesterId);
        let evaluations;
        if (canViewAll) {
          const scopedCollege = getScopedCollege(user);
          evaluations = await getAllEvaluations({ college: scopedCollege || input.college, semesterId });
        } else if (hasAnyRole(user, ["supervisor_expert"])) {
          evaluations = await getEvaluationsBySupervisor(user.id, semesterId);
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
        return { buffer: buffer.toString("base64"), filename: `evaluations_semester-${semesterId}_${todayStr}.xlsx` };
      }),

    exportToPdf: protectedProcedure
      .input(z.object({ college: z.string().optional(), semesterId: z.number().int().positive().optional() }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        // 权限：研究生院主管/admin/督导组长 可导出全部，学院教学秘书/院级督导只能导出本学院，校级以外的督导专家只能导出本人记录
        if (!hasAnyRole(user, ["graduate_admin", "admin", "college_secretary", "supervisor_leader", "supervisor_expert"])) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无导出权限" });
        }

        const canViewAll = hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"]);
        const semesterId = await selectedSemesterId(input.semesterId);
        let evaluations;
        if (canViewAll) {
          const scopedCollege = getScopedCollege(user);
          evaluations = await getAllEvaluations({ college: scopedCollege || input.college, semesterId });
        } else {
          evaluations = await getEvaluationsBySupervisor(user.id, semesterId);
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
        return { html: pdfHtml, filename: `evaluations_semester-${semesterId}_${todayStr}.pdf` };
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
        const course = await getCourseById(evaluation.courseId);
        if (!canViewEvaluation(user, evaluation, course)) throw new TRPCError({ code: "FORBIDDEN", message: "无权限导出该评价" });
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
        const course = await getCourseById(evaluation.courseId);
        if (!canViewEvaluation(user, evaluation, course)) throw new TRPCError({ code: "FORBIDDEN", message: "无权限导出该评价" });
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
    // 仪表盘口径按调用者收窄（2026-10-04 按研究生院权限表）：
    // 主管/系统管理员 = 全校；学院教学秘书（含分管领导的双身份）= 全院（本院）。
    // 学院统计口径不含其他学院，纯督导角色无此权限。
    adminDashboard: protectedProcedure
      .input(semesterInput)
      .query(async ({ input, ctx }) => {
        const user = ctx.user!;
        const isAdmin = hasAnyRole(user, ["graduate_admin", "admin"]);
        const isSecretary = hasAnyRole(user, ["college_secretary"]);
        if (!isAdmin && !isSecretary) {
          throw new TRPCError({ code: "FORBIDDEN", message: "统计仪表盘仅对研究生院主管、系统管理员与学院教学秘书开放" });
        }
        let scopedCollege: string | undefined;
        if (!isAdmin) {
          try {
            scopedCollege = resolveScopedCollege(user);
          } catch (err) {
            if (err instanceof MissingCollegeScopeError) {
              throw new TRPCError({ code: "FORBIDDEN", message: err.message });
            }
            throw err;
          }
        }
        return getAdminStats(await selectedSemesterId(input?.semesterId), scopedCollege);
      }),
    collegeStats: protectedProcedure
      .input(z.object({ college: z.string().optional(), semesterId: z.number().int().positive().optional() }))
      .query(async ({ input, ctx }) => {
        const user = ctx.user!;
        // 此前这里没有任何角色门禁：任何登录用户不传 college 就能拿到全校所有评价。
        if (!hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"])) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        // 用 getScopedCollege 而不是直接比较主角色，附加角色与院级督导才会被认到
        const scopedCollege = getScopedCollege(user);
        const college = scopedCollege || input.college;
        const evals = await getAllEvaluations({ college, semesterId: await selectedSemesterId(input.semesterId) });
        return {
          total: evals.length,
          submitted: evals.filter((e) => e.status === "submitted").length,
          evaluations: evals,
        };
      }),
    // 课程评价进度（学院秘书查本学院，主管查指定学院）
    courseProgress: protectedProcedure
      .input(z.object({ college: z.string().optional(), semesterId: z.number().int().positive().optional() }))
      .query(async ({ input, ctx }) => {
        const user = ctx.user!;
        // hasAnyRole / getScopedCollege 而不是直接比较 user.role：
        // 否则「主角色普通用户 + 附加角色研究生院主管」会被挡在外面
        if (!hasAnyRole(user, ["college_secretary", "graduate_admin", "admin"])) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const scopedCollege = getScopedCollege(user);
        return getCourseEvaluationProgress(scopedCollege || input.college, await selectedSemesterId(input.semesterId));
      }),
    // 全校各学院评价进度汇总（研究生院主管/系统管理员专用）
    allCollegeProgress: adminProcedure.input(semesterInput).query(async ({ input }) => {
      return getAllCollegeEvaluationProgress(undefined, await selectedSemesterId(input?.semesterId));
    }),
    // 全校课程总数（所有已登录用户可查）
    courseCount: protectedProcedure.input(semesterInput).query(async ({ input }) => {
      const result = await getCourses({ page: 1, pageSize: 1, semesterId: await selectedSemesterId(input?.semesterId) });
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

    markRead: protectedProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
      // 不校验收件人的话，知道通知 ID 就能把别人的通知标为已读
      const notification = await getNotificationById(input);
      if (!notification) throw new TRPCError({ code: "NOT_FOUND" });
      if (notification.recipientId !== ctx.user!.id) throw new TRPCError({ code: "FORBIDDEN" });
      await markNotificationRead(input);
      return { success: true };
    }),

    markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      await markAllNotificationsRead(ctx.user!.id);
      return { success: true };
    }),
  }),

  // ============================================================
  // 学期管理（研究生院主管）
  // ============================================================
  semesters: router({
    // 当前学期：所有登录用户都需要（前端据此计算周次、限定可选日期范围）
    active: protectedProcedure.query(async () => {
      const s = await getActiveSemester();
      if (!s) return null;
      return { id: s.id, academicYear: s.academicYear, name: s.name, startDate: s.startDate, totalWeeks: s.totalWeeks };
    }),

    list: protectedProcedure.query(async () => listSemesters()),

    create: adminProcedure
      .input(
        z.object({
          academicYear: z.string().min(1, "请填写学年"),
          name: z.string().min(1, "请填写学期名称"),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "开始日期格式应为 YYYY-MM-DD"),
          totalWeeks: z.number().int().min(1).max(30),
        })
      )
      .mutation(async ({ input }) => {
        try {
          return await createSemester(input);
        } catch (err: any) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message || "创建学期失败" });
        }
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.number(),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "开始日期格式应为 YYYY-MM-DD").optional(),
          totalWeeks: z.number().int().min(1).max(30).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...rest } = input;
        await updateSemester(id, rest);
        return { success: true };
      }),

    setActive: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await setActiveSemester(input.id);
      return { success: true };
    }),
  }),

  // ============================================================
  // 用户管理（研究生院主管）
  // ============================================================
  users: router({
    // 账号列表：主管/系统管理员=全校；学院教学秘书（含分管领导双身份）=本院账号
    // （上线前会议：院级教学秘书可以调整本院底下的账号，权限按学院范围收窄）
    list: protectedProcedure.query(async ({ ctx }) => {
      const user = ctx.user!;
      const isAdmin = hasAnyRole(user, ["graduate_admin", "admin"]);
      const isSecretary = hasAnyRole(user, ["college_secretary"]);
      if (!isAdmin && !isSecretary) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无账号管理权限" });
      }
      let scopedCollege: string | undefined;
      if (!isAdmin) {
        try {
          scopedCollege = resolveScopedCollege(user);
        } catch (err) {
          if (err instanceof MissingCollegeScopeError) throw new TRPCError({ code: "FORBIDDEN", message: err.message });
          throw err;
        }
      }
      const all = await getAllUsers();
      const visible = scopedCollege ? all.filter((u) => u.college && isCollegeInScope(scopedCollege, u.college)) : all;
      // 会议纪要安全底线：前端页面不得出现完整手机号。接口层直接返回掩码
      // （防扒接口），完整号码仅存于数据库与通讯录原件。
      // email 中用手机号做前缀的（139xxxx1234@163.com）同样打码。
      return visible.map((u) => ({
        ...u,
        phone: maskPhone(u.phone),
        email: maskPhoneInEmail(u.email),
      }));
    }),

    // 重置他人密码（上线前会议：研究生院主管可给其他账号设置修改密码；
    // 学院教学秘书可重置本院账号）。新密码必填（≥6 位），操作写入审计日志。
    resetPassword: protectedProcedure
      .input(z.object({ userId: z.number(), newPassword: z.string().min(6, "新密码至少 6 位") }))
      .mutation(async ({ input, ctx }) => {
        const actor = ctx.user!;
        const isAdmin = hasAnyRole(actor, ["graduate_admin", "admin"]);
        const isSecretary = hasAnyRole(actor, ["college_secretary"]);
        if (!isAdmin && !isSecretary) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无重置密码权限" });
        }
        const target = await getUserById(input.userId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
        if (!isAdmin) {
          const scopedCollege = resolveScopedCollege(actor);
          if (!scopedCollege) throw new TRPCError({ code: "FORBIDDEN", message: "学院范围未配置，请联系研究生院主管" });
          if (!target.college || !isCollegeInScope(scopedCollege, target.college)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "只能重置本院账号的密码" });
          }
        }
        await updateUserPassword(target.id, input.newPassword);
        await recordUserAdminChange(
          { id: actor.id, name: actor.name },
          { id: target.id, name: target.name },
          "passwordReset",
          `重置密码（新密码由操作人设置）`
        );
        return { success: true };
      }),

    // 授权变更记录（升级方案 3.2：谁在何时把谁的什么权限改成了什么）
    // 主管看全部；教学秘书看本院相关记录
    getAuditLog: protectedProcedure.query(async ({ ctx }) => {
      const user = ctx.user!;
      const logs = await getRecentUserAdminLogs();
      if (hasAnyRole(user, ["graduate_admin", "admin"])) return logs;
      if (!hasAnyRole(user, ["college_secretary"])) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权限" });
      }
      const scopedCollege = resolveScopedCollege(user);
      if (!scopedCollege) throw new TRPCError({ code: "FORBIDDEN", message: "学院范围未配置，请联系研究生院主管" });
      const targetIds = new Set(
        (await getAllUsers())
          .filter((u) => u.college && isCollegeInScope(scopedCollege, u.college))
          .map((u) => u.id)
      );
      return logs.filter((l) => targetIds.has(l.targetUserId));
    }),

    updateRole: adminProcedure
      .input(z.object({ userId: z.number(), role: z.enum(ASSIGNABLE_ROLES) }))
      .mutation(async ({ input, ctx }) => {
        const target = await guardUserAdminChange(ctx.user!.id, input.userId, { role: input.role });
        const before = target.role;
        await updateUserRole(input.userId, input.role);
        await recordUserAdminChange(ctx.user!, target, "role", `主角色：${getRoleLabel(before)} → ${getRoleLabel(input.role)}`);
        return { success: true };
      }),

    // 更新附加角色（多角色切换用）
    updateExtraRoles: adminProcedure
      .input(z.object({ userId: z.number(), extraRoles: z.array(z.enum(ASSIGNABLE_ROLES)) }))
      .mutation(async ({ input, ctx }) => {
        const target = await guardUserAdminChange(ctx.user!.id, input.userId, { extraRoles: input.extraRoles });
        const before = normalizeExtraRoles(target.extraRoles);
        await updateUserExtraRoles(input.userId, input.extraRoles);
        await recordUserAdminChange(
          ctx.user!,
          target,
          "extraRoles",
          `附加角色：${before.length ? before.map(getRoleLabel).join("、") : "无"} → ${input.extraRoles.length ? input.extraRoles.map(getRoleLabel).join("、") : "无"}`
        );
        return { success: true };
      }),

    // 更新所属学院（学院教学秘书的管辖学院；对督导是人事归属学院）
    updateCollege: adminProcedure
      .input(z.object({ userId: z.number(), college: z.string().nullable() }))
      .mutation(async ({ input, ctx }) => {
        const target = await guardUserAdminChange(ctx.user!.id, input.userId, { college: input.college });
        await updateUserCollege(input.userId, input.college);
        await recordUserAdminChange(ctx.user!, target, "college", `所属学院：${target.college || "无"} → ${input.college || "无"}`);
        return { success: true };
      }),

    // 更新督导范围（校级=全校课程，院级=仅本学院）
    updateSupervisorScope: adminProcedure
      .input(z.object({ userId: z.number(), scope: z.enum(["school", "college"]) }))
      .mutation(async ({ input, ctx }) => {
        const target = await guardUserAdminChange(ctx.user!.id, input.userId, { supervisorScope: input.scope });
        await updateUserSupervisorScope(input.userId, input.scope);
        await recordUserAdminChange(
          ctx.user!,
          target,
          "supervisorScope",
          `督导范围：${target.supervisorScope === "college" ? "院级" : "校级"} → ${input.scope === "college" ? "院级" : "校级"}`
        );
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
