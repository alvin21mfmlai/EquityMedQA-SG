// Admin API (role = admin):
//   GET  /api/admin?action=progress                      per-annotator progress (reviews, new questions, rating sets)
//   GET  /api/admin?action=export&what=WHAT&format=csv   WHAT = reviews (one row per doctor x base question),
//        new_questions, views (every question opened), exposure (per doctor x base question: what was opened, and
//        whether the doctor can still write a blind reference),
//        references (Phase 1A: one row per assigned doctor x base question; format=json carries each whole reference,
//        for scripts/import_phase1a.py in the research folder), ratings (default; one row per annotator x set x answer);
//        or format=json. Test accounts are left out unless include_test=1; every row says whether it comes from one
//        (test_account). In CSV, text a spreadsheet would run as a formula gets a leading apostrophe (csvCell).
//   POST /api/admin {action:"create_annotator", name, email, test}   -> the new personal link token (shown once); a test
//        account also gets a few demo references, so that its login shows every task
//   POST /api/admin {action:"set_active", id, active}
import { DEMO_REFS, assignDemoRefs, auth, contact, csvCell, db, handler, hashToken, newToken, readBody, send } from "./_lib.js";
import { AXES, DETAILS, reviewedSpecialty } from "../public/forms.js";

const EXPORT_COLUMNS = [
  "annotator_id", "annotator", "test_account", "set_id", "base_id", "axis", "batch", "label", "kind", "status", "guide_version",
  "updated_at", "item_id", "version", "is_baseline", "q_valid", "q_depends", "q_reference", "q_comment",
  "accuracy", "answer_harm", "bias", "answer_comment",
  "difference", "changed", "justified", "better", "comparison_harm", "comparison_comment",
];

const yn = (v) => (v ? "yes" : "no");

function exportRows(rows) {
  const out = [];
  for (const r of rows) {
    const d = r.data || {}, q = d.question || {}, set = r.payload;
    for (const v of set.variants) {
      const a = d.answers?.[v.item_id] || {}, c = d.comparisons?.[v.item_id] || {};
      out.push({
        annotator_id: r.annotator_id, annotator: r.name, test_account: yn(r.is_test), set_id: set.set_id, base_id: set.base_id,
        axis: set.axis, batch: set.batch, label: set.label, kind: r.kind, status: r.status, guide_version: r.guide_version,
        updated_at: r.updated_at?.toISOString?.() ?? r.updated_at, item_id: v.item_id, version: v.display_label,
        is_baseline: v.item_id === set.baseline_item_id ? "yes" : "no",
        q_valid: q.valid ?? "", q_depends: q.depends ?? "", q_reference: q.reference ?? "", q_comment: q.comment ?? "",
        accuracy: a.accuracy ?? "", answer_harm: a.harm ?? "", bias: (a.bias || []).join(";"), answer_comment: a.comment ?? "",
        difference: c.difference ?? "", changed: (c.changed || []).join(";"), justified: c.justified ?? "",
        better: c.better ?? "", comparison_harm: c.harm ?? "", comparison_comment: c.comment ?? "",
      });
    }
  }
  return out;
}

const iso = (v) => v?.toISOString?.() ?? v ?? "";

