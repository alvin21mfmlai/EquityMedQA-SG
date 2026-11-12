// Phase 1A: blind references written by doctors (2 Nov 2026).
//   GET  /api/ref              -> my assigned references, in order, with their status
//   GET  /api/ref?id=BASE_ID   -> one assigned reference: the question as this stage shows it, and my reference so far.
//        Stage 1 shows the "Not stated" question only; the template and the demographic axes are sent only after Stage 1
//        is locked, as for the AI drafters (Phase 0). Every open is logged in view_log (mode 'reference').
//   POST /api/ref {base_id, data, action, active_s} -> save. action: null (autosave) | lock_stage1 | complete | decline
//        (outside my expertise) | undecline. Stage 1 cannot change once locked, and Stage 2 is not stored before that.
//        Every save is appended to clinician_ref_log.
// Blind rule: a doctor who opened the question in the rating mode (answers and the AI reference) before finishing the
// reference cannot open or save it (409); api/set.js refuses the rating mode while a blind reference is unfinished.
// A complete reference stays open to read after such an open, but it is read only from then on (11 Nov 2026): any
// change would be made after seeing the answers, so every save is refused (409).
// On the pages a reference is called an "answer key", the name the study's poster and reports use.
// 11 Nov 2026, second review: a save runs wholly inside one transaction that first locks the assignment's row, so two
// saves for the same reference cannot cross; a save from a page that is out of date is refused (409, _lib.js stale);
// and a question without a "Not stated" wording cannot be started (409): Stage 1 would have nothing to show.
import { HAS_NEUTRAL, TITLE, auth, db, handler, readBody, send, stale, staleReply } from "./_lib.js";
import { REF_FORM_VERSION, STAGE1_KEYS, cleanRef, missingStage1, missingStage2, refAxes } from "../public/ref_forms.js";

const NOT_BLIND = "You have seen answers and an AI-drafted answer key for this question in the rating task, so you cannot "
  + "write a blind answer key for it. Please tell the study team.";
const NO_NEUTRAL = "This question is about the patient's ethnicity, sex or religion itself, so it has no wording with that "
  + "detail left out, and it cannot have a blind answer key. Please tell the study team.";
const READ_ONLY = "This answer key is complete, and you have since seen answers for this question in the rating task, so "
  + "it can no longer be changed. If something in it is wrong, please tell the study team.";

// exposed: opened in the rating mode before the reference was complete (or while it is unfinished): not blind.
// read_only: complete, and opened in the rating mode since: blind as it stands, so it may be read but not changed.
const BLIND_COLUMNS = `
            exists (select 1 from view_log v where v.annotator_id = a.annotator_id and v.base_id = a.base_id
                      and v.mode = 'rating' and v.opened_at < coalesce(r.completed_at, now())) as exposed,
            (r.status = 'complete' and exists (select 1 from view_log v where v.annotator_id = a.annotator_id
                      and v.base_id = a.base_id and v.mode = 'rating' and v.opened_at >= r.completed_at)) is true as read_only`;

async function load(me, id, c = db()) {
  const { rows } = await c.query(
    `select a.mode, a.position, q.payload, r.data, r.status, r.stage1_locked_at, r.updated_at,
            not (${HAS_NEUTRAL}) as no_neutral,${BLIND_COLUMNS}
       from ref_assignments a join questions q using (base_id)
       left join clinician_refs r on r.annotator_id = a.annotator_id and r.base_id = a.base_id
      where a.annotator_id = $1 and a.base_id = $2`, [me.id, id]);
  return rows[0];
}

// why this reference cannot be opened or saved, as [status, reply], or null
function refusal(r) {
  if (!r) return [404, { error: "answer key not found or not assigned to you" }];
  if (r.exposed) return [409, { error: NOT_BLIND }];
  if (r.mode !== "blind") return [409, { error: "this kind of answer key is not available yet" }];
  // one that was started before this rule (an earlier version of the site) stays open: the study team decides about it
  if (r.no_neutral && !r.status) return [409, { error: NO_NEUTRAL }];
  return null;
}

async function list(req, res, me) {
  const { rows } = await db().query(
    `select a.base_id, a.position, a.mode, ${TITLE} as title, not (${HAS_NEUTRAL}) as no_neutral,
            coalesce(r.status, 'not_started') as status, r.stage1_locked_at is not null as stage1_locked, r.updated_at,${BLIND_COLUMNS}
       from ref_assignments a join questions q using (base_id)
       left join clinician_refs r on r.annotator_id = a.annotator_id and r.base_id = a.base_id
      where a.annotator_id = $1 order by a.position`, [me.id]);
  send(res, 200, { references: rows });
}

