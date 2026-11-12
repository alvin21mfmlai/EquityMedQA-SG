// POST /api/review {base_id, data, complete, seen} -> store my review of a base question (every save is also logged).
// seen: the updated_at of the copy the page holds (null before the first save); see _lib.js stale.
import { auth, db, handler, readBody, send, stale, staleReply } from "./_lib.js";
import { FORMS_VERSION, cleanReview, missingReview } from "../public/forms.js";

export default handler(["POST"], async (req, res) => {
  const me = await auth(req, res);
  if (!me) return;
  const body = await readBody(req);
  const id = String(body.base_id || "");
  const { rows } = await db().query(
    `select r.status, r.updated_at from questions q left join reviews r on r.base_id = q.base_id and r.annotator_id = $1
      where q.base_id = $2`, [me.id, id]);
  if (!rows[0]) return send(res, 404, { error: "question not found" });
  // the page's copy is not the stored one (another tab or device saved since): refuse, or it would overwrite that work
  if (stale(body, rows[0].updated_at)) return send(res, 409, staleReply("review"));
  const data = cleanReview(body.data);
  const missing = missingReview(data);
  // as for the rating sets: an attempt to complete an incomplete review still saves it, then reports what is missing;
  // a complete review stays complete when edited, unless it no longer passes the checks
  const rejected = !!body.complete && missing.length > 0;
  const status = !missing.length && (body.complete || rows[0].status === "complete") ? "complete" : "in_progress";
  const c = await db().connect();
  try {
    await c.query("begin");
    const up = await c.query(
      `insert into reviews (annotator_id, base_id, data, status, forms_version, completed_at)
       values ($1, $2, $3, $4, $5, case when $4 = 'complete' then now() end)
       on conflict (annotator_id, base_id) do update
         set data = excluded.data, status = excluded.status, forms_version = excluded.forms_version, updated_at = clock_timestamp(),
             completed_at = case when excluded.status = 'complete' then coalesce(reviews.completed_at, now()) end
       returning status, updated_at`, [me.id, id, data, status, FORMS_VERSION]);
    await c.query(
      "insert into review_log (annotator_id, base_id, data, status, forms_version) values ($1, $2, $3, $4, $5)",
      [me.id, id, data, status, FORMS_VERSION]);
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
