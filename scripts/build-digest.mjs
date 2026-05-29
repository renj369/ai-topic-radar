import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const configPath = path.join(rootDir, "config", "sources.json");
const outputPath = path.join(rootDir, "public", "data", "digest.json");
const execFileAsync = promisify(execFile);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  htmlEntities: true,
  trimValues: false
});

const config = JSON.parse(await fs.readFile(configPath, "utf8"));

function text(value) {
  if (value == null) return "";
  return String(value)
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function getContent(entry) {
  const content = entry?.content;
  if (typeof content === "string") return content;
  if (content?.["#text"]) return content["#text"];
  if (content?.["__cdata"]) return content["__cdata"];
  return "";
}

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "ai-topic-radar/0.1"
      }
    });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.text();
  } catch (error) {
    const { stdout } = await execFileAsync("curl", ["-fsSL", "--max-time", "30", url], {
      maxBuffer: 20 * 1024 * 1024
    });
    if (!stdout) throw error;
    return stdout;
  }
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function normalizeKey(item) {
  const base = item.url || item.title || "";
  return base.toLowerCase().replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\W+/g, "");
}

function cleanTitle(title) {
  return text(title).replace(/\s*⭐️?\s*\d+(\.\d+)?\/10\s*$/i, "").trim();
}

function classifyAngle(title, summary, sourceType) {
  const haystack = `${title} ${summary}`.toLowerCase();
  if (/融资|估值|revenue|funding|valuation|ipo|收购|并购/.test(haystack)) return "资本与公司格局";
  if (/nvidia|gpu|芯片|算力|semiconductor|asic|tpu|h100|b200|blackwell/.test(haystack)) return "算力与芯片";
  if (/监管|法院|版权|政策|eu|gpa/i.test(haystack)) return "监管与风险";
  if (/open source|开源|github|hugging face|model release|weights/.test(haystack)) return "开源生态";
  if (/agent|coding|developer|codex|claude code|cursor|编程/.test(haystack)) return "AI 编程与 Agent";
  if (sourceType === "podcast") return "播客观点";
  return "产业动态";
}

function topicReason(item) {
  const angle = classifyAngle(item.title, item.summary, item.sourceType);
  const sourceBoost = item.sourceType === "horizon"
    ? "上游已经给出较高评分，适合先看。"
    : item.sourceType === "radar"
      ? "来自 24 小时 AI 信号池，适合作为候选线索。"
      : "播客内容适合挖观点和人物判断。";
  return `${angle}方向；${sourceBoost}`;
}

function makeSummary(item) {
  if (item.summary) return item.summary;
  if (item.sourceType === "radar") {
    const reason = item.raw?.ai_relevance_reason || "AI 相关信号";
    return `这条来自 AI News Radar 的强相关信号，当前系统判断为 ${reason}。需要点开原文确认细节和可用角度。`;
  }
  if (item.sourceType === "podcast") {
    return "这是一条 AI 相关播客节目线索，适合先看标题和节目简介，后续可补转写稿再判断是否值得做视频。";
  }
  return "上游源提供了这条 AI 产业线索，建议点开原文做二次确认。";
}

function scoreItem(item, weights) {
  const base = Number(item.score || 0);
  const sourceWeight = weights[item.sourceType] || 0;
  let score = base + sourceWeight;
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  if (/openai|anthropic|deepmind|google|meta|nvidia|microsoft|xai|mistral|perplexity/.test(haystack)) score += 0.9;
  if (/融资|估值|监管|芯片|算力|agent|模型|开源|copyright|policy|funding|valuation/.test(haystack)) score += 0.8;
  if (/发布|上线|release|launch|announc/.test(haystack)) score += 0.4;
  if (/活动|读书会|公示|入选|榜单|课程|直播预告|大会报名|招聘|观点征集/.test(haystack)) score -= 2.2;
  if (/工具合集|prompt|教程|how to|指南|小技巧/.test(haystack)) score -= 1.2;
  return Math.max(0, Math.min(10, score));
}

function isAiIndustrySignal(item) {
  const haystack = `${item.title} ${item.summary} ${item.sourceName}`.toLowerCase();
  return /ai|人工智能|大模型|模型|llm|openai|anthropic|claude|gemini|deepmind|nvidia|英伟达|gpu|芯片|算力|agent|机器人|智驾|自动驾驶|hugging face|mistral|perplexity|xai|字节跳动|高通|meta/.test(haystack);
}

