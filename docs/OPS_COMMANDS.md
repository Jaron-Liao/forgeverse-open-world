# 部署与运维命令清单

本项目有两种发布形态，命令不同，别混用：

| 形态 | 运行位置 | 发布入口 |
|---|---|---|
| **资料库云端 Page**（当前约定的改动落点） | 资料库平台托管，无需服务器 | `library` → `page/edit-flow.md` 事务提交 |
| **本地静态服务器 / 自建服务器** | 你自己的机器或云主机 | 下方命令清单 |

---

## 1. 项目结构

```
workbench3d/
├── index.html              # 入口 + importmap
├── css/3d.css              # 全部样式（王者风格皮肤）
├── js/                     # 23 个 ES 模块
│   ├── state.js            # 全局状态 + 事件总线
│   ├── engine.js           # 渲染引擎核心
│   ├── main.js             # 总控 / UI 接线
│   ├── world.js            # 地形基础
│   ├── biomes.js           # ★ 三环境 × 四层资产（建筑/地形/装饰/公路）
│   ├── terrain-edit.js     # ★ 水源/挖地/保存加载
│   ├── realism.js          # ★ 真实感光照 / 性能档位
│   ├── environment.js      # 天空 / 9 种天气 / 植被
│   ├── infinite-map.js     # 种子化无限地图 / 导航书签
│   ├── modeling.js         # 布尔/细分/镜像/阵列/挤出
│   ├── materials.js / textures.js / paint.js  # 材质与绘画
│   ├── explore.js          # 第一 / 第三人称
│   ├── item-info.js        # 物品信息卡 / 标签 / 搜索
│   ├── cloud.js            # 腾讯云 SDK 接入
│   ├── io.js / localfile.js / model-import.js
│   └── render-pipeline.js / lighting.js / tasks.js
├── vendor/                 # 本地 3D 引擎（Three.js r160 + addons + CSG），离线可用
├── unity/                  # Unity C# 工程骨架
├── docs/                   # 本文档
└── package.json            # {"type":"module"}，仅用于语法校验
```

前后端：**无自建后端**。数据持久化走腾讯云（WorkBuddy Cloud Service，`wb_saves` 表 + RLS 用户隔离）+ 浏览器本地文件双通道。部署时按静态站点处理即可。

---

## 2. 自动部署 / 启动 / 重启

### 2.1 资料库云端 Page（推荐，当前落点）
```bash
SKILL="D:/LenovoSoftstore/Install/WorkBuddy/resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/library"
NODE_ID="PswMzviTMbzUhZZS1aNhac"

# 拉取当前版本到工作副本（事务）
python3 "$SKILL/page/prepare_page_edit.py" --node-id "$NODE_ID" --path index.html --path js/main.js --path js/biomes.js
# 编辑后预检
python3 "$SKILL/page/finalize_page_edit.py" --check-only --work-dir "<work_dir>" --path index.html --path js/main.js --path js/biomes.js
# 提交新版本
python3 "$SKILL/page/finalize_page_edit.py" --work-dir "<work_dir>" --path index.html --path js/main.js --path js/biomes.js --message "开放世界场景增强"
# 发布 / 取消发布
python3 "$SKILL/page/publish_page.py" --node-id "$NODE_ID"
python3 "$SKILL/page/unpublish_page.py" --node-id "$NODE_ID"
```
> 云端 Page 是**多文件 artifact 包**：`--path` 可重复指定要改的文件；新增文件需要先在包里存在。改动前用 `download_page_artifacts.py --list-only` 看包里有哪些文件。

### 2.2 本地静态服务器（开发调试）
```bash
cd workbench3d
python3 -m http.server 8080 --bind 0.0.0.0
# 打开 http://localhost:8080/
```

### 2.3 Linux 系统服务（自建服务器，systemd）
```ini
# /etc/systemd/system/forgeverse.service
[Unit]
Description=ForgeVerse 3D Workbench
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/forgeverse/workbench3d
ExecStart=/usr/bin/python3 -m http.server 8080 --bind 0.0.0.0
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now forgeverse     # 开机自启 + 启动
sudo systemctl start   forgeverse          # 启动
sudo systemctl restart forgeverse          # 重启
sudo systemctl stop    forgeverse          # 停止
sudo systemctl status  forgeverse          # 状态
```

