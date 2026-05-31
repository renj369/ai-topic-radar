const state = {
  digest: null,
  query: "",
  view: "selection",
  selectionId: "today_briefing",
  categoryId: "deep",
  showAll: false
};

const generatedAtEl = document.getElementById("generatedAt");
const itemCountEl = document.getElementById("itemCount");
const selectionCountEl = document.getElementById("selectionCount");
const categoryCountEl = document.getElementById("categoryCount");
const searchInputEl = document.getElementById("searchInput");
const showAllBtnEl = document.getElementById("showAllBtn");
const coverageEl = document.getElementById("coverage");
const selectionModeBtnEl = document.getElementById("selectionModeBtn");
const categoryModeBtnEl = document.getElementById("categoryModeBtn");
const selectionTabsEl = document.getElementById("selectionTabs");
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
    waytoagi: "WaytoAGI",
    podcast: "Podcast",
    rule: "规则"
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
    ["WaytoAGI 7d", `${coverage.waytoagi.totalLoaded} 条`, "一周工具、工作流、实践内容，适合贴身影响型选题"],
    ["Podcast", `${coverage.podcasts.totalLoaded} 条`, `${coverage.podcasts.mustWatchPeople || 0} 人白名单；人物命中、其他播客、全量池分开看`]
  ];
  coverageEl.innerHTML = "";
  for (const [title, value, copy] of rows) {
    const card = document.createElement("article");
    card.className = "coverage-card";
    card.innerHTML = `<span>${title}</span><strong>${value}</strong><p>${copy}</p>`;
    coverageEl.appendChild(card);
  }
}

function setView(view) {
  state.view = view;
  state.showAll = false;
  selectionModeBtnEl.classList.toggle("active", view === "selection");
  categoryModeBtnEl.classList.toggle("active", view === "category");
  selectionTabsEl.hidden = view !== "selection";
  categoryTabsEl.hidden = view !== "category";
  showAllBtnEl.textContent = view === "selection" ? "全部精选" : "全部频道";
  renderTabs();
  renderList();
}

function renderTabs() {
  selectionTabsEl.innerHTML = "";
  for (const selection of state.digest.selections) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab ${state.view === "selection" && !state.showAll && state.selectionId === selection.id ? "active" : ""}`;
    button.textContent = `${selection.title} ${selection.count}`;
    button.addEventListener("click", () => {
      state.selectionId = selection.id;
      state.showAll = false;
      setView("selection");
    });
    selectionTabsEl.appendChild(button);
  }

  categoryTabsEl.innerHTML = "";
  for (const category of state.digest.categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab ${state.view === "category" && !state.showAll && state.categoryId === category.id ? "active" : ""}`;
    button.textContent = `${category.title} ${category.count}`;
    button.addEventListener("click", () => {
      state.categoryId = category.id;
      state.showAll = false;
      setView("category");
    });
    categoryTabsEl.appendChild(button);
  }
}

function renderItem(item) {
  const node = itemTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".score").textContent = item.selectionScore != null
    ? `选题 ${item.selectionScore}/10`
    : `上游 ${item.upstreamScore}/10`;
  node.querySelector(".label").textContent = item.upstreamLabel || item.angle;
  node.querySelector(".source").textContent = sourceLabel(item);
  node.querySelector("h2").textContent = item.title;
  const note = node.querySelector(".note");
  note.textContent = item.sourceNote || "";
  note.hidden = !item.sourceNote;
  node.querySelector(".summary").textContent = item.summary;
  const relatedSignals = node.querySelector(".related-signals");
  if (item.relatedSignals?.length) {
    relatedSignals.hidden = false;
    const rows = item.relatedSignals.map((signal) => {
      const score = signal.upstreamScore != null ? ` · ${Number(signal.upstreamScore).toFixed(1)}` : "";
      const label = signal.upstreamLabel ? `<span>${signal.upstreamLabel}${score}</span>` : "";
      return `
        <div class="signal-row">
          <span class="signal-date">${signal.date || formatDate(signal.publishedAt)}</span>
          <span class="signal-source">${signal.sourceName || ""}</span>
          <a href="${signal.url}" target="_blank" rel="noopener noreferrer">${signal.title}</a>
          ${label}
        </div>
      `;
    }).join("");
    relatedSignals.innerHTML = `<div class="signal-table">${rows}</div>`;
  } else {
    relatedSignals.hidden = true;
    relatedSignals.innerHTML = "";
  }
  node.querySelector(".reason").textContent = item.selectionReason || item.topicReason || "";
  const link = node.querySelector(".read-link");
  link.href = item.url || "#";
  link.hidden = !item.url || item.relatedSignals?.length;
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
  const groups = state.view === "selection"
    ? (state.showAll ? state.digest.selections : state.digest.selections.filter((selection) => selection.id === state.selectionId))
    : (state.showAll ? state.digest.categories : state.digest.categories.filter((category) => category.id === state.categoryId));

  for (const group of groups) {
    const section = renderCategory(group);
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
  selectionCountEl.textContent = state.digest.selections.length;
  categoryCountEl.textContent = state.digest.categories.length;

  renderCoverage();
  setView("selection");
}

searchInputEl.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderList();
});

showAllBtnEl.addEventListener("click", () => {
  state.showAll = !state.showAll;
  showAllBtnEl.textContent = state.showAll
    ? (state.view === "selection" ? "当前精选" : "当前频道")
    : (state.view === "selection" ? "全部精选" : "全部频道");
  renderTabs();
  renderList();
});

selectionModeBtnEl.addEventListener("click", () => setView("selection"));
categoryModeBtnEl.addEventListener("click", () => setView("category"));

init().catch((error) => {
  generatedAtEl.textContent = "加载失败";
  newsListEl.innerHTML = `<div class="empty">${error.message}</div>`;
});
