#!/usr/bin/env bash
# ============================================================
# 服务器整机备份：数据库 + 项目代码 + 配置 + 运行环境信息
#
# 目标：产出一个自包含的归档，拿到一台全新服务器上按 RESTORE.md 执行即可跑起来。
#
# 用法：
#   export MYSQL_PWD='数据库root密码'          # 若数据库需要密码
#   bash server-backup.sh                       # 备份到 /root/backups
#   bash server-backup.sh -o /data/backups      # 指定输出目录
#   bash server-backup.sh -p /root/proj1 -p /var/www/proj2   # 指定项目目录（可重复）
#   bash server-backup.sh -H 127.0.0.1 -P 3306 -u root       # 数据库不在默认位置时
#
# 设计原则：
#   1. 全程只读源数据，不修改、不删除服务器上任何东西
#   2. 数据库用 --single-transaction 热备，不锁表、不影响线上服务
#   3. 排除 node_modules / dist 等可重建产物，但保留 .env 等无法重建的配置
#   4. 备份完成后自行校验（SQL 完整性、归档可解压、关键文件存在）
# ============================================================
set -uo pipefail

OUT_DIR="/root/backups"
PROJECT_DIRS=()
INCLUDE_GIT=1
DB_HOST=""; DB_PORT=""; DB_USER="root"

while getopts "o:p:H:P:u:hG" opt; do
  case "$opt" in
    o) OUT_DIR="$OPTARG" ;;
    p) PROJECT_DIRS+=("$OPTARG") ;;
    H) DB_HOST="$OPTARG" ;;
    P) DB_PORT="$OPTARG" ;;
    u) DB_USER="$OPTARG" ;;
    G) INCLUDE_GIT=0 ;;
    h) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "未知参数，用 -h 查看用法"; exit 2 ;;
  esac
done

# 连接参数显式传给 mysql 与 mysqldump，避免二者对 localhost 的 socket/TCP
# 处理差异导致「客户端能连、导出却失败」
DB_CONN=()
[ -n "$DB_HOST" ] && DB_CONN+=(--host="$DB_HOST" --protocol=TCP)
[ -n "$DB_PORT" ] && DB_CONN+=(--port="$DB_PORT")

TS="$(date '+%Y%m%d_%H%M%S')"
STAGE="${OUT_DIR}/zjgsu_backup_${TS}"
ARCHIVE="${OUT_DIR}/zjgsu_backup_${TS}.tar.gz"

ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*"; }
die()  { echo "  ✗ $*" >&2; exit 1; }
sec()  { echo; echo "== $* =="; }

mkdir -p "$STAGE"/{database,projects,config,system} || die "无法创建 $STAGE"

echo "备份开始：$(date '+%Y-%m-%d %H:%M:%S')"
echo "输出目录：$STAGE"

# ------------------------------------------------------------
# 0. 空间预检：避免备份到一半磁盘满
# ------------------------------------------------------------
sec "空间预检"
AVAIL_KB=$(df -Pk "$OUT_DIR" | awk 'NR==2{print $4}')
echo "  目标分区可用：$(( AVAIL_KB / 1024 )) MB"
[ "$AVAIL_KB" -lt 1048576 ] && warn "可用空间不足 1GB，若数据量大可能失败（可用 -o 指定其它分区）"

# ------------------------------------------------------------
# 1. 数据库
# ------------------------------------------------------------
sec "数据库"
MYSQL_BIN=""; DUMP_BIN=""
command -v mysql   >/dev/null 2>&1 && MYSQL_BIN=mysql
command -v mariadb >/dev/null 2>&1 && [ -z "$MYSQL_BIN" ] && MYSQL_BIN=mariadb
command -v mysqldump   >/dev/null 2>&1 && DUMP_BIN=mysqldump
command -v mariadb-dump >/dev/null 2>&1 && [ -z "$DUMP_BIN" ] && DUMP_BIN=mariadb-dump

