// GET /api/sets -> my assigned sets, in order, with status
import { auth, db, handler, send } from "./_lib.js";

export default handler(["GET"], async (req, res) => {
  const me = await auth(req, res);
  if (!me) return;
  const { rows } = await db().query(
    `select a.set_id, a.position, case when a.kind = 'calibration' then 'calibration' else 'main' end as kind, s.base_id, s.axis, s.payload->>'title' as title,
            s.payload->>'label' as label, coalesce(n.status, 'not_started') as status, n.updated_at
       from assignments a join sets s using (set_id)
       left join annotations n on n.annotator_id = a.annotator_id and n.set_id = a.set_id
      where a.annotator_id = $1 order by a.position`, [me.id]);
  send(res, 200, { sets: rows });
});
