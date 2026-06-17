// Kanban widget — user-defined columns and draggable cards. Backed by the local
// /api/kanban store (no external account). Avoids native alert/confirm/prompt.

let board = null;
let rootEl = null;
let refocusColId = null; // restore add-card focus after a re-render

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || res.statusText);
  return res.json();
}

const cardsIn = (colId) => board.cards.filter((c) => c.columnId === colId);

function saveColumns() {
  return api("PUT", "/api/kanban/columns", { columns: board.columns }).then((b) => {
    board = b;
    draw();
  });
}

function makeCard(card) {
  const el = document.createElement("div");
  el.className = "kb-card";
  el.draggable = true;
  el.dataset.id = card.id;

  const title = document.createElement("span");
  title.className = "kb-card-title";
  title.contentEditable = "true";
  title.spellcheck = false;
  title.textContent = card.title;
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
    }
  });
  title.addEventListener("blur", () => {
    const next = title.textContent.trim();
    if (next && next !== card.title) {
      card.title = next;
      api("PATCH", `/api/kanban/cards/${card.id}`, { title: next }).catch(() => draw());
    } else {
      title.textContent = card.title;
    }
  });

  const del = document.createElement("button");
  del.className = "kb-card-del";
  del.title = "Delete card";
  del.textContent = "✕";
  del.addEventListener("click", () => {
    board.cards = board.cards.filter((c) => c.id !== card.id);
    draw();
    api("DELETE", `/api/kanban/cards/${card.id}`).catch(() => {});
  });

  el.append(title, del);
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", card.id);
    e.dataTransfer.effectAllowed = "move";
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
  return el;
}

function makeColumn(col) {
  const colEl = document.createElement("div");
  colEl.className = "kb-col";

  // Header: editable title + count + delete
  const head = document.createElement("div");
  head.className = "kb-col-head";
  const titleInput = document.createElement("input");
  titleInput.className = "kb-col-title";
  titleInput.value = col.title;
  titleInput.addEventListener("change", () => {
    const v = titleInput.value.trim();
    if (v && v !== col.title) {
      col.title = v;
      saveColumns();
    } else {
      titleInput.value = col.title;
    }
  });
  const count = document.createElement("span");
  count.className = "kb-col-count";
  count.textContent = cardsIn(col.id).length || "";
  const del = document.createElement("button");
  del.className = "kb-col-del";
  del.title = "Delete column (cards move to the first column)";
  del.textContent = "✕";
  del.addEventListener("click", () => {
    if (board.columns.length <= 1) return; // keep at least one
    board.columns = board.columns.filter((c) => c.id !== col.id);
    saveColumns();
  });
  head.append(titleInput, count, del);

  // Card list (drop target)
  const list = document.createElement("div");
  list.className = "kb-cards";
  cardsIn(col.id).forEach((c) => list.append(makeCard(c)));
  list.addEventListener("dragover", (e) => {
    e.preventDefault();
    list.classList.add("drop-hover");
  });
  list.addEventListener("dragleave", () => list.classList.remove("drop-hover"));
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    list.classList.remove("drop-hover");
    const id = e.dataTransfer.getData("text/plain");
    const card = board.cards.find((c) => c.id === id);
    if (!card || card.columnId === col.id) return;
    board.cards = board.cards.filter((c) => c.id !== id);
    card.columnId = col.id;
    board.cards.push(card);
    draw();
    api("PATCH", `/api/kanban/cards/${id}`, { columnId: col.id }).catch(() => draw());
  });

  // Add-card input
  const add = document.createElement("input");
  add.className = "kb-add";
  add.placeholder = "+ Add card";
  add.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const v = add.value.trim();
    if (!v) return;
    add.value = "";
    refocusColId = col.id;
    api("POST", "/api/kanban/cards", { title: v, columnId: col.id })
      .then((card) => {
        board.cards.push(card);
        draw();
      })
      .catch(() => draw());
  });

  colEl.append(head, list, add);
  return colEl;
}

