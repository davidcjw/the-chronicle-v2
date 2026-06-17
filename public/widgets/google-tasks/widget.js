function formatDueDate(iso) {
  if (!iso) return null;
  const due = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diff = Math.round((dueDay - today) / 86400000);
  if (diff < 0)  return { label: "Overdue",  color: "#ef4444" };
  if (diff === 0) return { label: "Today",    color: "#f59e0b" };
  if (diff === 1) return { label: "Tomorrow", color: "#f59e0b" };
  return {
    label: due.toLocaleDateString("en-SG", { day: "numeric", month: "short" }),
    color: "#6b7280",
  };
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let cached = [];

function buildHTML(task) {
  const due = formatDueDate(task.dueDate);
  return `
    <div class="rem-item" data-id="${task.encodedId}">
      <button class="rem-check" data-id="${task.encodedId}" title="Mark complete">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
      <div class="rem-body">
        <span class="rem-name">${escHtml(task.name)}</span>
        <div class="rem-chips">
          <span class="rem-list-chip">${escHtml(task.list)}</span>
          ${due ? `<span class="rem-due" style="color:${due.color}">⏰ ${due.label}</span>` : ""}
        </div>
      </div>
      <button class="rem-delete" data-id="${task.encodedId}" title="Delete">✕</button>
    </div>`;
}

function repaint(listEl) {
  if (!cached.length) {
    listEl.innerHTML = `<p class="widget-empty">No pending tasks</p>`;
    return;
  }
  const groups = {};
  for (const t of cached) {
    (groups[t.list] ??= []).push(t);
  }
  const multiList = Object.keys(groups).length > 1;
  listEl.innerHTML = Object.entries(groups)
    .map(([list, items]) => `
      ${multiList ? `<div class="rem-group-label">${escHtml(list)}</div>` : ""}
      ${items.map(buildHTML).join("")}
    `)
    .join("");
}

export default {
  id: "google-tasks",
  title: "Reminders",
  icon: "✅",
  size: "normal",

  async load() {
    const res = await fetch("/api/gtasks");
    const data = await res.json();
    if (data.error === "not_authenticated" || data.error === "token_expired") {
      return { authRequired: true, authUrl: data.authUrl };
    }
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },

  render(data, el) {
    if (data.authRequired) {
      el.innerHTML = `<p class="widget-empty">Google Tasks not connected. <a href="${data.authUrl}">Authorize →</a></p>`;
      return;
    }

    if (data.error) {
      el.innerHTML = `<p class="widget-error">${escHtml(data.error)}</p>`;
      return;
    }

    cached = Array.isArray(data) ? data : [];

    el.innerHTML = `
      <style>
        .rem-item{display:flex;align-items:center;gap:.5rem;padding:.45rem 0;border-bottom:1px solid var(--border)}
        .rem-item:last-of-type{border-bottom:none}
        .rem-item.rem-completing{opacity:0;transform:translateX(8px);transition:opacity .3s,transform .3s}
        .rem-check{background:none;border:none;color:var(--text-muted);cursor:pointer;padding:0;flex-shrink:0;display:flex;align-items:center;transition:color .15s}
        .rem-check:hover{color:var(--accent)}
        .rem-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:.15rem}
        .rem-name{font-size:.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rem-chips{display:flex;align-items:center;gap:.3rem;flex-wrap:wrap}
        .rem-list-chip{font-size:.67rem;color:var(--text-muted)}
        .rem-due{font-size:.67rem}
        .rem-delete{background:none;border:none;color:var(--text-muted);font-size:.7rem;cursor:pointer;opacity:0;transition:opacity .15s;flex-shrink:0;padding:.1rem .2rem;border-radius:3px}
        .rem-item:hover .rem-delete{opacity:1}
        .rem-delete:hover{color:#f87171}
        .rem-group-label{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);padding:.5rem 0 .2rem}
        .rem-add-form{display:flex;gap:.4rem;padding-top:.6rem;border-top:1px solid var(--border);margin-top:.25rem}
        .rem-add-input{flex:1;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.35rem .6rem;color:var(--text);font-size:.825rem;outline:none}
        .rem-add-input:focus{border-color:var(--accent)}
        .rem-add-btn{background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:.35rem .7rem;font-size:.875rem;cursor:pointer}
        .rem-add-btn:hover{background:#818cf840}
      </style>
      <div class="rem-list"></div>
      <form class="rem-add-form">
        <input class="rem-add-input" placeholder="Add task…" autocomplete="off" />
        <button class="rem-add-btn" type="submit">+</button>
      </form>`;

    const listEl = el.querySelector(".rem-list");
    repaint(listEl);

    el.addEventListener("click", async (e) => {
      const check = e.target.closest(".rem-check");
      const del = e.target.closest(".rem-delete");

      if (check) {
        const id = check.dataset.id;
        const row = el.querySelector(`.rem-item[data-id="${id}"]`);
        row?.classList.add("rem-completing");
        setTimeout(() => {
          cached = cached.filter((t) => t.encodedId !== id);
          repaint(listEl);
        }, 300);
        fetch(`/api/gtasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: true }),
        }).catch(console.error);
      }

      if (del) {
        const id = del.dataset.id;
        const row = el.querySelector(`.rem-item[data-id="${id}"]`);
        row?.classList.add("rem-completing");
        setTimeout(() => {
          cached = cached.filter((t) => t.encodedId !== id);
          repaint(listEl);
        }, 300);
        fetch(`/api/gtasks/${id}`, { method: "DELETE" }).catch(console.error);
      }
    });

    const form = el.querySelector(".rem-add-form");
    const input = el.querySelector(".rem-add-input");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      input.value = "";

      const tempId = `temp-${Date.now()}`;
      cached.unshift({ encodedId: tempId, name, list: "My Tasks", dueDate: null, priority: 0 });
      repaint(listEl);

      try {
        const res = await fetch("/api/gtasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const task = await res.json();
        if (task.error) throw new Error(task.error);
        const idx = cached.findIndex((t) => t.encodedId === tempId);
        if (idx !== -1) cached[idx] = task;
      } catch {
        cached = cached.filter((t) => t.encodedId !== tempId);
      }
      repaint(listEl);
    });
  },
};