if [ -z "$MYSQL_BIN" ] || [ -z "$DUMP_BIN" ]; then
  warn "未找到 mysql/mysqldump，跳过数据库备份"
else
  MYSQL_ARGS=(-u"$DB_USER" "${DB_CONN[@]}")
  $MYSQL_BIN "${MYSQL_ARGS[@]}" -e "SELECT 1" >/dev/null 2>&1 || {
    MYSQL_ARGS=("${DB_CONN[@]}")
    $MYSQL_BIN "${MYSQL_ARGS[@]}" -e "SELECT 1" >/dev/null 2>&1 || \
      die "无法连接数据库。请 export MYSQL_PWD='密码'，或用 -H/-P/-u 指定连接参数"
  }

  # 排除系统库与 MySQL/MariaDB 自带的空 test 库
  DBS=$($MYSQL_BIN "${MYSQL_ARGS[@]}" -N -e "SHOW DATABASES;" 2>/dev/null \
        | grep -vE '^(information_schema|performance_schema|mysql|sys|test)$')
  [ -z "$DBS" ] && warn "未发现业务数据库"

  for db in $DBS; do
    f="$STAGE/database/${db}.sql"
    # --single-transaction：InnoDB 热备，不锁表；--routines/--triggers/--events：存储过程等一并带上
    if $DUMP_BIN "${MYSQL_ARGS[@]}" \
         --single-transaction --quick --hex-blob \
         --routines --triggers --events \
         --default-character-set=utf8mb4 \
         --databases "$db" > "$f" 2>"$STAGE/database/${db}.err"; then
      rm -f "$STAGE/database/${db}.err"
      # 校验：必须含建表语句且以正常结束标记收尾
      if grep -q "CREATE TABLE" "$f" && tail -5 "$f" | grep -q "Dump completed"; then
        ok "$db → $(du -h "$f" | cut -f1)"
      else
        die "$db 导出内容不完整，请检查 $f"
      fi
    else
      die "$db 导出失败：$(head -3 "$STAGE/database/${db}.err")"
    fi
  done

  # 记录各表行数，供恢复后逐表核对
  {
    echo "# 备份时各表行数（恢复后据此核对）"
    for db in $DBS; do
      for t in $($MYSQL_BIN "${MYSQL_ARGS[@]}" -N -e "SHOW TABLES IN \`$db\`;" 2>/dev/null); do
        n=$($MYSQL_BIN "${MYSQL_ARGS[@]}" -N -e "SELECT COUNT(*) FROM \`$db\`.\`$t\`;" 2>/dev/null)
        echo "$db.$t=$n"
      done
    done
  } > "$STAGE/database/row_counts.txt"
  ok "行数清单已记录（$(wc -l < "$STAGE/database/row_counts.txt") 张表）"

  # 数据库账号与授权（新服务器需要重建同名账号，否则应用连不上）
  $MYSQL_BIN "${MYSQL_ARGS[@]}" -N -e \
    "SELECT CONCAT('SHOW GRANTS FOR ''',user,'''@''',host,''';') FROM mysql.user WHERE user NOT IN ('','mysql.sys','mysql.session','mysql.infoschema');" 2>/dev/null \
    | while read -r q; do $MYSQL_BIN "${MYSQL_ARGS[@]}" -N -e "$q" 2>/dev/null; done \
    | sed 's/$/;/' > "$STAGE/database/grants.sql"
  ok "账号授权已导出（新服务器需按需重建账号密码）"
fi

