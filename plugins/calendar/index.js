import { google } from "googleapis";
import fs from "fs";
import path from "path";
import config from "../../dashboard.config.js";

const calendarIds = config.calendar?.calendarIds?.length
  ? config.calendar.calendarIds
  : ["primary"];

const TOKEN_PATH = path.resolve("tokens.json");

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
  if (fs.existsSync(TOKEN_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    if (!tokens.refresh_token) return false;
    client.setCredentials(tokens);
    return true;
  }
  return false;
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
  if (!tokens.refresh_token && fs.existsSync(TOKEN_PATH)) {
    const prev = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    if (prev.refresh_token) tokens.refresh_token = prev.refresh_token;
  }
  client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
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
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const results = await Promise.all(
      calendarIds.map(async (calendarId, i) => {
        const color = SLOT_COLORS[i % SLOT_COLORS.length];
        const [eventsRes, metaRes] = await Promise.all([
          cal.events.list({
            calendarId,
            timeMin: now.toISOString(),
            timeMax: weekLater.toISOString(),
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
      if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
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
  ],
};
