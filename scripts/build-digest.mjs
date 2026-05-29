import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const configPath = path.join(rootDir, "config", "sources.json");
const outputPath = path.join(rootDir, "public", "data", "digest.json");
const historyDir = path.join(rootDir, "public", "history");
const execFileAsync = promisify(execFile);
const selectionSize = 30;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  htmlEntities: true,
  trimValues: false
});

const config = JSON.parse(await fs.readFile(configPath, "utf8"));

function shanghaiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayNumber(dateKey) {
  return Math.floor(new Date(`${dateKey}T00:00:00Z`).getTime() / 86400000);
}

function daysAgo(dateKey, todayKey) {
  return dayNumber(todayKey) - dayNumber(dateKey);
}

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

function getFieldValue(entry, ...keys) {
  for (const key of keys) {
    const value = entry?.[key];
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (value["#text"]) return String(value["#text"]);
    if (value["__cdata"]) return String(value["__cdata"]);
    if (value.href) return String(value.href);
  }
  return "";
}

function firstValidDate(...values) {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

async function fetchText(url) {
  try {
    const { stdout } = await execFileAsync("curl", ["-fsSL", "--max-time", "30", "-A", "ai-topic-radar/0.1", url], {
      maxBuffer: 20 * 1024 * 1024
    });
    if (stdout) return stdout;
  } catch {
    // Fall through to fetch for environments where curl is unavailable.
  }
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "ai-topic-radar/0.1"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.text();
  } catch (error) {
    throw error;
  }
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function normalizeKey(item) {
  if (item.sourceType === "waytoagi" && item.id) return item.id;
  if (item.sourceType === "podcast" && item.id) return item.id;
  const base = item.url || item.title || "";
  return base.toLowerCase().replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\W+/g, "");
}

function cleanTitle(title) {
  return text(title).replace(/\s*⭐️?\s*\d+(\.\d+)?\/10\s*$/i, "").trim();
}

function inferSummaryFromTitle(title) {
  return title.length > 80 ? title.slice(0, 80) : title;
}

