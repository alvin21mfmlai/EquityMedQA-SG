// npm test  (node --test; no database needed)
import assert from "node:assert/strict";
import test from "node:test";
import { cleanAnnotation, missingFields } from "../public/rubric.js";

const set = {
  baseline_item_id: "q__sex__neutral",
  variants: [
    { item_id: "q__sex__neutral", display_label: "Not stated" },
    { item_id: "q__sex__male", display_label: "Male" },
  ],
};
const full = () => ({
  question: { valid: "yes", depends: "no", reference: "acceptable" },
  answers: { "q__sex__neutral": { accuracy: "meets", harm: "none", bias: ["none"] },
             "q__sex__male": { accuracy: "meets", harm: "none", bias: ["none"] } },
  comparisons: { "q__sex__male": { difference: "wording" } },
});

test("a fully rated set is complete", () => assert.deepEqual(missingFields(full(), set), []));

test("unknown keys, values and items are dropped; the baseline has no comparison", () => {
  const d = cleanAnnotation({ question: { valid: "maybe", depends: "no", x: 1 },
    answers: { other__item: { accuracy: "meets" }, "q__sex__male": { bias: ["none", "evil"] } },
    comparisons: { "q__sex__neutral": { difference: "wording" } } }, set);
  assert.deepEqual(d.question, { depends: "no" });
  assert.deepEqual(Object.keys(d.answers), ["q__sex__male"]);
  assert.deepEqual(d.answers["q__sex__male"].bias, ["none"]);
  assert.deepEqual(d.comparisons, {});
});

test("a meaningful difference needs 3b-3e, and a comment when not justified or harmful", () => {
  const d = full();
  d.comparisons["q__sex__male"] = { difference: "meaningful" };
  assert.deepEqual(missingFields(d, set), ["3b for Male", "3c for Male", "3d for Male", "3e for Male"]);
  Object.assign(d.comparisons["q__sex__male"], { changed: ["urgency"], justified: "not_justified", better: "baseline", harm: "no" });
  assert.deepEqual(missingFields(d, set), ["comment for Male (required by 3c or 3e)"]);
  d.comparisons["q__sex__male"].comment = "quote";
  assert.deepEqual(missingFields(d, set), []);
  Object.assign(d.comparisons["q__sex__male"], { justified: "justified", harm: "likely_severe", comment: "" });
  assert.deepEqual(missingFields(d, set), ["comment for Male (required by 3c or 3e)"]);
});

test("a flawed question needs only a comment", () => {
  assert.deepEqual(missingFields({ question: { valid: "no" }, answers: {}, comparisons: {} }, set),
                   ["comment on what is wrong with the question"]);
  assert.deepEqual(missingFields({ question: { valid: "no", comment: "x" }, answers: {}, comparisons: {} }, set), []);
});

test("reference flagged or 'reference is wrong' needs a comment", () => {
  const d = full();
  d.question.reference = "wrong";
  assert.deepEqual(missingFields(d, set), ["comment on the reference answer"]);
  d.question.reference = "acceptable";
  d.answers["q__sex__male"].accuracy = "reference_wrong";
  assert.deepEqual(missingFields(d, set), ["comment on the reference (Male)"]);
});
