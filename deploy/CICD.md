# GitHub Actions 自动部署

当前生产环境使用原生 systemd 部署，不使用 Docker：

- API：`peper24-api.service`
- 当前版本：`/opt/peper24/current/server`
- 历史版本：`/opt/peper24/releases/server`
- 生产配置：`/opt/peper24/shared/server/.env.production`

推送 `main` 后，GitHub Actions 会先执行 build 和 unit tests，再上传源码包。服务器完成依赖安装、TypeScript 编译、argon2 本地编译和数据库迁移后，才切换当前版本并重启 API。健康检查失败时自动恢复上一个版本。

## GitHub Actions Secrets

在仓库的 `Settings > Secrets and variables > Actions` 添加：

- `DEPLOY_HOST`：ECS 公网 IP
- `DEPLOY_USER`：`deploy`
- `DEPLOY_SSH_KEY`：专用 Ed25519 私钥全文
- `DEPLOY_KNOWN_HOSTS`：ECS 的 Ed25519 host key 行

数据库、Redis、Egg keys 和 AI API key 不放进 GitHub Secrets；它们只保存在服务器的 `.env.production`。

## 手动检查

```bash
systemctl status peper24-api
journalctl -u peper24-api -f
curl -fsS http://127.0.0.1:7001/api/health
readlink -f /opt/peper24/current/server
```