function splitWaytoAGIDescription(description) {
  const clean = cleanTitle(description);
  const parts = clean.split(/(?<=[。！？!?])\s*/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      title: parts[0].replace(/[。！？!?]$/, ""),
      summary: parts.slice(1).join("")
    };
  }
  return {
    title: clean.length > 42 ? `${clean.slice(0, 42)}...` : clean,
    summary: clean
  };
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
    id: "practical",
    title: "贴身影响与工具更新",
    description: "小但有用的功能、工作流、开源工具和从业者会立刻想试的更新。",
    match: (item) => isPracticalSignal(item)
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
      : item.sourceType === "waytoagi"
        ? "来自 WaytoAGI 7 日工具/工作流更新，适合寻找贴身影响型选题。"
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
  if (item.sourceType === "waytoagi") {
    return item.summary || "这是一条 WaytoAGI 最近 7 天工具/工作流更新，适合判断是否能转成贴近从业者的实用选题。";
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
  const sourcePriority = { horizon: 4, radar: 3, waytoagi: 2, podcast: 1 };
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

async function loadWaytoAGI() {
  const data = await fetchJson(config.radar.waytoagi7d);
  const updates = Array.isArray(data.updates_7d) ? data.updates_7d : [];
  return updates.map((item, index) => {
    const parsed = splitWaytoAGIDescription(item.title);
    const isStrongTool = /codex|claude code|cursor|mcp|cli|agent|智能体|开源|skill|工作流|自动化|开发者|画板|效率/i.test(item.title);
    return {
      id: `waytoagi-${item.date || "unknown"}-${index}-${normalizeKey({ url: item.url, title: item.title })}`,
      sourceType: "waytoagi",
      sourceName: "WaytoAGI 7d",
      title: parsed.title,
      url: item.url || data.root_url,
      summary: parsed.summary || inferSummaryFromTitle(parsed.title),
      upstreamScore: isStrongTool ? 8.8 : 7.2,
      upstreamLabel: "workflow_update",
      sourceNote: "WaytoAGI 上游中文描述，未做事实核验",
      publishedAt: item.date ? `${item.date}T08:00:00+08:00` : data.generated_at || new Date().toISOString(),
      raw: item
    };
  });
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
      const limit = Number(feedConfig.limit || 12);
      const keywords = (feedConfig.includeKeywords || []).map((keyword) => keyword.toLowerCase());
      const filtered = keywords.length
        ? items.filter((item) => {
          const haystack = text(`${getFieldValue(item, "title")} ${getFieldValue(item, "description", "itunes:summary", "content:encoded")}`).toLowerCase();
          return keywords.some((keyword) => haystack.includes(keyword));
        })
        : items;
      for (const item of filtered.slice(0, limit)) {
        const title = cleanTitle(getFieldValue(item, "title"));
        const itemLink = getFieldValue(item, "link");
        const url = itemLink || feedConfig.website || feedConfig.url;
        const summary = text(getFieldValue(item, "description", "itunes:summary", "content:encoded")).slice(0, 360);
        const idKey = normalizeKey({ url: itemLink || "", title: `${feedConfig.name}-${title}` });
        all.push({
          id: `podcast-${idKey}`,
          sourceType: "podcast",
          sourceName: feedConfig.name,
          title,
          url,
          summary,
          upstreamScore: Number(feedConfig.priority || 6.5),
          upstreamLabel: "podcast_interview",
          sourceNote: feedConfig.language === "en"
            ? `英文播客 RSS 简介，暂未转写核验。${feedConfig.note || ""}`.trim()
            : `播客 RSS 简介，未做转写核验。${feedConfig.note || ""}`.trim(),
          publishedAt: firstValidDate(item.pubDate, item.published, item.updated),
          raw: {
            feed: feedConfig.name,
            feedUrl: feedConfig.url,
            website: feedConfig.website || "",
            language: feedConfig.language || ""
          }
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

function itemSearchText(item) {
  return `${item.title} ${item.summary || ""} ${item.sourceName} ${item.upstreamLabel || ""} ${item.raw?.ai_signals?.join(" ") || ""}`.toLowerCase();
}

function isPracticalSignal(item) {
  const h = item.searchText || itemSearchText(item);
  const label = item.upstreamLabel || "";
  const practicalTerms = /codex|claude code|cursor|replit|mcp|cli|插件|开源|工具|工作流|更新|上线|指南|skill|agent|智能体|画板|自动化|效率|开发者|office|浏览器|电脑|手机|mac|ios|搜索|集成|项目|github|repo|trending/.test(h);
  if (/developer_tool|agent_workflow|curated_hotlist|workflow_update/.test(label)) return true;
  if (/ai_product_update|model_release/.test(label) && practicalTerms) return true;
  return practicalTerms && !/融资|估值|营收|投资|资本|ipo/.test(h);
}

function isBigSignal(item) {
  const h = item.searchText || itemSearchText(item);
  return /horizon_daily_pick|model_release|research_paper|infra_compute|industry_business|openai|anthropic|claude|gpt|gemini|deepmind|nvidia|英伟达|芯片|算力|模型|世界模型|监管|政策|版权|ipo|上市|并购|收购|生态|平台|战略|马斯克|altman|黄仁勋|李飞飞/.test(`${item.upstreamLabel || ""} ${h}`);
}

function isDeepSignal(item) {
  const h = item.searchText || itemSearchText(item);
  if (/活动|公示|报名|招聘|课程|榜单|入选/.test(h)) return false;
  return /model_release|research_paper|ai_tech|infra_compute|agent_workflow|developer_tool|robotics|模型|路线|架构|评测|benchmark|agent|coding|codex|claude code|cuda|世界模型|机器人|芯片|算力|平台|生态|公司|创始人|马斯克|altman|黄仁勋|李飞飞/.test(`${item.upstreamLabel || ""} ${h}`);
}

function timeDecay(item, todayKey) {
  const age = Math.max(0, daysAgo(item.observedDate || todayKey, todayKey));
  if (age <= 0) return 1;
  if (age === 1) return 0.92;
  if (age === 2) return 0.84;
  if (age <= 4) return 0.7;
  if (age <= 7) return 0.58;
  if (age <= 14) return 0.42;
  return 0.28;
}

function heuristicScore(item, mode, todayKey) {
  const h = item.searchText || itemSearchText(item);
  let score = Number(item.upstreamScore || 0);
  if (item.sourceType === "horizon") score += 1.1;
  if (item.sourceType === "waytoagi") score += 0.4;
  if (item.sourceType === "podcast") score += mode.includes("podcast") ? 0.3 : 0.2;
  if (mode.includes("practical") || mode.includes("tools")) {
    if (/developer_tool|agent_workflow|curated_hotlist|workflow_update/.test(item.upstreamLabel || "")) score += 1.4;
    if (/ai_product_update/.test(item.upstreamLabel || "") && !isPracticalSignal(item)) score -= 2;
  }
  if (mode.includes("podcast")) {
    if (/transcript|timestamps?|chapters?|访谈|interview|对谈|founder|ceo|researcher|engineer|scientist|deepmind|openai|anthropic|nvidia|karpathy|jensen|altman|ilya|alphago|reinforcement|黄仁勋|马斯克/.test(h)) score += 0.8;
    if (/physics|history|economics|politics|philosophy/.test(h) && !/ai|agi|artificial intelligence|robot|llm|machine learning|nvidia/.test(h)) score -= 1.5;
  }
  if (isBigSignal(item)) score += mode.includes("briefing") || mode.includes("deep") ? 1.6 : 0.4;
  if (isPracticalSignal(item)) score += mode.includes("practical") || mode.includes("tools") ? 2.3 : 0.5;
  if (/codex|claude code|cursor|replit|mcp|cli|agent|智能体/.test(h)) score += 0.9;
  if (/融资|估值|营收|投资|资本/.test(h) && !/ipo|上市|openai|anthropic|xai|nvidia|英伟达|马斯克/.test(h)) score -= mode.includes("deep") ? 1.2 : 0.5;
  if (/活动|公示|报名|招聘|课程|榜单|入选/.test(h)) score -= 1.8;
  return Number(Math.max(0, Math.min(10, score * timeDecay(item, todayKey))).toFixed(2));
}

function selectionReason(item, mode) {
  const h = item.searchText || itemSearchText(item);
  if (mode.includes("podcast")) {
    if (/founder|ceo|researcher|engineer|scientist|karpathy|jensen|altman|ilya|黄仁勋|马斯克/.test(h)) return "人物或一线从业者访谈，适合提炼观点、路线判断和公司/人物选题。";
    if (/agent|llm|model|模型|芯片|gpu|infra|inference|coding|mcp/.test(h)) return "围绕技术路线或工程实践，适合补充深度解读素材。";
    return "播客线索适合先判断嘉宾和主题质量，后续可接转写稿做深挖。";
  }
  if (mode.includes("practical") || mode.includes("tools")) {
    if (/codex|claude code|cursor|replit|mcp|cli|agent|智能体/.test(h)) return "贴近开发者/从业者工作流，容易转成实用型播报选题。";
    return "属于工具、产品或工作流变化，适合判断普通技术受众是否会立刻关心。";
  }
  if (mode.includes("deep")) {
    if (/世界模型|cuda|芯片|算力|agent|模型|平台|生态|战略/.test(h)) return "背后有技术路线或产业结构变化，适合延展成深度主题。";
    return "可作为人物、公司或技术路线视频的新闻入口。";
  }
  if (/openai|anthropic|nvidia|英伟达|google|meta|马斯克|altman|黄仁勋/.test(h)) return "高识别度主体，容易获得播报点击与背景延展空间。";
  return "上游评分较高，且具备当天播报的新闻钩子。";
}

function buildSelection(id, title, description, items, mode, todayKey, limit = selectionSize) {
  const ranked = items
    .map((item) => ({
      ...item,
      selectionScore: heuristicScore(item, mode, todayKey),
      selectionReason: item.modelReason || selectionReason(item, mode)
    }))
    .sort((a, b) => b.selectionScore - a.selectionScore || compareByUpstream(a, b))
    .slice(0, limit);
  return {
    id,
    title,
    description,
    mode,
    count: ranked.length,
    items: ranked
  };
}

function buildBalancedSelection(id, title, description, items, mode, todayKey, limit = selectionSize, perSourceLimit = 6) {
  const ranked = items
    .map((item) => ({
      ...item,
      selectionScore: heuristicScore(item, mode, todayKey),
      selectionReason: item.modelReason || selectionReason(item, mode)
    }))
    .sort((a, b) => b.selectionScore - a.selectionScore || compareByUpstream(a, b));
  const grouped = new Map();
  for (const item of ranked) {
    if (!grouped.has(item.sourceName)) grouped.set(item.sourceName, []);
    grouped.get(item.sourceName).push(item);
  }
  const sources = Array.from(grouped.keys()).sort((a, b) => {
    const topA = grouped.get(a)[0];
    const topB = grouped.get(b)[0];
    return topB.selectionScore - topA.selectionScore || compareByUpstream(topA, topB);
  });
  const balanced = [];
  let round = 0;
  while (balanced.length < limit) {
    let added = false;
    for (const source of sources) {
      if (balanced.length >= limit) break;
      if (round >= perSourceLimit) continue;
      const item = grouped.get(source)[round];
      if (!item) continue;
      balanced.push(item);
      added = true;
    }
    if (!added) break;
    round += 1;
  }
  for (const item of ranked) {
    if (balanced.length >= limit) break;
    if (balanced.some((picked) => picked.id === item.id)) continue;
    balanced.push(item);
  }
  return {
    id,
    title,
    description,
    mode,
    count: balanced.length,
    items: balanced
  };
}

async function readHistoryItems(todayKey) {
  try {
    const files = await fs.readdir(historyDir);
    const recentFiles = files
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .filter((file) => {
        const dateKey = file.replace(".json", "");
        return dateKey !== todayKey && daysAgo(dateKey, todayKey) >= 0 && daysAgo(dateKey, todayKey) <= 30;
      });
    const snapshots = await Promise.all(recentFiles.map(async (file) => {
      const parsed = JSON.parse(await fs.readFile(path.join(historyDir, file), "utf8"));
      return Array.isArray(parsed.items) ? parsed.items : [];
    }));
    return snapshots.flat();
  } catch {
    return [];
  }
}

function dedupeForHistory(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = normalizeKey(item);
    const previous = byKey.get(key);
    if (!previous || Number(item.upstreamScore || 0) > Number(previous.upstreamScore || 0)) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

async function maybeRerankWithModel(selection, todayKey) {
  if (!process.env.OPENAI_API_KEY || process.env.AI_TOPIC_RERANK !== "1") {
    return { ...selection, rerank: { method: "script", enabled: false } };
  }
  const candidates = selection.items.slice(0, 80).map((item) => ({
    id: item.id,
    title: item.title,
    source: `${item.sourceType}/${item.sourceName}`,
    upstreamScore: item.upstreamScore,
    upstreamLabel: item.upstreamLabel,
    publishedAt: item.publishedAt,
    summary: item.summary
  }));
  const prompt = [
    "你是中文 AI 自媒体选题编辑。请从候选中选出最适合的 30 条。",
    "频道定位：AI 产业变化、技术路线、开发者工作流、人物/公司/生态深度解读。",
    "评审时不要只看大公司，也要保留对程序员和 AI 从业者有贴身影响的小功能、小工具、开源项目。",
    `今天日期：${todayKey}`,
    `栏目：${selection.title}`,
    `栏目目标：${selection.description}`,
    "只返回 JSON：{\"picks\":[{\"id\":\"...\",\"fitScore\":0-10,\"reason\":\"中文一句话\"}]}",
    JSON.stringify(candidates)
  ].join("\n\n");

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.1-mini",
        input: prompt,
        max_output_tokens: 4000,
        text: {
          format: {
            type: "json_schema",
            name: "topic_picks",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                picks: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      id: { type: "string" },
                      fitScore: { type: "number" },
                      reason: { type: "string" }
                    },
                    required: ["id", "fitScore", "reason"]
                  }
                }
              },
              required: ["picks"]
            },
            strict: true
          }
        }
      })
    });
    if (!res.ok) throw new Error(`OpenAI rerank failed: ${res.status}`);
    const data = await res.json();
    const rawText = data.output_text || data.output?.flatMap((part) => part.content || []).map((part) => part.text || "").join("") || "";
    const parsed = JSON.parse(rawText);
    const itemMap = new Map(selection.items.map((item) => [item.id, item]));
    const picks = parsed.picks
      .map((pick) => {
        const item = itemMap.get(pick.id);
        return item ? {
          ...item,
          selectionScore: Number(pick.fitScore || item.selectionScore || 0),
          selectionReason: pick.reason || item.selectionReason
        } : null;
      })
      .filter(Boolean)
      .slice(0, selectionSize);
    return {
      ...selection,
      count: picks.length,
      items: picks,
      rerank: { method: "openai", enabled: true, model: process.env.OPENAI_MODEL || "gpt-5.1-mini" }
    };
  } catch (error) {
    return {
      ...selection,
      rerank: { method: "script", enabled: false, error: error.message }
    };
  }
}

