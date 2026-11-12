// GET /api/question?id=BASE_ID -> one base question as the review page shows it (question only) and my review of it.
// Every open is logged in view_log (mode 'review'), as the blind rule asks.
import { auth, db, handler, send } from "./_lib.js";

export default handler(["GET"], async (req, res) => {
  const me = await auth(req, res);
  if (!me) return;
  const id = new URL(req.url, "http://x").searchParams.get("id") || "";
  const { rows } = await db().query(
    `select q.payload, r.data, r.status, r.updated_at
       from questions q left join reviews r on r.base_id = q.base_id and r.annotator_id = $1
      where q.base_id = $2`, [me.id, id]);
  if (!rows[0]) return send(res, 404, { error: "question not found" });
  await db().query("insert into view_log (annotator_id, mode, base_id) values ($1, 'review', $2)", [me.id, id]);
  const r = rows[0];
  send(res, 200, { question: r.payload, review: r.data || {}, status: r.status || "not_started", updated_at: r.updated_at });
});
