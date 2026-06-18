// Kanban widget — the dashboard renders one card per board (see instances()).
// Each board has user-defined columns and draggable cards backed by the local
// /api/kanban store. Cards carry optional detail fields (next action, due date,
// notes) editable in a modal, and a due date can be pushed to a synced Google
// Calendar via /api/calendar/*. Avoids native alert/confirm/prompt.

const ICON = "🗂️";

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || res.statusText);
  return res.json();
}

const reloadDashboard = () => window.dispatchEvent(new CustomEvent("chronicle:reload-dashboard"));

// Ask the calendar widget (if present on the dashboard) to re-pull its events.
const refreshCalendarWidget = () =>
  window.dispatchEvent(new CustomEvent("chronicle:reload-widget", { detail: { id: "calendar" } }));

// --- instance discovery: one widget descriptor per board -------------------

export async function instances() {
  let boards = [];
  try {
    boards = await api("GET", "/api/kanban/boards");
  } catch {
    boards = [];
  }
  return boards.map((meta) => ({
    id: `kanban__${meta.id}`,
    title: meta.name,
    icon: ICON,
    size: "wide",
    w: 6, // half width so two boards sit side by side
    h: 8,
    editableTitle: true,
    onRename: (name) => api("PATCH", `/api/kanban/boards/${meta.id}`, { name }).catch(() => {}),
    headerActions: [
      { id: "add", label: "＋ Board", title: "Add a new board" },
      { id: "delete", label: "🗑", title: "Delete this board" },
    ],
    onHeaderAction: async (action) => {
      try {
        if (action === "add") await api("POST", "/api/kanban/boards", { name: "New board" });
        if (action === "delete") await api("DELETE", `/api/kanban/boards/${meta.id}`);
        reloadDashboard();
      } catch {
        /* e.g. deleting the last remaining board is rejected — leave the board as-is */
      }
    },
    load: () => api("GET", `/api/kanban/boards/${meta.id}`),
    render: (data, el) => renderBoard(el, data),
  }));
}

function renderBoard(rootEl, board) {
  draw({ rootEl, board, boardId: board.id, base: `/api/kanban/boards/${board.id}`, refocusColId: null });
}

// --- helpers (all take the per-instance state `st`) -------------------------

const cardsIn = (st, colId) => st.board.cards.filter((c) => c.columnId === colId);

function saveColumns(st) {
  return api("PUT", `${st.base}/columns`, { columns: st.board.columns }).then((b) => {
    st.board = b;
    draw(st);
  });
}

function patchCard(st, card, fields) {
  Object.assign(card, fields);
  return api("PATCH", `${st.base}/cards/${card.id}`, fields);
}

function dueInfo(due) {
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = due.split("-").map(Number);
  const diff = Math.round((new Date(y, m - 1, d) - today) / 86400000);
  if (diff < 0) return { label: `Overdue ${-diff}d`, cls: "kb-due-over" };
  if (diff === 0) return { label: "Due today", cls: "kb-due-soon" };
  if (diff === 1) return { label: "Due tomorrow", cls: "kb-due-soon" };
  if (diff <= 7) return { label: `Due in ${diff}d`, cls: "kb-due-soon" };
  return { label: `Due in ${diff}d`, cls: "kb-due-far" };
}

