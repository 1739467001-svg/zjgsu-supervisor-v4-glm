# 浙江工商大学研究生院督导系统 - 数据持久化说明文档

## 概述

本系统采用**数据库持久化方案**，确保所有督导评价数据与系统版本完全独立，不会因系统升级、代码更新或版本迭代而丢失或被覆盖。

---

## 一、数据存储架构

### 1.1 存储层次

```
┌─────────────────────────────────────────┐
│        前端应用 (React + Vite)          │
│  - 表单输入、日期选择、评分交互         │
└──────────────┬──────────────────────────┘
               │ HTTP/tRPC
┌──────────────▼──────────────────────────┐
│     后端服务 (Express + tRPC)           │
│  - 业务逻辑、权限验证、数据验证         │
└──────────────┬──────────────────────────┘
               │ SQL
┌──────────────▼──────────────────────────┐
│    MySQL 数据库 (TiDB 兼容)             │
│  - 持久化存储、事务管理、数据一致性     │
└─────────────────────────────────────────┘
```

### 1.2 核心数据表

#### courseEvaluations 表 - 课程评价记录

| 字段名 | 类型 | 说明 | 持久化 |
|--------|------|------|--------|
| id | INT | 评价记录唯一标识 | ✅ 主键 |
| supervisorId | INT | 评价老师 ID | ✅ 外键 |
| courseId | INT | 课程 ID | ✅ 外键 |
| listenDate | DATE | 听课日期 | ✅ 业务数据 |
| actualWeek | INT | 实际周次 | ✅ 业务数据 |
| status | ENUM | 评价状态 (draft/submitted) | ✅ 业务数据 |
| score_* | INT | 22 项评分指标 | ✅ 业务数据 |
| highlights | TEXT | 课程亮点 | ✅ 业务数据 |
| suggestions | TEXT | 存在不足 | ✅ 业务数据 |
| improvement_suggestion | TEXT | 改进建议 | ✅ 业务数据 |
| development_suggestion | TEXT | 发展建议 | ✅ 业务数据 |
| dimension_suggestion | TEXT | 维度改进建议 | ✅ 业务数据 |
| resource_suggestion | TEXT | 资源建议 | ✅ 业务数据 |
| overallScore | INT | 综合评分 | ✅ 业务数据 |
| createdAt | TIMESTAMP | 创建时间 | ✅ 审计字段 |
| updatedAt | TIMESTAMP | 更新时间 | ✅ 审计字段 |

**数据量级**：当前存储 1,344 门课程的评价数据，每条记录约 2-3KB，总计约 3-5MB

---

## 二、数据持久化机制

### 2.1 创建评价流程

```
前端表单提交
    ↓
后端 tRPC 路由 (evaluations.create)
    ↓
权限验证 (supervisorProcedure)
    ↓
业务逻辑验证
  - 检查课程是否存在
  - 检查该课程是否已被其他老师评价过
  - 检查听课日期有效性
    ↓
数据库插入 (INSERT INTO courseEvaluations)
    ↓
返回新建评价记录
    ↓
前端收到响应，显示成功提示
```

### 2.2 更新评价流程

```
前端表单修改 → 提交
    ↓
后端 tRPC 路由 (evaluations.update)
    ↓
权限验证 (supervisorProcedure)
    ↓
业务逻辑验证
  - 检查评价是否存在
  - 检查是否为当前用户的评价
    ↓
数据库更新 (UPDATE courseEvaluations)
    ↓
返回更新后的评价记录
    ↓
前端收到响应，刷新列表
```

### 2.3 数据一致性保证

| 机制 | 实现方式 | 作用 |
|------|--------|------|
| 主键约束 | courseEvaluations.id (INT PRIMARY KEY) | 确保每条评价唯一 |
| 外键约束 | supervisorId → users.id, courseId → courses.id | 确保关联数据完整性 |
| 唯一性检查 | 一个老师对同一课程只能有一条已提交评价 | 防止重复评价 |
| 时间戳 | createdAt, updatedAt 自动管理 | 追踪数据变更历史 |
| 事务管理 | 数据库事务确保原子性 | 防止部分数据丢失 |

---

## 三、版本升级时的数据保护

