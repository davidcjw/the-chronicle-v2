import { Client } from "@notionhq/client";
import config from "../../dashboard.config.js";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const cfg = config.notion || {};
const excludeStatuses = cfg.excludeStatuses || ["Done"];
const maxTasks = cfg.maxTasks || 20;
const excludeSet = new Set(excludeStatuses.map((s) => s.toLowerCase()));
const propNames = { category: "Category", dueDate: "Due Date", ...cfg.properties };

// Cached once at startup
let statusOptions = [];
let titlePropertyName = "Name";

async function loadSchema() {
  try {
    const db = await notion.databases.retrieve({
      database_id: process.env.NOTION_DATABASE_ID,
    });
    const titleEntry = Object.entries(db.properties).find(([, p]) => p.type === "title");
    if (titleEntry) titlePropertyName = titleEntry[0];

    const statusProp = Object.values(db.properties).find((p) => p.type === "status");
    if (statusProp) {
      statusOptions = statusProp.status.options.map((o) => ({ name: o.name, color: o.color }));
    }
    console.log(`[notion] Schema: title="${titlePropertyName}", ${statusOptions.length} statuses`);
  } catch (err) {
    console.error("[notion] Failed to load schema:", err.message);
  }
}

export function mapPage(page) {
  const props = page.properties;

  const title =
    props[titlePropertyName]?.title?.[0]?.plain_text ||
    props.Name?.title?.[0]?.plain_text ||
    props.Task?.title?.[0]?.plain_text ||
    "Untitled";

  const status =
    props.Status?.status?.name || props.Status?.select?.name || "No status";

  const catProp = props[propNames.category];
  const category = catProp?.select
    ? { name: catProp.select.name, color: catProp.select.color }
    : catProp?.multi_select?.length
    ? { name: catProp.multi_select[0].name, color: catProp.multi_select[0].color }
    : null;

  const dueProp = props[propNames.dueDate];
  const dueDate = dueProp?.date?.start || null;

  return { id: page.id, title, status, url: page.url, category, dueDate };
}

async function getTasks(req, res) {
  try {
    const response = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: maxTasks,
    });
    const tasks = response.results
      .map(mapPage)
      .filter((t) => !excludeSet.has(t.status.toLowerCase()));
    res.json({ tasks, statusOptions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createTask(req, res) {
  const { title, status } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Title is required" });
  const defaultStatus =
    status ||
    statusOptions.find((s) => !excludeSet.has(s.name.toLowerCase()))?.name;
  try {
    const page = await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        [titlePropertyName]: { title: [{ text: { content: title.trim() } }] },
        ...(defaultStatus ? { Status: { status: { name: defaultStatus } } } : {}),
      },
    });
    res.json({ task: mapPage(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateTask(req, res) {
  const { id } = req.params;
  const { status, title } = req.body;
  try {
    const properties = {};
    if (status) properties.Status = { status: { name: status } };
    if (title) properties[titlePropertyName] = { title: [{ text: { content: title } }] };
    await notion.pages.update({ page_id: id, properties });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function archiveTask(req, res) {
  const { id } = req.params;
  try {
    await notion.pages.update({ page_id: id, archived: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default {
  id: "notion",
  label: "Notion Tasks",
  env: ["NOTION_TOKEN", "NOTION_DATABASE_ID"],
  onLoad: loadSchema,
  routes: [
    { method: "GET",    path: "/api/tasks",      handler: getTasks },
    { method: "POST",   path: "/api/tasks",      handler: createTask },
    { method: "PATCH",  path: "/api/tasks/:id",  handler: updateTask },
    { method: "DELETE", path: "/api/tasks/:id",  handler: archiveTask },
  ],
};
