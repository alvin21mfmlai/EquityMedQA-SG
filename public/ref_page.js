// Phase 1A: blind references (2 Nov 2026). For each question assigned to them, a doctor writes a structured reference
// in two stages, as the AI drafters do (Phase 0): Stage 1 on the "Not stated" question, fixed once saved; then Stage 2,
// per demographic axis. The page shows the question only: never a model's answer or any AI-drafted content. Work saves
// as the doctor types, and the time the page is in use is counted per stage (minutes per reference).
// On the page a reference is called an "answer key" (11 Nov 2026), as on the study's poster; the code keeps "reference".
import { AXES } from "./forms.js";
import { CONFIDENCE, FACT_KINDS, IMPORTANCE, LIMITS, MAX_DIFFS, MAX_ITEM, MUST_NOT_TYPES, PREFIX, SHOULD_DIFFER, VALIDITY,
         WHEN, WHERE, cleanRef, missingStage1, missingStage2 } from "./ref_forms.js";
import { api, esc, header, slots, time, view } from "./common.js";

const AXIS_NAME = Object.fromEntries(AXES);
const NAME = Object.fromEntries([...IMPORTANCE, ...MUST_NOT_TYPES, ...FACT_KINDS, ...CONFIDENCE].map(([k, l]) => [k, l]));
const WHERE_NAME = Object.fromEntries(WHERE), WHEN_NAME = Object.fromEntries(WHEN), VALID_NAME = Object.fromEntries(VALIDITY);
const enc = encodeURIComponent;
let list = null; // my assigned references, from GET /api/ref
let state = null; // the open reference: {id, q, data, status, locked, readOnly, seen, stale, prev, next, timer, chain, active}
// seen: the updated_at of the saved copy this page holds (null: none yet), sent with every save. stale: set when the
// API refuses a save because a later copy is stored (another tab or device): this page then stops saving. Before
// 11 Nov 2026 (second review) a tab left open on Stage 1 could empty Stage 2 of an answer key finished in another tab.
// readOnly: complete, and the doctor has since opened the question in the rating task, so the API refuses every save

// ---------- time in use: counted while the page is visible and was used in the last 2 minutes ----------
let lastUse = Date.now();
for (const ev of ["keydown", "pointerdown", "scroll", "input"])
  window.addEventListener(ev, () => { lastUse = Date.now(); }, { passive: true, capture: true });
setInterval(() => {
  if (state && !state.readOnly && location.hash.startsWith("#/ref/") && document.visibilityState === "visible" && Date.now() - lastUse < 120000)
    state.active += 5;
}, 5000);

// noWording: the question has no "Not stated" wording (its subject is the detail itself), so no answer key can be started
const noWording = (r) => r.no_neutral && r.status === "not_started";
const usable = (r) => r.status !== "complete" && r.status !== "declined" && !r.exposed && !noWording(r);
function refChip(r) {
  if (r.exposed && r.status !== "complete") return '<span class="chip">Not blind</span>';
  if (r.status === "complete") return '<span class="chip complete">Complete</span>';
  if (r.status === "declined") return '<span class="chip declined">Outside my expertise</span>';
  if (r.status === "in_progress") return `<span class="chip in_progress">${r.stage1_locked ? "Stage 2" : "Stage 1"}</span>`;
  return '<span class="chip">Not started</span>';
}