async function open(req, res, me, id) {
  const r = await load(me, id);
  const no = refusal(r);
  if (no) return send(res, ...no);
  await db().query("insert into view_log (annotator_id, mode, base_id) values ($1, 'reference', $2)", [me.id, id]);
  const p = r.payload, locked = !!r.stage1_locked_at;
  const question = { base_id: p.base_id, neutral_question: p.neutral_question,
                     ...(locked ? { template_display: p.template_display, axes: refAxes(p) } : {}) };
  const nav = await db().query(
    `select (select base_id from ref_assignments where annotator_id = $1 and position < $2 order by position desc limit 1) as prev,
            (select base_id from ref_assignments where annotator_id = $1 and position > $2 order by position limit 1) as next`,
    [me.id, r.position]);
  send(res, 200, { question, mode: r.mode, reference: r.data || {}, status: r.status || "not_started",
                   stage1_locked: locked, read_only: r.read_only, updated_at: r.updated_at, ...nav.rows[0] });
}

async function save(req, res, me) {
  const body = await readBody(req);
  const id = String(body.base_id || ""), action = body.action || null;
  const c = await db().connect();
  let open = false;
  // answer and end the transaction; nothing is stored unless commit is asked for
  const end = async (status, reply, commit = false) => {
    await c.query(commit ? "commit" : "rollback");
    open = false;
    send(res, status, reply);
  };
  try {
    await c.query("begin");
    open = true;
    // one save at a time for this doctor and question: a second one waits here, then reads what the first stored
    await c.query("select 1 from ref_assignments where annotator_id = $1 and base_id = $2 for update", [me.id, id]);
    const r = await load(me, id, c);
    const no = refusal(r);
    if (no) return await end(...no);
    if (r.read_only) return await end(409, { error: READ_ONLY });
    // the page's copy is not the stored one (another tab or device saved since): refuse, or it would overwrite that work
    if (stale(body, r.updated_at)) return await end(409, staleReply("answer key"));
    const locked = !!r.stage1_locked_at, axes = refAxes(r.payload), prev = r.data || {};
    let data;
    if (locked) {
      // Stage 1 is what was locked, whatever the page sends
      const d = { ...(body.data && typeof body.data === "object" ? body.data : {}) };
      for (const k of STAGE1_KEYS) { delete d[k]; if (prev[k] !== undefined) d[k] = prev[k]; }
      data = cleanRef(d, axes);
    } else data = cleanRef(body.data);
    let status = r.status || "in_progress", lockNow = false, missing = locked ? missingStage2(data, axes) : missingStage1(data);
    let rejected = false;
    if (status === "declined" && (action === "lock_stage1" || action === "complete"))
      return await end(409, { error: "this question is marked as outside your expertise: undo that first" });
    if (action === "decline") {
      if (status === "complete") return await end(409, { error: "a complete answer key cannot be declined" });
      status = "declined";
    } else if (action === "undecline") {
      if (status === "declined") status = "in_progress";
    } else if (action === "lock_stage1") {
      if (!locked) { if (missing.length) rejected = true; else lockNow = true; }
    } else if (action === "complete") {
      if (!locked) { rejected = true; missing = ["finish and save Stage 1 first"]; }
      else if (missing.length) rejected = true;
      else status = "complete";
    } else if (status === "complete" && missing.length) status = "in_progress"; // an edit that breaks a complete reference
    // active time since the last save, counted towards the stage it was spent on
    const inc = Math.max(0, Math.min(900, Math.round(Number(body.active_s) || 0)));
    const up = await c.query(
      `insert into clinician_refs (annotator_id, base_id, mode, data, status, stage1_locked_at, active_s1, active_s2,
                                   form_version, completed_at)
       values ($1, $2, $3, $4, $5, case when $6 then now() end, $7, $8, $9, case when $5 = 'complete' then now() end)
       on conflict (annotator_id, base_id) do update
         set data = excluded.data, status = excluded.status, form_version = excluded.form_version, updated_at = clock_timestamp(),
             stage1_locked_at = coalesce(clinician_refs.stage1_locked_at, excluded.stage1_locked_at),
             active_s1 = clinician_refs.active_s1 + excluded.active_s1,
             active_s2 = clinician_refs.active_s2 + excluded.active_s2,
             completed_at = case when excluded.status = 'complete' then coalesce(clinician_refs.completed_at, now()) end
       returning status, updated_at, stage1_locked_at is not null as stage1_locked`,
      [me.id, id, r.mode, data, status, lockNow, locked ? 0 : inc, locked ? inc : 0, REF_FORM_VERSION]);
    await c.query(
      `insert into clinician_ref_log (annotator_id, base_id, data, status, action, stage1_locked, active_s, form_version)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [me.id, id, data, status, action, locked || lockNow, inc, REF_FORM_VERSION]);
    if (rejected) await end(422, { error: "incomplete", missing, ...up.rows[0] }, true);
    else await end(200, { ...up.rows[0], missing: lockNow ? [] : missing }, true);
  } catch (e) {
    if (open) await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export default handler(["GET", "POST"], async (req, res) => {
  const me = await auth(req, res);
  if (!me) return;
  if (req.method === "POST") return save(req, res, me);
  const id = new URL(req.url, "http://x").searchParams.get("id");
  return id === null ? list(req, res, me) : open(req, res, me, id);
});
