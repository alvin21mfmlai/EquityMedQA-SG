// Phase 1A: the blind reference form for doctors (2 Nov 2026). One source for the page (browser) and the checks (API).
// The fields, values and limits are the Phase 0 schema's (src/emqsg/phase0/schema.py in the research folder), so the
// doctors' references and the AI drafts can be compared field by field; scripts/import_phase1a.py there re-checks every
// exported reference with that schema. Two stages, as for the AI drafters: Stage 1 on the "Not stated" question, then
// Stage 2 per demographic axis, shown only after Stage 1 is locked. Urgency is split into where and when.
// Wording follows guide.html#reference: change both together and bump REF_FORM_VERSION.
// 11 Nov 2026: the pages and the guide now call a reference an "answer key", the name the study's poster and reports
// use. The fields, values, limits and checks are unchanged (still r1); only the date in the version moved.
import { AXES } from "./forms.js";

export const REF_FORM_VERSION = "r1-2026-11-11";

export const IMPORTANCE = [["critical", "Critical"], ["desirable", "Desirable"]];
export const MUST_NOT_TYPES = [["harmful_advice", "Harmful advice"], ["wrong_claim", "Wrong claim"]];
export const WHERE = [["self_care", "Self-care at home"], ["gp_polyclinic", "GP or polyclinic"],
  ["specialist", "Specialist (by referral)"], ["a_and_e", "A&E"], ["call_995", "Call 995 (ambulance)"],
  ["not_applicable", "Not applicable"]];
export const WHEN = [["immediately", "Immediately"], ["within_24h", "Within 24 hours"], ["within_days", "Within days"],
  ["routine", "Routine"], ["not_applicable", "Not applicable"]];
export const FACT_KINDS = [["subsidy_scheme", "Subsidy or financing scheme"], ["screening_programme", "Screening programme"],
  ["clinical_cutoff", "Clinical cut-off"], ["service", "Service"], ["guideline", "Guideline"], ["regulation", "Regulation"],
  ["other", "Other"]];
export const VALIDITY = [["yes", "Yes"], ["needs_edit", "Needs edit"], ["no", "No"]];
export const CONFIDENCE = [["high", "High"], ["medium", "Medium"], ["low", "Low"]];
export const SHOULD_DIFFER = [["no", "No"], ["may", "Yes, it may"], ["must", "Yes, it must"], ["unsure", "Unsure"]];

// the schema's limits (schema.LIMITS); ids E1.., M1.., I1.., F1.. follow the order, as in Phase 0
export const LIMITS = { essential_points: [3, 10], must_not: [1, 6], missing_info: [0, 5], sg_facts: [0, 6] };
export const PREFIX = { essential_points: "E", must_not: "M", missing_info: "I", sg_facts: "F" };
export const MAX_DIFFS = 5;
export const MAX_ITEM = 400; // schema.MAX_ITEM_CHARS
const MAX_NOTE = 800, MAX_COMMENT = 3000;
export const STAGE1_KEYS = ["essential_points", "must_not", "urgency", "missing_info", "missing_info_none_reason",
  "sg_facts", "sg_facts_none_reason", "question_validity", "confidence"];

// the keys of each list item: "text" or the allowed values
const ITEM_SPEC = {
  essential_points: { text: "text", importance: IMPORTANCE },
  must_not: { text: "text", type: MUST_NOT_TYPES },
  missing_info: { ask: "text", how_advice_changes: "text" },
  sg_facts: { fact: "text", kind: FACT_KINDS, source_hint: "text" },
};

const AXIS_NAME = Object.fromEntries(AXES);
const codes = (list) => new Set(list.map(([k]) => k));
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const obj = (v) => (isObj(v) ? v : {});
const txt = (v, max) => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined);
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const pick = (v, list) => (codes(list).has(v) ? v : undefined);
const nonEmpty = (o) => (Object.keys(o).length ? o : undefined);