### 2.4 Docker 容器化
```dockerfile
# Dockerfile
FROM nginx:alpine
COPY workbench3d/ /usr/share/nginx/html/
EXPOSE 80
```
```bash
docker build -t forgeverse:latest .
docker run -d --name forgeverse -p 8080:80 --restart unless-stopped forgeverse:latest
docker restart forgeverse
docker stop forgeverse && docker rm forgeverse
```

### 2.5 反向代理（Nginx，配 HTTPS）
```nginx
server {
    listen 443 ssl http2;
    server_name workbench.example.com;
    ssl_certificate     /etc/ssl/certs/fullchain.pem;
    ssl_certificate_key /etc/ssl/private/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 3. 备份与恢复

```bash
# 本地项目打包备份（带日期）
tar -czf "forgeverse-$(date +%F).tar.gz" workbench3d/
# Windows（PowerShell）
Compress-Archive -Path workbench3d -DestinationPath "forgeverse-$(Get-Date -Format yyyy-MM-dd).zip"

# 云端存档：由腾讯云 wb_saves 表持久化，按 owner RLS 隔离
# 用户存档也可通过界面「💾 保存到本地文件」导出为 JSON

# 恢复：解压覆盖
tar -xzf forgeverse-2026-11-17.tar.gz
```

---

## 4. 日志检查与监控

### 4.1 应用日志
```bash
# systemd 服务日志
journalctl -u forgeverse -f                 # 实时
journalctl -u forgeverse --since "1 hour ago"
journalctl -u forgeverse -p err             # 只看错误

# Docker 日志
docker logs -f forgeverse
docker logs --tail 200 forgeverse

# Nginx 访问 / 错误日志
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### 4.2 健康检查
```bash
# 静态站点存活探测
curl -fsS http://localhost:8080/ -o /dev/null -w "HTTP %{http_code}  time=%{time_total}s\n"
# 关键资源可达
curl -fsS http://localhost:8080/vendor/three/three.module.js -o /dev/null -w "three.js %{http_code}\n"
curl -fsS http://localhost:8080/js/main.js -o /dev/null -w "main.js %{http_code}\n"
```

### 4.3 性能监控
- 工作台内 HUD 实时显示 **FPS / 物体数 / 面数 / 画质档位**
- 顶栏「🎬」切档位：低/标准/高清/电影级（`applyPerfProfile` 动态调 DPR 与阴影分辨率）
- 服务器资源：`top`/`htop`、`df -h`、`free -m`；容器 `docker stats forgeverse`

### 4.4 自动巡检脚本（可选）
```bash
#!/usr/bin/env bash
# healthcheck.sh — 挂到 cron 每 5 分钟
URL="http://localhost:8080/"
if ! curl -fsS "$URL" -o /dev/null; then
  echo "[$(date)] DOWN, restarting..." >> /var/log/forgeverse-health.log
  systemctl restart forgeverse
fi
```
```bash
crontab -e
# */5 * * * * /opt/forgeverse/healthcheck.sh
```

---

## 5. 常见坑
- **资料库 Page 改了 HTML 但没生效**：确认 `--path` 列了真正改动的文件；新增文件要先在 artifact 包里存在（用 `--list-only` 查）。
- **云端登录失效**：OAuth 回调绑定发布域名；换域名会失效，必须从同一个应用 ID 发布。
- **`file://` 打开存档失效**：浏览器禁 localStorage / ES module CORS，用 `python3 -m http.server` 或预览面板。
- **403 假象**：平台分享链接的子资源请求需要 sharecode 会话 cookie，浏览器正常；curl 裸请求会 403，属正常。
- **天空过曝 / 雪过密**：已在 `realism.js` / `environment.js` 调好；如自定义主题再发白，检查 toneMappingExposure 与 Bloom threshold。
