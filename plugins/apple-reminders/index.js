import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import config from "../../dashboard.config.js";

const cfg = config["apple-reminders"] ?? {};
const maxItems = cfg.maxItems ?? 20;
const allowedLists = cfg.lists ?? [];
const defaultList = cfg.defaultList ?? null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In a packaged Electron app the plugin lives inside app.asar (a file, not a
// directory), so the binary can't be exec'd from there — electron-builder unpacks
// it to app.asar.unpacked. Redirect to that copy; no-op in dev (no asar in path).
const CLI = path
  .resolve(__dirname, "reminders-cli")
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const execFileAsync = promisify(execFile);

export function encodeId(ekId) {
  return Buffer.from(ekId).toString("base64url");
}

export function decodeId(encoded) {
  return Buffer.from(encoded, "base64url").toString();
}

async function run(...args) {
  const { stdout } = await execFileAsync(CLI, args, { timeout: 15000 });
  const result = JSON.parse(stdout.trim());
  if (result && result.error) throw new Error(result.error);
  return result;
}

export default {
  id: "apple-reminders",
  label: "Reminders",
  env: [],
  routes: [
    {
      method: "GET",
      path: "/api/reminders",
      handler: async (_req, res) => {
        try {
          const all = await run("list");
          const filtered = (allowedLists.length > 0
            ? all.filter((r) => allowedLists.includes(r.list))
            : all
          ).slice(0, maxItems);
          res.json(filtered.map((r) => ({ ...r, encodedId: encodeId(r.id) })));
        } catch (err) {
          console.error("[reminders] GET error:", err.message);
          res.status(500).json({ error: err.message });
        }
      },
    },
    {
      method: "GET",
      path: "/api/reminders/lists",
      handler: async (_req, res) => {
        try {
          const lists = await run("lists");
          const filtered =
            allowedLists.length > 0
              ? lists.filter((l) => allowedLists.includes(l.title))
              : lists;
          res.json(filtered.map((l) => ({ ...l, isDefault: defaultList ? l.title === defaultList : l.isDefault })));
        } catch (err) {
          console.error("[reminders] GET lists error:", err.message);
          res.status(500).json({ error: err.message });
        }
      },
    },
    {
      method: "POST",
      path: "/api/reminders",
      handler: async (req, res) => {
        const { name, dueDate, list } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: "name required" });
        const targetList = list?.trim() || defaultList;
        try {
          const args = ["add", "--name", name.trim()];
          if (targetList) args.push("--list", targetList);
          if (dueDate) args.push("--due", dueDate);
          const reminder = await run(...args);
          res.json({ ...reminder, encodedId: encodeId(reminder.id) });
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      },
    },
    {
      method: "PATCH",
      path: "/api/reminders/:id",
      handler: async (req, res) => {
        const ekId = decodeId(req.params.id);
        const { completed, name } = req.body;
        try {
          if (completed) {
            res.json(await run("complete", "--id", ekId));
          } else if (name?.trim()) {
            res.json(await run("update", "--id", ekId, "--name", name.trim()));
          } else {
            res.json({ ok: false });
          }
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      },
    },
    {
      method: "DELETE",
      path: "/api/reminders/:id",
      handler: async (req, res) => {
        const ekId = decodeId(req.params.id);
        try {
          res.json(await run("delete", "--id", ekId));
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      },
    },
  ],
};
