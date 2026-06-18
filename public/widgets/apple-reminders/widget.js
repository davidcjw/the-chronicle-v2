function formatDueDate(iso) {
  if (!iso) return null;
  const due = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diff = Math.round((dueDay - today) / 86400000);
  if (diff < 0)  return { label: "Overdue",  color: "#ef4444" };
  if (diff === 0) {
    const time = due.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false });
    return { label: time, color: "#f59e0b" };
  }
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

function buildHTML(reminder) {
  const due = formatDueDate(reminder.dueDate);
  const isHigh = reminder.priority > 0 && reminder.priority <= 4;
  return `
    <div class="rem-item" data-id="${reminder.encodedId}">
      <button class="rem-check" data-id="${reminder.encodedId}" title="Mark complete">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
      <div class="rem-body">
        <span class="rem-name">${escHtml(reminder.name)}</span>
        <div class="rem-chips">
          <span class="rem-list-chip">${escHtml(reminder.list)}</span>
          ${due ? `<span class="rem-due" style="color:${due.color}">⏰ ${due.label}</span>` : ""}
          ${isHigh ? `<span class="rem-priority">!</span>` : ""}
        </div>
      </div>
      <button class="rem-delete" data-id="${reminder.encodedId}" title="Delete">✕</button>
    </div>`;
}

