#!/usr/bin/env node
// Admin tasks, run from a computer with DATABASE_URL set (the same database the Vercel app uses):
//
//   node scripts/admin.mjs init                       create or upgrade the tables (idempotent; run it again after
//                                                     every update of the site)
//   node scripts/admin.mjs load-questions data/questions.json   load or update the 250 questions for review (v2); a
//                                                     question with reviews or a started reference is never changed
//   node scripts/admin.mjs load data/sets.json        load or update the rating sets (a set with annotations is never changed)
//   node scripts/admin.mjs add-admin "Your name"      an admin account; prints its access token once
//   node scripts/admin.mjs add "Dr A" [email]         a clinician account; prints the personal link once
//   node scripts/admin.mjs add "Name (test)" [email] --test [--refs N]
//                                                     a test account, for trying the site: its entries are left out of
//                                                     the exports unless asked for, and it gets N demo references
//                                                     (default 3), so that its login shows every task
//   node scripts/admin.mjs set-test ID yes|no         make an account a test account, or a real one
//   node scripts/admin.mjs list                       accounts and progress
//   node scripts/admin.mjs assign --annotators 2,3,4 [--calibration 10] [--overlap 0.2] [--per-annotator N] [--seed 1]
//                                                     assign rating sets (the v1 rating mode; not needed for review)
//   node scripts/admin.mjs reset-token ID             new link for a lost one (the old link stops working)
//   node scripts/admin.mjs assign-refs --annotators 2,3 --base-ids ids.txt
//                                                     Phase 1A: each listed question (one base id per line, in that
//                                                     order) to each listed doctor for a blind reference (answer key)
//   node scripts/admin.mjs assign-refs --csv refs.csv  the same from a CSV with columns annotator_id,base_id
//                                                     Every pair is checked before any is assigned: an unknown doctor
//                                                     or question stops the command with nothing assigned. Skipped,
//                                                     with a note: pairs the doctor is not blind for, and questions
//                                                     with no "Not stated" wording (no Stage 1 question to show)
//   node scripts/admin.mjs unassign-refs ID BASE_ID [--force]
//                                                     take back an assignment; with --force also one that has been
//                                                     started (the reference is removed; its saves stay in the log)
//   node scripts/admin.mjs reopen-stage1 ID BASE_ID   for a Stage 1 saved by mistake: Stage 1 opens again, Stage 2 is
//                                                     cleared (it stays in the log), and the export counts the
//                                                     reopening; a question marked outside the doctor's expertise
//                                                     stays so marked until the doctor undoes that
//
// APP_URL (e.g. https://your-app.vercel.app) is used to print the links.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_REFS, HAS_NEUTRAL, assignDemoRefs, db, hashToken, newToken } from "../api/_lib.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const [cmd, ...args] = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name) => args.includes(`--${name}`);
// the arguments that are neither options nor an option's value
const VALUE_OPTIONS = ["annotators", "base-ids", "csv", "calibration", "overlap", "per-annotator", "seed", "refs"];
const plain = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_OPTIONS.includes(args[i - 1].replace(/^--/, "")) && args[i - 1].startsWith("--")));