# ------------------------------------------------------------
# 2. 项目代码与配置
# ------------------------------------------------------------
sec "项目目录"
if [ ${#PROJECT_DIRS[@]} -eq 0 ]; then
  # 未指定则自动发现：含 package.json 且不在 node_modules 内
  while IFS= read -r pkg; do
    PROJECT_DIRS+=("$(dirname "$pkg")")
  done < <(find /root /home /var/www /opt /srv /data -maxdepth 4 -name package.json \
           -not -path '*/node_modules/*' 2>/dev/null)
fi

if [ ${#PROJECT_DIRS[@]} -eq 0 ]; then
  warn "未发现项目目录，可用 -p 手动指定"
else
  EXCLUDES=(--exclude=node_modules --exclude=dist --exclude=.next --exclude=build
            --exclude=.cache --exclude=coverage --exclude='*.log')
  [ "$INCLUDE_GIT" -eq 0 ] && EXCLUDES+=(--exclude=.git)

  for d in "${PROJECT_DIRS[@]}"; do
    [ -d "$d" ] || { warn "$d 不存在，跳过"; continue; }
    name=$(echo "${d#/}" | tr '/' '_')
    tar czf "$STAGE/projects/${name}.tar.gz" "${EXCLUDES[@]}" -C "$(dirname "$d")" "$(basename "$d")" 2>/dev/null
    ok "$d → ${name}.tar.gz（$(du -h "$STAGE/projects/${name}.tar.gz" | cut -f1)）"
    # 单独留一份 .env / ecosystem 便于恢复时快速查看（同时已在上面的归档内）
    find "$d" -maxdepth 2 \( -name '.env' -o -name '.env.*' -o -name 'ecosystem.config*' \) \
      -not -path '*/node_modules/*' 2>/dev/null | while read -r f; do
        cp -a "$f" "$STAGE/config/${name}__$(basename "$f")" 2>/dev/null
      done
  done
  ls -1 "$STAGE/config" 2>/dev/null | grep -q . && ok "环境变量与进程配置已单独留存（含明文密钥，注意保管）"
fi

# ------------------------------------------------------------
# 3. 服务与系统配置
# ------------------------------------------------------------
sec "服务与系统配置"
if command -v pm2 >/dev/null 2>&1; then
  pm2 save >/dev/null 2>&1
  [ -f ~/.pm2/dump.pm2 ] && cp -a ~/.pm2/dump.pm2 "$STAGE/config/pm2_dump.json" && ok "PM2 进程列表"
  pm2 list > "$STAGE/config/pm2_list.txt" 2>/dev/null
fi

[ -d /etc/nginx ] && tar czf "$STAGE/config/nginx.tar.gz" -C /etc nginx 2>/dev/null && ok "Nginx 配置"
[ -d /etc/letsencrypt ] && tar czf "$STAGE/config/letsencrypt.tar.gz" -C /etc letsencrypt 2>/dev/null && ok "SSL 证书"
crontab -l > "$STAGE/config/crontab.txt" 2>/dev/null && ok "定时任务"
ls -1 /etc/systemd/system/*.service >/dev/null 2>&1 && \
  tar czf "$STAGE/config/systemd.tar.gz" /etc/systemd/system/*.service 2>/dev/null && ok "systemd 服务"

{
  echo "备份时间：$(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "主机名：$(hostname)"
  echo "系统：$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d'"' -f2)"
  echo "内核：$(uname -r)"
  echo
  echo "== 运行时版本（新服务器请安装同等或兼容版本）=="
  for c in node npm pnpm nginx mysql mariadb pm2; do
    command -v "$c" >/dev/null 2>&1 && printf '%-8s %s\n' "$c" "$("$c" --version 2>&1 | head -1)"
  done
  echo
  echo "== 全局 npm 包 =="
  npm ls -g --depth=0 2>/dev/null || true
  echo
  echo "== 监听端口 =="
  (ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null) || true
} > "$STAGE/system/environment.txt"
ok "运行环境信息"

# ------------------------------------------------------------
# 4. 恢复说明
# ------------------------------------------------------------
cat > "$STAGE/RESTORE.md" <<'RESTORE_EOF'
# 恢复到一台全新服务器

## 0. 先装好基础环境
与 `system/environment.txt` 里记录的版本保持一致（或更高的同主版本）：

```bash
# Node（示例：22.x）
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
npm install -g pnpm pm2

# MySQL 或 MariaDB
apt-get install -y mariadb-server && systemctl enable --now mariadb
```

## 1. 恢复数据库
```bash
# database/ 下每个 .sql 都自带 CREATE DATABASE，直接导入即可
for f in database/*.sql; do
  mysql -uroot -p < "$f"
done
```

重建应用使用的数据库账号（密码请查看 `config/*__ecosystem.config.cjs` 或 `.env`
里的 DATABASE_URL；`database/grants.sql` 记录了原有授权，供参考）：

```sql
CREATE USER 'zjgsu'@'localhost' IDENTIFIED BY '这里填新密码';
GRANT ALL PRIVILEGES ON zjgsu_supervisor.* TO 'zjgsu'@'localhost';
FLUSH PRIVILEGES;
```

**强烈建议借这次迁移更换所有密码**，并同步修改 `.env` / `ecosystem.config.cjs`
里的 DATABASE_URL 与 JWT_SECRET。

## 2. 恢复项目
```bash
mkdir -p /root && tar xzf projects/root_zjgsu-supervisor.tar.gz -C /root
cd /root/zjgsu-supervisor
pnpm install --frozen-lockfile
pnpm build
```

## 3. 核对数据完整性
```bash
# 与备份时的行数逐表比对，应完全一致
while IFS='=' read -r k v; do
  [ -z "$k" ] && continue; case "$k" in \#*) continue;; esac
  db="${k%%.*}"; tbl="${k#*.}"
  now=$(mysql -uroot -p -N -e "SELECT COUNT(*) FROM \`$db\`.\`$tbl\`;")
  [ "$now" = "$v" ] && echo "  ✓ $k = $now" || echo "  ✗ $k 备份=$v 现在=$now"
done < database/row_counts.txt
```

## 4. 启动
```bash
# 用备份里的 ecosystem 配置启动（先确认其中的密码已改成新的）
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup      # 按提示执行输出的命令，实现开机自启
```

## 5. 恢复 Nginx 与证书（如有）
```bash
tar xzf config/nginx.tar.gz -C /etc
tar xzf config/letsencrypt.tar.gz -C /etc   # 若换了域名则需重新申请证书
nginx -t && systemctl reload nginx
```

## 6. 收尾检查
- `pm2 list` 进程为 online
- `curl -I http://127.0.0.1:3000/api/trpc/auth.me` 返回 200
- 用一个真实工号登录，确认历史评价数据都在
- 恢复 `config/crontab.txt` 里的定时任务：`crontab config/crontab.txt`
RESTORE_EOF
ok "RESTORE.md 已生成"

# ------------------------------------------------------------
# 5. 打包与校验
# ------------------------------------------------------------
sec "打包与校验"
tar czf "$ARCHIVE" -C "$(dirname "$STAGE")" "$(basename "$STAGE")" || die "打包失败"
tar tzf "$ARCHIVE" >/dev/null 2>&1 || die "归档校验失败（文件可能损坏）"
ok "归档可正常解压"

for must in RESTORE.md system/environment.txt; do
  tar tzf "$ARCHIVE" | grep -q "$must" || die "归档缺少 $must"
done
ok "关键文件齐全"

sha256sum "$ARCHIVE" > "${ARCHIVE}.sha256"
rm -rf "$STAGE"

echo
echo "============================================================"
echo "备份完成"
echo "  归档：$ARCHIVE"
echo "  大小：$(du -h "$ARCHIVE" | cut -f1)"
echo "  校验：$(cut -d' ' -f1 "${ARCHIVE}.sha256")"
echo
echo "请尽快下载到本地留存（在你自己的电脑上执行）："
echo "  scp root@$(hostname -I 2>/dev/null | awk '{print $1}'):$ARCHIVE ."
echo "  下载后核对：sha256sum -c $(basename "$ARCHIVE").sha256"
echo "============================================================"
