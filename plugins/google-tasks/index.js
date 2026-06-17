import { google } from "googleapis";
import fs from "fs";
import path from "path";
import config from "../../dashboard.config.js";

const cfg = config["google-tasks"] ?? {};
const maxItems = cfg.maxItems ?? 20;
const TOKEN_PATH = path.resolve("tokens.json");

export function encodeId(tasklistId, taskId) {
  return Buffer.from(`${tasklistId}:${taskId}`).toString("base64url");
}

export function decodeId(encoded) {
  const str = Buffer.from(encoded, "base64url").toString();
  const i = str.indexOf(":");
  return { tasklistId: str.slice(0, i), taskId: str.slice(i + 1) };
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
    client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8")));
    return true;
  }
  return false;
}

function authGuard(res, client) {
  if (!loadTokens(client)) {
    res.status(401).json({ error: "not_authenticated", authUrl: "/auth/google" });
    return false;
  }
  return true;
}

function handleApiError(err, res) {
  if (err.code === 401) {
    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
    return res.status(401).json({ error: "token_expired", authUrl: "/auth/google" });
  }
  res.status(500).json({ error: err.message });
}

export default {
  id: "google-tasks",
  label: "Google Tasks",
  env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  routes: [
    {
      method: "GET",
      path: "/api/gtasks",
      handler: async (_req, res) => {
        const client = getOAuthClient();
        if (!authGuard(res, client)) return;
        try {
          const api = google.tasks({ version: "v1", auth: client });
          const listsRes = await api.tasklists.list({ maxResults: 20 });
          const lists = listsRes.data.items || [];

          const results = await Promise.all(
            lists.map(async (list) => {
              const r = await api.tasks.list({
                tasklist: list.id,
                showCompleted: false,
                showDeleted: false,
                showHidden: false,
                maxResults: maxItems,
              });
              return (r.data.items || []).map((t) => ({
                encodedId: encodeId(list.id, t.id),
                name: t.title || "",
                dueDate: t.due || null,
                list: list.title,
                priority: 0,
              }));
            })
          );

          res.json(results.flat().slice(0, maxItems));
        } catch (err) {
          handleApiError(err, res);
        }
      },
    },
    {
      method: "POST",
      path: "/api/gtasks",
      handler: async (req, res) => {
        const { name, dueDate } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: "name required" });
        const client = getOAuthClient();
        if (!authGuard(res, client)) return;
        try {
          const api = google.tasks({ version: "v1", auth: client });
          const body = { title: name.trim() };
          if (dueDate) body.due = new Date(dueDate).toISOString();
          const [created, listRes] = await Promise.all([
            api.tasks.insert({ tasklist: "@default", requestBody: body }),
            api.tasklists.get({ tasklist: "@default" }),
          ]);
          const t = created.data;
          res.json({
            encodedId: encodeId(listRes.data.id, t.id),
            name: t.title,
            dueDate: t.due || null,
            list: listRes.data.title,
            priority: 0,
          });
        } catch (err) {
          handleApiError(err, res);
        }
      },
    },
    {
      method: "PATCH",
      path: "/api/gtasks/:id",
      handler: async (req, res) => {
        const { tasklistId, taskId } = decodeId(req.params.id);
        const { completed } = req.body;
        const client = getOAuthClient();
        if (!authGuard(res, client)) return;
        try {
          const api = google.tasks({ version: "v1", auth: client });
          await api.tasks.patch({
            tasklist: tasklistId,
            task: taskId,
            requestBody: { status: completed ? "completed" : "needsAction" },
          });
          res.json({ ok: true });
        } catch (err) {
          handleApiError(err, res);
        }
      },
    },
    {
      method: "DELETE",
      path: "/api/gtasks/:id",
      handler: async (req, res) => {
        const { tasklistId, taskId } = decodeId(req.params.id);
        const client = getOAuthClient();
        if (!authGuard(res, client)) return;
        try {
          const api = google.tasks({ version: "v1", auth: client });
          await api.tasks.delete({ tasklist: tasklistId, task: taskId });
          res.json({ ok: true });
        } catch (err) {
          handleApiError(err, res);
        }
      },
    },
  ],
};
