import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLive, parseScore, toJson } from "./store.js";

const when = "2026-10-16T13:16:00.000Z";

test("score posts keep settled, time left, worlds, and fuel", () => {
  const parsed = parseScore({
    name: " Kirk ",
    settled: true,
    timeLeft: 120,
    worlds: 2,
    fuel: -1.5,
    finishedAt: when,
  });
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.name, "Kirk");
  assert.equal(parsed.settled, true);
  assert.equal(parsed.timeLeft, 120);
  assert.equal(parsed.worlds, 2);
  assert.equal(parsed.fuel, -1.5);
});

test("a score post without settled is an old loss", () => {
  const parsed = parseScore({ name: "Sulu", score: 3, finishedAt: when });
  assert.deepEqual(
    { settled: parsed.settled, timeLeft: parsed.timeLeft, worlds: parsed.worlds, fuel: parsed.fuel },
    { settled: false, timeLeft: 0, worlds: 0, fuel: 3 },
  );
});

test("a long run with leftover fuel is accepted", () => {
  const parsed = parseScore({ name: "Scott", settled: false, timeLeft: 10, worlds: 40, fuel: 50, finishedAt: when });
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.fuel, 50);
  assert.equal(parsed.worlds, 40);
});

test("a score post keeps roll and phone off the board", () => {
  const parsed = parseScore({
    name: "Kirk",
    roll: " 22B81A12 ",
    phone: "98765 43210",
    settled: false,
    timeLeft: 1,
    worlds: 1,
    fuel: 7.5,
    finishedAt: when,
  });
  assert.equal(parsed.roll, "22B81A12");
  assert.equal(parsed.phone, "9876543210");
  const json = toJson({
    id: 1,
    name: parsed.name,
    fuel: parsed.fuel,
    settled: false,
    time_left: 1,
    worlds: 1,
    finished_at: when,
  });
  assert.equal("roll" in json, false);
  assert.equal("phone" in json, false);
});

test("a score post works with a phone and no roll number", () => {
  const parsed = parseScore({ name: "Kirk", phone: "98765 43210", settled: false, timeLeft: 1, worlds: 1, fuel: 0, finishedAt: when });
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.roll, null);
  assert.equal(parsed.phone, "9876543210");
});

test("a score post rejects a bad phone", () => {
  const parsed = parseScore({
    name: "Kirk",
    roll: "22B81A12",
    phone: "123",
    settled: false,
    timeLeft: 1,
    worlds: 1,
    fuel: 0,
    finishedAt: when,
  });
  assert.equal(parsed.error, "phone must be a phone number");
});

test("a score post rejects a bad clock", () => {
  const parsed = parseScore({ name: "Uhura", settled: false, timeLeft: 1.5, worlds: 0, fuel: 0, finishedAt: when });
  assert.equal(parsed.error, "timeLeft and worlds must be whole numbers");
});

test("a score post rejects a name longer than the form allows", () => {
  const parsed = parseScore({ name: "K".repeat(41), settled: false, timeLeft: 1, worlds: 1, fuel: 0, finishedAt: when });
  assert.equal(parsed.error, "name must be at most 40 characters");
});

test("a score post keeps its run id, and old posts without one still work", () => {
  assert.equal(parseScore({ name: "Kirk", runId: "run-1", settled: false, timeLeft: 1, worlds: 1, fuel: 0, finishedAt: when }).runId, "run-1");
  assert.equal(parseScore({ name: "Kirk", settled: false, timeLeft: 1, worlds: 1, fuel: 0, finishedAt: when }).runId, null);
  assert.equal(parseScore({ name: "Kirk", runId: 7, settled: false, timeLeft: 1, worlds: 1, fuel: 0, finishedAt: when }).error, "runId must be a short string");
});

test("a leaderboard row carries its rank and whether it is yours", () => {
  const json = toJson({ id: 7, name: "Kirk", fuel: 3, settled: true, time_left: 60, worlds: 2, finished_at: when, mine: true, rank: "14", total: "230" });
  assert.equal(json.rank, 14);
  assert.equal(json.total, 230);
  assert.equal(json.mine, true);
  assert.equal("rank" in toJson({ id: 1, name: "Spock", fuel: 0, settled: false, time_left: 0, worlds: 0, finished_at: when }), false);
});

test("a heartbeat keeps the name, time left, fuel and worlds, and nothing else", () => {
  const parsed = parseLive({ liveId: "a1", name: " Kirk ", timeLeft: 540, fuel: 7.5, worlds: 2, phone: "5550100100" });
  assert.deepEqual(parsed, { liveId: "a1", name: "Kirk", timeLeft: 540, fuel: 7.5, worlds: 2 });
});

test("a run that ends is just its id and done", () => {
  assert.deepEqual(parseLive({ liveId: "a1", done: true }), { liveId: "a1", done: true });
});

test("a heartbeat with a bad id, name or number is refused", () => {
  const ok = { liveId: "a1", name: "Kirk", timeLeft: 10, fuel: 1, worlds: 1 };
  assert.equal(parseLive(null).error, "body must be a JSON object");
  assert.equal(parseLive({ ...ok, liveId: "" }).error, "liveId must be a short string");
  assert.equal(parseLive({ ...ok, liveId: "x".repeat(65) }).error, "liveId must be a short string");
  assert.equal(parseLive({ ...ok, name: "  " }).error, "name must be a non-empty string");
  assert.equal(parseLive({ ...ok, name: "k".repeat(41) }).error, "name must be at most 40 characters");
  assert.equal(parseLive({ ...ok, timeLeft: 1.5 }).error, "timeLeft and worlds must be whole numbers");
  assert.equal(parseLive({ ...ok, worlds: 56 }).error, "timeLeft and worlds must be whole numbers");
  assert.equal(parseLive({ ...ok, fuel: NaN }).error, "fuel must be a finite number");
  assert.equal(parseLive({ ...ok, fuel: 1e9 }).error, "fuel must be a finite number");
});
