# AI Topic Radar

中文 AI 产业选题台。它把公开高质量上游聚合源先抓下来，再生成一个适合手机和 Mac 阅读的每日 Top 20 摘要页面。

## 第一版架构

- AI News Radar：高质量 AI/tech 信号池。
- Horizon：中英双语 AI 摘要日报，上游已经做过评分和摘要。
- Podcast RSS：后续补充 AI 播客节目。
- GitHub Actions：每天定时生成 `public/data/digest.json`。
- GitHub Pages：展示 `public/index.html`，手机上可以添加到主屏幕当 PWA 使用。

## 本地运行

```bash
npm install
npm run build
npm run serve
```

然后打开：

```text
http://localhost:4173
```

## 只用 GitHub 是否够用

够用。MVP 不需要域名、不需要服务器、不需要数据库。

需要的只有：

- 一个独立 GitHub 仓库。
- GitHub Actions 自动更新日报数据。
- 可选：后续如果要 LLM 二次改写摘要，再在 GitHub Secrets 里放模型 API Key。

注意：GitHub Free 账号的私密仓库不能发布 GitHub Pages。当前仓库保持 private，Actions 只更新 `public/data/digest.json`。如果需要手机访问网页，有三种路线：

- 升级 GitHub Pro 后给这个 private repo 开 Pages。
- 另建一个 public 展示仓库，只发布生成后的 `public/`。
- 使用 Cloudflare Pages，源码仍保持 private。

## 下一步

1. 推到独立 GitHub 仓库。
2. 开启 GitHub Pages。
3. 打开 GitHub Actions 每日定时运行。
4. 后续加入你的频道方向评分规则，例如“适合快评”“适合深度视频”“只适合备选”。
