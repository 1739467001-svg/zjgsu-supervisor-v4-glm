/**
 * 一次性迁移：把全部明文口令升级为 scrypt 哈希（幂等，可重复运行）。
 *
 * 运行方式：
 *   生产（零构建部署形态，DATABASE_URL 已在容器环境里）：
 *     docker exec zjgsu-supervisor node /app/dist/hash-legacy-passwords.js
 *   本地/测试库：
 *     DATABASE_URL=mysql://root@127.0.0.1:3306/xxx_test npx tsx server/_core/hash-legacy-passwords.ts
 *
 * 语义：非空明文 → 原值哈希；空口令 → 初始口令（工号）的哈希（与旧行为等价）；
 *       已是哈希 → 跳过。迁移后残留明文行数 > 0 时以退出码 2 报警。
 * 注意：登录流程自带惰性升级（迁移后极小概率新登录短暂写回明文也会被再次运行纠正），
 *       建议低峰期执行并在结束后重跑一次确认残留为 0。
 */
import mysql from "mysql2/promise";
import { hashPassword, isScryptHash } from "../passwordCrypto";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("需要 DATABASE_URL 环境变量");
    process.exit(1);
  }
  const conn = await mysql.createConnection(url);
  const [rows]: any = await conn.query("SELECT id, employeeId, name, password FROM users");
  let hashed = 0;
  let filled = 0;
  let already = 0;
  for (const u of rows) {
    if (!u.password) {
      await conn.query("UPDATE users SET password = ? WHERE id = ?", [
        hashPassword(u.employeeId ?? String(u.id)),
        u.id,
      ]);
      filled++;
      continue;
    }
    if (isScryptHash(u.password)) {
      already++;
      continue;
    }
    await conn.query("UPDATE users SET password = ? WHERE id = ?", [hashPassword(u.password), u.id]);
    hashed++;
  }
  const [left]: any = await conn.query(
    "SELECT COUNT(*) AS n FROM users WHERE password IS NOT NULL AND password NOT LIKE 'scrypt$%'"
  );
  console.log(
    `迁移完成: 明文→哈希 ${hashed}，空口令→初始哈希 ${filled}，已是哈希 ${already}（共 ${rows.length} 个账号）；残留明文 ${left[0].n} 行`
  );
  await conn.end();
  if (left[0].n > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
