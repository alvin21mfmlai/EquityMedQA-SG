// GET /api/me -> who I am and my progress: question reviews, new questions, Phase 1A references and rating sets
// (the last two only if any are assigned)
import { auth, db, handler, send } from "./_lib.js";
import { GUIDE_VERSION } from "../public/rubric.js";
import { FORMS_VERSION } from "../public/forms.js";
import { REF_FORM_VERSION } from "../public/ref_forms.js";

export default handler(["GET"], async (req, res) => {
  const me = await auth(req, res);
  if (!me) return;
  const rating = await db().query(
    `select count(*)::int as assigned,
            count(*) filter (where n.status = 'complete')::int as complete,
            count(*) filter (where n.status = 'in_progress')::int as in_progress
       from assignments a left join annotations n on n.annotator_id = a.annotator_id and n.set_id = a.set_id
      where a.annotator_id = $1`, [me.id]);
  const review = await db().query(
    `select (select count(*)::int from questions) as total,
            count(*) filter (where status = 'complete')::int as complete,
            count(*) filter (where status = 'in_progress')::int as in_progress
       from reviews where annotator_id = $1`, [me.id]);
  const nq = await db().query(
    `select data->>'specialty' as specialty, status, count(*)::int as n from new_questions
      where annotator_id = $1 group by 1, 2`, [me.id]);
  const refs = await db().query(
    `select count(*)::int as assigned,
            count(*) filter (where c.status = 'complete')::int as complete,
            count(*) filter (where c.status = 'declined')::int as declined,
            count(*) filter (where c.status = 'in_progress')::int as in_progress
       from ref_assignments a left join clinician_refs c using (annotator_id, base_id)
      where a.annotator_id = $1`, [me.id]);
  send(res, 200, { name: me.name, role: me.role, test: !!me.is_test, guide_version: GUIDE_VERSION, forms_version: FORMS_VERSION,
                   ref_form_version: REF_FORM_VERSION, progress: rating.rows[0], review: review.rows[0],
                   new_questions: nq.rows, refs: refs.rows[0] });
});