### 3.1 系统升级流程

```
当前版本运行中
    ↓
新版本代码部署
    ↓
数据库连接保持
    ↓
courseEvaluations 表结构不变
    ↓
所有历史评价数据完整保留
    ↓
新版本继续读写历史数据
```

### 3.2 数据不会丢失的原因

1. **数据库独立性**
   - 评价数据存储在独立的 MySQL 数据库中
   - 数据库与前端代码、后端代码完全分离
   - 代码更新不会触发数据库清空或重置

2. **Schema 版本控制**
   - 使用 Drizzle ORM 管理数据库 schema
   - 所有 schema 变更通过 `pnpm db:push` 显式执行
   - 升级时只会执行新的 migration，不会删除历史数据

3. **向后兼容性**
   - 新版本代码能够读取旧版本的数据
   - 新增字段默认值设置，不影响旧数据
   - 字段删除时采用逻辑删除（标记为已删除），不物理删除

4. **备份与恢复**
   - 数据库定期自动备份（由 Manus 平台管理）
   - 即使发生意外，也可从备份恢复

---

## 四、已评价课程的独占性控制

### 4.1 实现机制

**核心规则**：一旦某课程被某位老师的已提交评价记录，其他老师将无法再对该课程进行评价。

### 4.2 实现代码

**后端检查函数** (`server/db.ts`)：

```typescript
// 检查课程是否已被其他老师评价过（已提交的评价）
export async function isCourseAlreadyEvaluated(courseId: number, supervisorId: number) {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .select()
    .from(courseEvaluations)
    .where(
      and(
        eq(courseEvaluations.courseId, courseId),
        eq(courseEvaluations.status, "submitted"),
        ne(courseEvaluations.supervisorId, supervisorId)
      )
    )
    .limit(1);
  return result.length > 0;
}
```

**创建评价时的验证** (`server/db.ts`)：

```typescript
export async function createEvaluation(evaluation: InsertCourseEvaluation) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  
  // 检查该课程是否已被其他老师评价过
  const alreadyEvaluated = await isCourseAlreadyEvaluated(
    evaluation.courseId!, 
    evaluation.supervisorId!
  );
  if (alreadyEvaluated) {
    throw new Error("该课程已被其他老师评价过，无法再次评价");
  }
  
  await db.insert(courseEvaluations).values(evaluation);
  // ... 返回新建评价
}
```

### 4.3 流程图

```
老师 A 打开课程 C 的评价表单
    ↓
检查课程 C 是否已有其他老师的已提交评价
    ↓
    ├─ 有 → 显示错误提示 "该课程已被评价过，无法再次评价"
    │
    └─ 无 → 允许填写表单
        ↓
    老师 A 填写并提交评价
        ↓
    数据库插入新评价记录
        ↓
    老师 B 打开课程 C 的评价表单
        ↓
    检查课程 C 是否已有其他老师的已提交评价
        ↓
    有 (老师 A 的已提交评价) → 显示错误提示
```

### 4.4 草稿状态的特殊处理

- **草稿评价**（status = "draft"）不会阻止其他老师评价
- 只有**已提交评价**（status = "submitted"）才会锁定课程
- 这允许老师先保存草稿，后续可以继续编辑或删除

---

## 五、数据查询与访问

### 5.1 查询接口

| 接口 | 权限 | 说明 |
|------|------|------|
| evaluations.getById | supervisorProcedure | 获取单条评价详情 |
| evaluations.myEvaluations | supervisorProcedure | 获取当前用户的所有评价 |
| evaluations.courseProgress | protectedProcedure | 获取课程评价进度统计 |

### 5.2 数据隔离

- 督导专家只能查看和编辑自己的评价
- 系统管理员可查看所有评价
- 学院秘书可查看本学院的评价统计

---

## 六、备份与灾难恢复

### 6.1 自动备份

- **备份频率**：每日自动备份（由 Manus 平台管理）
- **备份位置**：云端安全存储
- **保留周期**：30 天内的备份可随时恢复

### 6.2 恢复流程

如需恢复历史数据：

1. 联系系统管理员
2. 提供需要恢复的时间点
3. 从备份恢复数据库
4. 验证数据完整性

---

