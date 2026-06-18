import { google } from "googleapis";
import fs from "fs";
import path from "path";
import config from "../../dashboard.config.js";
import { getDataDir } from "../../src/settingsStore.js";

const calendarIds = config.calendar?.calendarIds?.length
  ? config.calendar.calendarIds
  : ["primary"];

// Resolved against the app data dir (like kanban.json / settings.json), not the
// process cwd — so the token is found regardless of where the server is launched.
const TOKEN_PATH = () => path.join(getDataDir(), "tokens.json");

// Consistent colors per calendar slot
const SLOT_COLORS = ["#818cf8", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#a78bfa", "#fb923c"];

export function mapEvent(e, calendarId, calendarName, color) {
  return {
    id: e.id,
    title: e.summary || "No title",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    allDay: !e.start?.dateTime,
    location: e.location || null,
    htmlLink: e.htmlLink || null,
    calendarId,
    calendarName,
    calendarColor: color,
  };
}

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "http://localhost:3737/auth/google/callback"
  );
}

function loadTokens(client) {
  if (fs.existsSync(TOKEN_PATH())) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH(), "utf-8"));
    if (!tokens.refresh_token) return false;
    client.setCredentials(tokens);
    return true;
  }
  return false;
}

// An authenticated Calendar API client, or null if the user hasn't connected yet.
function authedCalendar() {
  const client = getOAuthClient();
  if (!loadTokens(client)) return null;
  return google.calendar({ version: "v3", auth: client });
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// Surface the common "token predates the write scope" case as a clear instruction
// instead of Google's cryptic "Insufficient Permission".
function eventError(res, err) {
  const needsReconnect = err.code === 403 || /insufficient permission/i.test(err.message || "");
  res.status(needsReconnect ? 403 : 500).json({
    error: needsReconnect
      ? "Reconnect Google in Settings to grant calendar write access."
      : err.message,
  });
}

// YYYY-MM-DD one day after the given date (UTC math avoids tz date-shift).
function nextDay(d) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
}

// Build a Google event body from a kanban due date. With a time → a 30-min timed
// event; without → an all-day event (Google treats end.date as exclusive).
function buildEventResource({ summary, description, due, time }) {
  const ev = { summary: summary || "Untitled", description: description || "" };
  if (time) {
    const [h, m] = time.split(":").map(Number);
    const endTotal = h * 60 + m + 30;
    const eh = String(Math.floor(endTotal / 60) % 24).padStart(2, "0");
    const em = String(endTotal % 60).padStart(2, "0");
    ev.start = { dateTime: `${due}T${time}:00`, timeZone: TZ };
    ev.end = { dateTime: `${endTotal >= 1440 ? nextDay(due) : due}T${eh}:${em}:00`, timeZone: TZ };
  } else {
    ev.start = { date: due };
    ev.end = { date: nextDay(due) };
  }
  return ev;
}

function getAuthUrl(req, res) {
  const client = getOAuthClient();
  res.redirect(
    client.generateAuthUrl({
      access_type: "offline",
      // Force the consent screen so Google always returns a refresh_token —
      // without this, a re-authorization omits it and loadTokens() fails,
      // leaving the UI stuck on "Connect" even though sign-in succeeded.
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/calendar.events", // create/update kanban due-date events
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/tasks",
      ],
    })
  );
}

async function handleCallback(req, res) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(req.query.code);
  // Never clobber an existing refresh_token: if Google didn't send one this
  // round, reuse the one we already have so loadTokens() keeps working.
  if (!tokens.refresh_token && fs.existsSync(TOKEN_PATH())) {
    const prev = JSON.parse(fs.readFileSync(TOKEN_PATH(), "utf-8"));
    if (prev.refresh_token) tokens.refresh_token = prev.refresh_token;
  }
  client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH(), JSON.stringify(tokens));
  // Land on a friendly success page (consent happens in the user's real browser,
  // so we must not dump them onto the full dashboard in a stray browser tab).
  res.redirect("/auth-success.html");
}

