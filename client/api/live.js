import { LIVE_FRESH_S, liveDb, parseLive, readBody, send } from "./store.js";

// GET: who is playing now (the board's "Playing now" panel). POST: a pilot's heartbeat, or { liveId, done: true }
// when their run ends. Names, time left, fuel and worlds only; never a phone number.
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { error: "GET or POST only" });
  let parsed;
  if (req.method === "POST") {
    try {
      parsed = parseLive(await readBody(req));
    } catch {
      return send(res, 400, { error: "invalid JSON" });
    }
    if (parsed.error) return send(res, 400, parsed);
  }
  try {
    const sql = await liveDb();
    if (req.method === "GET") {
      // Oldest first, so the list holds still while pilots come and go. The key is for the screen only: it hides the id.
      // `age` is how stale the heartbeat is, so the screen can count the clock down from the real moment.
      const rows = await sql`
        SELECT substr(md5(live_id), 1, 8) AS key, name, time_left, fuel, worlds,
          extract(epoch FROM now() - updated_at) AS age
        FROM live_runs
        WHERE updated_at > now() - make_interval(secs => ${LIVE_FRESH_S})
        ORDER BY started_at, live_id
        LIMIT 12
      `;
      return send(
        res,
        200,
        rows.map((r) => ({ key: r.key, name: r.name, timeLeft: Number(r.time_left), age: Number(r.age), fuel: Number(r.fuel), worlds: Number(r.worlds) })),
      );
    }
    if (parsed.done) {
      await sql`DELETE FROM live_runs WHERE live_id = ${parsed.liveId}`;
    } else {
      // Rows nobody has touched for an hour are swept out in the same statement.
      await sql`
        WITH swept AS (DELETE FROM live_runs WHERE updated_at < now() - interval '1 hour')
        INSERT INTO live_runs (live_id, name, time_left, fuel, worlds)
        VALUES (${parsed.liveId}, ${parsed.name}, ${parsed.timeLeft}, ${parsed.fuel}, ${parsed.worlds})
        ON CONFLICT (live_id) DO UPDATE SET
          name = EXCLUDED.name, time_left = EXCLUDED.time_left, fuel = EXCLUDED.fuel,
          worlds = EXCLUDED.worlds, updated_at = now()
      `;
    }
    return send(res, 200, { ok: true });
  } catch (err) {
    const missing = err?.code === "NO_DATABASE";
    return send(res, missing ? 503 : 500, { error: missing ? "DATABASE_URL is not set" : "database" });
  }
}
