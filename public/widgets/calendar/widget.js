// Per-session filter state — empty = show all, non-empty = show only selected
const selectedCalendars = new Set();

// Remember the last calendar the user added an event to, so the picker defaults
// to it next time (mirrors the quick-add palette's behaviour).
const LAST_ADD_CAL_KEY = "chronicle-calendar-add-cal";

// The calendars the user can actually write to (owner/writer), for the add-event
// picker. Cached across opens; null until first fetched.
let writableCals = null;
async function getWritableCals() {
  if (writableCals) return writableCals;
  const r = await fetch("/api/calendar/writable", { cache: "no-store" });
  if (!r.ok) throw new Error("Could not load your calendars. Reconnect Google in Settings.");
  writableCals = await r.json();
  return writableCals;
}

function formatDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isToday = d.toDateString() === today.toDateString();
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const dayLabel = isToday
    ? "Today"
    : isTomorrow
    ? "Tomorrow"
    : d.toLocaleDateString("en-SG", { weekday: "short", month: "short", day: "numeric" });
  const timeLabel = iso.includes("T")
    ? d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })
    : "All day";
  return { dayLabel, timeLabel };
}

function renderList(events, listEl) {
  const visible = selectedCalendars.size
    ? events.filter((e) => selectedCalendars.has(e.calendarId))
    : events;
  if (!visible.length) {
    listEl.innerHTML = `<p class="widget-empty">No events for selected calendars</p>`;
    return;
  }
  listEl.innerHTML = visible
    .map((e) => {
      const { dayLabel, timeLabel } = formatDate(e.start);
      return `
      <a class="event-item" ${e.htmlLink ? `href="${e.htmlLink}" target="_blank" rel="noreferrer"` : ""}>
        <div class="event-meta">
          <span class="event-day">${dayLabel}</span>
          <span class="event-time">${timeLabel}</span>
        </div>
        <div class="event-body">
          <span class="event-cal-dot" style="background:${e.calendarColor}"></span>
          <span class="event-title">${e.title}</span>
        </div>
      </a>`;
    })
    .join("");
}

