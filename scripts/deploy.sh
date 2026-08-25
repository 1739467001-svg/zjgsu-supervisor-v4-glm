#!/usr/bin/env bash
#
# 浙江工商大学研究生院督导系统 —— 服务器一键部署 / 更新脚本
#
# 在服务器上执行（Ubuntu / Debian / CentOS / Alibaba Cloud Linux 均可）：
#   curl -fsSL https://raw.githubusercontent.com/1739467001-svg/zjgsu-supervisor-v3/main/scripts/deploy.sh -o deploy.sh
#   bash deploy.sh
#
# 幂等：首次执行完成初始化部署，之后重复执行即为拉取最新代码并更新，
# 不会重装已有组件，也不会覆盖已生成的密钥与数据库数据。
#
# 环境变量（可选）：
#   APP_DIR=/root/zjgsu-supervisor   部署目录
#   PORT=3000                        应用端口
#   BRANCH=main                      部署分支
#   SETUP_NGINX=1                    是否配置 nginx 反向代理（80 → 应用端口）

set -euo pipefail

APP_DIR="${APP_DIR:-/root/zjgsu-supervisor}"
PORT="${PORT:-3000}"
BRANCH="${BRANCH:-main}"
SETUP_NGINX="${SETUP_NGINX:-1}"
REPO="https://github.com/1739467001-svg/zjgsu-supervisor-v3.git"
DB_NAME="zjgsu_supervisor"
DB_USER="zjgsu"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行（或 sudo bash deploy.sh）"

# ============================================================
# 0. 识别系统
# ============================================================
log "识别系统环境"
if command -v apt-get >/dev/null 2>&1; then
  PKG=apt
elif command -v dnf >/dev/null 2>&1; then
  PKG=dnf
elif command -v yum >/dev/null 2>&1; then
  PKG=yum
else
  die "未识别的包管理器（仅支持 apt / dnf / yum）"
fi
ok "包管理器：$PKG"

pkg_install() {
  case "$PKG" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" >/dev/null ;;
    dnf) dnf install -y "$@" >/dev/null ;;
    yum) yum install -y "$@" >/dev/null ;;
  esac
}

log "更新软件源索引"
case "$PKG" in
  apt) apt-get update -qq >/dev/null ;;
  *)   : ;;
esac
ok "完成"

# ============================================================
# 1. 基础工具
# ============================================================
log "安装基础工具（git / curl / openssl）"
for c in git curl openssl; do
  command -v "$c" >/dev/null 2>&1 || pkg_install "$c"
done
ok "git $(git --version | awk '{print $3}')"

# ============================================================
# 2. Node.js 22 与 pnpm
# ============================================================
log "检查 Node.js"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$NODE_MAJOR" -ge 20 ]; then NEED_NODE=0; ok "已安装 Node $(node -v)"; fi
fi
if [ "$NEED_NODE" -eq 1 ]; then
  warn "安装 Node.js 22"
  case "$PKG" in
    apt) curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1; pkg_install nodejs ;;
    *)   curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null 2>&1; pkg_install nodejs ;;
  esac
  ok "Node $(node -v)"
fi

log "检查 pnpm"
if command -v pnpm >/dev/null 2>&1; then
  ok "已安装 pnpm $(pnpm -v)"
else
  corepack enable >/dev/null 2>&1 || npm install -g pnpm >/dev/null 2>&1
  command -v pnpm >/dev/null 2>&1 || npm install -g pnpm >/dev/null 2>&1
  ok "pnpm $(pnpm -v)"
fi

log "检查 PM2"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2 >/dev/null 2>&1
ok "pm2 $(pm2 -v 2>/dev/null | tail -1)"

# ============================================================
# 3. 数据库
# ============================================================
log "检查数据库"
if command -v mysqld >/dev/null 2>&1 || command -v mariadbd >/dev/null 2>&1; then
  ok "已安装数据库服务"
