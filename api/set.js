// GET /api/set?id=SET_ID -> one assigned set (questions, answers, reference) and my annotation of it; every open is
// logged in view_log (mode 'rating'). Refused (409) while the doctor has an unfinished blind reference for that question.
import { auth, db, handler, send } from "./_lib.js";

export default handler(["GET"], async (req, res) => {
  const me = await auth(req, res);
  if (!me) return;
  const id = new URL(req.url, "http://x").searchParams.get("id") || "";
  const { rows } = await db().query(
    `select s.payload, a.position, a.kind, n.data, n.status, n.updated_at
       from assignments a join sets s using (set_id)
       left join annotations n on n.annotator_id = a.annotator_id and n.set_id = a.set_id
      where a.annotator_id = $1 and a.set_id = $2`, [me.id, id]);
  // clinicians are not told which sets are double-annotated (kind 'overlap' is shown as 'main')
  if (!rows[0]) return send(res, 404, { error: "set not found or not assigned to you" });
  const nav = await db().query(
    `select (select set_id from assignments where annotator_id = $1 and position < $2 order by position desc limit 1) as prev,
            (select set_id from assignments where annotator_id = $1 and position > $2 order by position limit 1) as next`,
    [me.id, rows[0].position]);
  const r = rows[0];
  // Phase 1A: not while this doctor still has a blind reference to write for the same base question
  const pending = await db().query(
    `select 1 from ref_assignments a left join clinician_refs c using (annotator_id, base_id)
      where a.annotator_id = $1 and a.base_id = $2 and coalesce(c.status, 'in_progress') not in ('complete', 'declined')`,
    [me.id, r.payload.base_id]);
  if (pending.rows.length) return send(res, 409, { error: "This set shows answers and an AI-drafted answer key for a question you "
    + "still have to write a blind answer key for. Finish that answer key first (Answer keys page), then come back to this set." });
  // the rating page shows MedGemma's answers and the AI reference: after this, the doctor is not blind for the question
  await db().query("insert into view_log (annotator_id, mode, base_id, set_id) values ($1, 'rating', $2, $3)",
    [me.id, r.payload.base_id, id]);
  send(res, 200, { set: r.payload, position: r.position, kind: r.kind === "calibration" ? "calibration" : "main", annotation: r.data || {},
                   status: r.status || "not_started", updated_at: r.updated_at, ...nav.rows[0] });
});