function repaint(listEl) {
  if (!cached.length) {
    listEl.innerHTML = `<p class="widget-empty">No pending reminders</p>`;
    return;
  }
  // Group by list
  const groups = {};
  for (const r of cached) {
    (groups[r.list] ??= []).push(r);
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
  id: "apple-reminders",
  title: "Reminders",
  icon: "🔔",
  size: "normal",

  async load() {
    const res = await fetch("/api/reminders");
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  render(data, el) {
    if (data.error) {
      el.innerHTML = `<p class="widget-error">${data.error}</p>`;
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
        .rem-name{font-size:.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
        .rem-name:hover{color:var(--accent)}
        .rem-name-edit{font-size:.875rem;background:var(--surface-2);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:.1rem .3rem;color:var(--text);outline:none;width:100%}
        .rem-chips{display:flex;align-items:center;gap:.3rem;flex-wrap:wrap}
        .rem-list-chip{font-size:.67rem;color:var(--text-muted)}
        .rem-due{font-size:.67rem}
        .rem-priority{font-size:.67rem;font-weight:700;color:#ef4444}
        .rem-delete{background:none;border:none;color:var(--text-muted);font-size:.7rem;cursor:pointer;opacity:0;transition:opacity .15s;flex-shrink:0;padding:.1rem .2rem;border-radius:3px}
        .rem-item:hover .rem-delete{opacity:1}
        .rem-delete:hover{color:#f87171}
        .rem-group-label{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);padding:.5rem 0 .2rem}
        .rem-add-form{display:flex;flex-wrap:wrap;gap:.4rem;padding-top:.6rem;border-top:1px solid var(--border);margin-top:.25rem}
        .rem-add-input{flex:1;min-width:0;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.35rem .6rem;color:var(--text);font-size:.825rem;outline:none}
        .rem-add-input:focus{border-color:var(--accent)}
        .rem-add-due{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.35rem .5rem;color:var(--text-muted);font-size:.75rem;outline:none;cursor:pointer;width:100%}
        .rem-add-due:focus{border-color:var(--accent);color:var(--text)}
        .rem-add-due::-webkit-calendar-picker-indicator{filter:invert(0.5);cursor:pointer}
        .rem-add-btn{background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:.35rem .7rem;font-size:.875rem;cursor:pointer}
        .rem-add-btn:hover{background:#818cf840}
        .rem-add-list{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.35rem .5rem;color:var(--text-muted);font-size:.75rem;outline:none;cursor:pointer;flex:1;min-width:0}
        .rem-add-list:focus{border-color:var(--accent);color:var(--text)}
      </style>
      <div class="rem-list"></div>
      <form class="rem-add-form">
        <input class="rem-add-input" placeholder="Add reminder…" autocomplete="off" />
        <button class="rem-add-btn" type="submit">+</button>
        <select class="rem-add-list" title="Add to list"></select>
        <input class="rem-add-due" type="datetime-local" title="Due date &amp; time (optional)" />
      </form>`;

    const listEl = el.querySelector(".rem-list");
    repaint(listEl);

    // ── Inline edit ───────────────────────────────────────────────
    el.addEventListener("click", (e) => {
      const nameEl = e.target.closest(".rem-name");
      if (!nameEl || e.target.classList.contains("rem-name-edit")) return;
      const id = nameEl.closest(".rem-item").dataset.id;
      const reminder = cached.find((r) => r.encodedId === id);
      if (!reminder) return;

      const input = document.createElement("input");
      input.className = "rem-name-edit";
      input.value = reminder.name;
      nameEl.replaceWith(input);
      input.focus();
      input.select();

      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const newName = input.value.trim();
        const span = document.createElement("span");
        span.className = "rem-name";
        span.textContent = save && newName ? newName : reminder.name;
        input.replaceWith(span);
        if (save && newName && newName !== reminder.name) {
          reminder.name = newName;
          fetch(`/api/reminders/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName }),
          }).catch(console.error);
        }
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") finish(false);
      });
      input.addEventListener("blur", () => finish(true));
    });

    // ── Mark complete ─────────────────────────────────────────────
    el.addEventListener("click", async (e) => {
      const check = e.target.closest(".rem-check");
      const del = e.target.closest(".rem-delete");

      if (check) {
        const id = check.dataset.id;
        const row = el.querySelector(`.rem-item[data-id="${id}"]`);
        row?.classList.add("rem-completing");
        setTimeout(() => {
          cached = cached.filter((r) => r.encodedId !== id);
          repaint(listEl);
        }, 300);
        fetch(`/api/reminders/${id}`, {
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
          cached = cached.filter((r) => r.encodedId !== id);
          repaint(listEl);
        }, 300);
        fetch(`/api/reminders/${id}`, { method: "DELETE" }).catch(console.error);
      }
    });

    // ── Add reminder ──────────────────────────────────────────────
    const form = el.querySelector(".rem-add-form");
    const input = el.querySelector(".rem-add-input");
    const dueInput = el.querySelector(".rem-add-due");
    const listSelect = el.querySelector(".rem-add-list");

    // Populate the list picker. Remembers the last chosen list across reloads.
    const STORAGE_KEY = "rem-add-list";
    (async () => {
      try {
        const res = await fetch("/api/reminders/lists");
        if (!res.ok) return;
        const lists = await res.json();
        if (!Array.isArray(lists) || !lists.length) return;
        const saved = localStorage.getItem(STORAGE_KEY);
        const fallback = lists.find((l) => l.isDefault)?.title ?? lists[0].title;
        const selected = lists.some((l) => l.title === saved) ? saved : fallback;
        listSelect.innerHTML = lists
          .map((l) => `<option value="${escHtml(l.title)}"${l.title === selected ? " selected" : ""}>${escHtml(l.title)}</option>`)
          .join("");
      } catch {
        /* leave picker empty; POST falls back to server default */
      }
    })();
    listSelect.addEventListener("change", () => {
      if (listSelect.value) localStorage.setItem(STORAGE_KEY, listSelect.value);
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      const dueDate = dueInput.value || null;
      const list = listSelect.value || null;
      input.value = "";
      dueInput.value = "";

      const tempId = `temp-${Date.now()}`;
      cached.unshift({ encodedId: tempId, name, list: list || "Reminders", dueDate, priority: 0 });
      repaint(listEl);

      const body = { name };
      if (list) body.list = list;
      if (dueDate) body.dueDate = new Date(dueDate).toISOString().replace(/\.\d{3}Z$/, "Z");

      try {
        const res = await fetch("/api/reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const reminder = await res.json();
        if (reminder.error) throw new Error(reminder.error);
        const idx = cached.findIndex((r) => r.encodedId === tempId);
        if (idx !== -1) cached[idx] = reminder;
      } catch {
        cached = cached.filter((r) => r.encodedId !== tempId);
      }
      repaint(listEl);
    });
  },
};