else
  warn "安装 MariaDB"
  case "$PKG" in
    apt) pkg_install mariadb-server ;;
    *)   pkg_install mariadb-server ;;
  esac
fi

DB_SVC=""
for s in mariadb mysqld mysql; do
  systemctl list-unit-files 2>/dev/null | grep -q "^${s}.service" && DB_SVC="$s" && break
done
[ -n "$DB_SVC" ] || die "找不到数据库服务单元，请手动确认 MariaDB/MySQL 安装状态"
systemctl enable --now "$DB_SVC" >/dev/null 2>&1 || true
systemctl is-active --quiet "$DB_SVC" || die "数据库服务未能启动：systemctl status $DB_SVC"
ok "数据库服务 $DB_SVC 运行中"

# ============================================================
# 4. 部署目录与代码
# ============================================================
log "同步代码（分支 $BRANCH）"
mkdir -p "$APP_DIR" "$APP_DIR/logs"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" remote set-url origin "$REPO"
  git -C "$APP_DIR" fetch --depth 50 origin "$BRANCH" >/dev/null 2>&1
  git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
  ok "已更新到 $(git -C "$APP_DIR" rev-parse --short HEAD)"
else
  # 目录非空但不是 git 仓库时，先备份，避免覆盖既有部署
  if [ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name logs -print -quit 2>/dev/null)" ]; then
    BACKUP="${APP_DIR}.bak.$(date +%Y%m%d%H%M%S)"
    warn "目录非空且不是 git 仓库，已备份到 $BACKUP"
    mv "$APP_DIR" "$BACKUP"
    mkdir -p "$APP_DIR" "$APP_DIR/logs"
  fi
  git clone --depth 50 -b "$BRANCH" "$REPO" "$APP_DIR" >/dev/null 2>&1
  mkdir -p "$APP_DIR/logs"
  ok "已克隆到 $(git -C "$APP_DIR" rev-parse --short HEAD)"
fi

# ============================================================
# 5. 环境变量（.env）—— 密钥只生成一次，重复执行不会覆盖
# ============================================================
log "配置环境变量"
ENV_FILE="$APP_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  ok ".env 已存在，保留现有配置（如需轮换密钥请手动编辑）"
  # shellcheck disable=SC1090
  DB_PASS="$(sed -n 's#^DATABASE_URL=mysql://[^:]*:\([^@]*\)@.*#\1#p' "$ENV_FILE" | head -1)"
else
  DB_PASS="$(openssl rand -hex 16)"
  JWT_SECRET="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
# 本文件由 scripts/deploy.sh 生成，含敏感信息，切勿提交进版本库
NODE_ENV=production
PORT=${PORT}
TZ=Asia/Shanghai
DATABASE_URL=mysql://${DB_USER}:${DB_PASS}@127.0.0.1:3306/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
EOF
  chmod 600 "$ENV_FILE"
  ok "已生成 .env（数据库密码与 JWT 密钥为随机生成，权限 600）"
fi
[ -n "${DB_PASS:-}" ] || die "无法从 .env 解析数据库密码，请检查 $ENV_FILE"

# ============================================================
# 6. 建库建用户（幂等）
# ============================================================
log "初始化数据库 $DB_NAME"
if ! mysql -uroot -e "SELECT 1" >/dev/null 2>&1; then
  die "无法以 root 免密连接数据库。若已为 MySQL root 设置密码，请先执行：
       mysql -uroot -p -e \"CREATE DATABASE IF NOT EXISTS \\\`${DB_NAME}\\\` CHARACTER SET utf8mb4;\"
     然后手动创建账号并把连接串写入 ${ENV_FILE} 后重新运行本脚本"
fi
mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
ok "数据库与账号就绪"

# ============================================================
# 7. 依赖、迁移、构建
# ============================================================
cd "$APP_DIR"

log "安装依赖（含构建所需的开发依赖）"
pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null 2>&1
ok "完成"

