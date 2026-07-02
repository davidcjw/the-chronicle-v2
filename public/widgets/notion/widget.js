// Notion Tasks — the dashboard renders one card per connected database (see
// instances()), each titled with the database's name. Backed by /api/notion/*.

const NOTION_COLORS = {
  red: "#ef4444", orange: "#f97316", yellow: "#eab308", green: "#22c55e",
  blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899", gray: "#6b7280",
  brown: "#92400e", default: "#6b7280",
};

function statusColor(options, name) {
  const opt = options.find((o) => o.name === name);
  return NOTION_COLORS[opt?.color] || NOTION_COLORS.default;
}

// Escape remote-derived text before interpolating into innerHTML (DOM XSS guard).
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function formatDueDate(iso) {
  if (!iso) return null;
  const due = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diff = Math.round((dueDay - today) / 86400000);

  if (diff < 0)  return { label: "Overdue",   color: "#ef4444" };
  if (diff === 0) return { label: "Today",     color: "#f59e0b" };
  if (diff === 1) return { label: "Tomorrow",  color: "#f59e0b" };
  return {
    label: due.toLocaleDateString("en-SG", { day: "numeric", month: "short" }),
    color: "#6b7280",
  };
}

function buildTaskHTML(t, statusOptions) {
  const color = statusColor(statusOptions, t.status);
  const opts = statusOptions
    .map(
      (s) => `<button class="status-opt ${s.name === t.status ? "status-opt--active" : ""}"
        data-task-id="${escHtml(t.id)}" data-status="${escHtml(s.name)}"
        style="--s:${NOTION_COLORS[s.color] || NOTION_COLORS.default}">
        <span class="s-dot"></span>${escHtml(s.name)}
      </button>`
    )
    .join("");

  const catChip = t.category
    ? `<span class="task-cat" style="background:${NOTION_COLORS[t.category.color] || NOTION_COLORS.default}22;color:${NOTION_COLORS[t.category.color] || NOTION_COLORS.default}">${escHtml(t.category.name)}</span>`
    : "";

  const due = formatDueDate(t.dueDate);
  const dueChip = due
    ? `<span class="task-due" style="color:${due.color}">⏰ ${due.label}</span>`
    : "";

  return `
    <div class="task-row" data-task-id="${escHtml(t.id)}">
      <div class="task-left">
        <span class="task-title">${escHtml(t.title)}</span>
        ${catChip || dueChip ? `<div class="task-meta-chips">${catChip}${dueChip}</div>` : ""}
      </div>
      <div class="task-actions">
        <div class="status-wrap">
          <button class="status-badge status-trigger"
            data-task-id="${escHtml(t.id)}"
            style="background:${color}22;color:${color}">
            ${escHtml(t.status)}
          </button>
          <div class="status-menu hidden" data-task-id="${escHtml(t.id)}">${opts}</div>
        </div>
        <button class="task-archive" data-task-id="${t.id}" title="Archive">✕</button>
      </div>
    </div>`;
}

