// Dashboard engine — auto-discovers active plugins and renders draggable/resizable widgets.
// To add a widget: create plugins/<name>/index.js (backend) + public/widgets/<name>/widget.js (frontend).

const LAYOUT_KEY = "dashboard-layout";
const COLLAPSE_KEY = "dashboard-collapsed";

const refreshBtn = document.getElementById("refresh-btn");
const resetBtn = document.getElementById("reset-btn");

let grid;
const activeWidgets = new Map(); // id -> widget module, for targeted reloads

// Lets one widget ask another to re-pull (e.g. kanban adds a calendar event and
// wants the calendar widget to refresh) without reloading the whole dashboard.
window.addEventListener("chronicle:reload-widget", (e) => {
  const w = activeWidgets.get(e.detail?.id);
  if (w) loadWidget(w);
});

// Re-discover widgets and re-render the grid (e.g. a kanban board was added or
// removed, which changes how many cards exist).
window.addEventListener("chronicle:reload-dashboard", () => init(false));

// Inline-editable card titles. A widget opts in with `editableTitle: true` and an
// `onRename(newTitle)` callback; the title <h2> in its header becomes contenteditable.
function commitTitleEdit(h2) {
  const widget = activeWidgets.get(h2.dataset.rename);
  if (!widget?.onRename) return;
  const next = h2.textContent.trim();
  if (!next || next === widget.title) {
    h2.textContent = widget.title;
    return;
  }
  widget.title = next;
  widget.onRename(next);
}
document.addEventListener("focusout", (e) => {
  const h2 = e.target.closest?.("[data-rename]");
  if (h2) commitTitleEdit(h2);
});
document.addEventListener("keydown", (e) => {
  const h2 = e.target.closest?.("[data-rename]");
  if (h2 && e.key === "Enter") {
    e.preventDefault();
    h2.blur();
  }
});
// Clicking into the title must not start a gridstack drag (the header is the handle).
["pointerdown", "mousedown"].forEach((evt) =>
  document.addEventListener(evt, (e) => {
    if (e.target.closest?.("[data-rename]")) e.stopPropagation();
  }, true)
);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function setGreeting() {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  document.getElementById("greeting").textContent = greeting;
  document.getElementById("date-line").textContent = new Date().toLocaleDateString(
    "en-SG",
    { weekday: "long", year: "numeric", month: "long", day: "numeric" }
  );
}

// Default grid position per widget — users can override by dragging/resizing.
// A widget may carry an explicit { w, h } (e.g. kanban boards default to half-width
// so two sit side by side).
function defaultPos(widget) {
  if (widget.w && widget.h) return { w: widget.w, h: widget.h };
  return widget.size === "wide" ? { w: 12, h: 8 } : { w: 4, h: 7 };
}

function saveLayout() {
  const items = grid.save(false); // [{id, x, y, w, h}, ...]
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(items));
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return {};
    return Object.fromEntries(JSON.parse(raw).map((i) => [i.id, i]));
  } catch {
    return {};
  }
}

function clearLayout() {
  localStorage.removeItem(LAYOUT_KEY);
}

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}"); }
  catch { return {}; }
}

function saveCollapsed(state) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
}

function toggleCollapse(id) {
  const card = document.getElementById(`card-${id}`);
  const gsItem = card?.closest(".grid-stack-item");
  if (!card || !gsItem) return;

  const state = loadCollapsed();
  if (card.classList.contains("is-collapsed")) {
    const h = state[id] || 7;
    card.classList.remove("is-collapsed");
    grid.update(gsItem, { h, minH: 4 });
    delete state[id];
  } else {
    state[id] = parseInt(gsItem.getAttribute("gs-h")) || 7;
    card.classList.add("is-collapsed");
    grid.update(gsItem, { h: 1, minH: 1 });
  }
  saveCollapsed(state);
  saveLayout();
}

function cardHTML(widget) {
  return `
    <section class="card" id="card-${widget.id}">
      <div class="card-header" title="Drag to move">
        <span class="card-icon">${widget.icon}</span>
        <h2${widget.editableTitle ? ` contenteditable="true" spellcheck="false" data-rename="${widget.id}" title="Click to rename"` : ""}>${esc(widget.title)}</h2>
        <button class="card-collapse" data-id="${widget.id}" title="Collapse">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <polyline points="2,4 6,8 10,4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <span class="drag-hint">⠿</span>
      </div>
      <div class="card-body" id="body-${widget.id}">
        <div class="skeleton-list">
          <div class="skeleton"></div>
          <div class="skeleton"></div>
          <div class="skeleton"></div>
        </div>
      </div>
    </section>`;
}