function draw() {
  rootEl.innerHTML = `<style>
    .kb-board { display:flex; gap:0.6rem; overflow-x:auto; height:100%; align-items:flex-start; padding-bottom:4px; }
    .kb-col { background:var(--bg); border:1px solid var(--border); border-radius:var(--radius-sm); width:190px; flex:0 0 auto; display:flex; flex-direction:column; max-height:100%; }
    .kb-col-head { display:flex; align-items:center; gap:0.3rem; padding:0.45rem 0.5rem 0.35rem; }
    .kb-col-title { flex:1; min-width:0; background:transparent; border:none; color:var(--text); font-weight:600; font-size:0.82rem; padding:2px 4px; border-radius:4px; }
    .kb-col-title:focus { outline:none; background:var(--surface-2); }
    .kb-col-count { font-size:0.68rem; color:var(--text-muted); background:var(--surface-2); border-radius:999px; padding:0 0.4rem; min-width:1rem; text-align:center; }
    .kb-col-del { background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.72rem; opacity:0; padding:0 2px; }
    .kb-col:hover .kb-col-del { opacity:0.6; }
    .kb-col-del:hover { opacity:1; color:var(--text); }
    .kb-cards { flex:1; overflow-y:auto; padding:0 0.45rem; display:flex; flex-direction:column; gap:0.35rem; min-height:30px; border-radius:6px; }
    .kb-cards.drop-hover { outline:1.5px dashed var(--accent); outline-offset:-2px; }
    .kb-card { background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:0.4rem 0.5rem; font-size:0.8rem; cursor:grab; display:flex; gap:0.35rem; align-items:flex-start; }
    .kb-card:active { cursor:grabbing; }
    .kb-card.dragging { opacity:0.4; }
    .kb-card-title { flex:1; outline:none; line-height:1.35; word-break:break-word; }
    .kb-card-title:focus { background:var(--surface-2); border-radius:3px; }
    .kb-card-del { background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.72rem; opacity:0; flex-shrink:0; padding:0; }
    .kb-card:hover .kb-card-del { opacity:0.55; }
    .kb-card-del:hover { opacity:1; color:#f87171; }
    .kb-add { margin:0.4rem; background:transparent; border:1px dashed var(--border); color:var(--text-muted); border-radius:6px; padding:0.35rem 0.5rem; font-size:0.78rem; }
    .kb-add:focus { outline:none; border-color:var(--accent); color:var(--text); }
    .kb-addcol { flex:0 0 auto; align-self:flex-start; background:transparent; border:1px dashed var(--border); color:var(--text-muted); border-radius:var(--radius-sm); padding:0.5rem 0.7rem; cursor:pointer; font-size:0.8rem; white-space:nowrap; }
    .kb-addcol:hover { border-color:var(--accent); color:var(--text); }
  </style>`;

  const boardEl = document.createElement("div");
  boardEl.className = "kb-board";
  board.columns.forEach((col) => boardEl.append(makeColumn(col)));

  const addCol = document.createElement("button");
  addCol.className = "kb-addcol";
  addCol.textContent = "+ Column";
  addCol.addEventListener("click", () => {
    board.columns.push({ id: "", title: "New column" });
    saveColumns();
  });
  boardEl.append(addCol);
  rootEl.append(boardEl);

  if (refocusColId) {
    const cols = board.columns.map((c) => c.id);
    const idx = cols.indexOf(refocusColId);
    const inputs = boardEl.querySelectorAll(".kb-add");
    if (idx >= 0 && inputs[idx]) inputs[idx].focus();
    refocusColId = null;
  }
}

export default {
  id: "kanban",
  title: "Kanban",
  icon: "🗂️",
  size: "wide",
  async load() {
    return api("GET", "/api/kanban");
  },
  render(data, el) {
    board = data;
    rootEl = el;
    draw();
  },
};