async function getEvents(req, res) {
  const client = getOAuthClient();
  if (!loadTokens(client)) {
    return res.status(401).json({ error: "not_authenticated", authUrl: "/auth/google" });
  }
  try {
    const cal = google.calendar({ version: "v3", auth: client });
    const now = new Date();
    // 30-day horizon so kanban due dates (often weeks out) actually surface here.
    const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const results = await Promise.all(
      calendarIds.map(async (calendarId, i) => {
        const color = SLOT_COLORS[i % SLOT_COLORS.length];
        const [eventsRes, metaRes] = await Promise.all([
          cal.events.list({
            calendarId,
            timeMin: now.toISOString(),
            timeMax: horizon.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 20,
          }),
          cal.calendars.get({ calendarId }).catch(() => ({ data: { summary: calendarId } })),
        ]);
        return {
          calendarId,
          calendarName: metaRes.data.summary,
          color,
          items: (eventsRes.data.items || []).filter((e) => e.eventType !== "workingLocation"),
        };
      })
    );

    const calendars = results.map(({ calendarId, calendarName, color }) => ({
      id: calendarId,
      name: calendarName,
      color,
    }));

    const events = results
      .flatMap(({ calendarId, calendarName, color, items }) =>
        items.map((e) => mapEvent(e, calendarId, calendarName, color))
      )
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .slice(0, 20);

    res.json({ events, calendars });
  } catch (err) {
    const isAuthError =
      err.code === 401 ||
      err.message === "invalid_grant" ||
      err.message?.includes("No refresh token") ||
      err.response?.data?.error === "invalid_grant";
    if (isAuthError) {
      if (fs.existsSync(TOKEN_PATH())) fs.unlinkSync(TOKEN_PATH());
      return res.status(401).json({ error: "token_expired", authUrl: "/auth/google" });
    }
    res.status(500).json({ error: err.message });
  }
}

export default {
  id: "calendar",
  label: "Google Calendar",
  env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  routes: [
    { method: "GET", path: "/api/events", handler: getEvents },
    { method: "GET", path: "/auth/google", handler: getAuthUrl },
    { method: "GET", path: "/auth/google/callback", handler: handleCallback },

    // Synced calendars the user can actually write to (for the kanban "add to
    // calendar" picker). Read-only calendars (e.g. holidays) are excluded.
    {
      method: "GET",
      path: "/api/calendar/writable",
      handler: async (_req, res) => {
        const cal = authedCalendar();
        if (!cal) return res.status(401).json({ error: "not_authenticated" });
        try {
          const list = await cal.calendarList.list({ maxResults: 250 });
          const byId = {};
          let primaryName = "Primary";
          for (const c of list.data.items || []) {
            byId[c.id] = c;
            if (c.primary) primaryName = c.summary;
          }
          const writable = new Set(["owner", "writer"]);
          const out = [];
          for (const id of calendarIds) {
            if (id === "primary") out.push({ id: "primary", name: primaryName });
            else if (byId[id] && writable.has(byId[id].accessRole))
              out.push({ id, name: byId[id].summary });
          }
          res.json(out);
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      },
    },

    {
      method: "POST",
      path: "/api/calendar/events",
      handler: async (req, res) => {
        const cal = authedCalendar();
        if (!cal) return res.status(401).json({ error: "not_authenticated" });
        const { calendarId = "primary", summary, description, due, time } = req.body || {};
        if (!due) return res.status(400).json({ error: "due date required" });
        try {
          const r = await cal.events.insert({
            calendarId,
            requestBody: buildEventResource({ summary, description, due, time }),
          });
          res.json({ eventId: r.data.id, calendarId, htmlLink: r.data.htmlLink });
        } catch (err) {
          eventError(res, err);
        }
      },
    },

    {
      method: "PATCH",
      path: "/api/calendar/events/:id",
      handler: async (req, res) => {
        const cal = authedCalendar();
        if (!cal) return res.status(401).json({ error: "not_authenticated" });
        const { calendarId = "primary", summary, description, due, time } = req.body || {};
        if (!due) return res.status(400).json({ error: "due date required" });
        try {
          const r = await cal.events.patch({
            calendarId,
            eventId: req.params.id,
            requestBody: buildEventResource({ summary, description, due, time }),
          });
          res.json({ eventId: r.data.id, calendarId, htmlLink: r.data.htmlLink });
        } catch (err) {
          eventError(res, err);
        }
      },
    },

    {
      method: "DELETE",
      path: "/api/calendar/events/:id",
      handler: async (req, res) => {
        const cal = authedCalendar();
        if (!cal) return res.status(401).json({ error: "not_authenticated" });
        const calendarId = req.query.calendarId || "primary";
        try {
          await cal.events.delete({ calendarId, eventId: req.params.id });
          res.json({ ok: true });
        } catch (err) {
          if (err.code === 404 || err.code === 410) return res.json({ ok: true }); // already gone
          res.status(500).json({ error: err.message });
        }
      },
    },
  ],
};
