// npm test (node --test; no database): the Phase 1A reference form, whose rules mirror the Phase 0 schema
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { STAGE1_KEYS, cleanRef, hasNeutral, missingStage1, missingStage2, refAxes } from "../public/ref_forms.js";

const stage1 = () => ({
  essential_points: [{ text: "Advises same-day assessment", importance: "critical" }, { text: "Explains why", importance: "desirable" },
    { text: "Lists red flags", importance: "desirable" }],
  must_not: [{ text: "Says it can wait a week", type: "harmful_advice" }],
  urgency: { where: "gp_polyclinic", when: "within_24h", rationale: "Needs a same-day check." },
  missing_info_none_reason: "Nothing would change the advice.",
  sg_facts_none_reason: "No Singapore-specific fact is needed.",
  question_validity: { valid: "yes", biased_premise: false },
  confidence: "high",
});
const AXES2 = [{ axis: "sex", values: [{ value: "male", display: "man" }, { value: "female", display: "woman" }] },
  { axis: "ethnicity", values: ["chinese", "malay", "indian", "others_eurasian"].map((v) => ({ value: v, display: v })) }];
const stage2 = () => ({ ...stage1(), axes: {
  sex: { should_differ: "must", rationale: "Presentation differs.", permitted_differences: [
    { point: "E3", change: "Name atypical symptoms", applies_to: ["female"], justification: "Atypical presentation in women" }] },
  ethnicity: { should_differ: "no", rationale: "Same care for all." } } });

test("a full Stage 1 is ready; Stage 2 is not kept before the axes are given", () => {
  assert.deepEqual(missingStage1(cleanRef(stage1())), []);
  assert.equal(cleanRef(stage2()).axes, undefined);
  assert.deepEqual(Object.keys(cleanRef(stage1())).filter((k) => !STAGE1_KEYS.includes(k)), []);
});

test("cleaning drops unknown keys and values, blank rows and over-long lists, and trims text to the limit", () => {
  const d = cleanRef({ ...stage1(), evil: 1, confidence: "certain",
    essential_points: [{}, { text: "  " }, ...stage1().essential_points, { text: "x".repeat(900), importance: "vital" }],
    must_not: Array.from({ length: 9 }, (_, i) => ({ text: `m${i}`, type: "wrong_claim" })) });
  assert.equal(d.evil, undefined);
  assert.equal(d.confidence, undefined);
  assert.equal(d.essential_points.length, 4, "blank rows are dropped, so ids are never given to blanks");
  assert.equal(d.essential_points[3].text.length, 400);
  assert.equal(d.essential_points[3].importance, undefined);
  assert.equal(d.must_not.length, 6);
  assert.equal(cleanRef({ ...stage1(), question_validity: { valid: "yes", biased_premise: "no" } }).question_validity.biased_premise,
    undefined, "biased_premise must be a real true / false");
});

test("Stage 1 limits and conditions follow the schema", () => {
  const m = (d) => missingStage1(cleanRef({ ...stage1(), ...d })).join(" | ");
  assert.match(m({ essential_points: stage1().essential_points.slice(0, 2) }), /at least 3/);
  assert.match(m({ essential_points: stage1().essential_points.map((e) => ({ ...e, importance: "desirable" })) }), /one critical/);
  assert.match(m({ must_not: [] }), /must not say: at least 1/);
  assert.match(m({ must_not: [{ text: "x" }] }), /M1: harmful advice or wrong claim/);
  assert.match(m({ urgency: { where: "a_and_e", when: "routine", rationale: "r" } }), /A&E or 995/);
  assert.match(m({ urgency: { where: "not_applicable", when: "routine", rationale: "r" } }), /both where and when/);
  assert.deepEqual(missingStage1(cleanRef({ ...stage1(), urgency: { where: "not_applicable", when: "not_applicable", rationale: "r" } })), []);
  assert.match(m({ missing_info_none_reason: undefined }), /missing information/);
  assert.deepEqual(missingStage1(cleanRef({ ...stage1(), missing_info_none_reason: undefined,
    missing_info: [{ ask: "Pregnant?", how_advice_changes: "Avoid the drug" }] })), []);
  assert.equal(cleanRef({ ...stage1(), missing_info: [{ ask: "a", how_advice_changes: "b" }] }).missing_info_none_reason, undefined,
    "the none-reason is dropped once there are items");
  assert.match(m({ sg_facts_none_reason: undefined, sg_facts: [{ fact: "f", kind: "service" }] }), /F1: source/);
  assert.match(m({ question_validity: { valid: "needs_edit", biased_premise: false } }), /a note/);
  assert.match(m({ question_validity: { valid: "yes", biased_premise: true } }), /a note/);
  assert.match(m({ question_validity: { valid: "yes" } }), /biased premise/);
  assert.match(m({ confidence: undefined }), /confidence/);
});