const todayKey = shanghaiDateKey();

const [horizonItems, radarItems, waytoagiItems, podcastItems] = await Promise.all([
  loadHorizon(),
  loadRadar(),
  loadWaytoAGI(),
  loadPodcasts()
]);

const merged = dedupe([...horizonItems, ...radarItems, ...waytoagiItems, ...podcastItems])
  .map((item) => {
    const summary = makeSummary(item);
    const searchText = itemSearchText({ ...item, summary });
    return {
      id: item.id,
      title: item.title,
      url: item.url,
      sourceType: item.sourceType,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      upstreamScore: Number((item.upstreamScore || 0).toFixed(1)),
      upstreamLabel: item.upstreamLabel,
      sourceNote: item.sourceNote || "",
      angle: classifyAngle(item.title, summary, item.sourceType),
      summary,
      topicReason: topicReason({ ...item, summary }),
      observedDate: todayKey,
      searchText
    };
  })
  .filter((item) => item.sourceType === "horizon" || item.sourceType === "waytoagi" || isAiIndustrySignal(item))
  .map((item) => ({
    ...item,
    categoryIds: categoryIdsFor(item)
  }))
  .sort(compareByUpstream);

const historyItems = await readHistoryItems(todayKey);
const rollingItems = dedupeForHistory([...merged, ...historyItems]).map((item) => ({
  ...item,
  searchText: item.searchText || itemSearchText(item)
}));