// Render one database's tasks into `el`. State (tasks, statusOptions, base URL)
// is local to this call so multiple Tasks cards never clash.
function renderTasks(el, data, base) {
  if (data.error) {
    el.innerHTML = `<p class="widget-error">${escHtml(data.error)}</p>`;
    return;
  }

  let tasks = data.tasks || [];
  const statusOptions = data.statusOptions || [];

  el.innerHTML = `
    <style>
      .task-row{display:flex;align-items:center;gap:.5rem;padding:.5rem 0;border-bottom:1px solid var(--border)}
      .task-row:last-of-type{border-bottom:none}
      .task-left{display:flex;flex-direction:column;gap:.2rem;flex:1;min-width:0}
      .task-title{font-size:.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
      .task-title:hover{color:var(--accent)}
      .task-title-edit{font-size:.875rem;background:var(--surface-2);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:.1rem .3rem;color:var(--text);outline:none;width:100%}
      .task-meta-chips{display:flex;gap:.3rem;flex-wrap:wrap}
      .task-cat{font-size:.68rem;font-weight:500;padding:.1rem .4rem;border-radius:999px}
      .task-due{font-size:.68rem}
      .task-actions{display:flex;align-items:center;gap:.3rem;flex-shrink:0}
      .status-wrap{position:relative}
      .status-trigger{font-size:.7rem;font-weight:500;padding:.2rem .5rem;border-radius:999px;cursor:pointer;border:none;white-space:nowrap}
      .status-menu{position:absolute;right:0;top:calc(100% + 4px);background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);min-width:130px;z-index:100;box-shadow:0 4px 16px #0008;overflow:hidden}
      .status-menu.hidden{display:none}
      .status-opt{display:flex;align-items:center;gap:.4rem;width:100%;padding:.4rem .6rem;background:none;border:none;color:var(--text);font-size:.8rem;cursor:pointer;text-align:left}
      .status-opt:hover{background:var(--accent-dim)}
      .status-opt--active{color:var(--accent)}
      .s-dot{width:7px;height:7px;border-radius:50%;background:var(--s);flex-shrink:0}
      .task-archive{background:none;border:none;color:var(--text-muted);font-size:.75rem;cursor:pointer;opacity:0;transition:opacity .15s;padding:.1rem .25rem;border-radius:4px}
      .task-row:hover .task-archive{opacity:1}
      .task-archive:hover{color:#f87171}
      .task-add-form{display:flex;gap:.4rem;padding-top:.6rem;border-top:1px solid var(--border);margin-top:.25rem}
      .task-add-input{flex:1;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.35rem .6rem;color:var(--text);font-size:.825rem;outline:none}
      .task-add-input:focus{border-color:var(--accent)}
      .task-add-btn{background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:.35rem .7rem;font-size:.875rem;cursor:pointer}
      .task-add-btn:hover{background:#818cf840}
    </style>
    <div class="task-list"></div>
    <form class="task-add-form">
      <input class="task-add-input" placeholder="Add task…" autocomplete="off" />
      <button class="task-add-btn" type="submit">+</button>
    </form>`;

  const listEl = el.querySelector(".task-list");
  const repaint = () => {
    listEl.innerHTML = tasks.length
      ? tasks.map((t) => buildTaskHTML(t, statusOptions)).join("")
      : `<p class="widget-empty">No open tasks</p>`;
  };
  repaint();

  // ── Inline title edit ─────────────────────────────────────────
  el.addEventListener("click", (e) => {
    const titleEl = e.target.closest(".task-title");
    if (!titleEl || e.target.classList.contains("task-title-edit")) return;
    const taskId = titleEl.closest(".task-row").dataset.taskId;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const input = document.createElement("input");
    input.className = "task-title-edit";
    input.value = task.title;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const newTitle = input.value.trim();
      const span = document.createElement("span");
      span.className = "task-title";
      span.textContent = save && newTitle ? newTitle : task.title;
      input.replaceWith(span);
      if (save && newTitle && newTitle !== task.title) {
        task.title = newTitle;
        fetch(`${base}/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        }).catch(console.error);
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  });

  // ── Status change / archive ───────────────────────────────────
  el.addEventListener("click", async (e) => {
    const trigger = e.target.closest(".status-trigger");
    const opt = e.target.closest(".status-opt");
    const archive = e.target.closest(".task-archive");

    if (!trigger && !opt) {
      el.querySelectorAll(".status-menu").forEach((m) => m.classList.add("hidden"));
    }

    if (trigger) {
      const menu = el.querySelector(`.status-menu[data-task-id="${trigger.dataset.taskId}"]`);
      el.querySelectorAll(".status-menu").forEach((m) => m !== menu && m.classList.add("hidden"));
      menu?.classList.toggle("hidden");
      e.stopPropagation();
      return;
    }

    if (opt) {
      const { taskId, status } = opt.dataset;
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status === status) return;
      task.status = status;
      repaint();
      fetch(`${base}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(console.error);
      return;
    }

    if (archive) {
      const { taskId } = archive.dataset;
      tasks = tasks.filter((t) => t.id !== taskId);
      repaint();
      fetch(`${base}/tasks/${taskId}`, { method: "DELETE" }).catch(console.error);
    }
  });

  // ── Create ────────────────────────────────────────────────────
  const form = el.querySelector(".task-add-form");
  const input = el.querySelector(".task-add-input");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    input.value = "";

    const tempId = `temp-${Date.now()}`;
    const firstStatus =
      statusOptions.find((s) => !["done", "complete"].includes(s.name.toLowerCase()))?.name ||
      "Not started";
    tasks.unshift({ id: tempId, title, status: firstStatus, url: "#" });
    repaint();

    try {
      const res = await fetch(`${base}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const { task, error } = await res.json();
      if (error) throw new Error(error);
      const idx = tasks.findIndex((t) => t.id === tempId);
      if (idx !== -1) tasks[idx] = task;
    } catch {
      tasks = tasks.filter((t) => t.id !== tempId);
    }
    repaint();
  });

  // Close dropdowns on outside click
  document.addEventListener("click", () => {
    el.querySelectorAll(".status-menu").forEach((m) => m.classList.add("hidden"));
  });
}

// One Tasks card per connected database, titled with the database's name.
export async function instances() {
  let dbs = [];
  try {
    dbs = await (await fetch("/api/notion/databases")).json();
  } catch {
    dbs = [];
  }
  if (!Array.isArray(dbs)) dbs = [];
  return dbs.map((db) => {
    const base = `/api/notion/databases/${db.id}`;
    return {
      id: `notion__${db.id}`,
      title: db.name || "Tasks",
      icon: "✅",
      size: "normal",
      load: async () => (await fetch(`${base}/tasks`)).json(),
      render: (data, el) => renderTasks(el, data, base),
    };
  });
}
