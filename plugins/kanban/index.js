// Standalone Kanban board. Persists to kanban.json in the app data dir — no
// account or external service needed. Users define their own columns/cards.
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getDataDir } from "../../src/settingsStore.js";

const BOARD_PATH = () => path.join(getDataDir(), "kanban.json");

const DEFAULT_BOARD = {
  columns: [
    { id: "todo", title: "To Do" },
    { id: "doing", title: "In Progress" },
    { id: "done", title: "Done" },
  ],
  cards: [],
};

function load() {
  try {
    if (fs.existsSync(BOARD_PATH())) return JSON.parse(fs.readFileSync(BOARD_PATH(), "utf-8"));
  } catch (err) {
    console.error("[kanban] read error:", err.message);
  }
  return structuredClone(DEFAULT_BOARD);
}

function save(board) {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(BOARD_PATH(), JSON.stringify(board, null, 2));
  return board;
}

export default {
  id: "kanban",
  label: "Kanban Board",
  env: [],
  routes: [
    { method: "GET", path: "/api/kanban", handler: (_req, res) => res.json(load()) },

    // Replace the column set (add / rename / reorder / delete). Cards whose column
    // disappears are moved to the first column rather than lost.
    {
      method: "PUT",
      path: "/api/kanban/columns",
      handler: (req, res) => {
        const board = load();
        const cols = (req.body.columns || [])
          .filter((c) => c.title && c.title.trim())
          .map((c) => ({ id: c.id || randomUUID(), title: c.title.trim() }));
        if (!cols.length) return res.status(400).json({ error: "at least one column required" });
        const keep = new Set(cols.map((c) => c.id));
        const fallback = cols[0].id;
        board.columns = cols;
        board.cards.forEach((card) => {
          if (!keep.has(card.columnId)) card.columnId = fallback;
        });
        res.json(save(board));
      },
    },

    {
      method: "POST",
      path: "/api/kanban/cards",
      handler: (req, res) => {
        const board = load();
        const { title, columnId } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: "title required" });
        const col = board.columns.find((c) => c.id === columnId) ? columnId : board.columns[0]?.id;
        if (!col) return res.status(400).json({ error: "no columns" });
        const card = { id: randomUUID(), title: title.trim(), columnId: col };
        board.cards.push(card);
        save(board);
        res.json(card);
      },
    },

    // Rename and/or move a card. A move re-appends it to the end of the target column.
    {
      method: "PATCH",
      path: "/api/kanban/cards/:id",
      handler: (req, res) => {
        const board = load();
        const card = board.cards.find((c) => c.id === req.params.id);
        if (!card) return res.status(404).json({ error: "not found" });
        const { title, columnId } = req.body;
        if (typeof title === "string" && title.trim()) card.title = title.trim();
        if (columnId && board.columns.find((c) => c.id === columnId)) {
          board.cards = board.cards.filter((c) => c.id !== card.id);
          card.columnId = columnId;
          board.cards.push(card);
        }
        save(board);
        res.json(card);
      },
    },

    {
      method: "DELETE",
      path: "/api/kanban/cards/:id",
      handler: (req, res) => {
        const board = load();
        const before = board.cards.length;
        board.cards = board.cards.filter((c) => c.id !== req.params.id);
        save(board);
        res.json({ ok: board.cards.length < before });
      },
    },
  ],
};