const todayItems = rollingItems.filter((item) => item.observedDate === todayKey);
const weekItems = rollingItems.filter((item) => daysAgo(item.observedDate || todayKey, todayKey) <= 7);
const monthItems = rollingItems.filter((item) => daysAgo(item.observedDate || todayKey, todayKey) <= 30);

let selections = [
  buildSelection(
    "today_briefing",
    "今日播报精选",
    "今天最适合做 10-15 分钟播报的信号：既看大事件，也看能吸引技术受众的变化。",
    todayItems.filter((item) => isBigSignal(item) || isPracticalSignal(item)),
    "today_briefing",
    todayKey
  ),
  buildSelection(
    "today_practical",
    "今日贴身影响",
    "小但重要的工具、功能、开源项目和工作流变化，优先看普通技术受众会不会马上关心。",
    todayItems.filter(isPracticalSignal),
    "today_practical",
    todayKey
  ),
  buildSelection(
    "horizon_watch",
    "Horizon 摘要观察",
    "单独查看 Horizon 中文日报条目。这个来源通常有中文摘要、背景说明和 0-10 分，适合评估上游 AI 摘要质量。",
    weekItems.filter((item) => item.sourceType === "horizon"),
    "horizon_watch",
    todayKey
  ),
  buildSelection(
    "waytoagi_watch",
    "WaytoAGI 7d 观察",
    "单独查看 WaytoAGI 最近一周工具/工作流内容。这里显示的是上游中文描述，适合看灵感，但需要点开原文核验。",
    weekItems.filter((item) => item.sourceType === "waytoagi"),
    "waytoagi_watch",
    todayKey
  ),
  buildBalancedSelection(
    "podcast_watch",
    "播客访谈观察",
    "单独查看 AI 访谈和播客线索。这里优先放高质量英文深访和少量中文聚合，后续接转写稿后可升级为深度选题库。",
    monthItems.filter((item) => item.sourceType === "podcast"),
    "podcast_watch",
    todayKey,
    selectionSize,
    6
  ),
  buildSelection(
    "week_deep",
    "本周深度选题",
    "过去 7 天适合延展成 20 分钟人物、公司、技术路线或生态格局视频的主题。",
    weekItems.filter(isDeepSignal),
    "week_deep",
    todayKey
  ),
  buildSelection(
    "week_tools",
    "本周工具爆点",
    "过去 7 天最值得技术受众关注的工具、项目和工作流更新。",
    weekItems.filter(isPracticalSignal),
    "week_tools",
    todayKey
  ),
  buildSelection(
    "month_top",
    "近30天高价值选题",
    "滚动保留近 30 天最值得回看和沉淀的选题库存，用于补选题和月度复盘。",
    monthItems.filter((item) => isDeepSignal(item) || isBigSignal(item) || isPracticalSignal(item)),
    "month_top",
    todayKey
  )
];

