import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateWeekFromDate,
  calculateDateRangeFromWeek,
  getCurrentWeek,
  isValidFutureDate,
  getMinSelectableDate,
  getMaxSelectableDate,
} from "./dateUtils";
import { SEMESTER_START_DATE, WEEKS_IN_SEMESTER } from "./const";

describe("dateUtils", () => {
  beforeEach(() => {
    // 模拟当前时间为 2026-03-08（学期第二周）
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("calculateWeekFromDate", () => {
    it("应该计算学期第一周的日期对应的周次", () => {
      expect(calculateWeekFromDate("2026-03-02")).toBe(1);
      expect(calculateWeekFromDate("2026-03-08")).toBe(1);
    });

    it("应该计算学期最后一周的日期对应的周次", () => {
      // 第19周最后一天
      const lastDayOfSemester = new Date(SEMESTER_START_DATE);
      lastDayOfSemester.setDate(lastDayOfSemester.getDate() + (WEEKS_IN_SEMESTER - 1) * 7 + 6);
      const lastDayStr = lastDayOfSemester.toISOString().split("T")[0];
      expect(calculateWeekFromDate(lastDayStr)).toBe(19);
    });

    it("应该返回 undefined 如果日期早于学期开始", () => {
      expect(calculateWeekFromDate("2026-03-01")).toBeUndefined();
    });

    it("应该返回 undefined 如果日期晚于学期结束", () => {
      expect(calculateWeekFromDate("2026-07-20")).toBeUndefined();
    });

    it("应该接受 Date 对象作为输入", () => {
      const date = new Date("2026-03-02");
      expect(calculateWeekFromDate(date)).toBe(1);
    });
  });

  describe("calculateDateRangeFromWeek", () => {
    it("应该计算第一周的日期范围", () => {
      const range = calculateDateRangeFromWeek(1);
      expect(range).toEqual({
        startDate: "2026-03-02",
        endDate: "2026-03-08",
      });
    });

    it("应该计算第二周的日期范围", () => {
      // 第一周为 03-02~03-08，故第二周自 03-09 起（与 calculateWeekFromDate("2026-03-08") === 1 一致，两周不重叠）
      const range = calculateDateRangeFromWeek(2);
      expect(range).toEqual({
        startDate: "2026-03-09",
        endDate: "2026-03-15",
      });
    });

    it("应该返回 undefined 如果周次无效", () => {
      expect(calculateDateRangeFromWeek(0)).toBeUndefined();
      expect(calculateDateRangeFromWeek(20)).toBeUndefined();
      expect(calculateDateRangeFromWeek(-1)).toBeUndefined();
    });
  });

  describe("getCurrentWeek", () => {
    it("应该返回当前周次", () => {
      // 模拟时间为 2026-03-08（第一周）
      expect(getCurrentWeek()).toBe(1);
    });
  });

  // 注意：isValidFutureDate 这个函数名有历史遗留的误导性，它实际校验的是
  // 「日期是否落在本学期范围内」，并不要求日期在今天之后 —— 督导常常是听完课
  // 隔几天才补录评价，必须允许选择学期内的过去日期。
  describe("isValidFutureDate", () => {
    it("应该接受当前日期及未来日期", () => {
      expect(isValidFutureDate("2026-03-08")).toBe(true);
      expect(isValidFutureDate("2026-03-09")).toBe(true);
    });

    it("应该接受学期内的过去日期（督导补录已听过的课）", () => {
      expect(isValidFutureDate("2026-03-07")).toBe(true);
    });

    it("应该拒绝学期开始之前的日期", () => {
      expect(isValidFutureDate("2026-03-01")).toBe(false);
    });

    it("应该拒绝超出学期范围的日期", () => {
      expect(isValidFutureDate("2026-07-20")).toBe(false);
    });

    it("应该接受 Date 对象作为输入", () => {
      const date = new Date("2026-03-08");
      expect(isValidFutureDate(date)).toBe(true);
    });
  });

  describe("getMinSelectableDate", () => {
    it("应该返回学期第一天（而非今天，以便督导补录已听过的课）", () => {
      expect(getMinSelectableDate()).toBe(SEMESTER_START_DATE);
    });
  });

  describe("getMaxSelectableDate", () => {
    it("应该返回学期最后一天的日期", () => {
      const maxDate = getMaxSelectableDate();
      // 计算预期的最后一天
      const expectedLastDay = new Date(SEMESTER_START_DATE);
      expectedLastDay.setDate(expectedLastDay.getDate() + (WEEKS_IN_SEMESTER - 1) * 7 + 6);
      const expectedStr = expectedLastDay.toISOString().split("T")[0];
      expect(maxDate).toBe(expectedStr);
    });
  });
});
