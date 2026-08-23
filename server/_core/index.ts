import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { startScheduler } from "../scheduler";
import uploadCoursesRouter from "../uploadCourses";
import { sdk } from "./sdk";
import { getCourseById, getEvaluationById, getAllUsers } from "../db";
import { generatePrintableHtml } from "../exportUtils";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // 课程数据上传路由（仅研究生院主管）
  app.use(uploadCoursesRouter);

  // ============================================================
  // 打印路由：/api/print/evaluation/:id
  // 返回可在浏览器中直接打印的 HTML 页面
  // ============================================================
  app.get("/api/print/evaluation/:id", async (req, res) => {
    try {
      // 验证登录
      let user;
      try {
        user = await sdk.authenticateRequest(req as any);
      } catch {
        return res.status(401).send("<html><body style='font-family:sans-serif;padding:60px;text-align:center;'><h2>请先登录后再访问此页面</h2></body></html>");
      }
      // 权限验证
      const allowedRoles = ["graduate_admin", "admin", "college_secretary", "supervisor_expert", "supervisor_leader"];
      if (!allowedRoles.includes(user.role || "")) {
        return res.status(403).send("<html><body style='font-family:sans-serif;padding:60px;text-align:center;'><h2>无权限访问</h2></body></html>");
      }
      const evalId = parseInt(req.params.id);
      if (!evalId || evalId <= 0) {
        return res.status(400).send("<html><body style='font-family:sans-serif;padding:60px;text-align:center;'><h2>无效的评价 ID</h2></body></html>");
      }
      const evaluation = await getEvaluationById(evalId);
      if (!evaluation) {
        return res.status(404).send("<html><body style='font-family:sans-serif;padding:60px;text-align:center;'><h2>评价记录不存在</h2></body></html>");
      }
      // 学院秘书只能查看本学院
      const course = await getCourseById(evaluation.courseId);
      if (user.role === "college_secretary" && course?.college !== user.college) {
        return res.status(403).send("<html><body style='font-family:sans-serif;padding:60px;text-align:center;'><h2>无权限查看其他学院的评价</h2></body></html>");
      }
      const allUsers = await getAllUsers();
      const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);
      const enriched = { ...evaluation, course, supervisor };
      const html = generatePrintableHtml([enriched]);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err) {
      console.error("[Print] Error:", err);
      res.status(500).send("<html><body style='font-family:sans-serif;padding:60px;text-align:center;'><h2>服务器错误，请稍后重试</h2></body></html>");
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  // 注意：setupVite 必须用动态 import。vite 及其插件都是 devDependencies，
  // 生产镜像（pnpm install --prod）不会安装，静态引入会让进程在加载模块阶段就崩溃。
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // 启动听课提醒定时任务（每天凌晨 0:30 运行）
    startScheduler();
  });
}

startServer().catch(console.error);
