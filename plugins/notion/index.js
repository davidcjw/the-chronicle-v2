import { Client } from "@notionhq/client";
import config from "../../dashboard.config.js";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const cfg = config.notion || {};
const excludeStatuses = cfg.excludeStatuses || ["Done"];
const maxTasks = cfg.maxTasks || 20;
const excludeSet = new Set(excludeStatuses.map((s) => s.toLowerCase()));
const propNames = { category: "Category", dueDate: "Due Date", ...cfg.properties };

// Databases come from the config list; the legacy single NOTION_DATABASE_ID env
// secret is honored as a fallback so existing single-database setups keep working.
function databaseIds() {
  const ids = (Array.isArray(cfg.databaseIds) ? cfg.databaseIds : []).map((s) => String(s).trim()).filter(Boolean);
  const legacy = process.env.NOTION_DATABASE_ID;
  if (legacy && !ids.includes(legacy)) ids.push(legacy);
  return ids;
}

// Per-database schema cache: dbid -> { name, titleProp, statusOptions }
const schemas = new Map();

async function loadDbSchema(dbid) {
  const db = await notion.databases.retrieve({ database_id: dbid });
  const name = db.title?.map((t) => t.plain_text).join("").trim() || "Tasks";
  const titleEntry = Object.entries(db.properties).find(([, p]) => p.type === "title");
  const titleProp = titleEntry ? titleEntry[0] : "Name";
  const statusProp = Object.values(db.properties).find((p) => p.type === "status");
  const statusOptions = statusProp
    ? statusProp.status.options.map((o) => ({ name: o.name, color: o.color }))
    : [];
  const schema = { name, titleProp, statusOptions };
  schemas.set(dbid, schema);
  return schema;
}

const getSchema = (dbid) => schemas.get(dbid) || loadDbSchema(dbid);

async function loadSchemas() {
  for (const id of databaseIds()) {
    try {
      const s = await loadDbSchema(id);
      console.log(`[notion] ${id} → "${s.name}" (${s.statusOptions.length} statuses)`);
    } catch (err) {
      console.error(`[notion] schema load failed for ${id}:`, err.message);
    }
  }
}

export function mapPage(page, schema = { titleProp: "Name" }) {
  const props = page.properties;

  const title =
    props[schema.titleProp]?.title?.[0]?.plain_text ||
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

// List databases — the dashboard spawns one Tasks card per entry.
async function listDatabases(_req, res) {
  const out = [];
  for (const id of databaseIds()) {
    try {
      const s = await getSchema(id);
      out.push({ id, name: s.name });
    } catch {
      out.push({ id, name: "Tasks" }); // still show a card even if the schema can't load
    }
  }
  res.json(out);
}

async function getTasks(req, res) {
  try {
    const schema = await getSchema(req.params.dbid);
    const response = await notion.databases.query({
      database_id: req.params.dbid,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: maxTasks,
    });
    const tasks = response.results
      .map((p) => mapPage(p, schema))
      .filter((t) => !excludeSet.has(t.status.toLowerCase()));
    res.json({ tasks, statusOptions: schema.statusOptions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createTask(req, res) {
  const { title, status } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Title is required" });
  try {
    const schema = await getSchema(req.params.dbid);
    const defaultStatus =
      status || schema.statusOptions.find((s) => !excludeSet.has(s.name.toLowerCase()))?.name;
    const page = await notion.pages.create({
      parent: { database_id: req.params.dbid },
      properties: {
        [schema.titleProp]: { title: [{ text: { content: title.trim() } }] },
        ...(defaultStatus ? { Status: { status: { name: defaultStatus } } } : {}),
      },
    });
    res.json({ task: mapPage(page, schema) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateTask(req, res) {
  const { status, title } = req.body;
  try {
    const schema = await getSchema(req.params.dbid);
    const properties = {};
    if (status) properties.Status = { status: { name: status } };
    if (title) properties[schema.titleProp] = { title: [{ text: { content: title } }] };
    await notion.pages.update({ page_id: req.params.id, properties });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function archiveTask(req, res) {
  try {
    await notion.pages.update({ page_id: req.params.id, archived: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default {
  id: "notion",
  label: "Notion Tasks",
  env: ["NOTION_TOKEN"],
  onLoad: loadSchemas,
  routes: [
    { method: "GET", path: "/api/notion/databases", handler: listDatabases },
    { method: "GET", path: "/api/notion/databases/:dbid/tasks", handler: getTasks },
    { method: "POST", path: "/api/notion/databases/:dbid/tasks", handler: createTask },
    { method: "PATCH", path: "/api/notion/databases/:dbid/tasks/:id", handler: updateTask },
    { method: "DELETE", path: "/api/notion/databases/:dbid/tasks/:id", handler: archiveTask },
  ],
};
