// GET  /api/newq -> my new questions, newest first
// POST /api/newq {id?, data, action?: "submit" | "withdraw", seen?} -> create (no id) or update one of my new questions;
//      every save is also logged. A draft becomes "submitted" only when it passes the checks; a submitted question
//      stays submitted when edited, unless it no longer passes them; a withdrawn one stays withdrawn until it is
//      resubmitted and passes the checks. seen: the updated_at of the copy the page holds (_lib.js stale).
import { auth, db, handler, readBody, send, stale, staleReply } from "./_lib.js";
import { FORMS_VERSION, cleanNewQuestion, missingNewQuestion } from "../public/forms.js";

export default handler(["GET", "POST"], async (req, res) => {
  const me = await auth(req, res);
  if (!me) return;
  if (req.method === "GET") {
    const { rows } = await db().query(
      `select id, data, status, created_at, updated_at, submitted_at from new_questions
        where annotator_id = $1 order by id desc`, [me.id]);
    return send(res, 200, { questions: rows });
  }
  const body = await readBody(req);
  const data = cleanNewQuestion(body.data);
  const missing = missingNewQuestion(data);
  const action = ["submit", "withdraw"].includes(body.action) ? body.action : null;
  let prev = null;
  if (body.id !== undefined && body.id !== null) {
    const { rows } = await db().query("select status, updated_at from new_questions where id = $1 and annotator_id = $2",
      [Number(body.id) || 0, me.id]);
    if (!rows[0]) return send(res, 404, { error: "question not found or not yours" });
    // the page's copy is not the stored one (another tab or device saved since): refuse, or it would overwrite that work
    if (stale(body, rows[0].updated_at)) return send(res, 409, staleReply("question"));
    prev = rows[0].status;
  } else if (!Object.keys(data).length) return send(res, 400, { error: "nothing to save" });
  let status = "draft";
  if (action === "withdraw") status = "withdrawn";
  else if (!missing.length && (action === "submit" || prev === "submitted")) status = "submitted";
  else if (prev === "withdrawn") status = "withdrawn"; // also when a resubmit fails the checks (before 11 Nov: a draft)
  const rejected = action === "submit" && missing.length > 0;
  const c = await db().connect();
  try {
    await c.query("begin");
    const up = prev === null
      ? await c.query(
        `insert into new_questions (annotator_id, data, status, forms_version, submitted_at)
         values ($1, $2, $3, $4, case when $3 = 'submitted' then now() end) returning id, status, updated_at`,
        [me.id, data, status, FORMS_VERSION])
      : await c.query(
        `update new_questions set data = $3, status = $4, forms_version = $5, updated_at = clock_timestamp(),
                submitted_at = case when $4 = 'submitted' then coalesce(submitted_at, now()) else submitted_at end
          where id = $1 and annotator_id = $2 returning id, status, updated_at`,
        [Number(body.id), me.id, data, status, FORMS_VERSION]);
    const row = up.rows[0];
    await c.query(
      `insert into new_question_log (question_id, annotator_id, data, status, forms_version) values ($1, $2, $3, $4, $5)`,
      [row.id, me.id, data, status, FORMS_VERSION]);
    await c.query("commit");
    if (rejected) send(res, 422, { error: "incomplete", missing, ...row });
    else send(res, 200, { ...row, missing });
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
});
