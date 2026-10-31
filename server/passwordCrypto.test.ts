import { describe, expect, it } from "vitest";
import {
  hashPassword,
  isScryptHash,
  isDefaultPassword,
  verifyPassword,
  verifyScryptHash,
} from "./passwordCrypto";

describe("passwordCrypto（第13轮口令哈希化）", () => {
  it("哈希→校验往返：正确口令通过，错误口令拒绝", () => {
    const h = hashPassword("1050043");
    expect(isScryptHash(h)).toBe(true);
    expect(h).not.toContain("1050043"); // 明文不出现在存储串中
    expect(verifyScryptHash("1050043", h)).toBe(true);
    expect(verifyScryptHash("0000000", h)).toBe(false);
  });

  it("同一口令两次哈希产生不同盐（防彩虹表）", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });

  it("verifyPassword：哈希路径不含 legacy 标记；明文路径返回 legacy=true", () => {
    const h = hashPassword("pw1");
    expect(verifyPassword("pw1", h)).toEqual({ ok: true, legacyPlaintext: false });
    expect(verifyPassword("pw2", h).ok).toBe(false);
    expect(verifyPassword("pw1", "pw1")).toEqual({ ok: true, legacyPlaintext: true });
  });

  it("verifyPassword：stored 为空时回退工号（初始口令语义）", () => {
    expect(verifyPassword("1270013", null, "1270013").ok).toBe(true);
    expect(verifyPassword("wrong", null, "1270013").ok).toBe(false);
    expect(verifyPassword("anything", null, null).ok).toBe(false);
  });

  it("isDefaultPassword：空/明文=工号/哈希内容=工号 都视为初始；哈希内容≠工号视为已改密", async () => {
    expect(await isDefaultPassword({ password: null, employeeId: "a1" })).toBe(true);
    expect(await isDefaultPassword({ password: "", employeeId: "a1" })).toBe(true);
    expect(await isDefaultPassword({ password: "a1", employeeId: "a1" })).toBe(true); // 历史明文=工号
    expect(await isDefaultPassword({ password: hashPassword("a1"), employeeId: "a1" })).toBe(true);
    expect(await isDefaultPassword({ password: hashPassword("NewPass9"), employeeId: "a1" })).toBe(false);
    expect(await isDefaultPassword({ password: "Other8", employeeId: "a1" })).toBe(false); // 历史明文已改密
  });

  it("verifyScryptHash：非哈希串/残缺串安全返回 false", () => {
    expect(verifyScryptHash("x", "plaintext")).toBe(false);
    expect(verifyScryptHash("x", "scrypt$1$1$1$aa")).toBe(false);
  });
});
