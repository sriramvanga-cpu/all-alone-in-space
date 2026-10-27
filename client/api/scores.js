import { db, parseScore, readBody, send, toJson } from "./store.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  let body;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { error: "invalid JSON" });
  }
  const parsed = parseScore(body);
  if (parsed.error) return send(res, 400, parsed);
  try {
    const sql = await db();
    const rows = await sql`
      INSERT INTO scores (name, roll_no, phone, run_id, finished_at, settled, time_left, worlds, fuel)
      VALUES (
        ${parsed.name},
        ${parsed.roll},
        ${parsed.phone},
        ${parsed.runId},
        ${parsed.finishedAt},
        ${parsed.settled},
        ${parsed.timeLeft},
        ${parsed.worlds},
        ${parsed.fuel}
      )
      ON CONFLICT (run_id) DO NOTHING
      RETURNING id, name, fuel, settled, time_left, worlds, finished_at
    `;
    // No row back means this run was already saved: a retry, so report success.
    return rows.length ? send(res, 201, toJson(rows[0])) : send(res, 200, { duplicate: true });
  } catch (err) {
    const missing = err?.code === "NO_DATABASE";
    return send(res, missing ? 503 : 500, { error: missing ? "DATABASE_URL is not set" : "database" });
  }
}
