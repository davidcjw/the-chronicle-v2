function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

function threadBadge(count) {
  if (count === null) return "";
  if (count === 0)
    return `<span class="mr-badge mr-badge--clean" title="All threads resolved">✓ resolved</span>`;
  return `<span class="mr-badge mr-badge--warn" title="${count} unresolved thread${count > 1 ? "s" : ""}">${count} unresolved</span>`;
}

export default {
  id: "gitlab",
  title: "GitLab MRs",
  icon: "🔀",
  size: "normal",

  async load() {
    const res = await fetch("/api/gitlab/mrs");
    return res.json();
  },

  render(data, el) {
    if (data.error) {
      el.innerHTML = `<p class="widget-error">${data.error}</p>`;
      return;
    }
    if (!data.mrs?.length) {
      el.innerHTML = `<p class="widget-empty">No open MRs</p>`;
      return;
    }

    el.innerHTML = `
      <style>
        .mr-item { display:flex; flex-direction:column; gap:0.25rem; padding:0.55rem 0; border-bottom:1px solid var(--border); text-decoration:none; color:inherit; }
        .mr-item:last-child { border-bottom:none; }
        .mr-item:hover .mr-title { color:var(--accent); }
        .mr-top { display:flex; align-items:flex-start; justify-content:space-between; gap:0.5rem; }
        .mr-title { font-size:0.875rem; line-height:1.35; flex:1; }
        .mr-draft { font-size:0.7rem; color:var(--text-muted); font-weight:600; text-transform:uppercase; flex-shrink:0; }
        .mr-meta { display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; }
        .mr-project { font-size:0.72rem; color:var(--text-muted); }
        .mr-branch { font-size:0.7rem; background:var(--surface-2); color:var(--text-dim); padding:0.1rem 0.4rem; border-radius:4px; font-family:monospace; }
        .mr-age { font-size:0.72rem; color:var(--text-muted); margin-left:auto; }
        .mr-badge { font-size:0.7rem; font-weight:500; padding:0.15rem 0.45rem; border-radius:999px; flex-shrink:0; }
        .mr-badge--warn { background:#f59e0b22; color:#f59e0b; }
        .mr-badge--clean { background:#22c55e22; color:#22c55e; }
      </style>
      ${data.mrs
        .map(
          (mr) => `
        <a class="mr-item" href="${mr.url}" target="_blank" rel="noopener">
          <div class="mr-top">
            <span class="mr-title">${mr.title}</span>
            ${mr.draft ? '<span class="mr-draft">Draft</span>' : ""}
          </div>
          <div class="mr-meta">
            <span class="mr-project">${mr.project}</span>
            <span class="mr-branch">→ ${mr.targetBranch}</span>
            ${threadBadge(mr.unresolvedThreads)}
            <span class="mr-age">${timeAgo(mr.createdAt)}</span>
          </div>
        </a>`
        )
        .join("")}`;
  },
};