// Does the question have a "Not stated" wording, i.e. a "Not stated" version on each of its axes? Where the detail is
// the question's subject it does not, and the question cannot have a blind answer key (api/_lib.js HAS_NEUTRAL).
export const hasNeutral = (payload) => (payload?.axes || []).every((a) => a.versions.some((v) => v.value === "neutral"));

// The axes a question varies, as Stage 2 shows them: [{axis, values: [{value, display}]}], "Not stated" left out.
export function refAxes(payload) {
  return (payload?.axes || []).map((a) => ({
    axis: a.axis,
    values: a.versions.filter((v) => v.value !== "neutral").map((v) => ({ value: v.value, display: v.display })),
  }));
}

function cleanItem(it, spec) {
  if (!isObj(it)) return null;
  const o = prune(Object.fromEntries(Object.entries(spec).map(([k, kind]) =>
    [k, kind === "text" ? txt(it[k], MAX_ITEM) : pick(it[k], kind)])));
  return Object.keys(o).length ? o : null; // an empty row is dropped, so ids are never given to blanks
}

function cleanDiff(x, values, nPoints) {
  if (!isObj(x)) return null;
  const pt = String(x.point || "");
  const ok = pt === "new" || (/^E\d+$/.test(pt) && Number(pt.slice(1)) >= 1 && Number(pt.slice(1)) <= nPoints);
  const at = Array.isArray(x.applies_to) ? values.filter((v) => x.applies_to.includes(v)) : [];
  const o = prune({ point: ok ? pt : undefined, change: txt(x.change, MAX_ITEM), applies_to: at.length ? at : undefined,
                    justification: txt(x.justification, MAX_ITEM) });
  return Object.keys(o).length ? o : null;
}

// Keep only the fields and values the form allows (the API stores nothing else). Stage 2 (axes) is kept only when the
// question's axes are given, i.e. after Stage 1 is locked.
export function cleanRef(d, axes = null) {
  d = obj(d);
  const o = {};
  for (const [f, spec] of Object.entries(ITEM_SPEC)) {
    const items = (Array.isArray(d[f]) ? d[f] : []).map((it) => cleanItem(it, spec)).filter(Boolean).slice(0, LIMITS[f][1]);
    if (items.length) o[f] = items;
  }
  if (!o.missing_info) o.missing_info_none_reason = txt(d.missing_info_none_reason, MAX_ITEM);
  if (!o.sg_facts) o.sg_facts_none_reason = txt(d.sg_facts_none_reason, MAX_ITEM);
  const u = obj(d.urgency);
  o.urgency = nonEmpty(prune({ where: pick(u.where, WHERE), when: pick(u.when, WHEN), rationale: txt(u.rationale, MAX_ITEM) }));
  const qv = obj(d.question_validity);
  o.question_validity = nonEmpty(prune({ valid: pick(qv.valid, VALIDITY),
    biased_premise: typeof qv.biased_premise === "boolean" ? qv.biased_premise : undefined, note: txt(qv.note, MAX_NOTE) }));
  o.confidence = pick(d.confidence, CONFIDENCE);
  o.comment = txt(d.comment, MAX_COMMENT);
  if (axes) {
    const n = (o.essential_points || []).length, out = {};
    for (const ax of axes) {
      const a = obj(obj(d.axes)[ax.axis]);
      const one = prune({ should_differ: pick(a.should_differ, SHOULD_DIFFER), rationale: txt(a.rationale, MAX_ITEM) });
      if (one.should_differ === "may" || one.should_differ === "must") {
        const vals = ax.values.map((v) => v.value);
        const ds = (Array.isArray(a.permitted_differences) ? a.permitted_differences : [])
          .map((x) => cleanDiff(x, vals, n)).filter(Boolean).slice(0, MAX_DIFFS);
        if (ds.length) one.permitted_differences = ds;
      }
      if (Object.keys(one).length) out[ax.axis] = one;
    }
    o.axes = nonEmpty(out);
  }
  return prune(o);
}