function fmtDateAdded(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const eventSummary = (card) => (card.nextAction && card.nextAction.trim()) || card.title;

let writableCals = undefined; // shared cache across boards: undefined=unfetched, null=unavailable, []=none
async function getWritableCals() {
  if (writableCals !== undefined) return writableCals;
  try {
    writableCals = await api("GET", "/api/calendar/writable");
  } catch {
    writableCals = null;
  }
  return writableCals;
}

// --- card -------------------------------------------------------------------

function makeCard(st, card) {
  const el = document.createElement("div");
  el.className = "kb-card";
  el.draggable = true;
  el.dataset.id = card.id;

  const row = document.createElement("div");
  row.className = "kb-card-row";

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
      api("PATCH", `${st.base}/cards/${card.id}`, { title: next }).catch(() => draw(st));
    } else {
      title.textContent = card.title;
    }
  });

  const details = document.createElement("button");
  details.className = "kb-card-edit";
  details.title = "Card details";
  details.textContent = "⋯";
  details.addEventListener("click", () => openCardModal(st, card));

  const del = document.createElement("button");
  del.className = "kb-card-del";
  del.title = "Delete card";
  del.textContent = "✕";
  del.addEventListener("click", () => {
    st.board.cards = st.board.cards.filter((c) => c.id !== card.id);
    draw(st);
    if (card.calendar?.eventId) {
      const cid = encodeURIComponent(card.calendar.calendarId || "primary");
      api("DELETE", `/api/calendar/events/${card.calendar.eventId}?calendarId=${cid}`)
        .then(refreshCalendarWidget)
        .catch(() => {});
    }
    api("DELETE", `${st.base}/cards/${card.id}`).catch(() => {});
  });

  row.append(title, details, del);
  el.append(row);

  // Meta row: due badge, a 📅 mark when synced to Google, and a 📝 mark for notes.
  const info = dueInfo(card.nextActionDue);
  const hasNotes = !!(card.notes && card.notes.trim());
  if (info || card.calendar?.eventId || hasNotes) {
    const meta = document.createElement("div");
    meta.className = "kb-card-meta";
    if (info) {
      const badge = document.createElement("span");
      badge.className = `kb-due ${info.cls}`;
      badge.textContent = info.label;
      meta.append(badge);
    }
    if (card.calendar?.eventId) {
      const mark = document.createElement("span");
      mark.className = "kb-card-mark";
      mark.title = "On your calendar";
      mark.textContent = "📅";
      meta.append(mark);
    }
    if (hasNotes) {
      const mark = document.createElement("span");
      mark.className = "kb-card-mark";
      mark.title = "Has notes";
      mark.textContent = "📝";
      meta.append(mark);
    }
    el.append(meta);
  }

  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", card.id);
    e.dataTransfer.effectAllowed = "move";
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
  return el;
}

// --- card detail modal ------------------------------------------------------

function field(labelText, inputEl) {
  const wrap = document.createElement("label");
  wrap.className = "kbm-field";
  const lab = document.createElement("span");
  lab.className = "kbm-label";
  lab.textContent = labelText;
  wrap.append(lab, inputEl);
  return wrap;
}

function hint(text) {
  const p = document.createElement("p");
  p.className = "kbm-hint";
  p.textContent = text;
  return p;
}

