import { Client } from "@notionhq/client";
import config from "../../dashboard.config.js";

const pageId = config.standup?.pageId;

export function todayKey() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function findToggleForDate(blocks, dateKey) {
  return (
    blocks.find(
      (b) =>
        b.type === "toggle" &&
        b.toggle?.rich_text?.[0]?.plain_text === `[${dateKey}]`
    ) ?? null
  );
}

export function extractBullets(children) {
  return children
    .filter((b) => b.type === "bulleted_list_item")
    .map((b) =>
      b.bulleted_list_item.rich_text.map((t) => t.plain_text).join("")
    );
}

async function fetchAllChildren(notion, blockId) {
  const blocks = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return blocks;
}

export default {
  id: "standup",
  label: "Standup",
  env: ["NOTION_TOKEN"],
  routes: [
    {
      method: "GET",
      path: "/api/standup",
      handler: async (_req, res) => {
        if (!pageId)
          return res
            .status(400)
            .json({ error: "standup.pageId not set in dashboard.config.js" });
        const notion = new Client({ auth: process.env.NOTION_TOKEN });
        try {
          const children = await fetchAllChildren(notion, pageId);
          const toggle = findToggleForDate(children, todayKey());
          if (!toggle) return res.json({ bullets: [] });
          const toggleChildren = await fetchAllChildren(notion, toggle.id);
          res.json({ bullets: extractBullets(toggleChildren) });
        } catch (err) {
          console.error("[standup] GET error:", err.message);
          res.status(500).json({ error: err.message });
        }
      },
    },
    {
      method: "POST",
      path: "/api/standup",
      handler: async (req, res) => {
        if (!pageId)
          return res
            .status(400)
            .json({ error: "standup.pageId not set in dashboard.config.js" });
        const { bullets } = req.body;
        if (!Array.isArray(bullets))
          return res.status(400).json({ error: "bullets must be an array" });
        if (!bullets.every((s) => typeof s === "string"))
          return res
            .status(400)
            .json({ error: "bullets must be an array of strings" });

        const key = todayKey();
        const lines = bullets.map((s) => s.trim()).filter(Boolean);
        const bulletBlocks = lines.map((text) => ({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [{ type: "text", text: { content: text } }],
          },
        }));

        const notion = new Client({ auth: process.env.NOTION_TOKEN });
        try {
          const children = await fetchAllChildren(notion, pageId);
          const toggle = findToggleForDate(children, key);

          if (toggle) {
            const existing = await fetchAllChildren(notion, toggle.id);
            // Notion has no transactions: if append fails after delete, the toggle is left empty.
            await Promise.all(
              existing.map((b) => notion.blocks.delete({ block_id: b.id }))
            );
            if (lines.length) {
              await notion.blocks.children.append({
                block_id: toggle.id,
                children: bulletBlocks,
              });
            }
          } else {
            await notion.blocks.children.append({
              block_id: pageId,
              children: [
                {
                  object: "block",
                  type: "toggle",
                  toggle: {
                    rich_text: [
                      {
                        type: "text",
                        text: { content: `[${key}]` },
                      },
                    ],
                    children: bulletBlocks,
                  },
                },
              ],
            });
          }
          res.json({ ok: true });
        } catch (err) {
          console.error("[standup] POST error:", err.message);
          res.status(500).json({ error: err.message });
        }
      },
    },
  ],
};
