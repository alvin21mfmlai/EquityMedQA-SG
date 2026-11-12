// Question review (work item c): all 250 base questions, filtered by specialty and source. The page shows the question
// only (blind rule): the question as the patient asks it with its slots marked, the wording of its demographic
// versions, its source and the proposed specialty (the label only). The API logs every open (view_log, mode 'review').
import { AXES, REVIEW_FIELDS, SOURCES, SOURCE_NAME, SPECIALTIES, SPECIALTY_NAME, missingReview } from "./forms.js";
import { api, chip, diffQuestion, esc, fieldHtml, header, load, selectHtml, slots, store, textHtml, time, view } from "./common.js";

const FILTER_KEY = "emqsg_review_filter";
const AXIS_NAME = Object.fromEntries(AXES);
const FIELD = Object.fromEntries(REVIEW_FIELDS.map((f) => [f.key, f]));
let list = null; // the 250 with my status, from /api/questions
let state = null; // the open question: {q, data, status, seen, stale, timer, chain}
// seen: the updated_at of the saved copy this page holds (null: none yet), sent with every save. stale: set when the
// API refuses a save because a later copy is stored (another tab or device): this page then stops saving.

export const specialtyName = (code, other) =>
  code === "other" ? `Other${other ? `: ${other}` : ""}` : SPECIALTY_NAME[code] || code || "";
const proposedText = (s) => `${esc(specialtyName(s.primary, s.other_specialty))}${s.secondary
  ? ` <span class="muted">(secondary: ${esc(specialtyName(s.secondary, s.other_specialty))})</span>` : ""}`;

function getFilter() {
  const f = { specialty: "", source: "", status: "", text: "" };
  try { Object.assign(f, JSON.parse(load(FILTER_KEY) || "{}")); } catch {}
  return f;
}
function filtered(qs, f) {
  const t = f.text.trim().toLowerCase();
  return qs.filter((q) => (!f.specialty || q.specialty.primary === f.specialty) && (!f.source || q.sources.includes(f.source))
    && (!f.status || q.status === f.status) && (!t || q.title.toLowerCase().includes(t) || q.base_id.includes(t)));
}

