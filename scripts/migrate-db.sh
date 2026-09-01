#!/usr/bin/env bash
#
# 数据迁移：把旧环境的数据库整库搬到新服务器
#
# 用法（在新服务器上执行）：
#   # 从旧服务器的本地 MySQL 迁移
#   bash migrate-db.sh --from-ssh root@旧服务器IP --old-db zjgsu_supervisor
#
#   # 或从任意可直连的库（如 TiDB Cloud）迁移
#   bash migrate-db.sh --from-url 'mysql://用户:密码@主机:端口/库名'
#
# 迁移前会先备份新库现有数据，导入后自动校验行数。

set -euo pipefail

NEW_DB="${NEW_DB:-zjgsu_supervisor}"
FROM_SSH=""; FROM_URL=""; OLD_DB="zjgsu_supervisor"

while [ $# -gt 0 ]; do
  case "$1" in
    --from-ssh) FROM_SSH="$2"; shift 2 ;;
    --from-url) FROM_URL="$2"; shift 2 ;;
    --old-db)   OLD_DB="$2";   shift 2 ;;
    --new-db)   NEW_DB="$2";   shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$FROM_SSH$FROM_URL" ] || die "请指定 --from-ssh 或 --from-url"

TS="$(date +%Y%m%d%H%M%S)"
DUMP="/root/zjgsu-migrate-${TS}.sql"
BACKUP="/root/zjgsu-newdb-backup-${TS}.sql"

log "备份新服务器当前数据库（回滚用）"
mysqldump -uroot --databases "$NEW_DB" > "$BACKUP" 2>/dev/null || echo "-- 新库尚不存在" > "$BACKUP"
ok "已备份到 $BACKUP"

log "从源库导出"
if [ -n "$FROM_SSH" ]; then
  command -v ssh >/dev/null 2>&1 || die "需要 ssh 客户端"
  ssh "$FROM_SSH" "mysqldump -uroot --single-transaction --default-character-set=utf8mb4 '$OLD_DB'" > "$DUMP"
else
  # 解析 mysql:// 连接串
  U="$(printf '%s' "$FROM_URL" | sed -n 's#^mysql://\([^:]*\):.*#\1#p')"
  P="$(printf '%s' "$FROM_URL" | sed -n 's#^mysql://[^:]*:\([^@]*\)@.*#\1#p')"
  H="$(printf '%s' "$FROM_URL" | sed -n 's#^mysql://[^@]*@\([^:/]*\).*#\1#p')"
  PORT="$(printf '%s' "$FROM_URL" | sed -n 's#^mysql://[^@]*@[^:]*:\([0-9]*\)/.*#\1#p')"
  D="$(printf '%s' "$FROM_URL" | sed -n 's#^mysql://.*/\([^?]*\).*#\1#p')"
  [ -n "$U$H$D" ] || die "连接串解析失败：$FROM_URL"
  mysqldump -h "$H" -P "${PORT:-3306}" -u "$U" -p"$P" \
    --single-transaction --default-character-set=utf8mb4 \
    --set-gtid-purged=OFF --no-tablespaces "$D" > "$DUMP" 2>/dev/null \
  || mysqldump -h "$H" -P "${PORT:-3306}" -u "$U" -p"$P" \
    --single-transaction --default-character-set=utf8mb4 "$D" > "$DUMP"
fi
[ -s "$DUMP" ] || die "导出为空，请检查源库连接"
ok "已导出 $(du -h "$DUMP" | cut -f1) 到 $DUMP"

log "导入到新库 $NEW_DB"
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS \`${NEW_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -uroot "$NEW_DB" < "$DUMP"
ok "导入完成"

log "校验各表行数"
for t in users courses course_evaluations listening_plans notifications; do
  N="$(mysql -uroot -N -e "SELECT COUNT(*) FROM \`${NEW_DB}\`.\`$t\`" 2>/dev/null || echo "表不存在")"
  printf '    %-22s %s\n' "$t" "$N"
done

cat <<DONE

迁移完成。接下来：
  1. 确认上面各表行数与旧系统一致
  2. cd /root/zjgsu-supervisor && pnpm db:push   # 补齐新增的表结构（学期表等）
  3. pnpm db:doctor                              # 结构体检
  4. pm2 restart zjgsu-supervisor

回滚：mysql -uroot < ${BACKUP}
DONE
