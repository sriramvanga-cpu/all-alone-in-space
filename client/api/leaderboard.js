import { db, send, toJson } from "./store.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });
  try {
    const sql = await db();
    const rows = await sql`
      SELECT id, name, fuel, settled, time_left, worlds, finished_at FROM scores
      ORDER BY settled DESC,
        CASE WHEN settled THEN ROUND((fuel + time_left / 10.0)::numeric, 2) ELSE 0 END DESC,
        worlds DESC, fuel DESC,
        CASE WHEN settled THEN time_left ELSE -time_left END DESC,
        id ASC
      LIMIT 100
    `;
    return send(res, 200, rows.map(toJson));
  } catch (err) {
    const missing = err?.code === "NO_DATABASE";
    return send(res, missing ? 503 : 500, { error: missing ? "DATABASE_URL is not set" : "database" });
  }
}
