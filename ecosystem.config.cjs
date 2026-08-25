/**
 * PM2 进程配置。
 *
 * 注意：这里不放任何密钥。数据库连接串与 JWT 密钥写在部署目录下的 .env 里
 * （权限 600、不入版本库），应用入口 server/_core/index.ts 首行 `import "dotenv/config"`
 * 会自动加载。此前这些密钥硬编码在本文件中并提交进了 Git 历史，属于泄露，
 * 已改为从 .env 读取；原有密钥请在服务器上轮换。
 */
const path = require("path");

const APP_DIR = process.env.APP_DIR || path.resolve(__dirname);

module.exports = {
  apps: [
    {
      name: "zjgsu-supervisor",
      script: path.join(APP_DIR, "dist/index.js"),
      cwd: APP_DIR,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000,
        // 全局时区：确保 Node 进程使用中国标准时间（UTC+8）
        // 影响 new Date()、日志时间戳等所有时间相关操作
        TZ: "Asia/Shanghai",
      },
      error_file: path.join(APP_DIR, "logs/error.log"),
      out_file: path.join(APP_DIR, "logs/out.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