log "执行数据库迁移"
set +e
pnpm db:push > /tmp/zjgsu-migrate.log 2>&1
MIGRATE_RC=$?
set -e
if [ $MIGRATE_RC -ne 0 ]; then
  tail -20 /tmp/zjgsu-migrate.log
  die "迁移失败，详见 /tmp/zjgsu-migrate.log"
fi
ok "迁移完成"

log "数据库结构体检"
pnpm db:doctor || warn "体检发现待处理项（见上），不阻断部署"

log "构建前端与服务端"
pnpm build >/dev/null 2>&1 || die "构建失败，请在服务器上执行 pnpm build 查看详细报错"
ok "构建完成（dist/）"

# ============================================================
# 8. 启动
# ============================================================
log "启动应用"
export APP_DIR PORT
pm2 delete zjgsu-supervisor >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs >/dev/null
pm2 save >/dev/null 2>&1 || true
pm2 startup >/dev/null 2>&1 || true
ok "PM2 已启动并设置为开机自启"

log "健康检查"
HEALTHY=0
for _ in $(seq 1 15); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/trpc/auth.me" || true)"
  if [ "$CODE" = "200" ]; then HEALTHY=1; break; fi
  sleep 2
done
if [ "$HEALTHY" -eq 1 ]; then
  ok "应用已就绪（本机 http://127.0.0.1:${PORT} 返回 200）"
else
  pm2 logs zjgsu-supervisor --lines 30 --nostream || true
  die "健康检查未通过，请查看上方日志"
fi

# ============================================================
# 9. nginx 反向代理（80 → 应用端口）
# ============================================================
if [ "$SETUP_NGINX" = "1" ]; then
  log "配置 nginx 反向代理"
  command -v nginx >/dev/null 2>&1 || pkg_install nginx
  CONF_DIR=""
  if [ -d /etc/nginx/conf.d ]; then CONF_DIR=/etc/nginx/conf.d; fi
  if [ -n "$CONF_DIR" ]; then
    cat > "$CONF_DIR/zjgsu-supervisor.conf" <<NGINX
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
NGINX
    # Debian/Ubuntu 默认站点会抢占 default_server，先移除
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
    if nginx -t >/dev/null 2>&1; then
      systemctl enable --now nginx >/dev/null 2>&1 || true
      systemctl reload nginx >/dev/null 2>&1 || systemctl restart nginx >/dev/null 2>&1
      ok "nginx 已配置：80 → 127.0.0.1:${PORT}"
    else
      nginx -t || true
      warn "nginx 配置校验未通过，已跳过。应用仍可通过 ${PORT} 端口访问"
    fi
  else
    warn "未找到 /etc/nginx/conf.d，已跳过 nginx 配置"
  fi
fi

# ============================================================
# 完成
# ============================================================
IP="$(curl -s -m 5 https://api.ipify.org 2>/dev/null || echo '<服务器公网IP>')"
cat <<DONE

============================================================
 部署完成
============================================================
 访问地址   ： http://${IP}/            （若未配 nginx 则 http://${IP}:${PORT}/ ）
 部署目录   ： ${APP_DIR}
 当前版本   ： $(git -C "$APP_DIR" rev-parse --short HEAD)
 查看日志   ： pm2 logs zjgsu-supervisor
 重启应用   ： pm2 restart zjgsu-supervisor
 后续更新   ： bash ${APP_DIR}/scripts/deploy.sh

 后续步骤：
   1. 阿里云控制台放行 80 端口（轻量服务器防火墙 / 安全组）
   2. 导入教师名单：
        cd ${APP_DIR}
        pnpm db:import-users <名单.xlsx>            # 先试运行看计划
        pnpm db:import-users <名单.xlsx> --apply    # 确认后写入
   3. 教师默认密码为本人工号，首次登录后请提示其修改
============================================================

DONE
