// Shared agenda aggregator. Pulls dated items from every active source (calendar,
// Notion tasks, Google tasks, Apple reminders, kanban due dates) and normalizes
// them into a single sorted list. Used by the Agenda widget and notifications.
//
// Item shape: { id, title, date: Date, when: string, hasTime, source, label, color, link }

async function jget(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const toDate = (when, hasTime) =>
  new Date(hasTime ? when : `${String(when).slice(0, 10)}T00:00:00`);

export async function fetchAgenda() {
  const items = [];
  const push = (it) => {
    const date = toDate(it.when, it.hasTime);
    if (!isNaN(date)) items.push({ ...it, date });
  };

  // Only hit endpoints for active plugins (avoids 404s from disabled sources).
  const plugins = await jget("/api/plugins");
  const active = new Set((plugins || []).map((p) => p.id));
  const [cal, dbs, gt, rem, boards] = await Promise.all([
    active.has("calendar") ? jget("/api/events") : null,
    active.has("notion") ? jget("/api/notion/databases") : null,
    active.has("google-tasks") ? jget("/api/gtasks") : null,
    active.has("apple-reminders") ? jget("/api/reminders") : null,
    active.has("kanban") ? jget("/api/kanban/boards") : null,
  ]);

  // Calendar events
  if (cal && Array.isArray(cal.events)) {
    for (const e of cal.events) {
      push({
        id: `cal:${e.id}`,
        title: e.title,
        when: e.start,
        hasTime: !e.allDay,
        source: "calendar",
        label: e.calendarName || "Calendar",
        color: e.calendarColor || "#818cf8",
        link: e.htmlLink || null,
      });
    }
  }

  // Notion tasks (across all databases)
  if (Array.isArray(dbs)) {
    await Promise.all(
      dbs.map(async (db) => {
        const data = await jget(`/api/notion/databases/${db.id}/tasks`);
        (data?.tasks || []).forEach((t) => {
          if (!t.dueDate) return;
          push({
            id: `notion:${t.id}`,
            title: t.title,
            when: t.dueDate,
            hasTime: String(t.dueDate).includes("T"),
            source: "notion",
            label: db.name,
            color: "#34d399",
            link: t.url || null,
          });
        });
      })
    );
  }

  // Google tasks (due is a timestamp but date-only semantically)
  if (Array.isArray(gt)) {
    gt.forEach((t) => {
      if (!t.dueDate) return;
      push({
        id: `gt:${t.encodedId}`,
        title: t.name,
        when: String(t.dueDate).slice(0, 10),
        hasTime: false,
        source: "gtasks",
        label: t.list || "Google Tasks",
        color: "#34d399",
        link: null,
      });
    });
  }

  // Apple reminders
  if (Array.isArray(rem)) {
    rem.forEach((r) => {
      if (!r.dueDate) return;
      push({
        id: `rem:${r.id}`,
        title: r.name,
        when: r.dueDate,
        hasTime: String(r.dueDate).includes("T"),
        source: "reminder",
        label: r.list || "Reminders",
        color: "#f59e0b",
        link: null,
      });
    });
  }

  // Kanban next-action due dates (across all boards)
  if (Array.isArray(boards)) {
    await Promise.all(
      boards.map(async (b) => {
        const board = await jget(`/api/kanban/boards/${b.id}`);
        (board?.cards || []).forEach((c) => {
          if (!c.nextActionDue) return;
          const when = c.nextActionDueTime
            ? `${c.nextActionDue}T${c.nextActionDueTime}:00`
            : c.nextActionDue;
          push({
            id: `kb:${c.id}`,
            title: (c.nextAction && c.nextAction.trim()) || c.title,
            when,
            hasTime: !!c.nextActionDueTime,
            source: "kanban",
            label: b.name,
            color: "#a78bfa",
            link: null,
          });
        });
      })
    );
  }

  return items.sort((a, b) => a.date - b.date);
}

// Items from `floorDays` ago up to `aheadDays` from now (overdue + upcoming window).
export function inWindow(items, { aheadDays = 7, floorDays = 30 } = {}) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + aheadDays);
  const floor = new Date(start);
  floor.setDate(floor.getDate() - floorDays);
  return items.filter((i) => i.date >= floor && i.date < end);
}
