/**
 * 口令哈希（2026-11-01 第13轮）：教师口令一律以 scrypt 哈希落库，不再存明文。
 *
 * 背景：口令此前明文存储（默认=工号），任何备份/dump 外泄都等于全员口令泄露
 *（100/101 账号口令=工号）。本模块用 Node 内置 crypto.scrypt（零新依赖，
 * 纯 JS 部署形态不受影响），存储格式自描述：
 *
 *   scrypt$<N>$<r>$<p>$<salt-hex>$<key-hex>
 *
 * 兼容策略：历史上明文口令的行在登录验证时按明文比对（timingSafeEqual），
 * 命中后由登录流程「惰性升级」为哈希；一次性迁移脚本可立即全部升级。
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEYLEN = 64;
const PREFIX = "scrypt$";

/** 生成口令哈希（每次随机盐） */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return `${PREFIX}${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** 是否已是哈希格式 */
export function isScryptHash(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** 按存储串中的参数校验 */
export function verifyScryptHash(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  const expected = Buffer.from(keyHex, "hex");
  const key = scryptSync(plain, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function timingSafeStrEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * 登录口令校验。stored 为哈希 → scrypt 校验；为历史明文 → timing-safe 明文比对，
 * 并返回 legacyPlaintext=true 供调用方惰性升级；stored 为空 → 回退工号（初始口令）。
 */
export function verifyPassword(
  input: string,
  stored: string | null | undefined,
  fallbackEmployeeId?: string | null
): { ok: boolean; legacyPlaintext: boolean } {
  const expected = stored ?? fallbackEmployeeId ?? "";
  if (!expected) return { ok: false, legacyPlaintext: false };
  if (isScryptHash(expected)) {
    return { ok: verifyScryptHash(input, expected), legacyPlaintext: false };
  }
  return { ok: timingSafeStrEq(input, expected), legacyPlaintext: true };
}

/**
 * 口令是否仍为初始密码（空、历史明文=工号、或哈希的内容=工号）。
 * 异步：哈希校验一次约 50~100ms，仅登录/auth.me 调用，可接受。
 */
export async function isDefaultPassword(user: {
  password?: string | null;
  employeeId?: string | null;
}): Promise<boolean> {
  if (!user.password) return true;
  if (isScryptHash(user.password)) {
    return verifyScryptHash(user.employeeId ?? "", user.password);
  }
  return user.password === user.employeeId;
}
