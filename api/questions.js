// GET /api/questions -> the 250 base questions for the review list (question only), in order, with my review status.
// The title is the "Not stated" wording, or the template for a question that has none (_lib.js TITLE).
import { TITLE, auth, db, handler, send } from "./_lib.js";

export default handler(["GET"], async (req, res) => {
  const me = await auth(req, res);
  if (!me) return;
  const { rows } = await db().query(
    `select q.base_id, q.position, ${TITLE} as title, q.payload->'sources' as sources,
            q.payload->'specialty' as specialty, coalesce(r.status, 'not_started') as status, r.updated_at
       from questions q left join reviews r on r.base_id = q.base_id and r.annotator_id = $1
      order by q.position`, [me.id]);
  send(res, 200, { questions: rows });
});
