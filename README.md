# 浙江工商大学研究生院督导系统 v4

研究生课堂教学督导评价平台：督导专家浏览全校/MBA 研究生课表 → 制定听课计划 → 课堂评价（20 项定量 + 亮点与建议）→ 多级统计仪表盘与导出。支持学期归档、多角色与双身份切换、按学院收敛的统计口径。

当前版本：**v4.0.0**（上线候选，变更明细见 [CHANGELOG](./CHANGELOG.md)）

## 技术栈

React 19 + TypeScript + Vite · Tailwind CSS 4 + shadcn/ui · tRPC v11 + Express · MySQL 8 + Drizzle ORM · Vitest

## 快速开始

```bash
pnpm install
pnpm db:push        # 配置 .env 的 DATABASE_URL 后执行迁移
pnpm dev            # 开发环境 http://localhost:3000
pnpm check          # 类型检查
pnpm test           # 单元 + 集成测试
pnpm build          # 生产构建
```

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [CHANGELOG](./CHANGELOG.md) | 版本变更明细 |
| [角色与权限清单](./docs/角色与权限清单.md) | 7 种角色 + 双身份的权限边界 |
| [用户操作指引-分角色](./docs/用户操作指引-分角色.md) | 各角色功能指引与操作路径 |
| [生产发布准备清单](./docs/生产发布准备清单.md) | 上线五道关卡与验收证据 |
| [数字办部署执行清单](./docs/数字办部署执行清单.md) | 新服务器部署步骤（资源到位后执行） |
| [换学期与课表导入](./docs/换学期与课表导入.md) | 学期切换、双入口课表导入 |
| [密钥轮换](./docs/密钥轮换.md) | 密钥轮换手册 |
| [测试报告](./docs/测试报告-2026-10-04.md) | 软件工程式全量测试结论 |

## 质量基线

- 279 项单元测试 + 13 项数据库集成测试（专用测试库，`scripts/seed-smoke.mjs` 播种）
- 47 项 API 权限矩阵冒烟（`scripts/api-smoke.mjs`，可对任意隔离实例重复执行）
- 权限自检 `scripts/permission-selfcheck.ts` 与学期归档校验 `scripts/verify-semester-archive.ts`
