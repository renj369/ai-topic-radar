const state = {
  digest: null,
  query: "",
  angle: ""
};

const generatedAtEl = document.getElementById("generatedAt");
const topCountEl = document.getElementById("topCount");
const sourceCountEl = document.getElementById("sourceCount");
const searchInputEl = document.getElementById("searchInput");
const angleSelectEl = document.getElementById("angleSelect");
const newsListEl = document.getElementById("newsList");
const itemTemplate = document.getElementById("itemTemplate");

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

function filteredItems() {
  const query = state.query.trim().toLowerCase();
  return state.digest.items.filter((item) => {
    const matchesAngle = !state.angle || item.angle === state.angle;
    const haystack = `${item.title} ${item.summary} ${item.topicReason} ${item.sourceName}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    return matchesAngle && matchesQuery;
  });
}

function renderAngles() {
  const angles = [...new Set(state.digest.items.map((item) => item.angle))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  angleSelectEl.innerHTML = '<option value="">全部方向</option>';
  for (const angle of angles) {
    const option = document.createElement("option");
    option.value = angle;
    option.textContent = angle;
    angleSelectEl.appendChild(option);
  }
}

function renderList() {
  const items = filteredItems();
  newsListEl.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "没有匹配的选题，换个关键词试试。";
    newsListEl.appendChild(empty);
    return;
  }

  for (const item of items) {
    const node = itemTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".score").textContent = `${item.score}/10`;
    node.querySelector(".angle").textContent = item.angle;
    node.querySelector(".source").textContent = sourceLabel(item);
    node.querySelector("h2").textContent = item.title;
    node.querySelector(".summary").textContent = item.summary;
    node.querySelector(".reason").textContent = item.topicReason;
    const link = node.querySelector(".read-link");
    link.href = item.url;
    newsListEl.appendChild(node);
  }
}

async function init() {
  const res = await fetch(`./data/digest.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`加载日报失败：${res.status}`);
  state.digest = await res.json();

  generatedAtEl.textContent = `更新于 ${formatDate(state.digest.generatedAt)}`;
  topCountEl.textContent = state.digest.items.length;
  sourceCountEl.textContent = Object.values(state.digest.sources).reduce((sum, count) => sum + Number(count || 0), 0);

  renderAngles();
  renderList();
}

searchInputEl.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderList();
});

angleSelectEl.addEventListener("change", (event) => {
  state.angle = event.target.value;
  renderList();
});

init().catch((error) => {
  generatedAtEl.textContent = "加载失败";
  newsListEl.innerHTML = `<div class="empty">${error.message}</div>`;
});
