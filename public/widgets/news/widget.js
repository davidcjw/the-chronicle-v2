function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Escape remote-derived text before interpolating into innerHTML (DOM XSS guard).
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Only allow http(s) URLs in href; reject javascript:/data:/etc.
function safeUrl(u) {
  try {
    const parsed = new URL(String(u), window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "#";
  } catch {
    return "#";
  }
}

export default {
  id: "news",
  title: "News",
  icon: "📰",
  size: "wide",

  async load() {
    const res = await fetch("/api/news");
    return res.json();
  },

  render(data, el) {
    if (data.error) {
      el.innerHTML = `<p class="widget-error">${escHtml(data.error)}</p>`;
      return;
    }
    if (!data.articles?.length) {
      el.innerHTML = `<p class="widget-empty">No articles found</p>`;
      return;
    }
    el.innerHTML = `<div class="news-grid">${data.articles
      .map(
        (a) => `
      <a class="news-item" href="${escHtml(safeUrl(a.url))}" target="_blank" rel="noopener">
        <div class="news-item-meta">
          <span class="news-source">${escHtml(a.source)}</span>
          <span class="news-time">${timeAgo(a.publishedAt)}</span>
        </div>
        <p class="news-title">${escHtml(a.title)}</p>
        <span class="news-arrow">↗</span>
      </a>`
      )
      .join("")}</div>`;
  },
};
