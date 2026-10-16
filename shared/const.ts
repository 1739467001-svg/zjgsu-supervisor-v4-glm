export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

// 学期时间配置（默认回退值，实际以 semesters 表当前学期为准）
export const SEMESTER_START_DATE = '2026-09-14'; // 学期第一周开始日期（字符串，避免时区歧义）
export const WEEKS_IN_SEMESTER = 18; // 学期总周数（不含第 0 周「开学前」）

// 统一时区：所有时间显示以北京时间（Asia/Shanghai）为准
export const TIMEZONE = 'Asia/Shanghai';
