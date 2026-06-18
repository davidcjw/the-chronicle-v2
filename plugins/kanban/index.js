// Standalone Kanban boards. Persists to kanban.json in the app data dir — no
// account or external service needed. Users define their own boards, columns and
// cards; the dashboard renders one card per board.
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getDataDir } from "../../src/settingsStore.js";

const BOARD_PATH = () => path.join(getDataDir(), "kanban.json");

const defaultColumns = () => [
  { id: "todo", title: "To Do" },
  { id: "doing", title: "In Progress" },
  { id: "done", title: "Done" },
];

const newBoard = (name) => ({
  id: randomUUID(),
  name: (name || "").trim() || "New board",
  columns: defaultColumns(),
  cards: [],
});

// A fresh install starts with a single board called "Kanban".
const defaultStore = () => ({
  boards: [{ id: "default", name: "Kanban", columns: defaultColumns(), cards: [] }],
});

function load() {
  try {
    if (fs.existsSync(BOARD_PATH())) {
      const data = JSON.parse(fs.readFileSync(BOARD_PATH(), "utf-8"));
      if (Array.isArray(data.boards)) return data;
      // Migrate the legacy single-board shape { columns, cards } → { boards: [...] }.
      if (Array.isArray(data.columns)) {
        const migrated = {
          boards: [{ id: "default", name: "Kanban", columns: data.columns, cards: data.cards || [] }],
        };
        save(migrated);
        return migrated;
      }
    }
  } catch (err) {
    console.error("[kanban] read error:", err.message);
  }
  return defaultStore();
}

function save(store) {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(BOARD_PATH(), JSON.stringify(store, null, 2));
  return store;
}

const findBoard = (store, bid) => store.boards.find((b) => b.id === bid);

// Resolve { store, board } for a board-scoped route, or send 404.
function withBoard(req, res) {
  const store = load();
  const board = findBoard(store, req.params.bid);
  if (!board) {
    res.status(404).json({ error: "board not found" });
    return null;
  }
  return { store, board };
}

export default {
  id: "kanban",
  label: "Kanban Board",
  env: [],
  routes: [
    // ── Boards ──────────────────────────────────────────────────────────────

    // List boards — the dashboard spawns one widget card per entry.
    {
      method: "GET",
      path: "/api/kanban/boards",
      handler: (_req, res) => res.json(load().boards.map((b) => ({ id: b.id, name: b.name }))),
    },

    {
      method: "POST",
      path: "/api/kanban/boards",
      handler: (req, res) => {
        const store = load();
        const board = newBoard(req.body?.name);
        store.boards.push(board);
        save(store);
        res.json({ id: board.id, name: board.name });
      },
    },

    // Full board (columns + cards) for a widget instance to render.
    {
      method: "GET",
      path: "/api/kanban/boards/:bid",
      handler: (req, res) => {
        const ctx = withBoard(req, res);
        if (ctx) res.json(ctx.board);
      },
    },

    // Rename a board.
    {
      method: "PATCH",
      path: "/api/kanban/boards/:bid",
      handler: (req, res) => {
        const ctx = withBoard(req, res);
        if (!ctx) return;
        const name = (req.body?.name || "").trim();
        if (name) ctx.board.name = name;
        save(ctx.store);
        res.json({ id: ctx.board.id, name: ctx.board.name });
      },
    },

    // Delete a board (at least one must remain).
    {
      method: "DELETE",
      path: "/api/kanban/boards/:bid",
      handler: (req, res) => {
        const store = load();
        if (store.boards.length <= 1)
          return res.status(400).json({ error: "at least one board required" });
        const before = store.boards.length;
        store.boards = store.boards.filter((b) => b.id !== req.params.bid);
        save(store);
        res.json({ ok: store.boards.length < before });
      },
    },

    // ── Columns & cards (board-scoped) ───────────────────────────────────────

    // Replace the column set (add / rename / reorder / delete). Cards whose column
    // disappears are moved to the first column rather than lost.
    {
      method: "PUT",
      path: "/api/kanban/boards/:bid/columns",
      handler: (req, res) => {
        const ctx = withBoard(req, res);
        if (!ctx) return;
        const { store, board } = ctx;
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
        save(store);
        res.json(board);
      },
    },

    {
      method: "POST",
      path: "/api/kanban/boards/:bid/cards",
      handler: (req, res) => {
        const ctx = withBoard(req, res);
        if (!ctx) return;
        const { store, board } = ctx;
        const { title, columnId } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: "title required" });
        const col = board.columns.find((c) => c.id === columnId) ? columnId : board.columns[0]?.id;
        if (!col) return res.status(400).json({ error: "no columns" });
        const card = {
          id: randomUUID(),
          title: title.trim(),
          columnId: col,
          dateAdded: new Date().toISOString(),
        };
        board.cards.push(card);
        save(store);
        res.json(card);
      },
    },

    // Rename / move a card, or update its detail fields. A move re-appends it to
    // the end of the target column.
    {
      method: "PATCH",
      path: "/api/kanban/boards/:bid/cards/:id",
      handler: (req, res) => {
        const ctx = withBoard(req, res);
        if (!ctx) return;
        const { store, board } = ctx;
        const card = board.cards.find((c) => c.id === req.params.id);
        if (!card) return res.status(404).json({ error: "not found" });
        const { title, columnId } = req.body;
        if (typeof title === "string" && title.trim()) card.title = title.trim();
        // Detail fields — only touched when present, so a column-move drag
        // (which sends just { columnId }) never wipes them.
        if ("subtitle" in req.body)
          card.subtitle = typeof req.body.subtitle === "string" ? req.body.subtitle.trim() : "";
        if ("nextAction" in req.body)
          card.nextAction = typeof req.body.nextAction === "string" ? req.body.nextAction : "";
        if ("notes" in req.body)
          card.notes = typeof req.body.notes === "string" ? req.body.notes : "";
        if ("links" in req.body)
          card.links = Array.isArray(req.body.links) ? req.body.links.filter(Boolean) : [];
        if ("tags" in req.body)
          card.tags = Array.isArray(req.body.tags) ? req.body.tags.filter(Boolean) : [];
        if ("nextActionDue" in req.body) card.nextActionDue = req.body.nextActionDue || null;
        if ("nextActionDueTime" in req.body) card.nextActionDueTime = req.body.nextActionDueTime || null;
        if ("calendar" in req.body) card.calendar = req.body.calendar || null;
        if (columnId && board.columns.find((c) => c.id === columnId)) {
          board.cards = board.cards.filter((c) => c.id !== card.id);
          card.columnId = columnId;
          board.cards.push(card);
        }
        save(store);
        res.json(card);
      },
    },

    {
      method: "DELETE",
      path: "/api/kanban/boards/:bid/cards/:id",
      handler: (req, res) => {
        const ctx = withBoard(req, res);
        if (!ctx) return;
        const { store, board } = ctx;
        const before = board.cards.length;
        board.cards = board.cards.filter((c) => c.id !== req.params.id);
        save(store);
        res.json({ ok: board.cards.length < before });
      },
    },
  ],
};
