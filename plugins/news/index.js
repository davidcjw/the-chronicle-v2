import Parser from "rss-parser";
import config from "../../dashboard.config.js";

const cfg = config.news || {};
const topics = cfg.topics?.length ? cfg.topics : ["artificial intelligence"];
const customFeeds = cfg.feeds || [];
const maxArticles = cfg.maxArticles || 10;

const parser = new Parser({ timeout: 8000 });

function googleNewsUrl(topic) {
  const q = encodeURIComponent(topic);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

export function parseItem(item, fallbackSource) {
  // Google News titles are "Article Title - Source Name"
  const parts = item.title?.split(" - ") ?? [];
  const source = parts.length > 1 ? parts.pop() : fallbackSource;
  const title = parts.join(" - ");

  return {
    title: title || item.title,
    source: source || fallbackSource || "Unknown",
    url: item.link,
    publishedAt: item.isoDate || item.pubDate || null,
    description: item.contentSnippet || null,
  };
}

export function mergeArticles(results, max) {
  const seen = new Set();
  return results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((a) => {
      if (!a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, max);
}

async function getNews(req, res) {
  try {
    const results = await Promise.allSettled([
      // One Google News RSS feed per topic
      ...topics.map((topic) =>
        parser.parseURL(googleNewsUrl(topic)).then((feed) =>
          feed.items.map((item) => parseItem(item, null))
        )
      ),
      // Custom RSS feeds
      ...customFeeds.map((url) =>
        parser.parseURL(url).then((feed) =>
          feed.items.map((item) => parseItem(item, feed.title))
        )
      ),
    ]);

    const articles = mergeArticles(results, maxArticles);

    res.json({ articles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default {
  id: "news",
  label: "AI/ML News",
  env: [], // no API key needed
  routes: [{ method: "GET", path: "/api/news", handler: getNews }],
};