// What Stage 1 still needs before it can be locked: [] when ready. The same rules as schema.check_core (ungrounded).
export function missingStage1(d) {
  const m = [], n = (f) => (d[f] || []).length;
  const ep = d.essential_points || [], mn = d.must_not || [], mi = d.missing_info || [], sf = d.sg_facts || [];
  if (ep.length < LIMITS.essential_points[0]) m.push(`essential points: at least 3 (${ep.length} so far)`);
  ep.forEach((e, i) => {
    if (!e.text) m.push(`E${i + 1}: the point`);
    if (!e.importance) m.push(`E${i + 1}: critical or desirable`);
  });
  if (ep.length && !ep.some((e) => e.importance === "critical")) m.push("at least one critical essential point");
  if (!mn.length) m.push("must not say: at least 1");
  mn.forEach((x, i) => {
    if (!x.text) m.push(`M${i + 1}: what an answer must not say`);
    if (!x.type) m.push(`M${i + 1}: harmful advice or wrong claim`);
  });
  const u = d.urgency || {};
  if (!u.where) m.push("urgency: where");
  if (!u.when) m.push("urgency: when");
  if (!u.rationale) m.push("urgency: why (one sentence)");
  if (u.where && u.when && (u.where === "not_applicable") !== (u.when === "not_applicable"))
    m.push("urgency: \"not applicable\" for both where and when, or for neither");
  if ((u.where === "a_and_e" || u.where === "call_995") && u.when && !["immediately", "within_24h"].includes(u.when))
    m.push("urgency: A&E or 995 needs \"immediately\" or \"within 24 hours\"");
  mi.forEach((x, i) => {
    if (!x.ask) m.push(`I${i + 1}: what you would ask`);
    if (!x.how_advice_changes) m.push(`I${i + 1}: how the advice changes`);
  });
  if (!n("missing_info") && !d.missing_info_none_reason) m.push("missing information: add an item, or say why none is needed");
  sf.forEach((x, i) => {
    if (!x.fact) m.push(`F${i + 1}: the fact`);
    if (!x.kind) m.push(`F${i + 1}: kind`);
    if (!x.source_hint) m.push(`F${i + 1}: source (or "unsure")`);
  });
  if (!n("sg_facts") && !d.sg_facts_none_reason) m.push("Singapore facts: add a fact, or say why none is needed");
  const qv = d.question_validity || {};
  if (!qv.valid) m.push("question validity: is it valid?");
  if (typeof qv.biased_premise !== "boolean") m.push("question validity: biased premise?");
  if (qv.valid && typeof qv.biased_premise === "boolean" && (qv.valid !== "yes" || qv.biased_premise) && !qv.note)
    m.push("question validity: a note on what is wrong or what to challenge");
  if (!d.confidence) m.push("confidence");
  return m;
}

// What Stage 2 still needs before the reference can be marked complete: [] when ready (schema.check_axes rules).
export function missingStage2(d, axes) {
  const m = [];
  for (const ax of axes) {
    const a = d.axes?.[ax.axis] || {}, nm = AXIS_NAME[ax.axis] || ax.axis;
    if (!a.should_differ) m.push(`${nm}: should the ideal answer differ?`);
    if (!a.rationale) m.push(`${nm}: why (one or two sentences)`);
    if (a.should_differ !== "may" && a.should_differ !== "must") continue;
    const ds = a.permitted_differences || [];
    if (!ds.length) m.push(`${nm}: at least one permitted difference`);
    ds.forEach((x, i) => {
      const w = `${nm}, difference ${i + 1}`;
      if (!x.point) m.push(`${w}: which point`);
      if (!x.change) m.push(`${w}: what changes`);
      if (!x.applies_to?.length) m.push(`${w}: for which groups`);
      else if (x.applies_to.length >= ax.values.length) m.push(`${w}: not every group (then it is not a difference between groups)`);
      if (!x.justification) m.push(`${w}: the clinical reason`);
    });
  }
  return m;
}
