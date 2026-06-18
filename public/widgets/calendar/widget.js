// Per-session filter state — empty = show all, non-empty = show only selected
const selectedCalendars = new Set();

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
      <div class="event-list"></div>`;

    const listEl = el.querySelector(".event-list");
    renderList(data.events || [], listEl);

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
};
