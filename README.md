# AI Topic Radar

中文 AI 产业选题编辑台。它把公开高质量上游聚合源先抓下来，生成今日、本周、近 30 天的候选选题，并保留分类资料库。

## 第一版架构

- AI News Radar：高质量 AI/tech 信号池。
- Horizon：中英双语 AI 摘要日报，上游已经做过评分和摘要。
- WaytoAGI 7d：最近一周工具、工作流、实践内容。
- Podcast RSS：补充 AI 播客节目。
- GitHub Actions：每天定时生成 `public/data/digest.json`。
- History：每天保存 `public/history/YYYY-MM-DD.json`，用于本周和近 30 天滚动雷达。
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
- GitHub Pages 发布 `public/` 网页。
- 可选：如果要 LLM 二次评审选题，在 GitHub Secrets 里放 `OPENAI_API_KEY`，并设置 `AI_TOPIC_RERANK=1`。不设置时默认走脚本排序，不消耗 token。

当前推荐使用 public repo，这样 GitHub Free 也能直接使用 Pages。仓库里不要提交 API Key、私密订阅源或个人笔记；后续需要密钥时放进 GitHub Secrets。

## 下一步

1. 推到独立 GitHub 仓库。
2. 开启 GitHub Pages。
3. 打开 GitHub Actions 每日定时运行。
4. 后续加入你的频道方向评分规则，例如“适合快评”“适合深度视频”“只适合备选”。