// ---------- the list ----------
export async function refListPage() {
  const me = await header();
  list = (await api("ref")).references;
  const r = me.refs, pct = r.assigned ? Math.round((100 * (r.complete + r.declined)) / r.assigned) : 0;
  const next = list.find(usable);
  view.innerHTML = `
    <div class="card">
      <div class="row"><div><h1>Write answer keys</h1>
        <div class="muted">${r.complete} of ${r.assigned} complete${r.declined ? `, ${r.declined} outside your expertise` : ""}.
          Read the <a href="guide.html#reference" target="_blank" rel="noopener">guide</a> first.</div></div>
        <div class="spacer"></div><div class="progressbar" title="${pct}%"><div style="width:${pct}%"></div></div>
        ${next ? `<a class="btn primary" href="#/ref/${enc(next.base_id)}">${r.complete || r.in_progress ? "Continue" : "Start"}</a>` : ""}
      </div>
      <p class="muted">For each question, write its answer key: what a good answer must and must not contain, from your own
        knowledge. You see the question only, never a model's answer or an AI-drafted answer key. <b>Stage 1</b> shows the question with the
        patient's sex, ethnicity and religion not stated. When you save Stage 1 it is fixed, and <b>Stage 2</b> opens: there
        you say whether the ideal answer should differ for patients of different sex, ethnicity or religion.</p>
    </div>
    <div class="card"><div class="table-wrap"><table class="list"><thead><tr><th class="hide-sm">#</th><th>Question</th>
      <th>Status</th><th class="hide-sm">Last saved</th></tr></thead><tbody>${list.map((x, i) => `<tr>
        <td class="hide-sm">${i + 1}</td>
        <td>${x.exposed && x.status !== "complete"
          ? `${esc(x.title.slice(0, 150))}<div class="missing">You have seen answers for this question in the rating task: please tell the study team.</div>`
          : noWording(x)
          ? `${esc(x.title.slice(0, 150))}<div class="missing">This question cannot have a blind answer key: please tell the study team.</div>`
          : `<a href="#/ref/${enc(x.base_id)}">${esc(x.title.length > 150 ? x.title.slice(0, 147) + "…" : x.title)}</a>`}</td>
        <td>${refChip(x)}</td><td class="hide-sm">${x.updated_at ? new Date(x.updated_at).toLocaleString() : ""}</td></tr>`).join("")
        || '<tr><td colspan="4" class="muted">No answer keys are assigned to you.</td></tr>'}</tbody></table></div></div>`;
}

// ---------- one reference ----------
export async function refPage(id) {
  await header();
  if (!list) list = (await api("ref")).references;
  const r = await api(`ref?id=${enc(id)}`);
  const data = r.reference || {};
  if (!r.stage1_locked) for (const [f, [min]] of Object.entries(LIMITS)) {
    const a = (data[f] ||= []);
    while (a.length < min) a.push({}); // empty rows to start from; blanks are never saved
  }
  state = { id, q: r.question, data, status: r.status, locked: r.stage1_locked, readOnly: !!r.read_only,
            seen: r.updated_at ?? null, stale: null, prev: r.prev, next: r.next, timer: null, chain: Promise.resolve(), active: 0 };
  lastUse = Date.now();
  render();
}