// run fn(client) in one transaction
async function transaction(fn) {
  const c = await db().connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

// deterministic shuffle (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(xs, r) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Interleave strata (axis x label) so that every prefix of the order has about the same mix as the whole.
function stratifiedOrder(sets, r) {
  const strata = new Map();
  for (const s of shuffle(sets, r)) {
    const k = `${s.axis}|${s.label}`;
    if (!strata.has(k)) strata.set(k, []);
    strata.get(k).push(s);
  }
  const groups = [...strata.values()].map((items) => ({ items, taken: 0 }));
  const out = [];
  while (out.length < sets.length) {
    const g = groups.filter((g) => g.taken < g.items.length)
      .sort((a, b) => (a.taken + 1) / a.items.length - (b.taken + 1) / b.items.length)[0];
    out.push(g.items[g.taken++]);
  }
  return out;
}

async function main() {
  const q = (sql, p) => db().query(sql, p);
  if (cmd === "init") {
    await q(fs.readFileSync(path.join(here, "..", "schema.sql"), "utf8"));
    console.log("tables ready");
  } else if (cmd === "load-questions") {
    const file = args[0] || path.join(here, "..", "data", "questions.json");
    const { questions } = JSON.parse(fs.readFileSync(file, "utf8"));
    // a question a doctor has worked on (a review, or a reference that has been started) keeps the wording they saw
    const used = new Set((await q("select base_id from reviews union select base_id from clinician_refs")).rows.map((r) => r.base_id));
    let added = 0, updated = 0, kept = 0;
    for (const x of questions) {
      const cur = (await q("select payload from questions where base_id = $1", [x.base_id])).rows[0];
      if (cur && used.has(x.base_id)) {
        if (JSON.stringify(cur.payload) !== JSON.stringify(x)) console.warn(`kept ${x.base_id}: it already has reviews or a started reference`);
        kept++;
        continue;
      }
      await q(`insert into questions (base_id, position, payload) values ($1, $2, $3)
               on conflict (base_id) do update set position = excluded.position, payload = excluded.payload, loaded_at = now()`,
        [x.base_id, x.order, x]);
      cur ? updated++ : added++;
    }
    console.log(`${questions.length} questions in file: ${added} added, ${updated} updated, ${kept} kept (already reviewed, or a reference started)`);
  } else if (cmd === "load") {
    const file = args[0] || path.join(here, "..", "data", "sets.json");
    const { sets } = JSON.parse(fs.readFileSync(file, "utf8"));
    const used = new Set((await q("select distinct set_id from annotations")).rows.map((r) => r.set_id));
    let added = 0, updated = 0, kept = 0;
    for (const s of sets) {
      const cur = (await q("select payload from sets where set_id = $1", [s.set_id])).rows[0];
      if (cur && used.has(s.set_id)) {
        if (JSON.stringify(cur.payload) !== JSON.stringify(s)) console.warn(`kept ${s.set_id}: it already has annotations`);
        kept++;
        continue;
      }
      await q(`insert into sets (set_id, base_id, axis, batch, payload) values ($1, $2, $3, $4, $5)
               on conflict (set_id) do update set base_id = excluded.base_id, axis = excluded.axis,
                 batch = excluded.batch, payload = excluded.payload, loaded_at = now()`,
        [s.set_id, s.base_id, s.axis, s.batch, s]);
      cur ? updated++ : added++;
    }
    console.log(`${sets.length} sets in file: ${added} added, ${updated} updated, ${kept} kept (already annotated)`);
  } else if (cmd === "add" || cmd === "add-admin") {
    const [name, email] = plain;
    if (!name) throw new Error("usage: add NAME [EMAIL] [--test [--refs N]]");
    const token = newToken();
    const role = cmd === "add-admin" ? "admin" : "clinician", test = has("test");
    if (test && role === "admin") throw new Error("an admin account cannot be a test account");
    if (has("refs") && !test) throw new Error("--refs is for test accounts (--test); give a doctor references with assign-refs");
    const { rows } = await q("insert into annotators (name, email, role, token_hash, is_test) values ($1, $2, $3, $4, $5) returning id",
      [name, email || null, role, hashToken(token), test]);
    console.log(`${role} #${rows[0].id} ${name}${test ? " (test account: left out of the exports unless asked for)" : ""}`);
    if (test) console.log(`demo references assigned: ${await assignDemoRefs(q, rows[0].id, opt("refs", DEMO_REFS))}`);
    console.log(role === "admin" ? `admin page: ${APP_URL}/admin.html#k=${token}` : `personal link: ${APP_URL}/#k=${token}`);
    console.log("(shown once; the database stores only a hash)");
  } else if (cmd === "set-test") {
    const [id, v] = plain;
    if (!id || !["yes", "no"].includes(v)) throw new Error("usage: set-test ID yes|no");
    const { rows } = await q("update annotators set is_test = $2 where id = $1 and role = 'clinician' returning name", [id, v === "yes"]);
    if (!rows[0]) throw new Error("no such clinician account");
    console.log(`#${id} ${rows[0].name}: ${v === "yes" ? "test account (left out of the exports unless asked for)" : "real account (in the exports)"}`);
  } else if (cmd === "reset-token") {
    const token = newToken();
    const { rows } = await q("update annotators set token_hash = $2 where id = $1 returning name, role", [args[0], hashToken(token)]);
    if (!rows[0]) throw new Error("no such annotator");
    console.log(`${rows[0].name}: ${APP_URL}/${rows[0].role === "admin" ? "admin.html" : ""}#k=${token}`);
  } else if (cmd === "list") {
    const { rows } = await q(
      `select t.id, t.name, t.role, t.active, t.is_test as test, count(a.set_id)::int as assigned,
              count(n.set_id) filter (where n.status = 'complete')::int as complete,
              (select count(*) from ref_assignments r where r.annotator_id = t.id)::int as refs_assigned,
              (select count(*) from clinician_refs c where c.annotator_id = t.id and c.status = 'complete')::int as refs_complete
         from annotators t left join assignments a on a.annotator_id = t.id
         left join annotations n on n.annotator_id = a.annotator_id and n.set_id = a.set_id
        group by t.id order by t.id`);
    console.table(rows);
  } else if (cmd === "assign-refs") {
    // pairs (doctor, base question) in order: from --annotators x --base-ids, or from --csv
    let pairs = [];
    if (opt("csv")) {
      const [head, ...lines] = fs.readFileSync(opt("csv"), "utf8").replace(/^\ufeff/, "").split(/\r?\n/).filter((l) => l.trim());
      const cols = head.split(",").map((c) => c.trim());
      const ia = cols.indexOf("annotator_id"), ib = cols.indexOf("base_id");
      if (ia < 0 || ib < 0) throw new Error("the CSV needs the columns annotator_id,base_id");
      pairs = lines.map((l) => l.split(",")).map((c, i) => {
        if (c[ia] === undefined || c[ib] === undefined) throw new Error(`the CSV's line ${i + 2} has too few columns`);
        return [Number(c[ia]), c[ib].trim()];
      });
    } else {
      const ids = String(opt("annotators", "")).split(",").map(Number).filter(Boolean);
      if (!ids.length || !opt("base-ids")) throw new Error("use --annotators 2,3 --base-ids FILE, or --csv FILE");
      const bases = fs.readFileSync(opt("base-ids"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      pairs = ids.flatMap((id) => bases.map((b) => [id, b]));
    }
    const docs = new Map((await q("select id, name, role, active from annotators")).rows.map((r) => [r.id, r]));
    // each question, and whether it has a "Not stated" wording for Stage 1 to show (27 of the 250 do not)
    const qs = new Map((await q(`select q.base_id, ${HAS_NEUTRAL} as has_neutral from questions q`)).rows.map((r) => [r.base_id, r.has_neutral]));
    const have = new Set((await q("select annotator_id || '|' || base_id as k from ref_assignments")).rows.map((r) => r.k));
    const seen = new Set((await q("select distinct annotator_id || '|' || base_id as k from view_log where mode = 'rating'")).rows.map((r) => r.k));
    const reviewed = new Set((await q("select distinct annotator_id || '|' || base_id as k from view_log where mode = 'review'")).rows.map((r) => r.k));
    const rated = new Set((await q(
      "select distinct a.annotator_id || '|' || s.base_id as k from assignments a join sets s using (set_id)")).rows.map((r) => r.k));
    // 1. check every pair before anything is assigned (before 11 Nov 2026's second update, a mistake half-way down the
    //    list stopped the command with the pairs above it already assigned)
    const errors = [];
    for (const [id, b] of pairs) {
      const d = docs.get(id);
      const e = !d || d.role !== "clinician" ? `no clinician with id ${id}`
        : !d.active ? `${d.name} (#${id}) is deactivated`
        : !qs.has(b) ? `unknown base id ${b} (load the questions first)` : null;
      if (e && !errors.includes(e)) errors.push(e);
    }
    if (errors.length) throw new Error(`nothing was assigned:\n  ${errors.join("\n  ")}`);
    // 2. assign, all in one transaction
    const tally = { added: 0, already: 0, not_blind: 0, no_neutral: 0, reviewed: 0 };
    await transaction(async (c) => {
      const pos = new Map();
      for (const [id, b] of pairs) {
        const d = docs.get(id), k = `${id}|${b}`;
        if (have.has(k)) { tally.already++; continue; }
        if (seen.has(k)) {
          console.warn(`skipped ${b} for ${d.name}: opened in the rating mode, so not blind for it`);
          tally.not_blind++;
          continue;
        }
        if (!qs.get(b)) {
          console.warn(`skipped ${b} for ${d.name}: the question has no "Not stated" wording, so Stage 1 would have nothing to show`);
          tally.no_neutral++;
          continue;
        }
        if (rated.has(k)) console.warn(`note: ${d.name} also has a rating set for ${b}; the rating mode stays closed for it until the reference is done`);
        if (reviewed.has(k)) tally.reviewed++;
        if (!pos.has(id)) pos.set(id, (await c.query("select coalesce(max(position), 0)::int as p from ref_assignments where annotator_id = $1", [id])).rows[0].p);
        pos.set(id, pos.get(id) + 1);
        await c.query("insert into ref_assignments (annotator_id, base_id, mode, position) values ($1, $2, 'blind', $3)", [id, b, pos.get(id)]);
        have.add(k);
        tally.added++;
      }
    });
    console.log(`blind references: ${tally.added} assigned, ${tally.already} already assigned, ${tally.not_blind} skipped (not blind), `
      + `${tally.no_neutral} skipped (no "Not stated" wording)`);
    if (tally.reviewed) console.log(`note: for ${tally.reviewed} of the assigned, the doctor has already opened the question on the review page, `
      + "which shows its demographic versions: Stage 1 is then not written on the \"Not stated\" question alone. "
      + "The references export marks these (review_open_before_stage1).");
  } else if (cmd === "unassign-refs") {
    const [id, b] = plain;
    if (!id || !b) throw new Error("usage: unassign-refs ANNOTATOR_ID BASE_ID [--force]");
    const cur = (await q("select data, status, stage1_locked_at, form_version from clinician_refs where annotator_id = $1 and base_id = $2", [id, b])).rows[0];
    if (cur && !has("force"))
      throw new Error("this reference has been started; it is kept (the doctor can mark it as outside their expertise). "
        + "To remove it all the same, add --force: its saves stay in the log");
    // with --force: the started reference goes, after one more log row that says who removed it; every save stays in the log
    const n = await transaction(async (c) => {
      if (cur) {
        await c.query(
          `insert into clinician_ref_log (annotator_id, base_id, data, status, action, stage1_locked, active_s, form_version)
           values ($1, $2, $3, $4, 'admin_unassign', $5, 0, $6)`, [id, b, cur.data, cur.status, !!cur.stage1_locked_at, cur.form_version]);
        await c.query("delete from clinician_refs where annotator_id = $1 and base_id = $2", [id, b]);
      }
      return (await c.query("delete from ref_assignments where annotator_id = $1 and base_id = $2", [id, b])).rowCount;
    });
    console.log(!n ? "no such assignment" : cur
      ? `unassigned ${b} from #${id}; the started reference (${cur.status}) was removed, and its saves stay in clinician_ref_log`
      : `unassigned ${b} from #${id}`);
  } else if (cmd === "reopen-stage1") {
    const [id, b] = plain;
    if (!id || !b) throw new Error("usage: reopen-stage1 ANNOTATOR_ID BASE_ID");
    const cur = (await q("select data, status, form_version, stage1_locked_at from clinician_refs where annotator_id = $1 and base_id = $2", [id, b])).rows[0];
    if (!cur?.stage1_locked_at) throw new Error("Stage 1 of this reference has not been saved, so there is nothing to reopen");
    if ((await q("select 1 from view_log where annotator_id = $1 and base_id = $2 and mode = 'rating' limit 1", [id, b])).rows.length)
      throw new Error("this doctor has opened the question in the rating mode, so the reference can no longer be changed");
    // Stage 1 opens again with what was saved. Stage 2 is cleared, because its permitted differences point at Stage 1's
    // essential points by number; the log keeps it.
    const { axes, ...stage1 } = cur.data || {};
    // a question the doctor marked as outside their expertise stays so marked: only the doctor undoes that (before
    // 11 Nov 2026's second update, reopening quietly undid it)
    const status = cur.status === "declined" ? "declined" : "in_progress";
    await transaction(async (c) => {
      await c.query(
        `update clinician_refs set data = $3, status = $4, stage1_locked_at = null, completed_at = null,
                stage1_reopens = stage1_reopens + 1, updated_at = now() where annotator_id = $1 and base_id = $2`, [id, b, stage1, status]);
      await c.query(
        `insert into clinician_ref_log (annotator_id, base_id, data, status, action, stage1_locked, active_s, form_version)
         values ($1, $2, $3, $4, 'admin_reopen_stage1', false, 0, $5)`, [id, b, stage1, status, cur.form_version]);
    });
    console.log(`Stage 1 reopened for #${id} ${b}. Stage 2 was cleared (${Object.keys(axes || {}).length} details answered; they stay in the log).`);
    console.log("The doctor has now seen the demographic versions before finishing Stage 1: the export counts this (stage1_reopens).");
    if (status === "declined") console.log("The question is still marked as outside the doctor's expertise: the doctor undoes that on the page before writing.");
  } else if (cmd === "assign") {
    const ids = String(opt("annotators", "")).split(",").map(Number).filter(Boolean);
    if (!ids.length) throw new Error("--annotators 2,3,4 is required");
    const nCal = Number(opt("calibration", 10)), overlap = Number(opt("overlap", 0.2));
    const perAnn = opt("per-annotator") ? Number(opt("per-annotator")) : Infinity;
    const r = rng(Number(opt("seed", 1)));
    const all = (await q("select set_id, axis, payload->>'label' as label from sets order by set_id")).rows;
    const assigned = new Set((await q("select distinct set_id from assignments")).rows.map((x) => x.set_id));
    const order = stratifiedOrder(all, r);
    const pos = new Map();
    for (const id of ids) pos.set(id, (await q("select coalesce(max(position), 0)::int as p from assignments where annotator_id = $1", [id])).rows[0].p);
    const add = async (id, setId, kind) => {
      pos.set(id, pos.get(id) + 1);
      await q("insert into assignments (annotator_id, set_id, position, kind) values ($1, $2, $3, $4) on conflict do nothing",
        [id, setId, pos.get(id), kind]);
    };
    // calibration: the same sets for everyone, first in the order
    const cal = (await q("select distinct set_id from assignments where kind = 'calibration'")).rows.map((x) => x.set_id);
    const calSets = cal.length ? cal : order.slice(0, nCal).map((s) => s.set_id);
    for (const id of ids) for (const s of calSets) await add(id, s, "calibration");
    // main: round-robin over the rest; every 1/overlap-th set also goes to the next annotator
    const rest = order.filter((s) => !calSets.includes(s.set_id) && !assigned.has(s.set_id));
    const count = new Map(ids.map((id) => [id, 0]));
    const every = overlap > 0 ? Math.round(1 / overlap) : 0;
    let k = 0, n = 0;
    for (const s of rest) {
      const a = ids[k % ids.length];
      if (count.get(a) >= perAnn) break;
      await add(a, s.set_id, "main");
      count.set(a, count.get(a) + 1);
      n++;
      if (every && ids.length > 1 && n % every === 0) await add(ids[(k + 1) % ids.length], s.set_id, "overlap");
      k++;
    }
    console.log(`calibration: ${calSets.length} sets x ${ids.length} annotators; main: ${n} sets; overlap every ${every || "-"}th`);
  } else {
    // the usage notes at the top of this file
    const lines = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
    console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n"));
  }
  await db().end();
}

main().catch(async (e) => {
  console.error(e.message || e);
  try { await db().end(); } catch {}
  process.exit(1);
});