async function openCardModal(st, card) {
  document.getElementById("kbm-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "kbm-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  const onEsc = (e) => {
    if (e.key === "Escape") {
      overlay.remove();
      document.removeEventListener("keydown", onEsc);
    }
  };
  document.addEventListener("keydown", onEsc);

  const modal = document.createElement("div");
  modal.className = "kbm";

  const head = document.createElement("div");
  head.className = "kbm-head";
  const h = document.createElement("h3");
  h.textContent = card.title;
  const x = document.createElement("button");
  x.className = "kbm-x";
  x.textContent = "✕";
  x.addEventListener("click", () => overlay.remove());
  head.append(h, x);

  const added = document.createElement("div");
  added.className = "kbm-added";
  added.textContent = `Added ${fmtDateAdded(card.dateAdded)}`;

  const nextAction = document.createElement("input");
  nextAction.type = "text";
  nextAction.className = "kbm-input";
  nextAction.placeholder = "What's the next action?";
  nextAction.value = card.nextAction || "";

  const dueDate = document.createElement("input");
  dueDate.type = "date";
  dueDate.className = "kbm-input";
  dueDate.value = card.nextActionDue || "";

  const dueTime = document.createElement("input");
  dueTime.type = "time";
  dueTime.className = "kbm-input";
  dueTime.value = card.nextActionDueTime || "";

  const dueRow = document.createElement("div");
  dueRow.className = "kbm-due-row";
  dueRow.append(field("Next action due date", dueDate), field("Time (optional)", dueTime));

  const notes = document.createElement("textarea");
  notes.className = "kbm-input kbm-notes";
  notes.placeholder = "Anything you want to remember about this card…";
  notes.rows = 4;
  notes.value = card.notes || "";

  const calSection = document.createElement("div");
  calSection.className = "kbm-cal";

  const status = document.createElement("div");
  status.className = "kbm-status";

  const foot = document.createElement("div");
  foot.className = "kbm-foot";
  const cancel = document.createElement("button");
  cancel.className = "kbm-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => overlay.remove());
  const saveBtn = document.createElement("button");
  saveBtn.className = "kbm-btn kbm-save";
  saveBtn.textContent = "Save";
  foot.append(cancel, saveBtn);

  modal.append(
    head,
    added,
    field("Next action", nextAction),
    dueRow,
    field("Notes", notes),
    calSection,
    status,
    foot
  );
  overlay.append(modal);
  document.body.append(overlay);

  const collect = () => ({
    nextAction: nextAction.value.trim(),
    notes: notes.value,
    nextActionDue: dueDate.value || null,
    nextActionDueTime: dueDate.value && dueTime.value ? dueTime.value : null,
  });

  const setStatus = (msg, isErr) => {
    status.textContent = msg || "";
    status.classList.toggle("err", !!isErr);
  };

  async function renderCal() {
    calSection.innerHTML = "";
    const cals = await getWritableCals();
    if (cals === null) {
      calSection.append(hint("Connect Google Calendar in Settings to add due dates to your calendar."));
      return;
    }
    if (!cals.length) {
      calSection.append(hint("No writable calendars are synced. Add one under Calendar IDs in Settings."));
      return;
    }

    if (card.calendar?.eventId) {
      const synced = document.createElement("div");
      synced.className = "kbm-synced";
      const calName = cals.find((c) => c.id === card.calendar.calendarId)?.name || "calendar";
      const label = document.createElement("span");
      label.append("✓ On ");
      const strong = document.createElement("strong");
      strong.textContent = calName;
      label.append(strong);
      synced.append(label);
      if (card.calendar.htmlLink) {
        const view = document.createElement("a");
        view.href = card.calendar.htmlLink;
        view.target = "_blank";
        view.rel = "noreferrer";
        view.className = "kbm-link";
        view.textContent = "View";
        synced.append(view);
      }
      const remove = document.createElement("button");
      remove.className = "kbm-btn kbm-mini";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        setStatus("Removing event…");
        try {
          const cid = encodeURIComponent(card.calendar.calendarId || "primary");
          await api("DELETE", `/api/calendar/events/${card.calendar.eventId}?calendarId=${cid}`);
          await patchCard(st, card, { calendar: null });
          setStatus("Removed from calendar.");
          refreshCalendarWidget();
          renderCal();
          draw(st);
        } catch (err) {
          setStatus(err.message, true);
        }
      });
      synced.append(remove);
      calSection.append(synced);
      return;
    }

    const picker = document.createElement("select");
    picker.className = "kbm-input kbm-select";
    cals.forEach((c) => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      picker.append(o);
    });
    const add = document.createElement("button");
    add.className = "kbm-btn kbm-mini";
    add.textContent = "Add to calendar";
    const refreshAddState = () => {
      add.disabled = !dueDate.value;
      add.title = dueDate.value ? "" : "Set a due date first";
    };
    refreshAddState();
    dueDate.addEventListener("input", refreshAddState);
    add.addEventListener("click", async () => {
      if (!dueDate.value) return;
      setStatus("Adding to calendar…");
      try {
        const f = collect();
        await patchCard(st, card, f);
        const ev = await api("POST", "/api/calendar/events", {
          calendarId: picker.value,
          summary: eventSummary(card),
          description: `Kanban: ${card.title}`,
          due: f.nextActionDue,
          time: f.nextActionDueTime,
        });
        await patchCard(st, card, { calendar: ev });
        setStatus("Added to your calendar.");
        refreshCalendarWidget();
        renderCal();
        draw(st);
      } catch (err) {
        setStatus(err.message, true);
      }
    });

    const row = document.createElement("div");
    row.className = "kbm-cal-row";
    row.append(field("Add due date to", picker), add);
    calSection.append(row);
  }

  saveBtn.addEventListener("click", async () => {
    setStatus("Saving…");
    try {
      const f = collect();
      const hadEvent = !!card.calendar?.eventId;
      await patchCard(st, card, f);
      if (card.calendar?.eventId) {
        const cid = encodeURIComponent(card.calendar.calendarId || "primary");
        if (!f.nextActionDue) {
          await api("DELETE", `/api/calendar/events/${card.calendar.eventId}?calendarId=${cid}`);
          await patchCard(st, card, { calendar: null });
        } else {
          const ev = await api("PATCH", `/api/calendar/events/${card.calendar.eventId}`, {
            calendarId: card.calendar.calendarId,
            summary: eventSummary(card),
            description: `Kanban: ${card.title}`,
            due: f.nextActionDue,
            time: f.nextActionDueTime,
          });
          await patchCard(st, card, { calendar: ev });
        }
      }
      if (hadEvent) refreshCalendarWidget();
      draw(st);
      overlay.remove();
      document.removeEventListener("keydown", onEsc);
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  renderCal();
  nextAction.focus();
}

// --- columns ----------------------------------------------------------------

function makeColumn(st, col) {
  const colEl = document.createElement("div");
  colEl.className = "kb-col";

  const head = document.createElement("div");
  head.className = "kb-col-head";
  const titleInput = document.createElement("input");
  titleInput.className = "kb-col-title";
  titleInput.value = col.title;
  titleInput.addEventListener("change", () => {
    const v = titleInput.value.trim();
    if (v && v !== col.title) {
      col.title = v;
      saveColumns(st);
    } else {
      titleInput.value = col.title;
    }
  });
  const count = document.createElement("span");
  count.className = "kb-col-count";
  count.textContent = cardsIn(st, col.id).length || "";
  const del = document.createElement("button");
  del.className = "kb-col-del";
  del.title = "Delete column (cards move to the first column)";
  del.textContent = "✕";
  del.addEventListener("click", () => {
    if (st.board.columns.length <= 1) return; // keep at least one
    st.board.columns = st.board.columns.filter((c) => c.id !== col.id);
    saveColumns(st);
  });
  head.append(titleInput, count, del);

  const list = document.createElement("div");
  list.className = "kb-cards";
  cardsIn(st, col.id).forEach((c) => list.append(makeCard(st, c)));
  list.addEventListener("dragover", (e) => {
    e.preventDefault();
    list.classList.add("drop-hover");
  });
  list.addEventListener("dragleave", () => list.classList.remove("drop-hover"));
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    list.classList.remove("drop-hover");
    const id = e.dataTransfer.getData("text/plain");
    const card = st.board.cards.find((c) => c.id === id);
    if (!card || card.columnId === col.id) return;
    st.board.cards = st.board.cards.filter((c) => c.id !== id);
    card.columnId = col.id;
    st.board.cards.push(card);
    draw(st);
    api("PATCH", `${st.base}/cards/${id}`, { columnId: col.id }).catch(() => draw(st));
  });

  const add = document.createElement("input");
  add.className = "kb-add";
  add.placeholder = "+ Add card";
  add.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const v = add.value.trim();
    if (!v) return;
    add.value = "";
    st.refocusColId = col.id;
    api("POST", `${st.base}/cards`, { title: v, columnId: col.id })
      .then((card) => {
        st.board.cards.push(card);
        draw(st);
      })
      .catch(() => draw(st));
  });

  colEl.append(head, list, add);
  return colEl;
}

