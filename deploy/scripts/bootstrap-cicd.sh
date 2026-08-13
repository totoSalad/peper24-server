#!/usr/bin/env bash
set -Eeuo pipefail

public_key_file=${1:-}
server_deploy_script=${2:-}
app_deploy_script=${3:-}
nginx_config=${4:-}

for file in "$public_key_file" "$server_deploy_script" "$app_deploy_script" "$nginx_config"; do
  test -f "$file" || { echo "missing file: $file" >&2; exit 2; }
done

id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy "$public_key_file" /home/deploy/.ssh/authorized_keys

install -d -m 755 /opt/peper24/current /opt/peper24/releases/server /opt/peper24/releases/app
install -d -m 750 -o deploy -g deploy /opt/peper24/shared/server
chown -R deploy:deploy /opt/peper24/releases /opt/peper24/current

if [[ ! -f /opt/peper24/shared/server/.env.production ]]; then
  install -m 600 -o deploy -g deploy \
    /opt/peper24/peper24-server/deploy/.env.production \
    /opt/peper24/shared/server/.env.production
fi

if [[ ! -e /opt/peper24/current/server ]]; then
  ln -s /opt/peper24/peper24-server /opt/peper24/current/server
fi
if [[ -d /opt/peper24/peper24-app/dist && ! -e /opt/peper24/current/app ]]; then
  ln -s /opt/peper24/peper24-app/dist /opt/peper24/current/app
fi
chown -R deploy:deploy /opt/peper24/peper24-server

install -m 755 "$server_deploy_script" /usr/local/sbin/deploy-peper24-server
install -m 755 "$app_deploy_script" /usr/local/sbin/deploy-peper24-app
install -m 644 "$nginx_config" /etc/nginx/nginx.conf

cat >/etc/sudoers.d/peper24-deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/local/sbin/deploy-peper24-server *, /usr/local/sbin/deploy-peper24-app *
EOF
chmod 440 /etc/sudoers.d/peper24-deploy
visudo -cf /etc/sudoers.d/peper24-deploy

cat >/etc/systemd/system/peper24-api.service <<'EOF'
[Unit]
Description=Peper24 Egg.js API
After=network.target mysqld.service redis.service
Requires=mysqld.service redis.service

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/opt/peper24/current/server
EnvironmentFile=/opt/peper24/shared/server/.env.production
Environment=NODE_ENV=production
Environment=MYSQL_HOST=127.0.0.1
Environment=MYSQL_PORT=3306
Environment=REDIS_HOST=127.0.0.1
Environment=REDIS_PORT=6379
ExecStart=/usr/local/bin/pnpm exec eggctl start -c 1 --env=prod --title=egg-server-peper24-server
ExecStop=/usr/local/bin/pnpm exec eggctl stop --title=egg-server-peper24-server
Restart=always
RestartSec=5
TimeoutStopSec=30
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

nginx -t
systemctl daemon-reload
systemctl enable nginx peper24-api
systemctl restart peper24-api
systemctl restart nginx

echo "CI/CD bootstrap complete"