// every query returns t.is_test, which decides whether the row is exported (see the handler)
const EXPORTS = {
  reviews: {
    columns: ["annotator_id", "annotator", "test_account", "base_id", "position", "sources", "proposed_primary",
      "proposed_secondary", "proposed_other", "status", "forms_version", "started_at", "updated_at", "completed_at",
      "relevant", "realistic", "rewording", "specialty", "specialty_primary", "specialty_secondary", "specialty_other",
      "reviewed_primary", "reviewed_secondary", "versions", "versions_comment", "decision", "comment"],
    sql: `select r.*, t.name, t.is_test, q.position, q.payload from reviews r join annotators t on t.id = r.annotator_id
            join questions q using (base_id) order by r.annotator_id, q.position`,
    row: (r) => {
      const d = r.data || {}, p = r.payload.specialty, rs = reviewedSpecialty(d, p);
      return { annotator_id: r.annotator_id, annotator: r.name, test_account: yn(r.is_test), base_id: r.base_id,
        position: r.position, sources: r.payload.sources.join(";"), proposed_primary: p.primary,
        proposed_secondary: p.secondary ?? "", proposed_other: p.other_specialty ?? "", status: r.status,
        forms_version: r.forms_version, started_at: iso(r.started_at), updated_at: iso(r.updated_at),
        completed_at: iso(r.completed_at), reviewed_primary: rs.primary ?? "", reviewed_secondary: rs.secondary ?? "",
        ...Object.fromEntries(["relevant", "realistic", "rewording", "specialty", "specialty_primary", "specialty_secondary",
          "specialty_other", "versions", "versions_comment", "decision", "comment"].map((k) => [k, d[k] ?? ""])) };
    },
  },
  new_questions: {
    columns: ["id", "annotator_id", "annotator", "test_account", "status", "forms_version", "created_at", "updated_at",
      "submitted_at", "specialty", "specialty_other", "setting", "question", "details", "details_other",
      ...DETAILS.filter(([k]) => k !== "none").flatMap(([k]) => [`${k}_change`, `${k}_reason`]), "source", "template", "comment"],
    sql: `select n.*, t.name, t.is_test from new_questions n join annotators t on t.id = n.annotator_id order by n.id`,
    row: (r) => {
      const d = r.data || {};
      return { id: r.id, annotator_id: r.annotator_id, annotator: r.name, test_account: yn(r.is_test), status: r.status,
        forms_version: r.forms_version, created_at: iso(r.created_at), updated_at: iso(r.updated_at),
        submitted_at: iso(r.submitted_at), details: (d.details || []).join(";"),
        ...Object.fromEntries(["specialty", "specialty_other", "setting", "question", "details_other", "source", "template",
          "comment"].map((k) => [k, d[k] ?? ""])),
        ...Object.fromEntries(DETAILS.filter(([k]) => k !== "none").flatMap(([k]) =>
          [[`${k}_change`, d.changes?.[k]?.change ?? ""], [`${k}_reason`, d.changes?.[k]?.reason ?? ""]])) };
    },
  },
  views: {
    columns: ["id", "annotator_id", "annotator", "test_account", "mode", "base_id", "set_id", "opened_at"],
    sql: `select v.*, t.name, t.is_test from view_log v join annotators t on t.id = v.annotator_id order by v.id`,
    row: (r) => ({ ...r, annotator: r.name, test_account: yn(r.is_test), set_id: r.set_id ?? "", opened_at: iso(r.opened_at) }),
  },
  // blind_for_phase1a: can this doctor still write (or change) a blind reference for the question? "no" after any open
  // in the rating mode, also one made after the doctor's reference was complete. Whether a finished reference was
  // written blind is a different question: reference_complete_before_rating answers it here ("yes" when the reference
  // was complete before the first rating open, "no" when it was completed after it, empty without a rating open or a
  // complete reference), and the references export's blind_at_completion is the record (11 Nov 2026, second review).
  exposure: {
    columns: ["annotator_id", "annotator", "test_account", "base_id", "review_opens", "first_review_open", "rating_opens",
      "first_rating_open", "reference_opens", "first_reference_open", "blind_for_phase1a", "reference_complete_before_rating"],
    sql: `select v.annotator_id, t.name, t.is_test, v.base_id,
                 (select c.completed_at from clinician_refs c where c.annotator_id = v.annotator_id
                     and c.base_id = v.base_id and c.status = 'complete') as ref_completed_at,
                 count(*) filter (where v.mode = 'review')::int as review_opens,
                 min(v.opened_at) filter (where v.mode = 'review') as first_review_open,
                 count(*) filter (where v.mode = 'rating')::int as rating_opens,
                 min(v.opened_at) filter (where v.mode = 'rating') as first_rating_open,
                 count(*) filter (where v.mode = 'reference')::int as reference_opens,
                 min(v.opened_at) filter (where v.mode = 'reference') as first_reference_open
            from view_log v join annotators t on t.id = v.annotator_id
           group by v.annotator_id, t.name, t.is_test, v.base_id order by v.annotator_id, v.base_id`,
    row: (r) => ({ ...r, annotator: r.name, test_account: yn(r.is_test), first_review_open: iso(r.first_review_open),
      first_rating_open: iso(r.first_rating_open), first_reference_open: iso(r.first_reference_open),
      blind_for_phase1a: r.rating_opens ? "no" : "yes",
      reference_complete_before_rating: r.rating_opens && r.ref_completed_at ? yn(r.ref_completed_at <= r.first_rating_open) : "" }),
  },
  // blind_at_completion: no rating-mode open before the reference was completed (or, while unfinished, before now).
  // blind_at_last_save: no rating-mode open before its last save; empty when not started. The site refuses every save
  // after such an open, so "no" here means the row was changed outside the site.
  // stage1_reopens: how often the study team reopened Stage 1 (scripts/admin.mjs reopen-stage1).
  // review_open_before_stage1 (11 Nov 2026, second review): the doctor opened this question on the question-review page
  // before Stage 1 was saved (or, while it is not saved, before now). That page shows the template and every
  // demographic version, which Stage 1 keeps back, so Stage 1 was then not written on the "Not stated" question alone.
  // No AI content is involved: blind_at_completion is not affected.
  references: {
    columns: ["annotator_id", "annotator", "test_account", "base_id", "mode", "position", "status", "form_version",
      "assigned_at", "started_at", "stage1_locked_at", "completed_at", "updated_at", "active_min_stage1",
      "active_min_stage2", "blind_at_completion", "blind_at_last_save", "stage1_reopens", "review_open_before_stage1",
      "n_essential", "n_critical",
      "n_must_not", "urgency_where", "urgency_when", "n_missing_info", "n_sg_facts", "valid", "biased_premise",
      "confidence", ...AXES.map(([k]) => `should_differ_${k}`), "n_permitted_differences", "comment"],
    sql: `select a.annotator_id, t.name, t.is_test, a.base_id, a.mode, a.position, a.assigned_at, c.data, c.status,
                 c.form_version, c.started_at, c.stage1_locked_at, c.completed_at, c.updated_at, c.active_s1, c.active_s2,
                 c.stage1_reopens,
                 not exists (select 1 from view_log v where v.annotator_id = a.annotator_id and v.base_id = a.base_id
                               and v.mode = 'rating' and v.opened_at < coalesce(c.completed_at, now())) as blind,
                 case when c.updated_at is not null then
                   not exists (select 1 from view_log v where v.annotator_id = a.annotator_id and v.base_id = a.base_id
                                 and v.mode = 'rating' and v.opened_at < c.updated_at) end as blind_last,
                 exists (select 1 from view_log v where v.annotator_id = a.annotator_id and v.base_id = a.base_id
                           and v.mode = 'review' and v.opened_at < coalesce(c.stage1_locked_at, now())) as review_first
            from ref_assignments a join annotators t on t.id = a.annotator_id
            left join clinician_refs c on c.annotator_id = a.annotator_id and c.base_id = a.base_id
           order by a.annotator_id, a.position`,
    row: (r) => {
      const d = r.data || {}, u = d.urgency || {}, qv = d.question_validity || {}, ax = d.axes || {};
      return { annotator_id: r.annotator_id, annotator: r.name, test_account: yn(r.is_test), base_id: r.base_id, mode: r.mode,
        position: r.position, status: r.status ?? "not_started", form_version: r.form_version ?? "",
        assigned_at: iso(r.assigned_at), started_at: iso(r.started_at), stage1_locked_at: iso(r.stage1_locked_at),
        completed_at: iso(r.completed_at), updated_at: iso(r.updated_at),
        active_min_stage1: r.data ? (r.active_s1 / 60).toFixed(1) : "", active_min_stage2: r.data ? (r.active_s2 / 60).toFixed(1) : "",
        blind_at_completion: yn(r.blind), blind_at_last_save: r.blind_last === null ? "" : yn(r.blind_last),
        stage1_reopens: r.stage1_reopens ?? 0, review_open_before_stage1: yn(r.review_first),
        n_essential: (d.essential_points || []).length, n_critical: (d.essential_points || []).filter((e) => e.importance === "critical").length,
        n_must_not: (d.must_not || []).length, urgency_where: u.where ?? "", urgency_when: u.when ?? "",
        n_missing_info: (d.missing_info || []).length, n_sg_facts: (d.sg_facts || []).length, valid: qv.valid ?? "",
        biased_premise: qv.biased_premise === undefined ? "" : qv.biased_premise ? "yes" : "no", confidence: d.confidence ?? "",
        ...Object.fromEntries(AXES.map(([k]) => [`should_differ_${k}`, ax[k]?.should_differ ?? ""])),
        n_permitted_differences: Object.values(ax).reduce((n, a) => n + (a.permitted_differences || []).length, 0),
        comment: d.comment ?? "" };
    },
    // the whole reference, for import into the research pipeline (format=json)
    json: (r) => ({ annotator_id: r.annotator_id, annotator: r.name, test_account: !!r.is_test, base_id: r.base_id,
      mode: r.mode, position: r.position, status: r.status ?? "not_started", form_version: r.form_version,
      assigned_at: iso(r.assigned_at), started_at: iso(r.started_at), stage1_locked_at: iso(r.stage1_locked_at),
      completed_at: iso(r.completed_at), updated_at: iso(r.updated_at), active_s1: r.active_s1 ?? 0, active_s2: r.active_s2 ?? 0,
      blind_at_completion: !!r.blind, blind_at_last_save: r.blind_last, stage1_reopens: r.stage1_reopens ?? 0,
      review_open_before_stage1: !!r.review_first, data: r.data || {} }),
  },
};

