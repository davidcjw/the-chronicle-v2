// Dailies — a daily checklist. Each item records the local date it was last
// completed (lastDone, "YYYY-MM-DD"). The widget hides an item once it's done for
// "today" and shows it again after local midnight. Persists to dailies.json.
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getDataDir } from "../../src/settingsStore.js";

const FILE = () => path.join(getDataDir(), "dailies.json");
const localToday = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

function load() {
  try {
    if (fs.existsSync(FILE())) return JSON.parse(fs.readFileSync(FILE(), "utf-8"));
  } catch (err) {
    console.error("[dailies] read error:", err.message);
  }
  return { items: [] };
}

function save(data) {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(data, null, 2));
  return data;
}

export default {
  id: "dailies",
  label: "Dailies",
  env: [],
  routes: [
    { method: "GET", path: "/api/dailies", handler: (_req, res) => res.json(load()) },

    {
      method: "POST",
      path: "/api/dailies",
      handler: (req, res) => {
        const title = (req.body?.title || "").trim();
        if (!title) return res.status(400).json({ error: "title required" });
        const data = load();
        const item = { id: randomUUID(), title, lastDone: null };
        data.items.push(item);
        save(data);
        res.json(item);
      },
    },

    // Toggle done-for-today (the client sends its local date), or rename.
    {
      method: "PATCH",
      path: "/api/dailies/:id",
      handler: (req, res) => {
        const data = load();
        const item = data.items.find((i) => i.id === req.params.id);
        if (!item) return res.status(404).json({ error: "not found" });
        if (typeof req.body?.title === "string" && req.body.title.trim())
          item.title = req.body.title.trim();
        if ("done" in req.body)
          item.lastDone = req.body.done ? req.body.date || localToday() : null;
        save(data);
        res.json(item);
      },
    },

    {
      method: "DELETE",
      path: "/api/dailies/:id",
      handler: (req, res) => {
        const data = load();
        const before = data.items.length;
        data.items = data.items.filter((i) => i.id !== req.params.id);
        save(data);
        res.json({ ok: data.items.length < before });
      },
    },
  ],
};