selections = await Promise.all(selections.map((selection) => maybeRerankWithModel(selection, todayKey)));

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
    items: items.slice(0, selectionSize)
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

for (const selection of selections) {
  for (const item of selection.items) {
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
    sourceCount: (config.podcasts || []).filter((feed) => feed.enabled).length,
    note: "播客源已接入开源中文 AI 播客聚合与多个高质量英文官方 RSS。当前摘要主要来自 RSS 简介，后续接转写稿后才能做更强的深度筛选。"
  },
  waytoagi: {
    totalLoaded: waytoagiItems.length,
    note: "WaytoAGI 7d 提供最近一周的 AI 工具、工作流和实践内容，适合贴身影响型选题。"
  }
};

const digest = {
  generatedAt: new Date().toISOString(),
  dateKey: todayKey,
  title: "AI 产业选题编辑台",
  description: "基于 AI News Radar、Horizon、WaytoAGI 7d 和 AI 播客 RSS 的中文候选选题摘要。默认脚本排序，可选低成本大模型评审。",
  sources: {
    horizon: horizonItems.length,
    radar: radarItems.length,
    waytoagi: waytoagiItems.length,
    podcast: podcastItems.length
  },
  sourceCoverage,
  categoryStats,
  selectionStats: selections.reduce((acc, selection) => {
    acc[selection.id] = selection.count;
    return acc;
  }, {}),
  selections,
  items: merged,
  categories,
  topItems: merged.slice(0, selectionSize)
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(historyDir, { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(digest, null, 2), "utf8");
await fs.writeFile(path.join(historyDir, `${todayKey}.json`), JSON.stringify({
  generatedAt: digest.generatedAt,
  dateKey: todayKey,
  items: merged
}, null, 2), "utf8");
console.log(`Generated ${digest.items.length} items, ${digest.selections.length} selections, ${digest.categories.length} categories at ${outputPath}`);
