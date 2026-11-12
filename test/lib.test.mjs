// The shared server helpers added on 11 Nov 2026: CSV cells, the contact setting, request bodies, demo references.
import assert from "node:assert/strict";
import test from "node:test";
import { BadRequest, assignDemoRefs, contact, csvCell, readBody, stale, staleReply } from "../api/_lib.js";

test("a CSV cell a spreadsheet would run as a formula gets a leading apostrophe; other cells are unchanged", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+65 6123 4567"), "'+65 6123 4567");
  assert.equal(csvCell("-the Malay version reads oddly"), "'-the Malay version reads oddly");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("\tx"), "'\tx");
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(csvCell("a = b, c"), '"a = b, c"');
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell(-3), "-3"); // a number is not text typed by a doctor
  assert.equal(csvCell(12.5), "12.5");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("the contact comes from CONTACT_EMAIL and CONTACT_NAME; something that is not an address is ignored", () => {
  const saved = { e: process.env.CONTACT_EMAIL, n: process.env.CONTACT_NAME };
  const set = (e, n) => {
    for (const [k, v] of [["CONTACT_EMAIL", e], ["CONTACT_NAME", n]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  };
  try {
    set(undefined, undefined);
    assert.equal(contact(), null);
    set(" study@example.org ", " Study team ");
    assert.deepEqual(contact(), { name: "Study team", email: "study@example.org" });
    set("study@example.org", undefined);
    assert.deepEqual(contact(), { name: null, email: "study@example.org" });
    set(undefined, "Study team");
    assert.deepEqual(contact(), { name: "Study team", email: null });
    for (const bad of ["not an address", "a@b", '"><script>@x.y', "a b@example.org"]) {
      set(bad, undefined);
      assert.equal(contact(), null, bad);
    }
  } finally {
    set(saved.e, saved.n);
  }
});

test("a request body must be a JSON object: anything else is a bad request, not a server error", async () => {
  const stream = (s) => ({ async *[Symbol.asyncIterator]() { yield Buffer.from(s); } });
  assert.deepEqual(await readBody(stream('{"a":1}')), { a: 1 });
  assert.deepEqual(await readBody(stream("")), {});
  for (const bad of ["{not json", "null", "[1,2]", "3", '"text"'])
    await assert.rejects(() => readBody(stream(bad)), BadRequest, bad);
  // Vercel parses the body itself: the value arrives ready, or its getter throws when the text is not JSON
  assert.deepEqual(await readBody({ body: { a: 1 } }), { a: 1 });
  assert.deepEqual(await readBody({ body: '{"a":1}' }), { a: 1 });
  await assert.rejects(() => readBody({ get body() { throw new Error("Invalid JSON"); } }), BadRequest);
  await assert.rejects(() => readBody({ body: null }), BadRequest);
});

test("demo references: questions with three, two and one axes in turn, none twice, ten at most", async () => {
  const questions = [["q1", 1], ["q2", 2], ["q3", 3], ["q4", 2], ["q5", 3], ["q6", 1]]; // in the review order
  const assigned = [];
  const q = async (sql, p) => {
    if (sql.includes("from questions")) return { rows: questions.filter(([id]) => !assigned.some((a) => a.id === id)).map(([base_id, axes]) => ({ base_id, axes })) };
    if (sql.includes("max(position)")) return { rows: [{ p: assigned.length }] };
    if (sql.startsWith("insert into ref_assignments")) return assigned.push({ id: p[1], position: p[2] }), { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  };
  assert.equal(await assignDemoRefs(q, 7, 3), 3);
  assert.deepEqual(assigned, [{ id: "q3", position: 1 }, { id: "q2", position: 2 }, { id: "q1", position: 3 }]);
  assert.equal(await assignDemoRefs(q, 7, 99), 3); // capped at ten, and only three questions are left
  assert.deepEqual(assigned.slice(3), [{ id: "q5", position: 4 }, { id: "q4", position: 5 }, { id: "q6", position: 6 }]);
  assert.equal(await assignDemoRefs(q, 7, 2), 0);
  assert.equal(await assignDemoRefs(q, 7, 0), 0);
  assert.equal(await assignDemoRefs(q, 7, "abc"), 0);
});

test("a save from a page that is out of date is told apart by the updated_at the page holds (seen)", () => {
  const t = "2026-11-11T10:00:00.123Z";
  assert.equal(stale({}, t), false, "a request without seen (an older page) is not checked");
  assert.equal(stale({ seen: t }, new Date(t)), false);
  assert.equal(stale({ seen: t }, t), false);
  assert.equal(stale({ seen: null }, null), false, "first save: the page holds nothing, and nothing is stored");
  assert.equal(stale({ seen: null }, undefined), false);
  assert.equal(stale({ seen: null }, new Date(t)), true, "something was saved elsewhere since the page opened");
  assert.equal(stale({ seen: t }, new Date("2026-11-11T10:00:05.000Z")), true, "a later save is stored");
  assert.equal(stale({ seen: t }, null), true, "the stored row is gone");
  assert.equal(stale({ seen: "not a time" }, new Date(t)), true);
  assert.equal(staleReply("review").stale, true);
  assert.match(staleReply("review").error, /Reload the page/);
});
