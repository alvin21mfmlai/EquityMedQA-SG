// POST /api/save {set_id, data, complete} -> store my annotation of a set (every save is also logged)
import { auth, db, handler, readBody, send } from "./_lib.js";
import { GUIDE_VERSION, cleanAnnotation, missingFields } from "../public/rubric.js";

export default handler(["POST"], async (req, res) => {
  const me = await auth(req, res);
  if (!me) return;
  const body = await readBody(req);
  const { rows } = await db().query(
    `select s.payload from assignments a join sets s using (set_id) where a.annotator_id = $1 and a.set_id = $2`,
    [me.id, String(body.set_id || "")]);
  if (!rows[0]) return send(res, 404, { error: "set not found or not assigned to you" });
  const set = rows[0].payload;
  const data = cleanAnnotation(body.data || {}, set);
  const missing = missingFields(data, set);
  // an attempt to complete an incomplete set still saves the work (as in progress), then reports what is missing
  const rejected = !!body.complete && missing.length > 0;
  // a completed set stays complete when edited, unless it no longer passes the checks
  const prev = await db().query("select status from annotations where annotator_id = $1 and set_id = $2", [me.id, set.set_id]);
  const wasComplete = prev.rows[0]?.status === "complete";
  const status = !missing.length && (body.complete || wasComplete) ? "complete" : "in_progress";
  const c = await db().connect();
  try {
    await c.query("begin");
    const up = await c.query(
      `insert into annotations (annotator_id, set_id, data, status, guide_version, completed_at)
       values ($1, $2, $3, $4, $5, case when $4 = 'complete' then now() end)
       on conflict (annotator_id, set_id) do update
         set data = excluded.data, status = excluded.status, guide_version = excluded.guide_version,
             updated_at = now(),
             completed_at = case when excluded.status = 'complete' then coalesce(annotations.completed_at, now()) end
       returning status, updated_at`, [me.id, set.set_id, data, status, GUIDE_VERSION]);
    await c.query(
      `insert into annotation_log (annotator_id, set_id, data, status, guide_version) values ($1, $2, $3, $4, $5)`,
      [me.id, set.set_id, data, status, GUIDE_VERSION]);
    await c.query("commit");
    if (rejected) send(res, 422, { error: "incomplete", missing, ...up.rows[0] });
    else send(res, 200, { ...up.rows[0], missing });
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
});
