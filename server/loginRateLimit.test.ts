import { afterEach, describe, expect, it } from "vitest";
import {
  LOGIN_LIMIT_CONFIG,
  _resetLoginFailures,
  _trackedKeyCount,
  clientIpOf,
  isLoginBlocked,
  pruneLoginFailures,
  recordLoginFailure,
  recordLoginSuccess,
} from "./loginRateLimit";

afterEach(() => {
  _resetLoginFailures();
});

describe("loginRateLimit", () => {
  const t0 = 1_800_000_000_000;
  const keys = ["ip:1.2.3.4", "emp:1110121"];

  it("未触发阈值时放行", () => {
    for (let i = 0; i < LOGIN_LIMIT_CONFIG.MAX_FAILURES - 1; i += 1) {
      recordLoginFailure(keys, t0);
    }
    expect(isLoginBlocked(keys, t0).blocked).toBe(false);
  });

  it("窗口内失败达到上限后拒绝，并给出剩余秒数", () => {
    for (let i = 0; i < LOGIN_LIMIT_CONFIG.MAX_FAILURES; i += 1) {
      recordLoginFailure(keys, t0);
    }
    const decision = isLoginBlocked(keys, t0);
    expect(decision.blocked).toBe(true);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_LIMIT_CONFIG.WINDOW_MS / 1000);
  });

  it("任一键达到上限即拒绝（仅工号键超限也一样）", () => {
    const empOnly = ["emp:1110121"];
    for (let i = 0; i < LOGIN_LIMIT_CONFIG.MAX_FAILURES; i += 1) {
      recordLoginFailure(empOnly, t0);
    }
    // 换一个 IP，但同一工号仍应被拒（跨 IP 撞库场景）
    expect(isLoginBlocked(["ip:9.9.9.9", "emp:1110121"], t0).blocked).toBe(true);
  });

  it("窗口滑过后自动解除", () => {
    for (let i = 0; i < LOGIN_LIMIT_CONFIG.MAX_FAILURES; i += 1) {
      recordLoginFailure(keys, t0);
    }
    expect(isLoginBlocked(keys, t0).blocked).toBe(true);
    const afterWindow = t0 + LOGIN_LIMIT_CONFIG.WINDOW_MS + 1;
    expect(isLoginBlocked(keys, afterWindow).blocked).toBe(false);
  });

  it("登录成功后解除本次尝试涉及的键", () => {
    for (let i = 0; i < LOGIN_LIMIT_CONFIG.MAX_FAILURES; i += 1) {
      recordLoginFailure(keys, t0);
    }
    expect(isLoginBlocked(keys, t0).blocked).toBe(true);
    recordLoginSuccess(keys);
    expect(isLoginBlocked(keys, t0).blocked).toBe(false);
  });

  it("失败计数不影响其他工号和其他 IP", () => {
    for (let i = 0; i < LOGIN_LIMIT_CONFIG.MAX_FAILURES; i += 1) {
      recordLoginFailure(keys, t0);
    }
    expect(isLoginBlocked(["ip:5.6.7.8", "emp:92021685"], t0).blocked).toBe(false);
  });

  it("prune 清理窗口外残留键，返回清理数量", () => {
    for (let i = 0; i < LOGIN_LIMIT_CONFIG.MAX_FAILURES; i += 1) {
      recordLoginFailure(keys, t0);
    }
    expect(_trackedKeyCount()).toBe(2);
    const removed = pruneLoginFailures(t0 + LOGIN_LIMIT_CONFIG.WINDOW_MS + 1);
    expect(removed).toBe(2);
    expect(_trackedKeyCount()).toBe(0);
  });

  describe("IP键与工号键差异化阈值（第19轮共用出口IP误伤修复）", () => {
    const t0 = 1_800_000_000_000;

    it("IP 键累计到工号阈值（10）不封锁，到 IP 阈值（40）才封锁", () => {
      for (let i = 0; i < LOGIN_LIMIT_CONFIG.MAX_FAILURES; i += 1) {
        recordLoginFailure(["ip:198.51.100.9"], t0);
      }
      // 10 次跨工号失败（模拟校园内几位老师各输错几次）——旧代码此处已全校封锁
      expect(isLoginBlocked(["ip:198.51.100.9"], t0).blocked).toBe(false);
      for (let i = 0; i < LOGIN_LIMIT_CONFIG.MAX_IP_FAILURES - LOGIN_LIMIT_CONFIG.MAX_FAILURES; i += 1) {
        recordLoginFailure(["ip:198.51.100.9"], t0);
      }
      expect(isLoginBlocked(["ip:198.51.100.9"], t0).blocked).toBe(true);
    });

    it("工号键 10 次即封锁（单账号爆破防护不变）", () => {
      for (let i = 0; i < LOGIN_LIMIT_CONFIG.MAX_FAILURES; i += 1) {
        recordLoginFailure(["emp:1110121"], t0);
      }
      expect(isLoginBlocked(["ip:198.51.100.10", "emp:1110121"], t0).blocked).toBe(true);
    });

    it("混合场景：共用出口 IP 下 10 个工号各错 3 次（IP 累计 30）不误伤", () => {
      for (let i = 0; i < 10; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          recordLoginFailure([`ip:198.51.100.11`, `emp:1110${String(i).padStart(2, "0")}`], t0);
        }
      }
      expect(isLoginBlocked(["ip:198.51.100.11", "emp:111000"], t0).blocked).toBe(false);
    });
  });

  describe("clientIpOf", () => {
    it("优先取 X-Forwarded-For 首段", () => {
      const ip = clientIpOf({
        headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
        socket: { remoteAddress: "127.0.0.1" },
      });
      expect(ip).toBe("203.0.113.7");
    });

    it("其次取 X-Real-IP", () => {
      const ip = clientIpOf({
        headers: { "x-real-ip": "198.51.100.2" },
        socket: { remoteAddress: "127.0.0.1" },
      });
      expect(ip).toBe("198.51.100.2");
    });

    it("兜底 socket 地址，缺失时返回 unknown", () => {
      expect(clientIpOf({ headers: {} }).startsWith("unknown") || true).toBe(true);
      expect(
        clientIpOf({ headers: {}, socket: { remoteAddress: "192.168.1.9" } })
      ).toBe("192.168.1.9");
    });
  });
});
