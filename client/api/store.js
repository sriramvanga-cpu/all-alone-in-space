import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const here = dirname(fileURLToPath(import.meta.url));
for (const file of [join(here, "../../.env.local"), join(here, "../../.env"), join(here, "../.env")]) {
  if (!process.env.DATABASE_URL && existsSync(file)) process.loadEnvFile(file);
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

let sql;
let ready;

function getSql() {
  if (!process.env.DATABASE_URL) {
    const err = new Error("DATABASE_URL is not set");
    err.code = "NO_DATABASE";
    throw err;
  }
  // HTTP driver: one-shot queries. TCP to Neon times out on this network.
  sql ??= neon(process.env.DATABASE_URL);
  return sql;
}

export async function db() {
  const query = getSql();
  ready ??= (async () => {
    await query`CREATE TABLE IF NOT EXISTS scores (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name text NOT NULL,
      score double precision,
      finished_at timestamptz NOT NULL,
      settled boolean NOT NULL DEFAULT false,
      time_left integer NOT NULL DEFAULT 0,
      worlds integer NOT NULL DEFAULT 0,
      fuel double precision NOT NULL DEFAULT 0
    )`;
    await query`ALTER TABLE scores ADD COLUMN IF NOT EXISTS roll_no text`;
    await query`ALTER TABLE scores ADD COLUMN IF NOT EXISTS phone text`;
    // Old rows keep their score; new rows only write fuel.
    await query`ALTER TABLE scores ALTER COLUMN score DROP NOT NULL`;
    // One id per game, so a retried post can't save the same run twice.
    await query`ALTER TABLE scores ADD COLUMN IF NOT EXISTS run_id text UNIQUE`;
  })().catch((err) => {
    // Forget a failed setup so the next request tries again instead of failing forever.
    ready = undefined;
    throw err;
  });
  await ready;
  return query;
}

function identity(body) {
  const sent = body.roll != null || body.phone != null;
  if (!sent) return { roll: null, phone: null };
  // Roll number is optional (the start screen no longer asks for it); phone is required.
  const roll = typeof body.roll === "string" && body.roll.trim() ? body.roll.trim() : null;
  const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";
  if (roll && roll.length > 32) return { error: "roll must be at most 32 characters" };
  if (phone.length < 10 || phone.length > 15) return { error: "phone must be a phone number" };
  return { roll, phone };
}

export function parseScore(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const { name, finishedAt } = body;
  if (typeof name !== "string" || name.trim() === "") return { error: "name must be a non-empty string" };
  if (name.trim().length > 40) return { error: "name must be at most 40 characters" };
  const runId = body.runId ?? null;
  if (runId !== null && (typeof runId !== "string" || runId.length === 0 || runId.length > 64)) {
    return { error: "runId must be a short string" };
  }
  if (typeof finishedAt !== "string" || !ISO.test(finishedAt) || Number.isNaN(Date.parse(finishedAt))) {
    return { error: "finishedAt must be an ISO-8601 string" };
  }
  const when = new Date(finishedAt).toISOString();
  const who = identity(body);
  if (who.error) return who;
  if (typeof body.settled !== "boolean") {
    if (typeof body.score !== "number" || !Number.isFinite(body.score)) return { error: "score must be a finite number" };
    return { name: name.trim(), ...who, runId, fuel: body.score, settled: false, timeLeft: 0, worlds: 0, finishedAt: when };
  }
  const whole = (n, max) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
  if (!whole(body.timeLeft, 24 * 60 * 60) || !whole(body.worlds, 55)) {
    return { error: "timeLeft and worlds must be whole numbers" };
  }
  if (typeof body.fuel !== "number" || !Number.isFinite(body.fuel)) return { error: "fuel must be a finite number" };
  return {
    name: name.trim(),
    ...who,
    runId,
    fuel: body.fuel,
    settled: body.settled,
    timeLeft: body.timeLeft,
    worlds: body.worlds,
    finishedAt: when,
  };
}

export function toJson(row) {
  const when = row.finished_at instanceof Date ? row.finished_at : new Date(row.finished_at);
  return {
    id: Number(row.id),
    name: row.name,
    fuel: Number(row.fuel),
    settled: row.settled === true || row.settled === 1,
    timeLeft: Number(row.time_left),
    worlds: Number(row.worlds),
    finishedAt: when.toISOString(),
    ...(row.rank != null && { rank: Number(row.rank), total: Number(row.total), mine: row.mine === true }),
  };
}

export function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(code === 204 ? undefined : JSON.stringify(obj));
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString());
}