// --- board toolbar (rename / add / delete) ----------------------------------

// --- draw -------------------------------------------------------------------

function draw(st) {
  st.rootEl.innerHTML = `<style>
    .kb-wrap { display:flex; flex-direction:column; height:100%; }
    .kb-board { display:flex; gap:0.6rem; overflow-x:auto; flex:1; align-items:flex-start; padding-bottom:4px; }
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
    .kb-card { background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:0.4rem 0.5rem; font-size:0.8rem; cursor:grab; display:flex; flex-direction:column; gap:0.3rem; }
    .kb-card:active { cursor:grabbing; }
    .kb-card.dragging { opacity:0.4; }
    .kb-card-row { display:flex; gap:0.35rem; align-items:flex-start; }
    .kb-card-title { flex:1; outline:none; line-height:1.35; word-break:break-word; }
    .kb-card-title:focus { background:var(--surface-2); border-radius:3px; }
    .kb-card-edit, .kb-card-del { background:none; border:none; color:var(--text-muted); cursor:pointer; opacity:0; flex-shrink:0; padding:0; line-height:1; }
    .kb-card-edit { font-size:0.95rem; }
    .kb-card-del { font-size:0.72rem; }
    .kb-card:hover .kb-card-edit { opacity:0.55; }
    .kb-card:hover .kb-card-del { opacity:0.55; }
    .kb-card-edit:hover { opacity:1; color:var(--text); }
    .kb-card-del:hover { opacity:1; color:#f87171; }
    .kb-card-meta { display:flex; align-items:center; gap:0.3rem; }
    .kb-due { font-size:0.66rem; font-weight:600; border-radius:999px; padding:0.05rem 0.4rem; }
    .kb-due-over { background:rgba(248,113,113,0.16); color:#f87171; }
    .kb-due-soon { background:rgba(245,158,11,0.16); color:#f59e0b; }
    .kb-due-far { background:var(--surface-2); color:var(--text-muted); }
    .kb-card-mark { font-size:0.6rem; opacity:0.7; }
    .kb-add { margin:0.4rem; background:transparent; border:1px dashed var(--border); color:var(--text-muted); border-radius:6px; padding:0.35rem 0.5rem; font-size:0.78rem; }
    .kb-add:focus { outline:none; border-color:var(--accent); color:var(--text); }
    .kb-addcol { flex:0 0 auto; align-self:flex-start; background:transparent; border:1px dashed var(--border); color:var(--text-muted); border-radius:var(--radius-sm); padding:0.5rem 0.7rem; cursor:pointer; font-size:0.8rem; white-space:nowrap; }
    .kb-addcol:hover { border-color:var(--accent); color:var(--text); }

    #kbm-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:1000; }
    .kbm { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm,10px); width:min(420px,92vw); max-height:88vh; overflow-y:auto; padding:1.1rem 1.2rem 1.2rem; box-shadow:0 18px 50px rgba(0,0,0,0.45); }
    .kbm-head { display:flex; align-items:flex-start; gap:0.5rem; }
    .kbm-head h3 { margin:0; flex:1; font-size:1rem; color:var(--text); word-break:break-word; }
    .kbm-x { background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.9rem; }
    .kbm-x:hover { color:var(--text); }
    .kbm-added { font-size:0.72rem; color:var(--text-muted); margin:0.15rem 0 0.9rem; }
    .kbm-field { display:flex; flex-direction:column; gap:0.25rem; margin-bottom:0.8rem; flex:1; }
    .kbm-label { font-size:0.72rem; color:var(--text-muted); font-weight:600; }
    .kbm-input { background:var(--bg); border:1px solid var(--border); border-radius:6px; color:var(--text); padding:0.4rem 0.5rem; font-size:0.82rem; font-family:inherit; }
    .kbm-input:focus { outline:none; border-color:var(--accent); }
    .kbm-notes { resize:vertical; min-height:3.5rem; line-height:1.45; }
    .kbm-select { cursor:pointer; }
    .kbm-due-row { display:flex; gap:0.6rem; }
    .kbm-cal { border-top:1px solid var(--border); margin-top:0.2rem; padding-top:0.8rem; }
    .kbm-cal-row { display:flex; gap:0.5rem; align-items:flex-end; }
    .kbm-cal-row .kbm-field { margin-bottom:0; }
    .kbm-synced { display:flex; align-items:center; gap:0.5rem; font-size:0.8rem; color:var(--text); flex-wrap:wrap; }
    .kbm-link { color:var(--accent); font-size:0.76rem; text-decoration:none; }
    .kbm-link:hover { text-decoration:underline; }
    .kbm-hint { font-size:0.75rem; color:var(--text-muted); margin:0; line-height:1.4; }
    .kbm-status { font-size:0.74rem; color:var(--text-muted); min-height:1rem; margin-top:0.6rem; }
    .kbm-status.err { color:#f87171; }
    .kbm-foot { display:flex; justify-content:flex-end; gap:0.5rem; margin-top:0.9rem; }
    .kbm-btn { background:var(--surface-2); border:1px solid var(--border); color:var(--text); border-radius:6px; padding:0.4rem 0.8rem; font-size:0.8rem; cursor:pointer; }
    .kbm-btn:hover { border-color:var(--accent); }
    .kbm-btn:disabled { opacity:0.45; cursor:not-allowed; }
    .kbm-mini { padding:0.4rem 0.6rem; white-space:nowrap; }
    .kbm-save { background:var(--accent); border-color:var(--accent); color:#06231a; font-weight:600; }
  </style>`;

  const wrap = document.createElement("div");
  wrap.className = "kb-wrap";

  const boardEl = document.createElement("div");
  boardEl.className = "kb-board";
  st.board.columns.forEach((col) => boardEl.append(makeColumn(st, col)));

  const addCol = document.createElement("button");
  addCol.className = "kb-addcol";
  addCol.textContent = "+ Column";
  addCol.addEventListener("click", () => {
    st.board.columns.push({ id: "", title: "New column" });
    saveColumns(st);
  });
  boardEl.append(addCol);
  wrap.append(boardEl);
  st.rootEl.append(wrap);

  if (st.refocusColId) {
    const idx = st.board.columns.map((c) => c.id).indexOf(st.refocusColId);
    const inputs = boardEl.querySelectorAll(".kb-add");
    if (idx >= 0 && inputs[idx]) inputs[idx].focus();
    st.refocusColId = null;
  }
}
