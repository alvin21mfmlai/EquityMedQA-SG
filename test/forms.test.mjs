// npm test  (node --test; no database needed): the question-review and new-question forms, and the blind data file
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { NEW_PER_PRIORITY, PRIORITY, cleanNewQuestion, cleanReview, missingNewQuestion, missingReview, reviewedSpecialty,
         templateProblem } from "../public/forms.js";

const review = () => ({ relevant: "yes", realistic: "yes", specialty: "confirm", versions: "yes", decision: "keep" });

test("a full review is complete; unknown keys and values are dropped", () => {
  assert.deepEqual(missingReview(cleanReview(review())), []);
  const d = cleanReview({ ...review(), relevant: "maybe", x: 1, specialty_primary: "cardiology", comment: "  " });
  assert.equal(d.relevant, undefined);
  assert.equal(d.x, undefined);
  assert.equal(d.specialty_primary, undefined, "a new specialty is kept only when the doctor changes it");
  assert.equal(d.comment, undefined, "blank text is not stored");
});

test("review conditions: rewording, new specialty, other name, versions and drop reasons", () => {
  const m = (d) => missingReview(cleanReview({ ...review(), ...d }));
  assert.match(m({ realistic: "needs_edit" }).join(), /rewording/);
  assert.deepEqual(m({ realistic: "needs_edit", rewording: "Better words" }), []);
  assert.match(m({ specialty: "change" }).join(), /new specialty/);
  assert.match(m({ specialty: "change", specialty_primary: "other" }).join(), /other specialty/);
  assert.deepEqual(m({ specialty: "change", specialty_primary: "other", specialty_other: "Respiratory medicine" }), []);
  assert.match(m({ versions: "no" }).join(), /which version/);
  assert.match(m({ decision: "drop" }).join(), /why to drop/);
  assert.match(m({ decision: "edit" }).join(), /rewording \(2\) or a comment/);
  assert.equal(cleanReview({ ...review(), specialty: "change", specialty_primary: "oncology", specialty_secondary: "oncology" })
    .specialty_secondary, undefined, "the secondary differs from the primary");
});

test("the reviewed specialty is the proposed one when confirmed", () => {
  const p = { primary: "oncology", secondary: "obgyn" };
  assert.deepEqual(reviewedSpecialty({ specialty: "confirm" }, p), { primary: "oncology", secondary: "obgyn" });
  assert.deepEqual(reviewedSpecialty({ specialty: "change", specialty_primary: "obgyn" }, p), { primary: "obgyn", secondary: null });
});

const newq = () => ({ specialty: "cardiology", setting: "singapore", question: "I am a 58-year-old woman with breathlessness.",
  details: ["sex"], changes: { sex: { change: "yes", reason: "Atypical presentation in women" } } });

test("a full new question passes; None of these excludes the other details", () => {
  assert.deepEqual(missingNewQuestion(cleanNewQuestion(newq())), []);
  const d = cleanNewQuestion({ ...newq(), details: ["sex", "none", "bogus"] });
  assert.deepEqual(d.details, ["none"]);
  assert.equal(d.changes, undefined, "no per-detail answers once None of these is chosen");
  assert.deepEqual(missingNewQuestion(d), []);
});

test("new question conditions: every detail needs a change and a reason; other names; template brackets", () => {
  const m = (d) => missingNewQuestion(cleanNewQuestion({ ...newq(), ...d }));
  assert.match(m({ details: ["sex", "religion"] }).join(), /religion should change.*reason for religion/);
  assert.match(m({ details: ["other"], changes: { other: { change: "no", reason: "r" } } }).join(), /other detail's name/);
  assert.match(m({ specialty: "other" }).join(), /other specialty/);
  assert.match(m({ question: "short" }).join(), /as a patient would ask it/);
  assert.match(m({ template: "I am a [woman / man" }).join(), /without its \]/);
  assert.deepEqual(m({ template: "I am a 58-year-old [woman / man] with breathlessness." }), []);
  assert.equal(templateProblem("no brackets"), "no [ ] around the words that could change");
  assert.equal(templateProblem("[a [b]]"), "a [ inside another [ ]");
});

// the review page's data: built by prepare_data.py from a whitelist (question only)
const file = new URL("../data/questions.json", import.meta.url);
test("questions.json holds the question only (blind rule)", { skip: !fs.existsSync(file) && "data/questions.json not built" }, () => {
  const { questions } = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(questions.length, 250);
  for (const q of questions) {
    assert.deepEqual(Object.keys(q).sort(), ["axes", "base_id", "neutral_question", "order", "sources", "specialty", "template_display"]);
    assert.deepEqual(Object.keys(q.specialty).sort(), ["other_specialty", "primary", "secondary"]);
    for (const a of q.axes) for (const v of a.versions) assert.deepEqual(Object.keys(v).sort(), ["display", "question", "value"]);
  }
  const blob = JSON.stringify(questions);
  // no answer, reference, label or rationale field anywhere (a question's own words may say "reference range")
  assert.doesNotMatch(blob, /"(reference\w*|key_points|label\w*_rationale|rationale|answer\w*|verdict\w*|domain|is_adversarial_premise)":/);
  for (const w of ["INVARIANT", "CONTEXT_DEPENDENT", "MedGemma", "gpt-oss", "Nemotron"])
    assert.ok(!blob.includes(w), `"${w}" must not appear in questions.json`);
});

test("a template's [brackets] are only for details that change between the question's versions", { skip: !fs.existsSync(file) && "data/questions.json not built" }, () => {
  const axisOf = (slot) => (slot.includes("/") ? "sex" : slot.includes("ethnic") ? "ethnicity" : slot.includes("religion") ? "religion" : slot);
  const { questions } = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const q of questions) {
    const varied = new Set(q.axes.map((a) => a.axis));
    for (const [, slot] of q.template_display.matchAll(/\[([^\]]+)\]/g))
      assert.ok(varied.has(axisOf(slot)), `${q.base_id}: [${slot}] never changes (run scripts/fix_templates.py)`);
  }
});

test("the analysis script's priority specialties and target are the forms'", () => {
  const py = fs.readFileSync(new URL("../analysis/analyse_reviews.py", import.meta.url), "utf8");
  assert.deepEqual(JSON.parse(py.match(/^PRIORITY = (\[.*\])$/m)[1]), PRIORITY);
  assert.equal(Number(py.match(/^NEW_PER_PRIORITY = (\d+)$/m)[1]), NEW_PER_PRIORITY);
});
