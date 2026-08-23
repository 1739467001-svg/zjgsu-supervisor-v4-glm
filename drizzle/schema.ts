import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  float,
  boolean,
  json,
} from "drizzle-orm/mysql-core";

// ============================================================
// 用户表（基于角色信息表60位用户）
// ============================================================
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  // 工号作为唯一登录凭证
  employeeId: varchar("employeeId", { length: 32 }).unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  // 系统角色（主角色）：督导专家、督导组长、学院教学秘书、研究生院主管
  role: mysqlEnum("role", ["supervisor_expert", "supervisor_leader", "college_secretary", "graduate_admin", "user", "admin"]).default("user").notNull(),
  // 附加角色（多角色切换用，如同时具有"研究生院主管"和"督导专家"身份）
  extraRoles: json("extraRoles").$type<string[]>(),
  // 所属学院（学院教学秘书用；督导专家/组长设置此项即为"院级督导"仅本学院范围，不设置则为"校级督导"全校范围）
  college: varchar("college", { length: 128 }),
  // 备注（如“负责留学生”）
  remark: varchar("remark", { length: 256 }),
  // 登录密码（默认为工号）
  password: varchar("password", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================================
// 学期表（学期起始日与周数改为可配置，替代此前写死在 shared/const.ts 的常量）
// ============================================================
export const semesters = mysqlTable("semesters", {
  id: int("id").autoincrement().primaryKey(),
  // 学年，如 "2025-2026"
  academicYear: varchar("academicYear", { length: 16 }).notNull(),
  // 学期名，如 "第二学期"
  name: varchar("name", { length: 32 }).notNull(),
  // 学期第一周的开始日期，用字符串存储避免时区歧义
  startDate: varchar("startDate", { length: 10 }).notNull(),
  // 学期总周数
  totalWeeks: int("totalWeeks").default(19).notNull(),
  // 是否为当前学期（全表应仅有一条为 true）
  isActive: boolean("isActive").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Semester = typeof semesters.$inferSelect;
export type InsertSemester = typeof semesters.$inferInsert;

// ============================================================
// 课程表（来自全校总课表2026-03-01.xls，1344条记录）
// ============================================================
export const courses = mysqlTable("courses", {
  id: int("id").autoincrement().primaryKey(),
  // 学年
  academicYear: varchar("academicYear", { length: 16 }),
  // 学期
  semester: varchar("semester", { length: 32 }),
  // 开课院系
  college: varchar("college", { length: 128 }),
  // 课程名称
  courseName: varchar("courseName", { length: 256 }),
  // 课程性质
  courseType: varchar("courseType", { length: 64 }),
  // 教室名称
  classroom: varchar("classroom", { length: 128 }),
  // 班级编号
  classId: varchar("classId", { length: 64 }),
  // 主讲教师
  teacher: varchar("teacher", { length: 64 }),
  // 校区名称（下沙/教工路）
  campus: varchar("campus", { length: 32 }),
  // 星期几
  weekday: varchar("weekday", { length: 16 }),
  // 单双周描述
  weekType: varchar("weekType", { length: 128 }),
  // 节次（如"第3-4节"）
  period: varchar("period", { length: 64 }),
  // 自定义周次（如"第1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16周"）
  customWeeks: text("customWeeks"),
  // 解析后的周次数组（JSON存储）
  weekNumbers: json("weekNumbers").$type<number[]>(),
  // 学生专业
  studentMajor: text("studentMajor"),
  // 选中人数
  studentCount: int("studentCount"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Course = typeof courses.$inferSelect;
export type InsertCourse = typeof courses.$inferInsert;

// ============================================================
// 听课计划表（督导专家/组长的待办）
// ============================================================
export const listeningPlans = mysqlTable("listening_plans", {
  id: int("id").autoincrement().primaryKey(),
  // 督导专家/组长ID
  supervisorId: int("supervisorId").notNull(),
  // 课程ID
  courseId: int("courseId").notNull(),
  // 所属学期（跨学期隔离，避免新学期的待听课列表混入上学期遗留计划）
  semesterId: int("semesterId"),
  // 计划听课的周次
  planWeek: int("planWeek"),
  // 状态：pending=待听课, completed=已评价, cancelled=已取消
  status: mysqlEnum("status", ["pending", "completed", "cancelled"]).default("pending").notNull(),
  // 备注
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ListeningPlan = typeof listeningPlans.$inferSelect;
export type InsertListeningPlan = typeof listeningPlans.$inferInsert;

// ============================================================
// 课程评价表（完全按照课程评价表.jpg）
// ============================================================
export const courseEvaluations = mysqlTable("course_evaluations", {
  id: int("id").autoincrement().primaryKey(),
  // 关联听课计划
  planId: int("planId"),
  // 督导专家ID
  supervisorId: int("supervisorId").notNull(),
  // 课程ID
  courseId: int("courseId").notNull(),
  // 所属学期（历史评价按学期归档隔离）
  semesterId: int("semesterId"),
  // 听课日期
  listenDate: timestamp("listenDate"),
  // 实际听课周次
  actualWeek: int("actualWeek"),
  // 综合评分（1-5）
  overallScore: float("overallScore"),

  // ============ 一、定量评分 ============
  // 一）教学状态
  // 1. 教学内容与课程（1-5）
  score_teaching_content: int("score_teaching_content"),
  // 2. 课程目标管理（1-5）
  score_course_objective: int("score_course_objective"),
  // 3. 教学参考资料分享（1-5）
  score_reference_sharing: int("score_reference_sharing"),
  // 4. 基本文献人文（1-5）
  score_literature_humanities: int("score_literature_humanities"),
  // 5. 教学组织力（1-5）
  score_teaching_organization: int("score_teaching_organization"),

  // 二）学生状态
  // 6. 到课率与准时率（1-5）
  score_course_development: int("score_course_development"),
  // 7. 课堂专注度（1-5）
  score_course_focus: int("score_course_focus"),
  // 8. 设备使用合理性（1-5）
  score_language_logic: int("score_language_logic"),
  // 9. 互动响应率（1-5）
  score_interaction: int("score_interaction"),
  // 10. 学习准备情况（1-5）
  score_learning_preparation: int("score_learning_preparation"),

  // 三）授课内容
  // 11. 教学大纲贴合度（1-5）
  score_teaching_quality: int("score_teaching_quality"),
  // 12. 深度与前沿性（1-5）
  score_active_response: int("score_active_response"),
  // 13. 课件与案例质量（1-5）
  score_student_centered: int("score_student_centered"),
  // 14. 科研转化融合度（学术学位课程）（1-5，与4.2二选一）
  score_research_teaching: int("score_research_teaching"),
  // 15. 前沿视野传递（专业学位课程）（1-5，与4.1二选一）
  score_learning_effect: int("score_learning_effect"),
  // 16. 学习任务设计（1-5）
  score_learning_task_design: int("score_learning_task_design"),

  // 四）教学过程
  // 17. 师生互动质量（1-5）
  score_interaction_quality: int("score_interaction_quality"),
  // 18. 教学方法多样性（1-5）
  score_method_diversity: int("score_method_diversity"),
  // 19. 平等交流氛围（1-5）
  score_equal_dialogue: int("score_equal_dialogue"),
  // 20. 节奏调控能力（1-5）
  score_pace_control: int("score_pace_control"),
  // 21. 即时反馈运用（1-5）
  score_feedback: int("score_feedback"),

  // ============ 二、课程亮点与评价 ============
  // 1. 最突出的教学亮点
  highlights: text("highlights"),
  // 2. 存在不足与提升建议
  suggestions: text("suggestions"),

  // ============ 三、具体建议 ============
  // 1. 针对性改进建议（必填）
  improvement_suggestion: text("improvement_suggestion"),
  // 2. 拓展性发展建议（必填）
  development_suggestion: text("development_suggestion"),
  // 3. 针对定量评价维度的改进建议（必填）
  dimension_suggestion: text("dimension_suggestion"),
  // 4. 资源或支持建议（选填）
  resource_suggestion: text("resource_suggestion"),

  // 评价状态：draft=草稿, submitted=已提交
  status: mysqlEnum("status", ["draft", "submitted"]).default("draft").notNull(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CourseEvaluation = typeof courseEvaluations.$inferSelect;
export type InsertCourseEvaluation = typeof courseEvaluations.$inferInsert;

// ============================================================
// 系统通知表
// ============================================================
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  // 接收者ID
  recipientId: int("recipientId").notNull(),
  // 发送者ID（0=系统）
  senderId: int("senderId").default(0),
  // 通知类型：evaluation_complete=评价完成, plan_reminder=听课提醒
  type: mysqlEnum("type", ["evaluation_complete", "plan_reminder", "system"]).notNull(),
  // 通知标题
  title: varchar("title", { length: 256 }).notNull(),
  // 通知内容
  content: text("content"),
  // 关联的评价ID
  evaluationId: int("evaluationId"),
  // 关联的听课计划ID
  planId: int("planId"),
  // 是否已读
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
