import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // 集成测试（db.integration / scheduler）打同一个真实测试库且会清表/切换激活学期，
    // 文件级并行会互相踩踏（2026-10-25 第6轮发现：scheduler 用例的清表与统计用例的
    // 播种竞争导致统计断言失败）。整套串行换取确定性。
    fileParallelism: false,
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "shared/**/*.test.ts",
      "shared/**/*.spec.ts",
      "scripts/**/*.test.ts",
      "client/src/**/*.test.ts",
    ],
  },
});
