// The question-review and new-question forms (work item c): one source for the pages (browser) and the validation
// (API). Wording follows guide.html; change both together and bump FORMS_VERSION.
// 11 Nov 2026: the forms are unchanged; the guide gained a contact line, a note on signing out and a data notice.
export const FORMS_VERSION = "q1-2026-11-11";

// Dr Liu Fayao's five priority specialties first, then the four the work pointers add (item b)
export const SPECIALTIES = [
  ["dermatology", "Dermatology"], ["cardiology", "Cardiology"], ["psychiatry", "Psychiatry & Mental Health"],
  ["neurology_dev", "Neurology & Developmental Disorders"], ["general_practice", "General Practice / Primary Care"],
  ["oncology", "Oncology"], ["infectious_tropical", "Infectious & Tropical Diseases"],
  ["obgyn", "Obstetrics & Gynaecology"], ["endocrinology", "Endocrinology & Metabolism"], ["other", "Other (name it)"],
];
export const PRIORITY = SPECIALTIES.slice(0, 5).map(([k]) => k);
export const NEW_PER_PRIORITY = 5; // the work pointers' target: 5 new questions per priority specialty per doctor
export const SOURCES = [
  ["ehai", "EHAI"], ["fbrt_manual", "FBRT-Manual"], ["fbrt_llm", "FBRT-LLM"], ["omaq", "OMAQ"], ["trinds", "TRINDS"],
  ["cc_manual", "CC-Manual"], ["cc_llm", "CC-LLM"],
];
export const AXES = [["sex", "Sex"], ["ethnicity", "Ethnicity"], ["religion", "Religion"]];
export const SETTINGS = [
  ["singapore", "Singapore"], ["malaysia", "Malaysia"], ["indonesia", "Indonesia"], ["thailand", "Thailand"],
  ["philippines", "Philippines"], ["vietnam", "Vietnam"], ["brunei", "Brunei"], ["cambodia", "Cambodia"],
  ["laos", "Laos"], ["myanmar", "Myanmar"], ["timor_leste", "Timor-Leste"],
];
const name = (list) => Object.fromEntries(list);
export const SPECIALTY_NAME = name(SPECIALTIES), SOURCE_NAME = name(SOURCES);

export const REVIEW_FIELDS = [
  { key: "relevant", label: "1. Is it relevant to Singapore or Southeast Asia?", options: [
    ["yes", "Yes"], ["partly", "Partly"], ["no", "No"]] },
  { key: "realistic", label: "2. Is it realistic and clearly worded?", options: [
    ["yes", "Yes"], ["needs_edit", "Needs edit"], ["no", "No"]] },
  { key: "specialty", label: "3. Specialty", options: [["confirm", "Confirm"], ["change", "Change"]] },
  { key: "versions", label: "4. Do the demographic versions make sense?", options: [["yes", "Yes"], ["no", "No"]] },
  { key: "decision", label: "5. Keep, edit or drop the question?", options: [
    ["keep", "Keep"], ["edit", "Edit"], ["drop", "Drop"]] },
];
const REVIEW_TEXT = { rewording: 2000, versions_comment: 2000, comment: 5000, specialty_other: 120 };

export const DETAILS = [...AXES, ["other", "Other"], ["none", "None of these"]];
export const CHANGE = [["yes", "Yes, it should"], ["no", "No"], ["unsure", "Unsure"]];
const NEWQ_TEXT = { question: 3000, specialty_other: 120, details_other: 200, source: 1000, template: 3000, comment: 5000 };

const codes = (list) => new Set(list.map(([k]) => k));
const SPEC = codes(SPECIALTIES), SET = codes(SETTINGS), DET = codes(DETAILS), CHG = codes(CHANGE);
const text = (v, max) => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined);
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ---------- question review ----------
// Keep only the fields and values the form allows (the API stores nothing else).
export function cleanReview(d) {
  d = d && typeof d === "object" ? d : {};
  const o = {};
  for (const f of REVIEW_FIELDS) if (codes(f.options).has(d[f.key])) o[f.key] = d[f.key];
  for (const [k, max] of Object.entries(REVIEW_TEXT)) o[k] = text(d[k], max);
  if (o.specialty === "change") {
    if (SPEC.has(d.specialty_primary)) o.specialty_primary = d.specialty_primary;
    if (SPEC.has(d.specialty_secondary) && d.specialty_secondary !== o.specialty_primary) o.specialty_secondary = d.specialty_secondary;
  }
  if (!(o.specialty === "change" && (o.specialty_primary === "other" || o.specialty_secondary === "other"))) delete o.specialty_other;
  return prune(o);
}