async function loadWidget(widget) {
  const body = document.getElementById(`body-${widget.id}`);
  if (!body) {
    console.error(`[${widget.id}] body element not found in DOM`);
    return;
  }

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timed out after 10s")), 10000)
  );

  try {
    const data = await Promise.race([widget.load(), timeout]);
    widget.render(data, body);
  } catch (err) {
    console.error(`[${widget.id}] load failed:`, err);
    body.innerHTML = `<p class="widget-error">Failed to load: ${err.message}</p>`;
  }
}

async function init(resetPositions = false) {
  setGreeting();

  if (grid) {
    grid.removeAll(true); // remove widgets + their DOM, keep gridstack instance
  } else {
    const isMobile = () => window.innerWidth < 640;
    grid = GridStack.init({
      column: 12,
      columnOpts: {
        breakpointForWindow: true,
        layout: "compact",
        breakpoints: [{ w: 640, c: 1 }],
      },
      cellHeight: 60,
      animate: true,
      float: false,
      margin: 10,
      draggable: { handle: ".card-header" },
      resizable: { handles: "se, sw" },
      disableDrag: isMobile(),
      disableResize: isMobile(),
    }, "#grid");

    window.addEventListener("resize", () => {
      const mobile = isMobile();
      grid.setStatic(false);
      grid.enableMove(!mobile);
      grid.enableResize(!mobile);
    }, { passive: true });
    grid.on("change", saveLayout); // register once, not on every refresh
  }

  const activePlugins = await fetch("/api/plugins").then((r) => r.json());

  // A plugin's widget module normally has a single default export. It may instead
  // export an async `instances()` returning several widget descriptors (kanban
  // renders one card per board).
  const widgets = await Promise.all(
    activePlugins.map(async ({ id }) => {
      try {
        const mod = await import(`/widgets/${id}/widget.js`);
        if (typeof mod.instances === "function") return await mod.instances();
        return [mod.default];
      } catch {
        console.warn(`No frontend widget found for plugin: ${id}`);
        return [];
      }
    })
  );

  const validWidgets = widgets.flat().filter(Boolean);
  activeWidgets.clear();
  validWidgets.forEach((w) => activeWidgets.set(w.id, w));
  const saved = resetPositions ? {} : loadLayout();

  grid.batchUpdate();
  for (const widget of validWidgets) {
    const pos = saved[widget.id] ?? defaultPos(widget);
    const el = document.createElement("div");
    el.setAttribute("gs-id", widget.id);
    el.setAttribute("gs-w", pos.w);
    el.setAttribute("gs-h", pos.h);
    if (pos.x != null) el.setAttribute("gs-x", pos.x);
    if (pos.y != null) el.setAttribute("gs-y", pos.y);
    el.setAttribute("gs-min-w", 3);
    el.setAttribute("gs-min-h", 4);
    el.innerHTML = `<div class="grid-stack-item-content">${cardHTML(widget)}</div>`;
    grid.makeWidget(el);
  }
  grid.batchUpdate(false);

  // Compact if any previously saved widgets are no longer active
  const activeIds = new Set(validWidgets.map((w) => w.id));
  const hasMissing = Object.keys(saved).some((id) => !activeIds.has(id));
  if (hasMissing) {
    grid.compact();
    saveLayout(); // persist the compacted layout
  }

  // Re-apply collapsed state (after DOM exists)
  const collapseState = loadCollapsed();
  for (const widget of validWidgets) {
    if (!(widget.id in collapseState)) continue;
    const card = document.getElementById(`card-${widget.id}`);
    const gsItem = card?.closest(".grid-stack-item");
    if (!card || !gsItem) continue;
    card.classList.add("is-collapsed");
    grid.update(gsItem, { h: 1, minH: 1 });
  }

  // Load data in parallel
  await Promise.allSettled(validWidgets.map(loadWidget));
}

const themeSelect = document.getElementById("theme-select");

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("dashboard-theme", theme);
  themeSelect.value = theme;
}

themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));

// Set initial value on load
applyTheme(localStorage.getItem("dashboard-theme") ?? "nord");

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".card-collapse");
  if (btn) toggleCollapse(btn.dataset.id);
});

refreshBtn.addEventListener("click", () => init(false));
resetBtn.addEventListener("click", () => {
  clearLayout();
  init(true);
});

init();