async function loadHorizon() {
  const xml = await fetchText(config.horizon.feedZh);
  const feed = parser.parse(xml)?.feed;
  const entries = Array.isArray(feed?.entry) ? feed.entry : [feed?.entry].filter(Boolean);
  const latest = entries[0];
  const html = getContent(latest);
  const sections = [...html.matchAll(/<h2[^>]*>[\s\S]*?<a href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?⭐️\s*([\d.]+)\/10[\s\S]*?<\/h2>\s*<p>([\s\S]*?)<\/p>/g)];

  return sections.map((match, index) => ({
    id: `horizon-${index + 1}-${normalizeKey({ url: match[1], title: match[2] })}`,
    sourceType: "horizon",
    sourceName: "Horizon",
    title: cleanTitle(match[2]),
    url: match[1],
    summary: text(match[4]),
    score: Number(match[3]),
    publishedAt: latest?.updated || feed?.updated || new Date().toISOString(),
    raw: { entryTitle: text(latest?.title) }
  }));
}

async function loadRadar() {
  const data = await fetchJson(config.radar.latest24h);
  const items = Array.isArray(data.items) ? data.items : [];
  return items.slice(0, 80).map((item) => ({
    id: `radar-${item.id || normalizeKey(item)}`,
    sourceType: "radar",
    sourceName: item.source || item.site_name || "AI News Radar",
    title: cleanTitle(item.title_zh || item.title_bilingual || item.title || item.title_original),
    url: item.url,
    summary: "",
    score: Math.min(10, Number(item.ai_score || 0) * 10),
    publishedAt: item.published_at || item.first_seen_at,
    raw: item
  }));
}

async function loadPodcasts() {
  const enabled = (config.podcasts || []).filter((feed) => feed.enabled);
  const all = [];
  for (const feedConfig of enabled) {
    try {
      const xml = await fetchText(feedConfig.url);
      const parsed = parser.parse(xml);
      const channel = parsed?.rss?.channel;
      const items = Array.isArray(channel?.item) ? channel.item : [channel?.item].filter(Boolean);
      for (const item of items.slice(0, 20)) {
        all.push({
          id: `podcast-${normalizeKey({ url: item.link, title: item.title })}`,
          sourceType: "podcast",
          sourceName: feedConfig.name,
          title: cleanTitle(item.title),
          url: item.link,
          summary: text(item.description).slice(0, 180),
          score: 5.5,
          publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          raw: { feed: feedConfig.name }
        });
      }
    } catch (error) {
      all.push({
        id: `podcast-error-${feedConfig.name}`,
        sourceType: "podcast",
        sourceName: feedConfig.name,
        title: `${feedConfig.name} 抓取失败`,
        url: feedConfig.url,
        summary: error.message,
        score: 0,
        publishedAt: new Date().toISOString(),
        raw: { error: error.message }
      });
    }
  }
  return all;
}

function dedupe(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = normalizeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

const [horizonItems, radarItems, podcastItems] = await Promise.all([
  loadHorizon(),
  loadRadar(),
  loadPodcasts()
]);

const merged = dedupe([...horizonItems, ...radarItems, ...podcastItems])
  .map((item) => {
    const finalScore = scoreItem(item, config.weights);
    const summary = makeSummary(item);
    return {
      id: item.id,
      title: item.title,
      url: item.url,
      sourceType: item.sourceType,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      score: Number(finalScore.toFixed(1)),
      angle: classifyAngle(item.title, summary, item.sourceType),
      summary,
      topicReason: topicReason({ ...item, summary }),
      originalScore: item.score
    };
  })
  .filter(isAiIndustrySignal)
  .sort((a, b) => {
    const sourcePriority = { horizon: 3, radar: 2, podcast: 1 };
    return b.score - a.score
      || (sourcePriority[b.sourceType] || 0) - (sourcePriority[a.sourceType] || 0)
      || new Date(b.publishedAt) - new Date(a.publishedAt);
  });

const digest = {
  generatedAt: new Date().toISOString(),
  title: "今日 AI 产业选题 Top 20",
  description: "基于 AI News Radar、Horizon 和 AI 播客 RSS 的中文候选选题摘要。",
  sources: {
    horizon: horizonItems.length,
    radar: radarItems.length,
    podcast: podcastItems.length
  },
  items: merged.slice(0, 20),
  backlog: merged.slice(20, 60)
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(digest, null, 2), "utf8");
console.log(`Generated ${digest.items.length} top items at ${outputPath}`);