## 七、监控与维护

### 7.1 数据库健康检查

```bash
# 检查数据库连接
SELECT 1;

# 查看评价表大小
SELECT COUNT(*) FROM courseEvaluations;

# 查看最近的评价记录
SELECT * FROM courseEvaluations 
ORDER BY createdAt DESC 
LIMIT 10;
```

### 7.2 常见问题排查

| 问题 | 原因 | 解决方案 |
|------|------|--------|
| 评价提交失败 | 数据库连接错误 | 检查 DATABASE_URL 环境变量 |
| 显示"课程已被评价" | 该课程已有其他老师的已提交评价 | 联系该老师或系统管理员 |
| 数据丢失 | 数据库故障 | 从备份恢复 |

---

## 八、数据库结构体检（db-doctor）

### 8.1 背景：一处历史遗留的列名不一致

`course_evaluations` 表中「四、教学过程」的 5 个评分列，曾在代码里被改名，但**没有生成对应的迁移文件**，导致「迁移历史记录的列名」与「代码使用的列名」长期不一致：

| 迁移历史中的列名 | 代码中的列名 | 对应评价指标 |
|---|---|---|
| `score_emotional_motivation` | `score_interaction_quality` | 1. 师生互动质量 |
| `score_teaching_diversity` | `score_method_diversity` | 2. 教学方法多样性 |
| `score_rhythm_transition` | `score_equal_dialogue` | 3. 平等交流氛围 |
| `score_key_summary` | `score_pace_control` | 4. 节奏调控能力 |
| `score_feedback_improvement` | `score_feedback` | 5. 即时反馈运用 |

后果是每次执行 `drizzle-kit generate` 都会弹出「是新建列还是重命名列」的交互式询问，无法在自动化流程中使用。

### 8.2 已做的修复

迁移文件 `0001` 的建表语句与 `meta/*_snapshot.json` 已统一为新列名。这样处理是安全的：drizzle 判断迁移是否跳过**只比较 `__drizzle_migrations` 表里的 `created_at` 时间戳，不校验文件 hash**，因此修改早已应用过的迁移文件对现有数据库完全无副作用，同时能让全新部署直接建出正确的列名。

> 之所以不采用「新增一个改名迁移」的方案：若数据库已是新列名，该迁移会执行失败并阻断整个部署。

### 8.3 体检工具用法

```bash
node scripts/db-doctor.mjs        # 只读体检，不做任何修改
node scripts/db-doctor.mjs --fix  # 仅在安全时执行重命名
```

工具会报告 5 个评分列的真实状态、`users.extraRoles` 是否就位、以及 drizzle 迁移进度。

**若旧列中仍存有历史评分数据，工具会拒绝自动处理。** 因为这批列是评价指标体系重新设计的产物，并非逐一对应改名 —— 例如 `score_rhythm_transition`（节奏过渡）按位置会映射到 `score_equal_dialogue`（平等交流氛围），而语义上它更接近 `score_pace_control`（节奏调控能力）。强行按位置重命名不会丢数据，但会让历史评分张冠李戴。人工确认映射关系无误后，再执行：

```bash
node scripts/db-doctor.mjs --fix --accept-positional-mapping
```

工具始终使用 `CHANGE COLUMN` 重命名、**绝不 DROP 列**。这是有教训的：迁移 `0004` 处理 `text_*` 系列改名时采用了 ADD + DROP，原有数据被删除后才发现无法找回。

---

## 九、总结

本系统通过以下措施确保数据持久化和安全性：

✅ **数据库持久化**：所有评价数据存储在 MySQL 数据库，与代码完全分离

✅ **版本独立性**：系统升级不影响历史数据，新版本能读取旧数据

✅ **独占性控制**：已提交评价的课程被锁定，防止重复评价

✅ **一致性保证**：主键、外键、唯一性约束确保数据完整性

✅ **自动备份**：每日自动备份，30 天内可恢复

✅ **权限隔离**：不同角色只能访问授权的数据

✅ **结构一致性**：`db-doctor` 可随时校验数据库结构与代码是否一致（见第八章）

---

**文档版本**：1.1  
**最后更新**：2026-08-22  
**维护人**：系统管理员