export default {
  id: "calendar",
  title: "Upcoming Events",
  icon: "📅",
  size: "normal",
  headerActions: [{ id: "add", label: "＋ Event", title: "Add event" }],

  // Toggle the inline add-event form (rendered hidden inside the widget body).
  onHeaderAction(actionId) {
    if (actionId !== "add" || !this._el) return;
    const form = this._el.querySelector(".cal-add");
    if (!form) return;
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector(".cal-add-title").focus();
  },

  async load() {
    const res = await fetch("/api/events");
    return res.json();
  },

  render(data, el) {
    if (data.error === "not_authenticated" || data.error === "token_expired") {
      el.innerHTML = `
        <div class="widget-auth">
          <p>Connect Google Calendar to see your events.</p>
          <a class="btn-auth" href="${data.authUrl}">Connect →</a>
        </div>`;
      return;
    }
    if (data.error) {
      el.innerHTML = `<p class="widget-error">${data.error}</p>`;
      return;
    }

    const calendars = data.calendars || [];

    el.innerHTML = `
      <style>
        .cal-filters { display:flex; flex-wrap:wrap; gap:0.4rem; padding-bottom:0.6rem; border-bottom:1px solid var(--border); margin-bottom:0.25rem; }
        .cal-chip { display:flex; align-items:center; gap:0.3rem; padding:0.2rem 0.55rem; border-radius:999px; border:1px solid var(--border); background:transparent; color:var(--text-muted); font-size:0.72rem; cursor:pointer; transition:background 0.15s, color 0.15s, border-color 0.15s; }
        .cal-chip:hover { border-color:var(--cal-color, var(--accent)); color:var(--text-dim); }
        .cal-chip--on { border-color:var(--cal-color, var(--accent)); background:color-mix(in srgb, var(--cal-color, var(--accent)) 15%, transparent); color:var(--text); }
        .cal-dot { width:7px; height:7px; border-radius:50%; background:var(--cal-color, var(--accent)); flex-shrink:0; }
        .event-body { display:flex; align-items:center; gap:0.4rem; flex:1; min-width:0; }
        .event-cal-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
        .event-title { font-size:0.875rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        a.event-item { text-decoration:none; color:inherit; border-radius:6px; transition:background 0.12s; }
        a.event-item[href] { cursor:pointer; }
        a.event-item[href]:hover { background:var(--surface-2); }
        a.event-item[href]:hover .event-title { color:var(--accent); }
        .cal-add { display:flex; flex-direction:column; gap:0.45rem; padding:0.6rem; margin-bottom:0.5rem; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); }
        .cal-add[hidden] { display:none; }
        .cal-add-title { width:100%; box-sizing:border-box; background:var(--bg); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:0.85rem; padding:0.4rem 0.5rem; outline:none; }
        .cal-add-title:focus, .cal-add input:focus, .cal-add select:focus { border-color:var(--accent); }
        .cal-add-row { display:flex; gap:0.4rem; }
        .cal-add input, .cal-add select { flex:1; min-width:0; background:var(--bg); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:0.78rem; font-family:inherit; padding:0.35rem 0.45rem; outline:none; }
        .cal-add-foot { display:flex; align-items:center; gap:0.5rem; }
        .cal-add-status { flex:1; font-size:0.72rem; color:var(--text-muted); }
        .cal-add-status.err { color:#f87171; }
        .cal-add-btn { background:var(--surface); border:1px solid var(--border); color:var(--text); border-radius:6px; padding:0.35rem 0.7rem; font-size:0.78rem; cursor:pointer; }
        .cal-add-btn:hover { border-color:var(--accent); }
        .cal-add-btn:disabled { opacity:0.5; cursor:default; }
        .cal-add-save { background:var(--accent); border-color:var(--accent); color:#06231a; font-weight:600; }
      </style>
      <div class="cal-filters">
        ${calendars
          .map(
            (c) => `
          <button class="cal-chip ${selectedCalendars.has(c.id) ? "cal-chip--on" : ""}"
                  data-cal-id="${c.id}"
                  style="--cal-color:${c.color}">
            <span class="cal-dot"></span>${c.name}
          </button>`
          )
          .join("")}
      </div>
      <form class="cal-add" hidden>
        <input class="cal-add-title" placeholder="Event title" />
        <div class="cal-add-row">
          <select class="cal-add-cal"><option>Loading…</option></select>
          <input class="cal-add-date" type="date" />
          <input class="cal-add-time" type="time" />
        </div>
        <div class="cal-add-foot">
          <span class="cal-add-status"></span>
          <button type="button" class="cal-add-btn cal-add-cancel">Cancel</button>
          <button type="submit" class="cal-add-btn cal-add-save">Add</button>
        </div>
      </form>
      <div class="event-list"></div>`;

    this._el = el;
    const listEl = el.querySelector(".event-list");
    renderList(data.events || [], listEl);
    this._wireAddForm(el);

    el.querySelectorAll(".cal-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.calId;
        if (selectedCalendars.has(id)) {
          selectedCalendars.delete(id);
          btn.classList.remove("cal-chip--on");
        } else {
          selectedCalendars.add(id);
          btn.classList.add("cal-chip--on");
        }
        renderList(data.events || [], listEl);
      });
    });
  },

  // Populate the calendar picker and handle submission of the add-event form.
  _wireAddForm(el) {
    const form = el.querySelector(".cal-add");
    const titleIn = form.querySelector(".cal-add-title");
    const calSel = form.querySelector(".cal-add-cal");
    const dateIn = form.querySelector(".cal-add-date");
    const timeIn = form.querySelector(".cal-add-time");
    const status = form.querySelector(".cal-add-status");
    const saveBtn = form.querySelector(".cal-add-save");

    dateIn.value = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local day

    // Lazily load the user's writable calendars into the picker.
    getWritableCals()
      .then((cals) => {
        if (!cals.length) {
          calSel.innerHTML = `<option value="">No writable calendars</option>`;
          saveBtn.disabled = true;
          status.textContent = "Add a calendar under Calendar IDs in Settings.";
          return;
        }
        const last = localStorage.getItem(LAST_ADD_CAL_KEY);
        calSel.innerHTML = cals
          .map((c) => `<option value="${c.id}">${c.name}</option>`)
          .join("");
        if (last && cals.some((c) => c.id === last)) calSel.value = last;
      })
      .catch((err) => {
        calSel.innerHTML = `<option value="">Unavailable</option>`;
        saveBtn.disabled = true;
        status.classList.add("err");
        status.textContent = err.message;
      });

    form.querySelector(".cal-add-cancel").addEventListener("click", () => {
      form.hidden = true;
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const summary = titleIn.value.trim();
      if (!summary) return void titleIn.focus();
      if (!dateIn.value) {
        status.classList.add("err");
        status.textContent = "Pick a date.";
        return;
      }
      const calendarId = calSel.value;
      if (!calendarId) return;

      saveBtn.disabled = true;
      status.classList.remove("err");
      status.textContent = "Adding…";
      try {
        const r = await fetch("/api/calendar/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            calendarId,
            summary,
            due: dateIn.value,
            time: timeIn.value || null,
          }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || r.statusText);
        localStorage.setItem(LAST_ADD_CAL_KEY, calendarId);
        // Refresh just this widget so the new event appears (and the form resets).
        window.dispatchEvent(new CustomEvent("chronicle:reload-widget", { detail: { id: "calendar" } }));
      } catch (err) {
        status.classList.add("err");
        status.textContent = err.message;
        saveBtn.disabled = false;
      }
    });
  },
};