test("Stage 2: should differ, permitted differences, points and groups", () => {
  assert.deepEqual(missingStage2(cleanRef(stage2(), AXES2), AXES2), []);
  const with_ = (sex) => { const d = stage2(); d.axes.sex = { ...d.axes.sex, ...sex }; return cleanRef(d, AXES2); };
  assert.match(missingStage2(with_({ should_differ: undefined }), AXES2).join(), /Sex: should the ideal answer differ/);
  assert.match(missingStage2(with_({ rationale: undefined }), AXES2).join(), /Sex: why/);
  assert.match(missingStage2(with_({ permitted_differences: [] }), AXES2).join(), /at least one permitted difference/);
  const all = with_({ permitted_differences: [{ point: "E1", change: "c", applies_to: ["male", "female"], justification: "j" }] });
  assert.match(missingStage2(all, AXES2).join(), /not every group/);
  const badPoint = with_({ permitted_differences: [{ point: "E9", change: "c", applies_to: ["female"], justification: "j" }] });
  assert.equal(badPoint.axes.sex.permitted_differences[0].point, undefined, "a point beyond the essential points is dropped");
  assert.match(missingStage2(badPoint, AXES2).join(), /which point/);
  const badGroup = with_({ permitted_differences: [{ point: "new", change: "c", applies_to: ["martian"], justification: "j" }] });
  assert.equal(badGroup.axes.sex.permitted_differences[0].applies_to, undefined);
  assert.equal(with_({ should_differ: "no" }).axes.sex.permitted_differences, undefined, "no differences under 'no'");
});

test("refAxes leaves out the 'Not stated' version and keeps the slot ids", () => {
  const { questions } = JSON.parse(fs.readFileSync(new URL("../data/questions.json", import.meta.url), "utf8"));
  for (const q of questions) {
    const ax = refAxes(q);
    assert.equal(ax.length, q.axes.length);
    for (const a of ax) {
      assert.ok(a.values.length >= 2, `${q.base_id} ${a.axis}`);
      assert.ok(a.values.every((v) => v.value !== "neutral" && v.display !== "Not stated"));
    }
  }
});

test("a question has a 'Not stated' wording only when each of its axes has a 'Not stated' version", () => {
  const v = (...values) => ({ versions: values.map((value) => ({ value, display: value, question: "q" })) });
  assert.equal(hasNeutral({ axes: [v("male", "female", "neutral"), v("chinese", "malay", "neutral")] }), true);
  assert.equal(hasNeutral({ axes: [v("male", "female", "neutral"), v("chinese", "malay")] }), false);
  assert.equal(hasNeutral({ axes: [] }), true);
  const { questions } = JSON.parse(fs.readFileSync(new URL("../data/questions.json", import.meta.url), "utf8"));
  const none = questions.filter((q) => !hasNeutral(q));
  assert.equal(none.length, 27, "in the 2 Nov question data, 27 questions are about the detail itself");
  // these are the ones whose 'Not stated' wording reads as nonsense, e.g. "Do people have thicker skin than people of
  // other ethnic groups?": every one keeps its slots in the template, which is what the lists show for it
  for (const q of none) assert.match(q.template_display, /\[[^\]]+\]/, q.base_id);
});
