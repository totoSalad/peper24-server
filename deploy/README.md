# Peper24 生产部署

本方案在一台 Linux 服务器上使用 Docker Compose 运行 Nginx、Egg.js、MySQL 8 和 Redis 7。
MySQL、Redis 和 Egg.js 只加入 Docker 内网，公网仅开放 80/443。

## 1. 服务器和 DNS

推荐起步配置：2 vCPU、4 GiB 内存、60 GiB SSD、5 Mbps 公网带宽、Ubuntu 24.04 x86_64。

在阿里云安全组或轻量服务器防火墙中：

- 80/443 允许公网访问；
- 22 只允许管理员 IP；
- 不要开放 3306、6379 和 7001。

将域名 A 记录指向服务器公网 IP。中国内地服务器需先完成 ICP 备案。

## 2. 安装 Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo apt-get install -y docker-compose-plugin
sudo usermod -aG docker "$USER"
```

退出 SSH 并重新登录，然后检查：

```bash
docker version
docker compose version
```

如果服务器无法从 Docker Hub 拉取基础镜像，在阿里云容器镜像服务控制台的“镜像工具 > 镜像加速器”获取当前账号的加速地址，按控制台说明写入 `/etc/docker/daemon.json` 后重启 Docker。

## 3. 放置代码

两个仓库必须位于同一父目录：

```text
/opt/peper24/
├── peper24-app/
└── peper24-server/
```

建议用只读 deploy key 分别拉取两个仓库，不要把个人 GitHub 密码或 token 写进服务器脚本。

## 4. 配置生产密钥

```bash
cd /opt/peper24/peper24-server/deploy
cp .env.production.example .env.production
chmod 600 .env.production
```

生成独立密钥：

```bash
openssl rand -base64 48
openssl rand -hex 32
```

编辑 `.env.production`：

- `ALLOWED_ORIGINS` 改为真实 HTTPS 域名，例如 `https://peper24.example`；
- `APP_KEYS`、`VERIFICATION_CODE_SECRET`、MySQL 两个密码和 Redis 密码全部独立生成；
- `AI_TEXT_PROVIDER` 明确设为 `deepseek` 或 `bailian`；
- `DASHSCOPE_API_KEY` 必须配置，翻译固定使用百炼 `qwen3.7-flash`；如果其他 AI 能力选择
  DeepSeek，还需配置新建的 `DEEPSEEK_API_KEY`。

密码建议只使用字母和数字的长随机字符串，避免 Compose 对 `$` 等字符做变量展开。

## 5. 配置 HTTPS 证书

在阿里云 SSL 证书服务中签发证书，下载 Nginx 格式的证书。最终放置为：

```text
deploy/certs/fullchain.pem
deploy/certs/privkey.pem
```

如果下载包里是 `*.pem` 和 `*.key`，分别重命名为上述文件名。私钥不得提交 Git。

```bash
chmod 600 certs/privkey.pem
```

## 6. 首次启动

先检查 Compose 最终配置：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
```

构建镜像：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build
```

启动 MySQL 和 Redis，执行数据库 Migration：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d mysql redis
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm api pnpm migrate
```

然后启动全部服务：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

检查日志与健康状态：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 api web
curl -fsS https://YOUR_DOMAIN/api/health
curl -fsS https://YOUR_DOMAIN/api/ready
```

`/api/ready` 中 MySQL 和 Redis 都应为 `up`。

## 7. 更新版本

先在本地通过测试并提交代码，服务器只拉取确定的 tag 或 commit。更新时：

```bash
cd /opt/peper24/peper24-app && git pull --ff-only
cd /opt/peper24/peper24-server && git pull --ff-only
cd /opt/peper24/peper24-server/deploy
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm api pnpm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Migration 必须在新 API 容器替换前成功。如果 Migration 失败，不要继续发布。

## 8. 备份与恢复

- 为云盘开启每日自动快照，保留 7～14 天；
- 另外每日执行 `mysqldump --single-transaction`，加密后保存到不同存储位置；
- 至少每月在临时数据库中做一次恢复演练；
- 不要把生产 SQL 备份提交到代码仓库。

## 常用排查

```bash
# 查看所有容器
docker compose --env-file .env.production -f docker-compose.prod.yml ps

# 跟踪 API 日志
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api

# 重启 API
docker compose --env-file .env.production -f docker-compose.prod.yml restart api

# 查看内部就绪接口
docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
  node -e "fetch('http://127.0.0.1:7001/api/ready').then(r=>r.text()).then(console.log)"
```
