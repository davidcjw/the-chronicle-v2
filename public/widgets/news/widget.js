function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default {
  id: "news",
  title: "AI / ML News",
  icon: "🤖",
  size: "wide",

  async load() {
    const res = await fetch("/api/news");
    return res.json();
  },

  render(data, el) {
    if (data.error) {
      el.innerHTML = `<p class="widget-error">${data.error}</p>`;
      return;
    }
    if (!data.articles?.length) {
      el.innerHTML = `<p class="widget-empty">No articles found</p>`;
      return;
    }
    el.innerHTML = `<div class="news-grid">${data.articles
      .map(
        (a) => `
      <a class="news-item" href="${a.url}" target="_blank" rel="noopener">
        <div class="news-item-meta">
          <span class="news-source">${a.source}</span>
          <span class="news-time">${timeAgo(a.publishedAt)}</span>
        </div>
        <p class="news-title">${a.title}</p>
        <span class="news-arrow">↗</span>
      </a>`
      )
      .join("")}</div>`;
  },
};
