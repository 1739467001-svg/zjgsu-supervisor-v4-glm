// 登录失败限流：进程内滑动窗口计数（单实例部署，无需外部存储）。
// 按「来源 IP」与「工号」双键计数：任一键在窗口内失败次数达到各自上限即拒绝该来源的登录尝试，
// 登录成功后解除该次尝试涉及的键。限流的是"失败尝试"，正常用户一次成功登录不受影响。
//
// 两个上限刻意不同（2026-11-06 第19轮共用出口IP误伤实测后调整）：
// - 工号键 10 次：单账号爆破防护，精确命中攻击目标；
// - IP 键 40 次：跨账号喷洒防护。校园网老师共享出口 IP，10 次会把「几位老师各输错
//   几次密码」放大成全校 15 分钟登录封锁（实测 T2/T3 复现），放宽后正常输错不再误伤，
//   而喷洒式攻击（一个 IP 轮询大量工号）在 40 次/15分钟仍被有效限速。

const WINDOW_MS = 15 * 60 * 1000; // 统计窗口：15 分钟
const MAX_FAILURES = 10; // 工号键：窗口内最大失败次数
const MAX_IP_FAILURES = 40; // IP 键：窗口内最大失败次数（跨工号累计）
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

const hits = new Map<string, number[]>();

export type LoginLimitDecision = {
  blocked: boolean;
  /** 距离解除还需的秒数（blocked 时才有意义） */
  retryAfterSeconds: number;
};

/** 按键类型取各自上限：ip 键累计的是整个出口的所有用户，阈值放宽 */
function thresholdFor(key: string): number {
  return key.startsWith("ip:") ? MAX_IP_FAILURES : MAX_FAILURES;
}

function countWithinWindow(key: string, now: number): number[] {
  const list = hits.get(key);
  if (!list) return [];
  const windowStart = now - WINDOW_MS;
  while (list.length > 0 && list[0] <= windowStart) {
    list.shift();
  }
  return list;
}

export function isLoginBlocked(keys: string[], now: number = Date.now()): LoginLimitDecision {
  for (const key of keys) {
    const list = countWithinWindow(key, now);
    if (list.length >= thresholdFor(key)) {
      const oldest = list[0];
      return {
        blocked: true,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
      };
    }
  }
  return { blocked: false, retryAfterSeconds: 0 };
}

export function recordLoginFailure(keys: string[], now: number = Date.now()): void {
  for (const key of keys) {
    const list = countWithinWindow(key, now);
    list.push(now);
    hits.set(key, list);
  }
}

export function recordLoginSuccess(keys: string[]): void {
  for (const key of keys) {
    hits.delete(key);
  }
}

/** 清理窗口外无残留的键，防止 Map 无限增长（由定时器周期调用） */
export function pruneLoginFailures(now: number = Date.now()): number {
  const windowStart = now - WINDOW_MS;
  let removed = 0;
  for (const [key, list] of hits) {
    const recent = list.filter((t) => t > windowStart);
    if (recent.length === 0) {
      hits.delete(key);
      removed += 1;
    } else if (recent.length !== list.length) {
      hits.set(key, recent);
    }
  }
  return removed;
}

// 周期清理；unref 保证不阻止进程退出
let pruneTimer: ReturnType<typeof setInterval> | null = null;
export function ensurePruneTimer(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => pruneLoginFailures(), PRUNE_INTERVAL_MS);
  pruneTimer.unref?.();
}

/** 客户端真实 IP：经 nginx 反代时取 X-Forwarded-For 首段，其次 X-Real-IP，兜底 socket 地址 */
export function clientIpOf(req: {
  headers: { [key: string]: unknown };
  socket?: { remoteAddress?: string };
}): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.length > 0) {
    return real.trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

/** 测试与运维排查看用：当前在计数中的键数量 */
export function _trackedKeyCount(): number {
  return hits.size;
}

/** 测试用：清空全部计数 */
export function _resetLoginFailures(): void {
  hits.clear();
}

export const LOGIN_LIMIT_CONFIG = { WINDOW_MS, MAX_FAILURES, MAX_IP_FAILURES } as const;
