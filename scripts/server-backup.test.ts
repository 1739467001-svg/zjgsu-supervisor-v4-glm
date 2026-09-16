/**
 * server-backup.sh 打包校验环节的回归测试。
 *
 * 线上实际踩过的坑：校验写成「列出归档清单 | grep -q 关键文件」。
 * grep -q 一命中就退出，归档条目多时 tar 还在往管道里写，被 SIGPIPE 杀掉（退出码 141）；
 * 脚本又开了 set -o pipefail，于是整条管道判定为失败，报出
 * 「✗ 归档缺少 RESTORE.md」—— 文件明明在归档里，备份也是完好的，
 * 纯粹是校验误报。但它让脚本 exit 1，后面的 sha256 校验值和暂存目录清理都没跑。
 *
 * 触发条件是「被匹配的条目排在清单靠前的位置」：匹配得越早，tar 剩下要写的越多，
 * 越必然撞上 SIGPIPE。所以下面显式指定打包顺序，把 RESTORE.md 排在第一条，
 * 让这个场景稳定复现，而不是靠目录遍历顺序碰运气。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scriptPath = path.resolve(import.meta.dirname, "server-backup.sh");

/** 从脚本里抠出「打包与校验」那一段，保证测的是真代码而不是复制品 */
function extractVerifySection(): string {
  const src = fs.readFileSync(scriptPath, "utf-8");
  const start = src.indexOf('ARCHIVE_LIST="$(mktemp)"');
  const end = src.indexOf('ok "关键文件齐全"');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

let tmp: string;
let archive: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backup-verify-"));
  const stage = path.join(tmp, "stage");
  fs.mkdirSync(path.join(stage, "system"), { recursive: true });
  fs.writeFileSync(path.join(stage, "RESTORE.md"), "# 恢复说明\n");
  fs.writeFileSync(path.join(stage, "system", "environment.txt"), "node v22\n");
  // 真实备份的 projects/ 下动辄上万个文件；这里造足够多的长文件名把 64KB 管道缓冲区撑破
  const bulk = path.join(stage, "projects");
  fs.mkdirSync(bulk, { recursive: true });
  for (let i = 0; i < 20000; i++) {
    fs.writeFileSync(path.join(bulk, `a_reasonably_long_source_file_name_${i}.ts`), "x");
  }
  archive = path.join(tmp, "backup.tar.gz");
  // 顺序写死：RESTORE.md 在最前，后面还有两万条要写
  execFileSync("tar", ["czf", archive, "-C", tmp, "stage/RESTORE.md", "stage/system", "stage/projects"]);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function runVerify(body: string): { code: number; out: string } {
  const script = [
    "set -uo pipefail",
    'die() { echo "✗ $*" >&2; exit 1; }',
    'ok() { echo "✓ $*"; }',
    `ARCHIVE=${JSON.stringify(archive)}`,
    body,
    'echo "关键文件齐全"',
  ].join("\n");
  try {
    const out = execFileSync("bash", ["-c", script], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("server-backup.sh 归档校验", () => {
  it("归档条目很多时也能通过校验（不被 SIGPIPE 误判为缺文件）", () => {
    const result = runVerify(extractVerifySection());
    expect(result.out).not.toContain("归档缺少");
    expect(result.code).toBe(0);
  });

  it("归档里真的缺文件时仍然报错（校验没有被改成摆设）", () => {
    const body = extractVerifySection().replace(
      "RESTORE.md system/environment.txt",
      "RESTORE.md 绝对不存在的文件.txt",
    );
    const result = runVerify(body);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("归档缺少");
  });

  it("旧写法确实会被 SIGPIPE 打成 141 —— 守住这个坑不要再被写回去", () => {
    const legacy = 'for must in RESTORE.md; do\n  tar tzf "$ARCHIVE" | grep -q "$must" || die "归档缺少 $must"\ndone\n';
    const result = runVerify(legacy);
    expect(result.code).toBe(1);
    expect(result.out).toContain("归档缺少 RESTORE.md");
  });

  it("脚本正文里不再出现「列归档 | grep」这种管道写法", () => {
    const src = fs.readFileSync(scriptPath, "utf-8");
    const codeLines = src.split("\n").filter((line) => !line.trimStart().startsWith("#"));
    expect(codeLines.join("\n")).not.toMatch(/tar\s+tzf[^\n]*\|\s*grep/);
  });
});