function sendCsv(res, name, columns, rows) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.end("﻿" + [columns.join(","), ...rows.map((r) => columns.map((k) => csvCell(r[k])).join(","))].join("\r\n"));
}

export default handler(["GET", "POST"], async (req, res) => {
  const me = await auth(req, res, { admin: true });
  if (!me) return;
  if (req.method === "GET") {
    const p = new URL(req.url, "http://x").searchParams;
    const action = p.get("action");
    if (action === "progress") {
      const { rows } = await db().query(
        `select t.id, t.name, t.email, t.role, t.active, t.is_test, t.created_at,
                (select count(*) from assignments a where a.annotator_id = t.id)::int as assigned,
                (select count(*) from annotations n where n.annotator_id = t.id and n.status = 'complete')::int as complete,
                (select count(*) from annotations n where n.annotator_id = t.id and n.status = 'in_progress')::int as in_progress,
                (select count(*) from assignments a where a.annotator_id = t.id and a.kind = 'calibration')::int as calibration,
                (select count(*) from assignments a join annotations n using (annotator_id, set_id)
                  where a.annotator_id = t.id and a.kind = 'calibration' and n.status = 'complete')::int as calibration_complete,
                (select count(*) from reviews r where r.annotator_id = t.id and r.status = 'complete')::int as reviews_complete,
                (select count(*) from reviews r where r.annotator_id = t.id and r.status = 'in_progress')::int as reviews_in_progress,
                (select count(*) from new_questions q where q.annotator_id = t.id and q.status = 'submitted')::int as new_submitted,
                (select count(*) from new_questions q where q.annotator_id = t.id and q.status = 'draft')::int as new_drafts,
                (select count(distinct base_id) from view_log v where v.annotator_id = t.id and v.mode = 'rating')::int as not_blind,
                (select count(*) from ref_assignments a where a.annotator_id = t.id)::int as refs_assigned,
                (select count(*) from clinician_refs c where c.annotator_id = t.id and c.status = 'complete')::int as refs_complete,
                (select count(*) from clinician_refs c where c.annotator_id = t.id and c.status = 'in_progress')::int as refs_in_progress,
                (select count(*) from clinician_refs c where c.annotator_id = t.id and c.status = 'declined')::int as refs_declined,
                greatest((select max(updated_at) from annotations n where n.annotator_id = t.id),
                         (select max(updated_at) from reviews r where r.annotator_id = t.id),
                         (select max(updated_at) from new_questions q where q.annotator_id = t.id),
                         (select max(updated_at) from clinician_refs c where c.annotator_id = t.id)) as last_saved
           from annotators t order by t.id`);
      const totals = await db().query(`select (select count(*) from sets)::int as sets, (select count(*) from questions)::int as questions`);
      return send(res, 200, { annotators: rows, sets_loaded: totals.rows[0].sets, questions_loaded: totals.rows[0].questions,
                              contact: contact() });
    }
    if (action === "export") {
      const what = p.get("what"), json = p.get("format") === "json", includeTest = p.get("include_test") === "1";
      const kept = (rows) => rows.filter((r) => includeTest || !r.is_test);
      if (EXPORTS[what]) {
        const x = EXPORTS[what];
        const rows = kept((await db().query(x.sql)).rows);
        if (json)
          return send(res, 200, { exported_at: new Date().toISOString(), what, include_test: includeTest, rows: rows.map(x.json || x.row) });
        return sendCsv(res, what, x.columns, rows.map(x.row));
      }
      // the v1 rating mode (the default)
      const rows = kept((await db().query(
        `select n.annotator_id, t.name, t.is_test, n.set_id, n.data, n.status, n.guide_version, n.updated_at, a.kind, s.payload
           from annotations n join annotators t on t.id = n.annotator_id join sets s using (set_id)
           left join assignments a on a.annotator_id = n.annotator_id and a.set_id = n.set_id
          order by n.annotator_id, a.position`)).rows);
      const flat = exportRows(rows);
      if (json)
        return send(res, 200, { exported_at: new Date().toISOString(), include_test: includeTest,
                                annotations: rows.map(({ payload, ...r }) => r), rows: flat });
      return sendCsv(res, "annotations", EXPORT_COLUMNS, flat);
    }
    return send(res, 400, { error: "unknown action" });
  }
  const body = await readBody(req);
  if (body.action === "create_annotator") {
    const name = String(body.name || "").trim();
    if (!name) return send(res, 400, { error: "name is required" });
    const test = !!body.test, token = newToken();
    const { rows } = await db().query(
      "insert into annotators (name, email, role, token_hash, is_test) values ($1, $2, 'clinician', $3, $4) returning id, name",
      [name, String(body.email || "").trim() || null, hashToken(token), test]);
    // a test account gets a few demo references (answer keys), so that its login shows every task
    const refs = test ? await assignDemoRefs((s, v) => db().query(s, v), rows[0].id, body.demo_refs ?? DEMO_REFS) : 0;
    return send(res, 200, { ...rows[0], test, refs_assigned: refs, token });
  }
  if (body.action === "set_active") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return send(res, 400, { error: "id must be a whole number" });
    await db().query("update annotators set active = $2 where id = $1 and id <> $3", [id, !!body.active, me.id]);
    return send(res, 200, { ok: true });
  }
  return send(res, 400, { error: "unknown action" });
});
