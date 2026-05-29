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

const categoryDefs = [
  {
    id: "deep",
    title: "适合深度选题",
    description: "更适合拆解 AI 时代变化、技术路径、平台格局或人物判断的候选主题。",
    match: (item) => {
      const h = item.searchText;
      const label = item.upstreamLabel;
      if (/融资|估值|入选|榜单|活动|公示|读书会|大会报名|招聘/.test(h)) return false;
      return /model_release|agent_workflow|developer_tool|ai_tech|research_paper|infra_compute|robotics|模型|评测|benchmark|agent|coding|codex|claude code|cursor|开源|github|推理|inference|算力|芯片|机器人|world model|世界模型|平台|生态|战略|马斯克|altman|黄仁勋/.test(`${label} ${h}`);
    }
  },
  {
    id: "model_eval",
    title: "模型发布与评测",
    description: "模型发布、能力评测、benchmark、推理速度和模型路线变化。",
    match: (item) => /model_release|research_paper|模型|大模型|llm|claude|gpt-|gpt4|gemini|deepseek|qwen|llama|mistral|benchmark|评测|eval|推理|inference|tokens?\/秒/.test(`${item.upstreamLabel} ${item.searchText}`)
  },
  {
    id: "agent_dev",
    title: "Agent 与 AI 编程",
    description: "Agent 工作流、AI coding、开发者工具、代码助手和自动化系统。",
    match: (item) => /agent_workflow|developer_tool|agent|coding|codex|claude code|cursor|cline|copilot|devin|workflow|自动化|代码|编程|开发者/.test(`${item.upstreamLabel} ${item.searchText}`)
  },
  {
    id: "hot_projects",
    title: "爆款项目与开源生态",
    description: "GitHub 热门项目、突然火的工具、开源模型和开发者社区信号。",
    match: (item) => /curated_hotlist|github|trending|开源|open source|hugging face|项目|repo|repository|star|爆|火|prototype|futures lab/.test(`${item.upstreamLabel} ${item.searchText}`)
  },
  {
    id: "apps",
    title: "应用场景与产品",
    description: "AI 产品更新、行业应用、机器人、智驾和消费级场景。",
    match: (item) => /ai_product_update|robotics|产品|应用|场景|机器人|智驾|自动驾驶|汽车|教育|金融|医疗|办公|浏览器|搜索|app|release|上线/.test(`${item.upstreamLabel} ${item.searchText}`)
  },
  {
    id: "infra",
    title: "算力、芯片与基础设施",
    description: "GPU、芯片、数据中心、训练/推理基础设施和云平台变化。",
    match: (item) => /infra_compute|nvidia|英伟达|gpu|芯片|算力|semiconductor|asic|tpu|h100|b200|blackwell|cuda|数据中心|cloud|云|推理成本/.test(`${item.upstreamLabel} ${item.searchText}`)
  },
  {
    id: "company_strategy",
    title: "公司战略与平台格局",
    description: "大公司战略、平台绑定、生态合作、创始人观点和竞争格局。",
    match: (item) => /industry_business|openai|anthropic|google|deepmind|meta|microsoft|xai|perplexity|字节跳动|阿里|腾讯|百度|战略|合作|绑定|平台|生态|ceo|创始人|马斯克|altman|黄仁勋/.test(`${item.upstreamLabel} ${item.searchText}`)
  },
  {
    id: "capital",
    title: "资本、IPO 与并购",
    description: "融资、估值、IPO、并购和商业化信号，主要作为产业背景参考。",
    match: (item) => /融资|估值|ipo|收购|并购|funding|valuation|revenue|营收|投资|资本|上市/.test(item.searchText)
  },
  {
    id: "policy_safety",
    title: "监管、版权与安全",
    description: "政策、版权、模型安全、网络安全和合规风险。",
    match: (item) => /监管|政策|版权|法院|诉讼|安全|网络防御|cyber|safety|alignment|copyright|policy|eu|欧盟|合规|风险/.test(item.searchText)
  },
  {
    id: "podcast",
    title: "播客与人物观点",
    description: "播客、访谈、直播和适合提炼人物判断的观点线索。",
    match: (item) => item.sourceType === "podcast" || /podcast|播客|访谈|直播|对话|interview/.test(item.searchText)
  }
];

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

function isAiIndustrySignal(item) {
  const haystack = `${item.title} ${item.summary} ${item.sourceName}`.toLowerCase();
  return /ai|人工智能|大模型|模型|llm|openai|anthropic|claude|gemini|deepmind|nvidia|英伟达|gpu|芯片|算力|agent|机器人|智驾|自动驾驶|hugging face|mistral|perplexity|xai|字节跳动|高通|meta/.test(haystack);
}