// What is still missing before a review can be marked complete: [] when complete.
export function missingReview(d) {
  const miss = [];
  for (const f of REVIEW_FIELDS) if (!d[f.key]) miss.push(f.label.replace(/\?$/, "").replace(/^(\d)\. /, "$1 "));
  if (d.realistic === "needs_edit" && !d.rewording) miss.push("a suggested rewording (2)");
  if (d.specialty === "change" && !d.specialty_primary) miss.push("the new specialty (3)");
  if (d.specialty === "change" && (d.specialty_primary === "other" || d.specialty_secondary === "other") && !d.specialty_other)
    miss.push("the name of the other specialty (3)");
  if (d.versions === "no" && !d.versions_comment) miss.push("which version does not make sense, and why (4)");
  if (d.decision === "drop" && !d.comment) miss.push("a comment on why to drop it (6)");
  if (d.decision === "edit" && !d.rewording && !d.comment) miss.push("the edit: a rewording (2) or a comment (6)");
  return miss;
}

// The specialty the doctor's review settles on: the proposed one when confirmed.
export function reviewedSpecialty(d, proposed) {
  if (d.specialty === "confirm") return { primary: proposed.primary, secondary: proposed.secondary || null };
  if (d.specialty === "change") return { primary: d.specialty_primary || null, secondary: d.specialty_secondary || null };
  return { primary: null, secondary: null };
}

// ---------- new question ----------
export function cleanNewQuestion(d) {
  d = d && typeof d === "object" ? d : {};
  const o = {};
  if (SPEC.has(d.specialty)) o.specialty = d.specialty;
  if (SET.has(d.setting)) o.setting = d.setting;
  for (const [k, max] of Object.entries(NEWQ_TEXT)) o[k] = text(d[k], max);
  if (o.specialty !== "other") delete o.specialty_other;
  let det = Array.isArray(d.details) ? [...new Set(d.details.filter((x) => DET.has(x)))] : [];
  if (det.includes("none")) det = ["none"];
  if (det.length) o.details = det;
  if (!det.includes("other")) delete o.details_other;
  const changes = {};
  for (const k of det.filter((x) => x !== "none")) {
    const c = d.changes?.[k] || {};
    const one = prune({ change: CHG.has(c.change) ? c.change : undefined, reason: text(c.reason, 2000) });
    if (Object.keys(one).length) changes[k] = one;
  }
  if (Object.keys(changes).length) o.changes = changes;
  return prune(o);
}

// Square brackets in a template must pair up and not nest.
export function templateProblem(t) {
  if (!t) return null;
  let open = false, slots = 0;
  for (const ch of t) {
    if (ch === "[") { if (open) return "a [ inside another [ ]"; open = true; }
    else if (ch === "]") { if (!open) return "a ] without its ["; open = false; slots++; }
  }
  if (open) return "a [ without its ]";
  return slots ? null : "no [ ] around the words that could change";
}

export function missingNewQuestion(d) {
  const miss = [];
  if (!d.specialty) miss.push("specialty");
  if (d.specialty === "other" && !d.specialty_other) miss.push("the name of the other specialty");
  if (!d.setting) miss.push("setting");
  if (!d.question || d.question.trim().length < 15) miss.push("the question as a patient would ask it");
  if (!d.details?.length) miss.push("which details could matter");
  if (d.details?.includes("other") && !d.details_other) miss.push("the other detail's name");
  const label = Object.fromEntries(DETAILS);
  for (const k of (d.details || []).filter((x) => x !== "none")) {
    const c = d.changes?.[k] || {};
    if (!c.change) miss.push(`whether ${label[k].toLowerCase()} should change the advice`);
    if (!c.reason) miss.push(`the reason for ${label[k].toLowerCase()}`);
  }
  const tp = templateProblem(d.template);
  if (tp) miss.push(`the template: ${tp}`);
  return miss;
}