// ---------- the list ----------
export async function reviewListPage() {
  const me = await header();
  list = (await api("questions")).questions;
  const f = getFilter();
  const done = me.review.complete, total = me.review.total, pct = total ? Math.round((100 * done) / total) : 0;
  view.innerHTML = `
    <div class="card">
      <div class="row"><div><h1>Review the questions</h1>
        <div class="muted">${done} of ${total} reviewed${me.review.in_progress ? `, ${me.review.in_progress} in progress` : ""}.
        About a minute each. Read the <a href="guide.html#review" target="_blank" rel="noopener">guide</a> first.</div></div>
        <div class="spacer"></div><div class="progressbar" title="${pct}%"><div style="width:${pct}%"></div></div>
        <a class="btn primary" id="continue" href="#/review">Continue</a>
      </div>
    </div>
    <div class="card">
      <div class="filters">
        <label>Specialty ${selectHtml("specialty", SPECIALTIES.map(([k, l]) => [k, k === "other" ? "Other" : l]), f.specialty, "All specialties")}</label>
        <label>Source ${selectHtml("source", SOURCES, f.source, "All sources")}</label>
        <label>Status ${selectHtml("status", [["not_started", "Not started"], ["in_progress", "In progress"], ["complete", "Complete"]], f.status, "Any status")}</label>
        <label>Search <input type="search" data-key="text" value="${esc(f.text)}" placeholder="Words in the question"></label>
      </div>
      <p class="legend" id="count"></p>
      <div class="table-wrap"><table class="list"><thead><tr><th class="hide-sm">#</th><th>Question</th><th>Specialty</th><th class="hide-sm">Source</th><th>Status</th></tr></thead>
        <tbody id="rows"></tbody></table></div>
    </div>`;
  const draw = () => {
    const f = getFilter(), rows = filtered(list, f);
    view.querySelector("#count").textContent = `Showing ${rows.length} of ${list.length} questions.`;
    view.querySelector("#rows").innerHTML = rows.map((q) => `<tr>
      <td class="hide-sm">${q.position}</td>
      <td><a href="#/review/${encodeURIComponent(q.base_id)}">${esc(q.title.length > 150 ? q.title.slice(0, 147) + "…" : q.title)}</a></td>
      <td>${esc(specialtyName(q.specialty.primary, q.specialty.other_specialty))}</td>
      <td class="hide-sm">${q.sources.map((s) => esc(SOURCE_NAME[s] || s)).join(", ")}</td>
      <td>${chip(q.status)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">No question matches these filters.</td></tr>';
    const next = rows.find((q) => q.status !== "complete");
    const btn = view.querySelector("#continue");
    btn.hidden = !next;
    if (next) btn.href = `#/review/${encodeURIComponent(next.base_id)}`;
  };
  view.querySelectorAll(".filters [data-key]").forEach((el) => el.addEventListener(el.type === "search" ? "input" : "change", () => {
    store(FILTER_KEY, JSON.stringify({ ...getFilter(), [el.dataset.key]: el.value }));
    draw();
  }));
  draw();
}

// ---------- one question ----------
export async function reviewPage(id) {
  await header();
  if (!list) list = (await api("questions")).questions;
  const r = await api(`question?id=${encodeURIComponent(id)}`);
  state = { q: r.question, data: r.review || {}, status: r.status, seen: r.updated_at ?? null, stale: null, timer: null,
            chain: Promise.resolve() };
  renderReview();
}

function neighbours(id) {
  // previous and next within the current filter (the whole list if this question is outside it)
  const f = getFilter();
  let rows = filtered(list, f);
  const active = !!(f.specialty || f.source || f.status || f.text.trim()) && rows.some((q) => q.base_id === id);
  if (!active) rows = list;
  const i = rows.findIndex((q) => q.base_id === id);
  return { i, n: rows.length, prev: rows[i - 1]?.base_id, next: rows[i + 1]?.base_id, filteredView: active };
}

function versionsHtml(q) {
  return q.axes.map((a) => {
    const base = a.versions.find((v) => v.value === "neutral") || a.versions[0];
    const items = a.versions.map((v) => `<li><span class="vlabel">${esc(v.display)}</span>${
      v === base ? esc(v.question) : diffQuestion(base.question, v.question)[1]}</li>`).join("");
    return `<details class="versions" open><summary>${esc(AXIS_NAME[a.axis] || a.axis)}: ${a.versions.map((v) => esc(v.display)).join(" · ")}</summary>
      <ul>${items}</ul></details>`;
  }).join("");
}

function renderReview() {
  const { q, data } = state, nb = neighbours(q.base_id), s = q.specialty;
  const varied = q.axes.map((a) => `${AXIS_NAME[a.axis] || a.axis} (${a.versions.length} versions)`).join(", ");
  view.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <a class="btn" href="#/review">← All questions</a>
      ${nb.prev ? `<a class="btn" href="#/review/${encodeURIComponent(nb.prev)}">Previous</a>` : ""}
      ${nb.next ? `<a class="btn" href="#/review/${encodeURIComponent(nb.next)}">Next</a>` : ""}
      <span class="muted">Question ${nb.i + 1} of ${nb.n}${nb.filteredView ? " (filtered)" : ""}</span>
      <div class="spacer"></div><span id="saved" class="saved"></span>
    </div>
    <div class="card">
      <div class="row">${q.sources.map((x) => `<span class="chip">Source: ${esc(SOURCE_NAME[x] || x)}</span>`).join("")}
        <span class="muted" style="font-size:12px">${esc(q.base_id)}</span></div>
      <h2 style="margin-top:12px">The question as the patient asks it</h2>
      <p class="template">${slots(q.template_display)}</p>
      <p class="legend">Words in [brackets] change between versions. This question's versions differ in: ${esc(varied)}.</p>
    </div>
    <div class="card">
      <h2>Demographic versions</h2>
      <p class="legend">Each version as a patient would send it. <span class="ins">Highlighted</span> words differ from the first version listed.</p>
      ${versionsHtml(q)}
    </div>
    <div class="card review-form">
      <h2>Your review</h2>
      ${fieldHtml(FIELD.relevant, data.relevant, "relevant", "review")}
      ${fieldHtml(FIELD.realistic, data.realistic, "realistic", "review")}
      <div data-if="realistic=needs_edit">${textHtml("rewording", data.rewording, "Suggested rewording",
        "The question as you would word it", { rows: 3, scope: "review" })}</div>
      <div class="field"><div class="lbl">${esc(FIELD.specialty.label)}</div>
        <p class="proposed">Proposed: <b>${proposedText(s)}</b></p>
        <div class="opts">${FIELD.specialty.options.map(([k, l]) => `<label><input type="radio" name="specialty" value="${k}"
          data-scope="review" data-key="specialty" ${data.specialty === k ? "checked" : ""}>${esc(l)}</label>`).join("")}</div></div>
      <div data-if="specialty=change" class="subfields">
        <label>Primary ${selectHtml("specialty_primary", SPECIALTIES, data.specialty_primary, "Choose…", "review")}</label>
        <label>Secondary (optional) ${selectHtml("specialty_secondary", SPECIALTIES, data.specialty_secondary, "None", "review")}</label>
        <div data-if="other">${textHtml("specialty_other", data.specialty_other, "Name the other specialty", "e.g. Respiratory medicine",
          { input: true, scope: "review" })}</div>
      </div>
      ${fieldHtml(FIELD.versions, data.versions, "versions", "review")}
      <div data-if="versions=no">${textHtml("versions_comment", data.versions_comment, "Which version does not make sense, and why?",
        "e.g. the Malay version: …", { rows: 2, scope: "review" })}</div>
      ${fieldHtml(FIELD.decision, data.decision, "decision", "review")}
      ${textHtml("comment", data.comment, "6. Further comment", "Optional; required to drop a question", { rows: 3, scope: "review" })}
    </div>
    <div class="footer-bar">
      ${chip(state.status)}<span id="missing" class="missing"></span><div class="spacer"></div>
      <button class="btn primary" id="complete">Mark reviewed${nb.next ? " and go to next" : ""}</button>
    </div>`;
  view.querySelectorAll("[data-scope='review']").forEach((el) =>
    el.addEventListener(el.tagName === "TEXTAREA" || el.type === "text" ? "input" : "change", onInput));
  view.querySelector("#complete").addEventListener("click", () => save(true));
  applyConditions();
  showMissing();
}

function applyConditions() {
  const d = state.data;
  view.querySelectorAll("[data-if]").forEach((el) => {
    const cond = el.dataset.if;
    const on = cond === "other"
      ? d.specialty_primary === "other" || d.specialty_secondary === "other"
      : d[cond.split("=")[0]] === cond.split("=")[1];
    el.hidden = !on;
  });
}
function onInput(e) {
  const el = e.target, key = el.dataset.key;
  if (el.value) state.data[key] = el.value;
  else delete state.data[key];
  applyConditions();
  showMissing();
  clearTimeout(state.timer);
  state.timer = setTimeout(() => save(false), 700);
}
function showMissing() {
  const m = missingReview(state.data);
  const el = view.querySelector("#missing");
  if (!el) return;
  if (state.stale) { el.textContent = state.stale; el.classList.remove("done"); return; }
  el.textContent = m.length ? `Still to answer: ${m.slice(0, 3).join("; ")}${m.length > 3 ? ` and ${m.length - 3} more` : ""}` : "All answered";
  el.classList.toggle("done", !m.length);
}

function save(complete, s = state) {
  clearTimeout(s.timer);
  s.timer = null;
  if (s.stale) return s.chain; // this page is out of date: it must be reloaded
  // saves go out one at a time, in order
  s.chain = s.chain.then(() => send(s, complete));
  return s.chain;
}
async function send(s, complete) {
  const label = view.querySelector("#saved");
  if (label && s === state) label.textContent = "Saving…";
  try {
    const r = await api("review", { method: "POST", body: JSON.stringify({ base_id: s.q.base_id, data: s.data, complete, seen: s.seen }) });
    s.status = r.status;
    s.seen = r.updated_at;
    const row = list?.find((q) => q.base_id === s.q.base_id);
    if (row) row.status = r.status;
    if (s !== state) return;
    if (label) label.textContent = `Saved ${time(r.updated_at)}`;
    if (complete) {
      const nb = neighbours(s.q.base_id);
      location.hash = nb.next ? `#/review/${encodeURIComponent(nb.next)}` : "#/review";
    } else {
      const c = view.querySelector(".footer-bar .chip");
      if (c) c.outerHTML = chip(r.status);
    }
  } catch (e) {
    if (e.status === 422) {
      s.seen = e.body.updated_at;
      const row = list?.find((q) => q.base_id === s.q.base_id);
      if (row) row.status = e.body.status;
      if (s !== state) return;
      const el = view.querySelector("#missing");
      if (el) el.textContent = `Cannot mark as reviewed yet. Still to answer: ${e.body.missing.join("; ")}`;
      if (label) label.textContent = "Saved (incomplete)";
      return;
    }
    if (e.status === 409) { // a later copy is stored (another tab or device): retrying would not help
      s.stale = e.message;
      if (s !== state) return;
      showMissing();
      if (label) label.textContent = "Not saved";
      return;
    }
    if (label && s === state) label.textContent = "Not saved: retrying…";
    s.timer = setTimeout(() => save(complete, s), 4000);
  }
}

// save unsaved work before leaving the page
export async function flushReview() { if (state?.timer) await save(false); }
export const reviewPending = () => !!state?.timer;
