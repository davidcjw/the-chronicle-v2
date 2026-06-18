// Dailies widget — a daily checklist. Items you do every day; once checked they
// hide until the next local day. Backed by /api/dailies.

let rootEl = null;
let items = [];
let showDone = false;
let midnightTimer = null;

const todayStr = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || res.statusText);
  return res.json();
}

// After local midnight, re-pull so yesterday's completed items reappear.
function scheduleMidnight() {
  if (midnightTimer) clearTimeout(midnightTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30);
  midnightTimer = setTimeout(
    () => window.dispatchEvent(new CustomEvent("chronicle:reload-widget", { detail: { id: "dailies" } })),
    next - now
  );
}

function row(item, done) {
  const el = document.createElement("div");
  el.className = "dl-row";

  const check = document.createElement("button");
  check.className = `dl-check${done ? " dl-check--on" : ""}`;
  check.title = done ? "Uncheck" : "Mark done for today";
  check.addEventListener("click", () => {
    const next = !done;
    item.lastDone = next ? todayStr() : null;
    draw();
    api("PATCH", `/api/dailies/${item.id}`, { done: next, date: todayStr() }).catch(() => draw());
  });

  const title = document.createElement("span");
  title.className = "dl-title";
  title.contentEditable = "true";
  title.spellcheck = false;
  title.textContent = item.title;
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
    }
  });
  title.addEventListener("blur", () => {
    const v = title.textContent.trim();
    if (v && v !== item.title) {
      item.title = v;
      api("PATCH", `/api/dailies/${item.id}`, { title: v }).catch(() => draw());
    } else {
      title.textContent = item.title;
    }
  });

  const del = document.createElement("button");
  del.className = "dl-del";
  del.title = "Remove daily";
  del.textContent = "✕";
  del.addEventListener("click", () => {
    items = items.filter((i) => i.id !== item.id);
    draw();
    api("DELETE", `/api/dailies/${item.id}`).catch(() => {});
  });

  el.append(check, title, del);
  return el;
}

function draw() {
  const today = todayStr();
  const pending = items.filter((i) => i.lastDone !== today);
  const done = items.filter((i) => i.lastDone === today);

  rootEl.innerHTML = `<style>
    .dl-list { display:flex; flex-direction:column; }
    .dl-row { display:flex; align-items:center; gap:0.6rem; padding:0.5rem 0; border-bottom:1px solid var(--border); }
    .dl-row:last-child { border-bottom:none; }
    .dl-check { width:20px; height:20px; flex-shrink:0; border:2px solid var(--text-muted); border-radius:50%; background:transparent; cursor:pointer; position:relative; transition:border-color 0.12s, background 0.12s; }
    .dl-check:hover { border-color:var(--accent); }
    .dl-check--on { border-color:var(--accent); background:var(--accent); }
    .dl-check--on::after { content:"✓"; position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:0.72rem; font-weight:700; color:#06231a; }
    .dl-title { flex:1; min-width:0; outline:none; font-size:0.875rem; line-height:1.35; word-break:break-word; }
    .dl-title:focus { background:var(--surface-2); border-radius:3px; }
    .dl-done .dl-title { color:var(--text-muted); text-decoration:line-through; }
    .dl-del { background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.72rem; opacity:0; flex-shrink:0; }
    .dl-row:hover .dl-del { opacity:0.55; }
    .dl-del:hover { opacity:1; color:#f87171; }
    .dl-empty { color:var(--text-muted); font-size:0.875rem; padding:0.6rem 0; }
    .dl-foot { margin-top:0.5rem; display:flex; justify-content:space-between; align-items:center; gap:0.5rem; }
    .dl-toggle { background:none; border:none; color:var(--text-muted); font-size:0.72rem; cursor:pointer; padding:0; }
    .dl-toggle:hover { color:var(--text-dim); }
    .dl-add { width:100%; margin-top:0.5rem; background:transparent; border:1px dashed var(--border); color:var(--text-muted); border-radius:6px; padding:0.4rem 0.6rem; font-size:0.8rem; box-sizing:border-box; }
    .dl-add:focus { outline:none; border-color:var(--accent); color:var(--text); }
  </style>`;

  const list = document.createElement("div");
  list.className = "dl-list";
  pending.forEach((i) => list.append(row(i, false)));
  if (showDone)
    done.forEach((i) => {
      const r = row(i, true);
      r.classList.add("dl-done");
      list.append(r);
    });
  rootEl.append(list);

  if (!pending.length && !showDone) {
    const p = document.createElement("p");
    p.className = "dl-empty";
    p.textContent = items.length
      ? "All done for today 🎉"
      : "No dailies yet — add something you do every day.";
    rootEl.append(p);
  }

  if (done.length) {
    const foot = document.createElement("div");
    foot.className = "dl-foot";
    const toggle = document.createElement("button");
    toggle.className = "dl-toggle";
    toggle.textContent = showDone ? "Hide done" : `✓ ${done.length} done today`;
    toggle.addEventListener("click", () => {
      showDone = !showDone;
      draw();
    });
    foot.append(toggle);
    rootEl.append(foot);
  }

  const add = document.createElement("input");
  add.className = "dl-add";
  add.placeholder = "+ Add a daily";
  add.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const v = add.value.trim();
    if (!v) return;
    add.value = "";
    api("POST", "/api/dailies", { title: v })
      .then((item) => {
        items.push(item);
        draw();
        rootEl.querySelector(".dl-add")?.focus();
      })
      .catch(() => draw());
  });
  rootEl.append(add);
}

export default {
  id: "dailies",
  title: "Dailies",
  icon: "🔁",
  size: "normal",
  async load() {
    return api("GET", "/api/dailies");
  },
  render(data, el) {
    rootEl = el;
    items = data.items || [];
    showDone = false;
    scheduleMidnight();
    draw();
  },
};
