// Quick-capture command palette (⌘K / Ctrl+K). Type a title, pick a destination
// (kanban board, Notion DB, Google Tasks, Reminders, or a calendar) and an optional
// due date, and it creates the item via that plugin's existing endpoints.

const LAST_DEST_KEY = "chronicle-quickadd-dest";

async function jget(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Build the list of places a new item can go, from whatever is active/connected.
async function buildDestinations() {
  const [plugins, boards, dbs, cals] = await Promise.all([
    jget("/api/plugins"),
    jget("/api/kanban/boards"),
    jget("/api/notion/databases"),
    jget("/api/calendar/writable"),
  ]);
  const active = new Set((plugins || []).map((p) => p.id));
  const dests = [];

  (boards || []).forEach((b) =>
    dests.push({ key: `kanban:${b.id}`, label: `🗂️ Kanban · ${b.name}`, type: "kanban", id: b.id, due: "optional" })
  );
  (dbs || []).forEach((d) =>
    dests.push({ key: `notion:${d.id}`, label: `✅ Notion · ${d.name}`, type: "notion", id: d.id, due: "none" })
  );
  if (active.has("google-tasks"))
    dests.push({ key: "gtasks", label: "✅ Google Tasks", type: "gtasks", due: "none" });
  if (active.has("apple-reminders"))
    dests.push({ key: "reminder", label: "🔔 Reminder", type: "reminder", due: "optional" });
  (cals || []).forEach((c) =>
    dests.push({ key: `calendar:${c.id}`, label: `📅 Calendar · ${c.name}`, type: "calendar", id: c.id, due: "required" })
  );

  return dests;
}

const toIso = (date, time) => new Date(`${date}T${time || "09:00"}:00`).toISOString();

// Create the item at the chosen destination.
async function createItem(dest, title, date, time) {
  const post = (url, body) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(
      async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || r.statusText);
        return r.json();
      }
    );

  switch (dest.type) {
    case "kanban": {
      const card = await post(`/api/kanban/boards/${dest.id}/cards`, { title });
      if (date)
        await fetch(`/api/kanban/boards/${dest.id}/cards/${card.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nextActionDue: date, nextActionDueTime: time || null }),
        });
      return;
    }
    case "notion":
      return void (await post(`/api/notion/databases/${dest.id}/tasks`, { title }));
    case "gtasks":
      return void (await post("/api/gtasks", { title }));
    case "reminder":
      return void (await post("/api/reminders", { name: title, dueDate: date ? toIso(date, time) : undefined }));
    case "calendar":
      if (!date) throw new Error("A calendar event needs a date.");
      return void (await post("/api/calendar/events", {
        calendarId: dest.id,
        summary: title,
        due: date,
        time: time || null,
      }));
  }
}

function injectStyles() {
  if (document.getElementById("cmd-styles")) return;
  const s = document.createElement("style");
  s.id = "cmd-styles";
  s.textContent = `
    #cmd-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:flex-start; justify-content:center; padding-top:14vh; z-index:2000; }
    .cmd { background:var(--surface); border:1px solid var(--border); border-radius:12px; width:min(520px,92vw); padding:1rem 1.1rem 1.1rem; box-shadow:0 20px 60px rgba(0,0,0,0.5); }
    .cmd-title-in { width:100%; background:var(--bg); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:1rem; padding:0.6rem 0.7rem; outline:none; box-sizing:border-box; }
    .cmd-title-in:focus { border-color:var(--accent); }
    .cmd-row { display:flex; gap:0.5rem; margin-top:0.6rem; }
    .cmd-field { display:flex; flex-direction:column; gap:0.2rem; flex:1; }
    .cmd-lab { font-size:0.68rem; color:var(--text-muted); font-weight:600; }
    .cmd-in { background:var(--bg); border:1px solid var(--border); border-radius:7px; color:var(--text); padding:0.4rem 0.5rem; font-size:0.82rem; font-family:inherit; }
    .cmd-in:focus { outline:none; border-color:var(--accent); }
    .cmd-in:disabled { opacity:0.4; }
    .cmd-foot { display:flex; align-items:center; gap:0.6rem; margin-top:0.9rem; }
    .cmd-status { flex:1; font-size:0.74rem; color:var(--text-muted); }
    .cmd-status.err { color:#f87171; }
    .cmd-btn { background:var(--surface-2); border:1px solid var(--border); color:var(--text); border-radius:7px; padding:0.45rem 0.9rem; font-size:0.82rem; cursor:pointer; }
    .cmd-btn:hover { border-color:var(--accent); }
    .cmd-add { background:var(--accent); border-color:var(--accent); color:#06231a; font-weight:600; }
    .cmd-hint { font-size:0.68rem; color:var(--text-muted); margin-top:0.5rem; }
  `;
  document.head.append(s);
}

let open = false;

async function openPalette() {
  if (open) return;
  open = true;
  injectStyles();

  const overlay = document.createElement("div");
  overlay.id = "cmd-overlay";
  const panel = document.createElement("div");
  panel.className = "cmd";
  overlay.append(panel);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    open = false;
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => e.target === overlay && close());

  const titleIn = document.createElement("input");
  titleIn.className = "cmd-title-in";
  titleIn.placeholder = "Add a task, event, reminder…";

  const dest = document.createElement("select");
  dest.className = "cmd-in";
  const dateIn = document.createElement("input");
  dateIn.type = "date";
  dateIn.className = "cmd-in";
  const timeIn = document.createElement("input");
  timeIn.type = "time";
  timeIn.className = "cmd-in";

  const fieldEl = (label, input) => {
    const f = document.createElement("div");
    f.className = "cmd-field";
    const l = document.createElement("span");
    l.className = "cmd-lab";
    l.textContent = label;
    f.append(l, input);
    return f;
  };

  const row = document.createElement("div");
  row.className = "cmd-row";
  row.append(fieldEl("Add to", dest), fieldEl("Date", dateIn), fieldEl("Time", timeIn));

  const status = document.createElement("div");
  status.className = "cmd-status";
  const cancel = document.createElement("button");
  cancel.className = "cmd-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", close);
  const add = document.createElement("button");
  add.className = "cmd-btn cmd-add";
  add.textContent = "Add";

  const foot = document.createElement("div");
  foot.className = "cmd-foot";
  foot.append(status, cancel, add);

  const hint = document.createElement("div");
  hint.className = "cmd-hint";
  hint.textContent = "Enter to add · Esc to close";

  panel.append(titleIn, row, foot, hint);
  document.body.append(overlay);
  titleIn.focus();

  // Populate destinations.
  const dests = await buildDestinations();
  if (!dests.length) {
    status.textContent = "No destinations available — connect a service in Settings.";
    add.disabled = true;
    return;
  }
  const last = localStorage.getItem(LAST_DEST_KEY);
  dests.forEach((d) => {
    const o = document.createElement("option");
    o.value = d.key;
    o.textContent = d.label;
    dest.append(o);
  });
  if (last && dests.some((d) => d.key === last)) dest.value = last;

  const current = () => dests.find((d) => d.key === dest.value) || dests[0];
  const syncDue = () => {
    const cap = current().due;
    const off = cap === "none";
    dateIn.disabled = off;
    timeIn.disabled = off;
    if (off) {
      dateIn.value = "";
      timeIn.value = "";
    }
  };
  dest.addEventListener("change", syncDue);
  syncDue();

  const submit = async () => {
    const title = titleIn.value.trim();
    if (!title) return;
    const d = current();
    add.disabled = true;
    status.classList.remove("err");
    status.textContent = "Adding…";
    try {
      await createItem(d, title, dateIn.value || "", timeIn.value || "");
      localStorage.setItem(LAST_DEST_KEY, d.key);
      close();
      window.dispatchEvent(new CustomEvent("chronicle:reload-dashboard"));
    } catch (err) {
      status.textContent = err.message;
      status.classList.add("err");
      add.disabled = false;
    }
  };
  add.addEventListener("click", submit);
  titleIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
}

// ⌘K / Ctrl+K to open.
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette();
  }
});

// A header button for discoverability.
function injectHeaderButton() {
  const actions = document.querySelector(".header-actions");
  if (!actions || document.getElementById("cmd-open-btn")) return;
  const btn = document.createElement("button");
  btn.id = "cmd-open-btn";
  btn.title = "Quick add";
  btn.innerHTML = `＋ Add <kbd class="cmd-kbd">⌘K</kbd>`;
  btn.addEventListener("click", openPalette);
  actions.insertBefore(btn, actions.firstChild);
}
injectHeaderButton();
