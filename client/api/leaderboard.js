import { createHash } from "node:crypto";
import { db, send, toJson } from "./store.js";

// Points: fuel / 2 + time_left / 6, the same as runPoints in src/game/rules.js.
// Top 10, plus the asking player's own row (by ?run=<runId>) with its rank, so they needn't scroll.
// ?all=1 returns every run, for the display board.
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });
  const asked = new URL(req.url || "/", "http://local").searchParams.get("run");
  const run = asked && asked.length <= 64 ? asked : null;
  const all = new URL(req.url || "/", "http://local").searchParams.get("all") === "1";
  try {
    const sql = await db();
    const rows = await sql`
      SELECT * FROM (
        SELECT id, name, fuel, settled, time_left, worlds, finished_at, run_id = ${run} AS mine,
          ROW_NUMBER() OVER (
            ORDER BY settled DESC,
              CASE WHEN settled THEN ROUND((fuel / 2.0 + time_left / 6.0)::numeric, 2) ELSE 0 END DESC,
              worlds DESC, fuel DESC,
              CASE WHEN settled THEN time_left ELSE -time_left END DESC,
              id ASC
          ) AS rank,
          COUNT(*) OVER () AS total
        FROM scores
      ) ranked
      WHERE ${all} OR rank <= 10 OR mine
      ORDER BY rank
    `;
    const list = rows.map(toJson);
    // Boards ask every 3 seconds and the answer rarely changes. With a hash of it as the ETag, the browser asks
    // "still this?" and an unchanged board comes back as an empty 304 (a proxy that compresses may mark it W/).
    const etag = `"${createHash("sha1").update(JSON.stringify(list)).digest("base64url")}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "no-cache");
    if ((req.headers["if-none-match"] || "").replace(/^W\//, "") === etag) return send(res, 304);
    return send(res, 200, list);
  } catch (err) {
    const missing = err?.code === "NO_DATABASE";
    return send(res, missing ? 503 : 500, { error: missing ? "DATABASE_URL is not set" : "database" });
  }
}