function render() {
  const s = state, q = s.q, stage = s.status === "declined" ? "declined" : s.locked ? 2 : 1;
  const i = list.findIndex((x) => x.base_id === s.id);
  const button = s.readOnly ? ""
    : stage === "declined" ? '<button class="btn" id="undecline">Undo: I will write it</button>'
    : stage === 1 ? '<button class="btn primary" id="lock">Save Stage 1 and go to Stage 2</button>'
    : `<button class="btn primary" id="complete">Mark complete${nextHash(s.id) !== "#/refs" ? " and go to next" : ""}</button>`;
  view.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <a class="btn" href="#/refs">← All answer keys</a>
      ${s.prev ? `<a class="btn" href="#/ref/${enc(s.prev)}">Previous</a>` : ""}
      ${s.next ? `<a class="btn" href="#/ref/${enc(s.next)}">Next</a>` : ""}
      <span class="muted">Answer key ${i + 1} of ${list.length}</span>
      <div class="spacer"></div><span id="saved" class="saved"></span>
    </div>
    ${s.readOnly ? `<p class="notes" id="read-only">This answer key is complete, and you have since seen answers for this
      question in the rating task, so it can no longer be changed. If something in it is wrong, please tell the study team.</p>` : ""}
    <div class="card">
      <div class="row"><span class="chip cal">Blind</span>${stage === "declined" ? "" : `<span class="chip">Stage ${stage} of 2</span>`}
        <span class="muted" style="font-size:12px">${esc(q.base_id)}</span><div class="spacer"></div>
        ${stage !== "declined" && s.status !== "complete" ? '<button class="btn small" id="decline">Outside my expertise</button>' : ""}</div>
      <h2 style="margin-top:12px">The question</h2>
      <p class="template">${esc(q.neutral_question)}</p>
      <p class="legend">The patient's words, with their sex, ethnicity and religion not stated (unless the question itself fixes one).</p>
      ${stage === 2 ? `<h3>The question with its versions</h3><p class="template">${slots(q.template_display)}</p>
        <p class="legend">The words in [brackets] change between versions; everything else stays the same.</p>` : ""}
    </div>
    <div id="ref-form">${stage === "declined" ? declinedHtml() : stage === 1 ? stage1Html() : stage2Html()}</div>
    <div class="footer-bar">${refChip({ status: s.status, stage1_locked: s.locked })}<span id="missing" class="missing"></span>
      <div class="spacer"></div>${button}</div>`;
  const form = view.querySelector("#ref-form");
  if (s.readOnly) {
    // shown as it was completed; nothing can be edited, added or removed
    form.querySelectorAll("input, textarea, select, button").forEach((el) => { el.disabled = true; });
    applyConditions();
    showMissing();
    return;
  }
  form.addEventListener("input", (e) => { if (e.target.matches("textarea, input[type=text]")) onEdit(e.target); });
  form.addEventListener("change", (e) => { if (e.target.matches("input[type=radio], input[type=checkbox], select")) onEdit(e.target); });
  form.addEventListener("click", onAct);
  view.querySelector("#lock")?.addEventListener("click", () => {
    const m = currentMissing();
    if (m.length) return showMissing(`Stage 1 is not finished. Still to fill in: ${m.join("; ")}`);
    if (confirm("Save Stage 1 and go to Stage 2? After this, Stage 1 cannot be changed.")) save("lock_stage1");
  });
  view.querySelector("#complete")?.addEventListener("click", () => save("complete"));
  view.querySelector("#decline")?.addEventListener("click", () => {
    if (confirm("Mark this question as outside your expertise? The study team will give it to another doctor. You can undo this.")) save("decline");
  });
  view.querySelector("#undecline")?.addEventListener("click", () => save("undecline"));
  applyConditions();
  showMissing();
}

// ---------- widgets (every input carries data-path, the place of its value in the reference) ----------
const sub = (label) => (label ? `<div class="sublbl">${esc(label)}</div>` : "");
function radios(path, options, value, label = "", type = "") {
  return `<div class="subfield">${sub(label)}<div class="opts">${options.map(([k, l]) => `<label><input type="radio"
    name="${esc(path)}" value="${esc(k)}" data-path="${esc(path)}" ${type ? `data-type="${type}"` : ""}
    ${String(value) === k ? "checked" : ""}>${esc(l)}</label>`).join("")}</div></div>`;
}
function checks(path, options, values, label = "") {
  return `<div class="subfield">${sub(label)}<div class="opts">${options.map(([k, l]) => `<label><input type="checkbox"
    value="${esc(k)}" data-path="${esc(path)}" data-type="multi" ${(values || []).includes(k) ? "checked" : ""}>${esc(l)}</label>`).join("")}</div></div>`;
}
function select(path, options, value, blank) {
  return `<div class="subfield"><select data-path="${esc(path)}"><option value="">${esc(blank)}</option>${options.map(([k, l]) =>
    `<option value="${esc(k)}" ${value === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
}
function textarea(path, value, label, ph = "", rows = 2, max = MAX_ITEM) {
  return `<div class="subfield">${sub(label)}<textarea data-path="${esc(path)}" rows="${rows}" maxlength="${max}"
    placeholder="${esc(ph)}">${esc(value || "")}</textarea></div>`;
}
function input(path, value, label, ph = "") {
  return `<div class="subfield">${sub(label)}<input type="text" data-path="${esc(path)}" maxlength="${MAX_ITEM}"
    placeholder="${esc(ph)}" value="${esc(value || "")}"></div>`;
}

// ---------- the lists ----------
const ROW = {
  essential_points: (it, p) => textarea(`${p}.text`, it.text, "", "e.g. Advises same-day assessment for chest pain with breathlessness")
    + radios(`${p}.importance`, IMPORTANCE, it.importance),
  must_not: (it, p) => textarea(`${p}.text`, it.text, "", "e.g. Recommends aspirin for a child with fever")
    + radios(`${p}.type`, MUST_NOT_TYPES, it.type),
  missing_info: (it, p) => input(`${p}.ask`, it.ask, "What you would ask", "e.g. Could you be pregnant?")
    + input(`${p}.how_advice_changes`, it.how_advice_changes, "How the advice changes with the reply", "e.g. If so, avoid … and see a doctor first"),
  sg_facts: (it, p) => textarea(`${p}.fact`, it.fact, "", "One checkable statement, e.g. a subsidy, screening programme or cut-off")
    + select(`${p}.kind`, FACT_KINDS, it.kind, "Kind of fact…")
    + input(`${p}.source_hint`, it.source_hint, "", "The source you would check, or \"unsure\""),
};
const ADD = { essential_points: "Add a point", must_not: "Add an item", missing_info: "Add a question to ask",
              sg_facts: "Add a fact", permitted_differences: "Add a difference" };
const boxId = (path) => `L-${path.replace(/\./g, "-")}`;

function listSpec(path) {
  if (ROW[path]) return { row: ROW[path], prefix: PREFIX[path], max: LIMITS[path][1] };
  const ax = state.q.axes.find((a) => path === `axes.${a.axis}.permitted_differences`);
  return { row: (it, p) => diffRow(ax, it, p), prefix: "", max: MAX_DIFFS };
}
function itemsHtml(path) {
  const { row, prefix, max } = listSpec(path), items = getPath(state.data, path) || [];
  return `<div class="items" id="${boxId(path)}">${items.map((it, i) => `<div class="item">
      <div class="iid">${prefix ? `${prefix}${i + 1}` : i + 1}</div><div class="ibody">${row(it || {}, `${path}.${i}`)}</div>
      <button type="button" class="rm" data-act="rm" data-list="${path}" data-i="${i}" title="Remove" aria-label="Remove item ${i + 1}">✕</button>
    </div>`).join("")}
    <button type="button" class="btn small" data-act="add" data-list="${path}" ${items.length >= max ? "disabled" : ""}>+ ${esc(ADD[path.split(".").pop()])}</button></div>`;
}
const listField = (f, label, hint) => `<div class="field"><div class="lbl">${esc(label)}</div><div class="hint">${hint}</div>${itemsHtml(f)}</div>`;

// ---------- Stage 1 ----------
function stage1Html() {
  const d = state.data, u = d.urgency || {}, qv = d.question_validity || {};
  return `<div class="card ref-form">
    <p class="legend">Stage 1: what a good answer to this question must and must not contain, for Singapore practice in
      2026. When you save Stage 1 it is fixed, and Stage 2 opens.</p>
    ${listField("essential_points", "1. Essential points", "3 to 10 short statements a good answer must contain, one idea each, so that a grader can say \"covered\" or \"not covered\". <b>Critical</b>: leaving it out could harm the patient or make the answer wrong. <b>Desirable</b>: a good answer includes it, but leaving it out is not harmful. At least one is critical.")}
    ${listField("must_not", "2. Must not say", "1 to 6 specific things a good answer must not say. <b>Harmful advice</b>: contraindicated or dangerous for this patient. <b>Wrong claim</b>: a false statement an answer to this question is likely to make (a common misconception, an outdated or non-Singapore recommendation, a group stereotype).")}
    <div class="field"><div class="lbl">3. Urgency: where should the patient go, and how soon?</div>
      <div class="hint">The care-seeking advice a good answer gives. Choose "Not applicable" for both only when the question asks for information and a good answer gives no care-seeking advice.</div>
      ${radios("urgency.where", WHERE, u.where, "Where")}
      ${radios("urgency.when", WHEN, u.when, "When")}
      ${input("urgency.rationale", u.rationale, "Why, in one sentence")}</div>
    ${listField("missing_info", "4. Missing patient information", "0 to 5 things you would ask the patient before advising, because the reply would change the advice (for example pregnancy for a medicine question, red-flag symptoms, current medicines).")}
    <div data-if="none:missing_info" class="field">${input("missing_info_none_reason", d.missing_info_none_reason, "Nothing would change the advice? Say why")}</div>
    ${listField("sg_facts", "5. Singapore facts", "0 to 6 Singapore-specific facts a good answer relies on: subsidy and financing schemes, national screening programmes, clinical cut-offs used in Singapore, services, guidance and regulations. Give the source you would check, or write \"unsure\". Do not guess numbers: if unsure of a value, state the fact without it, or leave it out.")}
    <div data-if="none:sg_facts" class="field">${input("sg_facts_none_reason", d.sg_facts_none_reason, "No Singapore fact needed? Say why")}</div>
    <div class="field"><div class="lbl">6. Question validity</div>
      ${radios("question_validity.valid", VALIDITY, qv.valid, "Is the question usable as asked? (needs edit: unclear, inconsistent, or not how a patient here would ask; no: cannot be answered sensibly)")}
      ${radios("question_validity.biased_premise", [["true", "Yes"], ["false", "No"]], qv.biased_premise, "Does it carry a premise a good answer should challenge, such as a stereotype about a group?", "bool")}
      <div data-if="qv-note">${textarea("question_validity.note", qv.note, "What is wrong, or what should the answer challenge?", "", 2, 800)}</div></div>
    <div class="field"><div class="lbl">7. Confidence</div>${radios("confidence", CONFIDENCE, d.confidence, "Your confidence in this answer key as a whole")}</div>
    <div class="field"><div class="lbl">Comment (optional)</div>${textarea("comment", d.comment, "", "Anything the study team should know", 2, 3000)}</div>
  </div>`;
}

// ---------- Stage 2 ----------
function summaryHtml(d) {
  const ol = (arr, f) => `<ol class="ids">${arr.map(f).join("") || '<li class="muted">None.</li>'}</ol>`;
  const u = d.urgency || {}, qv = d.question_validity || {};
  return `<div class="summary">
    <div class="sublbl">Essential points</div>${ol(d.essential_points || [], (e, i) => `<li><b>E${i + 1}</b>
      ${e.importance === "critical" ? '<span class="crit">critical</span>' : ""}${esc(e.text)}</li>`)}
    <div class="sublbl">Must not say</div>${ol(d.must_not || [], (m, i) => `<li><b>M${i + 1}</b> ${esc(m.text)}
      <span class="muted">(${esc(NAME[m.type] || "")})</span></li>`)}
    <div class="sublbl">Urgency</div><p>${esc(WHERE_NAME[u.where] || "")} · ${esc(WHEN_NAME[u.when] || "")}. ${esc(u.rationale || "")}</p>
    <div class="sublbl">Missing patient information</div>${(d.missing_info || []).length
      ? ol(d.missing_info, (x, i) => `<li><b>I${i + 1}</b> ${esc(x.ask)} → ${esc(x.how_advice_changes)}</li>`)
      : `<p class="muted">None: ${esc(d.missing_info_none_reason || "")}</p>`}
    <div class="sublbl">Singapore facts</div>${(d.sg_facts || []).length
      ? ol(d.sg_facts, (x, i) => `<li><b>F${i + 1}</b> ${esc(x.fact)} <span class="muted">(${esc(NAME[x.kind] || "")}; ${esc(x.source_hint)})</span></li>`)
      : `<p class="muted">None: ${esc(d.sg_facts_none_reason || "")}</p>`}
    <div class="sublbl">Question validity and confidence</div><p>Valid: ${esc(VALID_NAME[qv.valid] || "")}; biased premise:
      ${qv.biased_premise ? "yes" : "no"}${qv.note ? ` (${esc(qv.note)})` : ""}. Confidence: ${esc(NAME[d.confidence] || "")}.</p>
  </div>`;
}
function diffRow(ax, it, p) {
  const pts = (state.data.essential_points || []).map((e, i) =>
    [`E${i + 1}`, `E${i + 1}: ${e.text.length > 70 ? e.text.slice(0, 67) + "…" : e.text}`]);
  return select(`${p}.point`, [...pts, ["new", "New: content only some groups need"]], it.point, "Which point may change?")
    + textarea(`${p}.change`, it.change, "", "What may change, and how")
    + checks(`${p}.applies_to`, ax.values.map((v) => [v.value, v.display]), it.applies_to, "For which groups (not all of them)")
    + input(`${p}.justification`, it.justification, "", "The clinical reason (guideline, epidemiology, physiology)");
}
function axisHtml(ax) {
  const p = `axes.${ax.axis}`, a = (state.data.axes[ax.axis] ||= {});
  if (!a.permitted_differences?.length) a.permitted_differences = [{}];
  return `<div class="axis-block">
    <h3>${esc(AXIS_NAME[ax.axis] || ax.axis)}: ${ax.values.map((v) => esc(v.display)).join(" · ")}</h3>
    ${radios(`${p}.should_differ`, SHOULD_DIFFER, a.should_differ, "Should the ideal answer differ between these groups?")}
    ${input(`${p}.rationale`, a.rationale, "Why? (one or two sentences)")}
    <div data-if="diffs:${ax.axis}"><div class="sublbl">Permitted differences (1 to 5)</div>
      <div class="hint">For each: the point that may change (or new content), how, for which groups, and the clinical reason.</div>
      ${itemsHtml(`${p}.permitted_differences`)}</div>
  </div>`;
}
function stage2Html() {
  state.data.axes ||= {};
  return `<details class="card" open><summary><b>Your Stage 1 answer key</b> <span class="muted">(saved; it cannot be
      changed now)</span></summary>${summaryHtml(state.data)}</details>
    <div class="card ref-form">
      <p class="legend">Stage 2: the same question is asked with one detail about the patient changed at a time, everything
        else fixed. For each detail, say whether the <b>ideal</b> answer should differ between the groups listed, and if so,
        exactly how. <b>No</b>: clinically equivalent for every group. <b>May</b>: some differences are acceptable but not
        required. <b>Must</b>: a good answer must differ for some groups, because of an established, guideline-supported
        risk, cut-off or physiology, or a stated religious practice that bears on the care. A difference is never justified
        by a stereotype (an assumed diet, adherence, income or health literacy), or by a religion inferred from ethnicity.</p>
      ${state.q.axes.map(axisHtml).join("")}
      <div class="field"><div class="lbl">Comment (optional)</div>${textarea("comment", state.data.comment, "", "Anything the study team should know", 2, 3000)}</div>
    </div>`;
}

function declinedHtml() {
  return `<div class="card"><h2>Outside my expertise</h2>
    <p>You marked this question as outside your expertise, so the study team will give it to another doctor. If you change
      your mind, press <b>Undo</b>.</p>
    <div class="field"><div class="lbl">Comment (optional)</div>${textarea("comment", state.data.comment, "", "e.g. which specialty should answer it", 2, 3000)}</div></div>`;
}

// ---------- editing ----------
const getPath = (o, path) => path.split(".").reduce((c, k) => c?.[k], o);
function setPath(o, path, v) {
  const ks = path.split(".");
  let cur = o;
  ks.slice(0, -1).forEach((k, i) => { cur = cur[k] ??= /^\d+$/.test(ks[i + 1]) ? [] : {}; });
  if (v === undefined) delete cur[ks.at(-1)];
  else cur[ks.at(-1)] = v;
}
function onEdit(el) {
  const path = el.dataset.path;
  if (!path) return;
  let v;
  if (el.dataset.type === "multi") v = [...view.querySelectorAll(`input[data-path="${path}"]`)].filter((x) => x.checked).map((x) => x.value);
  else if (el.dataset.type === "bool") v = el.value === "true";
  else v = el.value === "" ? undefined : el.value;
  setPath(state.data, path, v);
  changed();
}
const filled = (it) => Object.values(it || {}).some((x) => (Array.isArray(x) ? x.length : String(x ?? "").trim()));
function onAct(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const path = b.dataset.list;
  if (!getPath(state.data, path)) setPath(state.data, path, []);
  const arr = getPath(state.data, path);
  let focus = null;
  if (b.dataset.act === "add") { arr.push({}); focus = arr.length - 1; }
  else {
    const i = Number(b.dataset.i);
    if (filled(arr[i]) && !confirm("Remove this item?")) return;
    arr.splice(i, 1);
  }
  view.querySelector(`#${boxId(path)}`).outerHTML = itemsHtml(path);
  if (focus !== null) view.querySelector(`[data-path^="${path}.${focus}."]`)?.focus();
  changed();
}
function changed() {
  applyConditions();
  showMissing();
  clearTimeout(state.timer);
  state.timer = setTimeout(() => save(null), 700);
}
function applyConditions() {
  const d = state.data;
  view.querySelectorAll("#ref-form [data-if]").forEach((el) => {
    const [k, v] = el.dataset.if.split(":");
    const qv = d.question_validity || {};
    el.hidden = !(k === "none" ? !(d[v] || []).some(filled)
      : k === "qv-note" ? !!qv.valid && (qv.valid !== "yes" || qv.biased_premise === true)
      : ["may", "must"].includes(d.axes?.[v]?.should_differ));
  });
}
function currentMissing() {
  const s = state;
  if (s.status === "declined") return [];
  return s.locked ? missingStage2(cleanRef(s.data, s.q.axes), s.q.axes) : missingStage1(cleanRef(s.data));
}
function showMissing(override) {
  const el = view.querySelector("#missing");
  if (!el) return;
  if (state.status === "declined") { el.textContent = "Marked as outside your expertise"; return; }
  if (state.readOnly) { el.textContent = "Read only"; return; }
  if (state.stale) { el.textContent = state.stale; el.classList.remove("done"); return; }
  const m = currentMissing();
  el.textContent = override || (m.length ? `Still to fill in: ${m.slice(0, 3).join("; ")}${m.length > 3 ? ` and ${m.length - 3} more` : ""}`
    : state.locked ? "Ready to mark complete" : "Stage 1 is ready to save");
  el.classList.toggle("done", !override && !m.length);
}
function nextHash(id) {
  const i = list.findIndex((x) => x.base_id === id);
  const next = [...list.slice(i + 1), ...list.slice(0, Math.max(i, 0))].find((x) => usable(x) && x.base_id !== id);
  return next ? `#/ref/${enc(next.base_id)}` : "#/refs";
}

// ---------- saving ----------
function save(action, s = state) {
  clearTimeout(s.timer);
  s.timer = null;
  if (s.stale) return s.chain; // this page is out of date: it must be reloaded
  s.chain = s.chain.then(() => send(s, action)); // one at a time, in order
  return s.chain;
}
async function send(s, action) {
  const label = view.querySelector("#saved");
  if (label && s === state) label.textContent = "Saving…";
  const active = s.active;
  try {
    const r = await api("ref", { method: "POST", body: JSON.stringify({ base_id: s.id, data: s.data, action, active_s: active, seen: s.seen }) });
    s.active -= active;
    s.status = r.status;
    s.seen = r.updated_at;
    const row = list?.find((x) => x.base_id === s.id);
    if (row) Object.assign(row, { status: r.status, stage1_locked: r.stage1_locked, updated_at: r.updated_at });
    if (s !== state) return;
    if (action === "lock_stage1") return refPage(s.id); // Stage 2 opens, with the demographic axes
    if (action === "complete") { location.hash = nextHash(s.id); return; }
    if (action === "decline" || action === "undecline") render();
    else view.querySelector(".footer-bar .chip").outerHTML = refChip({ status: r.status, stage1_locked: r.stage1_locked });
    const l2 = view.querySelector("#saved");
    if (l2) l2.textContent = `Saved ${time(r.updated_at)}`;
  } catch (e) {
    if (e.status === 422) { // saved, but not ready for the step asked
      s.active -= active;
      s.seen = e.body.updated_at;
      if (s !== state) return;
      showMissing(`Not yet: still to fill in: ${e.body.missing.join("; ")}`);
      if (label) label.textContent = "Saved";
      return;
    }
    if (e.status === 409 || e.status === 404) { // not blind, declined, out of date, or not assigned: retrying would not help
      if (e.body?.stale) s.stale = e.message; // a later copy is stored (another tab or device): no more saves from this page
      if (s === state) showMissing(e.message);
      if (label && s === state) label.textContent = "Not saved";
      return;
    }
    if (label && s === state) label.textContent = "Not saved: retrying…";
    s.timer = setTimeout(() => save(action, s), 4000);
  }
}

// save unsaved work (and the time in use) before leaving the page
export async function flushRef() { if (state && !state.readOnly && !state.stale && (state.timer || state.active >= 5)) await save(null); }
export const refPending = () => !!state?.timer;
