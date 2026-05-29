const state = {
  digest: null,
  query: "",
  categoryId: "deep",
  showAll: false
};

const generatedAtEl = document.getElementById("generatedAt");
const itemCountEl = document.getElementById("itemCount");
const categoryCountEl = document.getElementById("categoryCount");
const sourceCountEl = document.getElementById("sourceCount");
const searchInputEl = document.getElementById("searchInput");
const showAllBtnEl = document.getElementById("showAllBtn");
const coverageEl = document.getElementById("coverage");
const categoryTabsEl = document.getElementById("categoryTabs");
const newsListEl = document.getElementById("newsList");
const itemTemplate = document.getElementById("itemTemplate");
const categoryTemplate = document.getElementById("categoryTemplate");

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function sourceLabel(item) {
  const map = {
    horizon: "Horizon",
    radar: "AI News Radar",
    podcast: "Podcast"
  };
  return `${map[item.sourceType] || item.sourceType} · ${item.sourceName}`;
}

function matchesQuery(item) {
  const query = state.query.trim().toLowerCase();
  const haystack = `${item.title} ${item.summary} ${item.upstreamLabel} ${item.sourceName}`.toLowerCase();
  return !query || haystack.includes(query);
}

function renderCoverage() {
  const coverage = state.digest.sourceCoverage;
  const rows = [
    ["AI News Radar", `${coverage.aiNewsRadar.totalLoaded} 条`, "广覆盖：模型、Agent、产品、基础设施、开发者工具、热门清单"],
    ["Horizon", `${coverage.horizon.totalLoaded} 条`, "少量高分：中文摘要、背景解释、0-10 分"],
    ["Podcast", `${coverage.podcasts.totalLoaded} 条`, "补充播客线索，后续接转写稿后更有价值"]
  ];
  coverageEl.innerHTML = "";
  for (const [title, value, copy] of rows) {
    const card = document.createElement("article");
    card.className = "coverage-card";
    card.innerHTML = `<span>${title}</span><strong>${value}</strong><p>${copy}</p>`;
    coverageEl.appendChild(card);
  }
}

function renderTabs() {
  categoryTabsEl.innerHTML = "";
  for (const category of state.digest.categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab ${!state.showAll && state.categoryId === category.id ? "active" : ""}`;
    button.textContent = `${category.title} ${category.count}`;
    button.addEventListener("click", () => {
      state.categoryId = category.id;
      state.showAll = false;
      renderTabs();
      renderList();
    });
    categoryTabsEl.appendChild(button);
  }
}

function renderItem(item) {
  const node = itemTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".score").textContent = `上游 ${item.upstreamScore}/10`;
  node.querySelector(".label").textContent = item.upstreamLabel || item.angle;
  node.querySelector(".source").textContent = sourceLabel(item);
  node.querySelector("h2").textContent = item.title;
  node.querySelector(".summary").textContent = item.summary;
  const link = node.querySelector(".read-link");
  link.href = item.url;
  return node;
}

function renderCategory(category) {
  const items = category.items.filter(matchesQuery);
  if (!items.length) return null;
  const section = categoryTemplate.content.firstElementChild.cloneNode(true);
  section.querySelector("h2").textContent = category.title;
  section.querySelector("p").textContent = category.description;
  section.querySelector(".category-count").textContent = `${items.length}/${category.count}`;
  const list = section.querySelector(".category-list");
  for (const item of items) {
    list.appendChild(renderItem(item));
  }
  return section;
}

function renderList() {
  newsListEl.innerHTML = "";
  const categories = state.showAll
    ? state.digest.categories
    : state.digest.categories.filter((category) => category.id === state.categoryId);

  for (const category of categories) {
    const section = renderCategory(category);
    if (section) newsListEl.appendChild(section);
  }

  if (!newsListEl.children.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "没有匹配的选题，换个关键词试试。";
    newsListEl.appendChild(empty);
  }
}

async function init() {
  const res = await fetch(`./data/digest.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`加载日报失败：${res.status}`);
  state.digest = await res.json();

  generatedAtEl.textContent = `更新于 ${formatDate(state.digest.generatedAt)}`;
  itemCountEl.textContent = state.digest.items.length;
  categoryCountEl.textContent = state.digest.categories.length;
  sourceCountEl.textContent = Object.values(state.digest.sources).reduce((sum, count) => sum + Number(count || 0), 0);

  renderCoverage();
  renderTabs();
  renderList();
}

searchInputEl.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderList();
});

showAllBtnEl.addEventListener("click", () => {
  state.showAll = !state.showAll;
  showAllBtnEl.textContent = state.showAll ? "当前频道" : "全部频道";
  renderTabs();
  renderList();
});

init().catch((error) => {
  generatedAtEl.textContent = "加载失败";
  newsListEl.innerHTML = `<div class="empty">${error.message}</div>`;
});
