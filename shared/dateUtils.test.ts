import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateWeekFromDate,
  calculateDateRangeFromWeek,
  getCurrentWeek,
  isValidFutureDate,
  getMinSelectableDate,
  getMaxSelectableDate,
} from "./dateUtils";

/**
 * 全校校历统一口径：第一周周一（2026-09-14）是第 1 周第 1 天；
 * 早于它的日期（MBA 提前开学等）记为第 0 周「开学前」。
 * 下面固定传入这份学期配置，不依赖 shared/const 的默认值。
 */
const SEMESTER = { startDate: "2026-09-14", totalWeeks: 18 };

describe("dateUtils", () => {
  beforeEach(() => {
    // 模拟当前时间为 2026-09-16（第 1 周周三）
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("calculateWeekFromDate", () => {
    it("第一周周一到周日都是第 1 周", () => {
      expect(calculateWeekFromDate("2026-09-14", SEMESTER)).toBe(1);
      expect(calculateWeekFromDate("2026-09-20", SEMESTER)).toBe(1);
    });

    it("跨到下周一进入第 2 周", () => {
      expect(calculateWeekFromDate("2026-09-21", SEMESTER)).toBe(2);
    });

    it("早于起始日的日期记为第 0 周（开学前，全校统一口径）", () => {
      expect(calculateWeekFromDate("2026-09-12", SEMESTER)).toBe(0);
      expect(calculateWeekFromDate("2026-09-13", SEMESTER)).toBe(0);
      expect(calculateWeekFromDate("2026-08-30", SEMESTER)).toBe(0);
    });

    it("学期最后一周的日期对应最大周次", () => {
      expect(calculateWeekFromDate("2027-01-17", SEMESTER)).toBe(18);
    });

    it("应该返回 undefined 如果日期晚于学期结束", () => {
      expect(calculateWeekFromDate("2027-02-20", SEMESTER)).toBeUndefined();
    });

    it("应该接受 Date 对象作为输入", () => {
      expect(calculateWeekFromDate(new Date("2026-09-14T12:00:00Z"), SEMESTER)).toBe(1);
    });
  });

  describe("calculateDateRangeFromWeek", () => {
    it("第 0 周是开学前一周（起始日前推 7 天到前一天）", () => {
      const range = calculateDateRangeFromWeek(0, SEMESTER);
      expect(range).toEqual({
        startDate: "2026-09-07",
        endDate: "2026-09-13",
      });
    });

    it("应该计算第一周的日期范围", () => {
      const range = calculateDateRangeFromWeek(1, SEMESTER);
      expect(range).toEqual({
        startDate: "2026-09-14",
        endDate: "2026-09-20",
      });
    });

    it("应该计算第二周的日期范围", () => {
      const range = calculateDateRangeFromWeek(2, SEMESTER);
      expect(range).toEqual({
        startDate: "2026-09-21",
        endDate: "2026-09-27",
      });
    });

    it("应该返回 undefined 如果周次无效", () => {
      expect(calculateDateRangeFromWeek(-1, SEMESTER)).toBeUndefined();
      expect(calculateDateRangeFromWeek(19, SEMESTER)).toBeUndefined();
    });
  });

  describe("getCurrentWeek", () => {
    it("应该返回当前周次", () => {
      // 模拟时间为 2026-09-16（第一周）
      expect(getCurrentWeek(SEMESTER)).toBe(1);
    });
  });

  // 注意：isValidFutureDate 这个函数名有历史遗留的误导性，它实际校验的是
  // 「日期是否可选」，并不要求日期在今天之后 —— 督导常常是听完课
  // 隔几天才补录评价，必须允许选择学期内的过去日期。
  describe("isValidFutureDate", () => {
    it("应该接受学期内日期", () => {
      expect(isValidFutureDate("2026-09-16", SEMESTER)).toBe(true);
      expect(isValidFutureDate("2026-12-01", SEMESTER)).toBe(true);
    });

    it("应该接受开学前一周内的日期（第 0 周，督导听提前开课的课）", () => {
      expect(isValidFutureDate("2026-09-12", SEMESTER)).toBe(true);
      expect(isValidFutureDate("2026-09-13", SEMESTER)).toBe(true);
    });

    it("应该拒绝开学前一周更早的日期（属于上学期）", () => {
      expect(isValidFutureDate("2026-09-05", SEMESTER)).toBe(false);
    });

    it("应该拒绝超出学期范围的日期", () => {
      expect(isValidFutureDate("2027-02-20", SEMESTER)).toBe(false);
    });

    it("应该接受 Date 对象作为输入", () => {
      expect(isValidFutureDate(new Date("2026-09-16T12:00:00Z"), SEMESTER)).toBe(true);
    });
  });

  describe("getMinSelectableDate", () => {
    it("应该返回第 0 周的第一天（开学前一周的周一，以便补录提前开课的听课）", () => {
      expect(getMinSelectableDate(SEMESTER)).toBe("2026-09-07");
    });
  });

  describe("getMaxSelectableDate", () => {
    it("应该返回学期最后一天的日期", () => {
      expect(getMaxSelectableDate(SEMESTER)).toBe("2027-01-17");
    });
  });
});