function categoryIdsFor(item) {
  const ids = categoryDefs.filter((category) => category.match(item)).map((category) => category.id);
  if (!ids.length) ids.push("general");
  return ids;
}

function compareByUpstream(a, b) {
  const sourcePriority = { horizon: 3, radar: 2, podcast: 1 };
  return b.upstreamScore - a.upstreamScore
    || (sourcePriority[b.sourceType] || 0) - (sourcePriority[a.sourceType] || 0)
    || new Date(b.publishedAt) - new Date(a.publishedAt);
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
    upstreamScore: Number(match[3]),
    upstreamLabel: "horizon_daily_pick",
    publishedAt: latest?.updated || feed?.updated || new Date().toISOString(),
    raw: { entryTitle: text(latest?.title) }
  }));
}

async function loadRadar() {
  const data = await fetchJson(config.radar.latest24h);
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((item) => ({
    id: `radar-${item.id || normalizeKey(item)}`,
    sourceType: "radar",
    sourceName: item.source || item.site_name || "AI News Radar",
    title: cleanTitle(item.title_zh || item.title_bilingual || item.title || item.title_original),
    url: item.url,
    summary: "",
    upstreamScore: Math.min(10, Number(item.ai_score || 0) * 10),
    upstreamLabel: item.ai_label || "ai_signal",
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
          upstreamScore: 5.5,
          upstreamLabel: "podcast",
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
        upstreamScore: 0,
        upstreamLabel: "podcast_error",
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
    const summary = makeSummary(item);
    const searchText = `${item.title} ${summary} ${item.sourceName} ${item.raw?.ai_signals?.join(" ") || ""}`.toLowerCase();
    return {
      id: item.id,
      title: item.title,
      url: item.url,
      sourceType: item.sourceType,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      upstreamScore: Number((item.upstreamScore || 0).toFixed(1)),
      upstreamLabel: item.upstreamLabel,
      angle: classifyAngle(item.title, summary, item.sourceType),
      summary,
      topicReason: topicReason({ ...item, summary }),
      searchText
    };
  })
  .filter(isAiIndustrySignal)
  .map((item) => ({
    ...item,
    categoryIds: categoryIdsFor(item)
  }))
  .sort(compareByUpstream);

const generalCategory = {
  id: "general",
  title: "其他 AI 信号",
  description: "暂时无法归入明确频道，但仍被上游判断为 AI 相关。",
  match: (item) => item.categoryIds.includes("general")
};

const categories = [...categoryDefs, generalCategory].map((category) => {
  const items = merged
    .filter((item) => item.categoryIds.includes(category.id))
    .sort(compareByUpstream);
  return {
    id: category.id,
    title: category.title,
    description: category.description,
    count: items.length,
    items: items.slice(0, 20)
  };
}).filter((category) => category.count > 0);

const labelStats = merged.filter((item) => item.sourceType === "radar").reduce((acc, item) => {
  acc[item.upstreamLabel] = (acc[item.upstreamLabel] || 0) + 1;
  return acc;
}, {});

const categoryStats = categories.reduce((acc, category) => {
  acc[category.id] = category.count;
  return acc;
}, {});

for (const item of merged) {
  delete item.searchText;
}

for (const category of categories) {
  for (const item of category.items) {
    delete item.searchText;
  }
}

const sourceCoverage = {
  aiNewsRadar: {
    totalLoaded: radarItems.length,
    labels: labelStats,
    note: "AI News Radar 提供广覆盖 24 小时信号池，包含模型发布、Agent 工作流、AI 产品、热门清单、基础设施、开发者工具等 ai_label。"
  },
  horizon: {
    totalLoaded: horizonItems.length,
    note: "Horizon 每天从较小候选池中筛出少量高分条目，提供中文摘要、背景和 0-10 分。"
  },
  podcasts: {
    totalLoaded: podcastItems.length,
    note: "播客源目前是补充线索，后续需要接转写稿后才能做更强的深度筛选。"
  }
};

const digest = {
  generatedAt: new Date().toISOString(),
  title: "AI 产业选题分频道雷达",
  description: "基于 AI News Radar、Horizon 和 AI 播客 RSS 的中文候选选题摘要。排序优先尊重上游评分。",
  sources: {
    horizon: horizonItems.length,
    radar: radarItems.length,
    podcast: podcastItems.length
  },
  sourceCoverage,
  categoryStats,
  items: merged,
  categories,
  topItems: merged.slice(0, 20)
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(digest, null, 2), "utf8");
console.log(`Generated ${digest.items.length} items across ${digest.categories.length} categories at ${outputPath}`);
