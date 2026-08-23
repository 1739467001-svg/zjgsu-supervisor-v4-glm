import express, { type Express } from "express";
import fs from "fs";
import path from "path";

/**
 * 生产环境的静态资源服务。
 *
 * 刻意与 ./vite.ts 分开：vite.ts 顶层依赖 vite 及各类 vite 插件，而这些都是
 * devDependencies。生产镜像执行 pnpm install --prod 时不会安装它们，若入口文件
 * 静态引入 vite.ts，Node 在加载模块阶段就会以 ERR_MODULE_NOT_FOUND 崩溃。
 * 因此生产所需的 serveStatic 必须放在这个不含任何 vite 依赖的模块里。
 */
export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
