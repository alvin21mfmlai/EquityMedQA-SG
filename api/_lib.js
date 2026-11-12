// Shared helpers for the API functions (Vercel Node runtime; also used by dev/server.mjs).
import crypto from "node:crypto";
import pg from "pg";

let pool;
export function db() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Neon needs TLS; a local Postgres (dev) does not
    const local = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url);
    pool = new pg.Pool({ connectionString: url, max: 3, ssl: local ? false : { rejectUnauthorized: true } });
  }
  return pool;
}

export const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
export const newToken = () => crypto.randomBytes(24).toString("base64url");

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function bearer(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

// The annotator for this request, or null (and a 401 already sent).
export async function auth(req, res, { admin = false } = {}) {
  const token = bearer(req);
  if (!token) return send(res, 401, { error: "missing access token" }), null;
  const { rows } = await db().query(
    "select id, name, role, is_test from annotators where token_hash = $1 and active", [hashToken(token)]);
  const me = rows[0];
  if (!me) return send(res, 401, { error: "unknown or inactive access token" }), null;
  if (admin && me.role !== "admin") return send(res, 403, { error: "admin only" }), null;
  return me;
}

// Wrap a handler: method check and uniform error replies.
export function handler(methods, fn) {
  return async (req, res) => {
    if (!methods.includes(req.method)) return send(res, 405, { error: `use ${methods.join(" or ")}` });
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof BadRequest) return send(res, 400, { error: e.message });
      console.error(e);
      send(res, 500, { error: "server error" });
    }
  };
}

// A request the caller got wrong: answered with 400 and this message (not "server error").
export class BadRequest extends Error {}

// The request's JSON body as an object. Anything else (text that is not JSON, a list, a number, null) is a bad request.
export async function readBody(req) {
  let v;
  try {
    if (req.body !== undefined) v = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
    else {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const s = Buffer.concat(chunks).toString("utf8");
      v = s ? JSON.parse(s) : {};
    }
  } catch {
    throw new BadRequest("the request is not valid JSON");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BadRequest("the request must be a JSON object");
  return v;
}

// One CSV cell. Text that a spreadsheet would run as a formula (it starts with = + - @, a tab or a carriage return)
// gets a leading apostrophe; numbers are left alone. The JSON exports carry the text exactly as typed.
export const csvCell = (v) => {
  let s = String(v ?? "");
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Who doctors can contact, from the project's environment variables CONTACT_EMAIL and CONTACT_NAME (both optional;
// an address that does not look like one is ignored). null when neither is set: the pages then show no contact.
export function contact() {
  const name = String(process.env.CONTACT_NAME || "").trim().slice(0, 120);
  const raw = String(process.env.CONTACT_EMAIL || "").trim();
  const email = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(raw) ? raw.slice(0, 200) : "";
  return name || email ? { name: name || null, email: email || null } : null;
}

// Has the stored row changed since the page loaded it (11 Nov 2026, second review)? body.seen is the updated_at of the
// copy the page holds (null: nothing saved yet); current is the stored row's updated_at (null or undefined: no row).
// A save from a page that is out of date is refused (409), so that a tab left open cannot overwrite later work.
// A request without "seen" (a page loaded before this update) is not checked.
export function stale(body, current) {
  if (!("seen" in body)) return false;
  const seen = body.seen == null ? null : Date.parse(body.seen), cur = current == null ? null : new Date(current).getTime();
  return seen !== cur;
}
export const staleReply = (what) => ({ stale: true, error: `This page is out of date: a later version of this ${what} is `
  + "already saved (from another tab or device, or by a save whose reply did not arrive). Nothing was saved from this "
  + "page just now. Reload the page to carry on from the saved version." });

// SQL (the questions table as q): does every axis of the question have a "Not stated" (neutral) version? 27 of the 250
// do not: there the detail is the question's subject ("Do [ethnic group] people have thicker skin ...?"), and with it
// left out the "Not stated" wording means nothing. Such a question is listed by its template, and it gets no blind
// answer key, because Stage 1 would have no question to show (11 Nov 2026, second review).
export const HAS_NEUTRAL = `not exists (select 1 from jsonb_array_elements(q.payload->'axes') ax
            where not exists (select 1 from jsonb_array_elements(ax->'versions') v where v->>'value' = 'neutral'))`;
export const TITLE = `case when ${HAS_NEUTRAL} then q.payload->>'neutral_question' else q.payload->>'template_display' end`;

export const DEMO_REFS = 3; // how many a new test account gets unless told otherwise

// Demo answer keys for a test account, so that its login shows the Phase 1A form: up to n (at most 10) questions the
// account does not have yet (and that have a "Not stated" wording), taking in turn the first question (in the review order) with three, two and one
// demographic axes. q is (sql, params) => result. Returns how many were assigned.
export async function assignDemoRefs(q, annotatorId, n) {
  n = Math.max(0, Math.min(10, Math.floor(Number(n) || 0)));
  if (!n) return 0;
  const { rows } = await q(
    `select q.base_id, jsonb_array_length(q.payload->'axes') as axes from questions q
      where q.base_id not in (select base_id from ref_assignments where annotator_id = $1) and ${HAS_NEUTRAL}
      order by q.position`, [annotatorId]);
  const by = { 3: [], 2: [], 1: [] };
  for (const r of rows) by[r.axes]?.push(r.base_id);
  const picked = [];
  for (let i = 0; picked.length < n && (by[3].length || by[2].length || by[1].length); i++) {
    const next = by[[3, 2, 1][i % 3]].shift();
    if (next) picked.push(next);
  }
  let pos = (await q("select coalesce(max(position), 0)::int as p from ref_assignments where annotator_id = $1", [annotatorId])).rows[0].p;
  for (const b of picked)
    await q("insert into ref_assignments (annotator_id, base_id, mode, position) values ($1, $2, 'blind', $3)", [annotatorId, b, ++pos]);
  return picked.length;
}
