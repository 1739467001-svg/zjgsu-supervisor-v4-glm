#!/usr/bin/env bash
# ============================================================
# 服务器盘点（只读，不做任何修改）
#
# 备份之前先跑这个，弄清楚服务器上到底有什么：哪些数据库、哪些项目、
# 哪些常驻服务、占多大空间。据此才能确认备份没有遗漏。
#
# 用法：
#   bash server-survey.sh              # 输出到屏幕
#   bash server-survey.sh > survey.txt # 存成文件便于回传
# ============================================================
set -uo pipefail

line() { printf '%s\n' "------------------------------------------------------------"; }
sec() { echo; line; echo "## $*"; line; }

echo "服务器盘点报告"
echo "生成时间：$(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "主机名：$(hostname 2>/dev/null || echo 未知)"

sec "系统信息"
(cat /etc/os-release 2>/dev/null | grep -E '^(PRETTY_NAME|VERSION)=') || echo "无法读取 /etc/os-release"
echo "内核：$(uname -r)"
echo "架构：$(uname -m)"

sec "磁盘空间（备份需要足够剩余空间）"
df -h 2>/dev/null | grep -vE '^(tmpfs|devtmpfs|overlay)' || df -h

sec "运行时版本"
for c in node npm pnpm yarn python3 java nginx mysql mariadb docker pm2; do
  if command -v "$c" >/dev/null 2>&1; then
    printf '  %-8s %s\n' "$c" "$("$c" --version 2>&1 | head -1)"
  fi
done

sec "MySQL / MariaDB 数据库与体积"
MYSQL_BIN=""
command -v mysql >/dev/null 2>&1 && MYSQL_BIN=mysql
[ -z "$MYSQL_BIN" ] && command -v mariadb >/dev/null 2>&1 && MYSQL_BIN=mariadb

if [ -z "$MYSQL_BIN" ]; then
  echo "  未找到 mysql/mariadb 客户端"
else
  # 依次尝试几种常见的免密/默认连接方式
  MYSQL_ARGS=""
  if $MYSQL_BIN -e "SELECT 1" >/dev/null 2>&1; then
    MYSQL_ARGS=""
  elif [ -n "${MYSQL_PWD:-}" ] && $MYSQL_BIN -uroot -e "SELECT 1" >/dev/null 2>&1; then
    MYSQL_ARGS="-uroot"
  else
    echo "  ! 无法免密连接数据库。请设置后重跑，例如："
    echo "      export MYSQL_PWD='你的数据库密码'; bash server-survey.sh"
    MYSQL_ARGS="__FAIL__"
  fi

  if [ "$MYSQL_ARGS" != "__FAIL__" ]; then
    echo "  各库体积："
    $MYSQL_BIN $MYSQL_ARGS -N -e "
      SELECT CONCAT('    ', table_schema, ' : ',
             ROUND(SUM(data_length+index_length)/1024/1024, 1), ' MB, ',
             COUNT(*), ' 张表')
      FROM information_schema.tables
      WHERE table_schema NOT IN ('information_schema','performance_schema','mysql','sys')
      GROUP BY table_schema;" 2>/dev/null || echo "    查询失败"

    echo
    echo "  各表行数（业务库）："
    for db in $($MYSQL_BIN $MYSQL_ARGS -N -e "SHOW DATABASES;" 2>/dev/null | grep -vE '^(information_schema|performance_schema|mysql|sys)$'); do
      echo "    [$db]"
      $MYSQL_BIN $MYSQL_ARGS -N -e "
        SELECT CONCAT('      ', table_name, ' : ', table_rows, ' 行(估)')
        FROM information_schema.tables WHERE table_schema='$db';" 2>/dev/null
    done
  fi
fi

sec "PM2 常驻进程"
if command -v pm2 >/dev/null 2>&1; then
  pm2 list 2>/dev/null || echo "  pm2 list 执行失败"
  echo
  echo "  PM2 配置文件位置：$(ls -d ~/.pm2 2>/dev/null || echo 未找到)"
else
  echo "  未安装 pm2"
fi

sec "systemd 中的自定义服务"
systemctl list-units --type=service --state=running --no-pager 2>/dev/null \
  | grep -viE 'systemd|dbus|cron|ssh|network|polkit|rsyslog|getty|udev|chrony|agent|aliyun' \
  | head -25 || echo "  无法读取"

sec "Nginx 配置"
if command -v nginx >/dev/null 2>&1; then
  nginx -t 2>&1 | head -3
  echo "  站点配置："
  ls -1 /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* 2>/dev/null | sed 's/^/    /' || echo "    未找到"
  echo "  SSL 证书目录："
  ls -d /etc/letsencrypt /etc/nginx/ssl /etc/ssl/private 2>/dev/null | sed 's/^/    /' || echo "    未找到"
else
  echo "  未安装 nginx"
fi

sec "可能的项目目录（含 package.json 且非 node_modules）"
for base in /root /home /var/www /opt /srv /data /app; do
  [ -d "$base" ] || continue
  find "$base" -maxdepth 4 -name package.json -not -path '*/node_modules/*' 2>/dev/null | while read -r pkg; do
    d=$(dirname "$pkg")
    size=$(du -sh --exclude=node_modules "$d" 2>/dev/null | cut -f1)
    echo "    $d  （不含 node_modules 约 $size）"
  done
done
echo
echo "  其它较大目录（/root 与 /home 下前 15）："
du -sh /root/* /home/* 2>/dev/null | sort -rh | head -15 | sed 's/^/    /'

sec "环境变量与密钥文件（只列文件名，不输出内容）"
for base in /root /home /var/www /opt; do
  [ -d "$base" ] || continue
  find "$base" -maxdepth 4 \( -name '.env' -o -name '.env.*' -o -name 'ecosystem.config*' \) \
    -not -path '*/node_modules/*' 2>/dev/null | sed 's/^/    /'
done

sec "定时任务"
echo "  root crontab："
crontab -l 2>/dev/null | sed 's/^/    /' || echo "    无"
echo "  /etc/cron.d："
ls -1 /etc/cron.d 2>/dev/null | sed 's/^/    /' || echo "    无"

sec "监听端口"
(ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null) | head -20

echo
line
echo "盘点结束。请把以上输出保存并回传，据此确认备份范围。"
line
