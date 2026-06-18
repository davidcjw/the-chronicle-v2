// Desktop notifications for due items. While the app is running it polls the
// shared agenda every few minutes and fires native notifications: a once-a-day
// "due today" digest, plus a lead-time alert before each timed item.
import { fetchAgenda } from "/lib/agendaData.js";

const POLL_MS = 5 * 60 * 1000; // re-check every 5 minutes
const LEAD_MS = 11 * 60 * 1000; // alert within ~11 min before a timed item
const NOTIFIED_KEY = "chronicle-notified";
const DIGEST_KEY = "chronicle-digest-date";

const SOURCE_LABEL = {
  calendar: "Event",
  notion: "Task",
  gtasks: "Task",
  reminder: "Reminder",
  kanban: "Due",
};

async function ensurePermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

const loadNotified = () => {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "{}");
  } catch {
    return {};
  }
};

const fmtTime = (d) => d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });

async function tick() {
  if (!(await ensurePermission())) return;
  let items;
  try {
    items = await fetchAgenda();
  } catch {
    return;
  }
  const now = Date.now();
  const notified = loadNotified();
  for (const k of Object.keys(notified)) if (now - notified[k] > 2 * 86400000) delete notified[k];

  // Once-a-day "due today" digest.
  const todayStr = new Date().toDateString();
  if (localStorage.getItem(DIGEST_KEY) !== todayStr) {
    const todays = items.filter((i) => i.date.toDateString() === todayStr);
    if (todays.length) {
      const preview = todays.slice(0, 3).map((i) => i.title).join(", ");
      new Notification(`The Chronicle — ${todays.length} due today`, {
        body: preview + (todays.length > 3 ? "…" : ""),
      });
    }
    localStorage.setItem(DIGEST_KEY, todayStr);
  }

  // Lead-time alerts for timed items.
  for (const i of items) {
    if (!i.hasTime) continue;
    const delta = i.date.getTime() - now;
    if (delta > 0 && delta <= LEAD_MS && !notified[i.id]) {
      new Notification(`${SOURCE_LABEL[i.source] || "Due"}: ${i.title}`, { body: `at ${fmtTime(i.date)}` });
      notified[i.id] = now;
    }
  }
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified));
}

ensurePermission().then((ok) => ok && tick());
setInterval(tick, POLL_MS);
