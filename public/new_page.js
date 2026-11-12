// New questions (work item c): a doctor writes questions by specialty on a blank form, with a short guide and one
// worked example (guide.html#new). The page shows no study content. Drafts autosave; "Submit" checks the form.
import { CHANGE, DETAILS, NEW_PER_PRIORITY, PRIORITY, SETTINGS, SPECIALTIES, SPECIALTY_NAME, missingNewQuestion,
         templateProblem } from "./forms.js";
import { api, chip, esc, header, selectHtml, textHtml, time, view } from "./common.js";

const DETAIL_NAME = Object.fromEntries(DETAILS);
let state = null; // the open question: {id, data, status, seen, stale, timer, chain}
// seen: the updated_at of the saved copy this page holds (null: none yet), sent with every save. stale: set when the
// API refuses a save because a later copy is stored (another tab or device): this page then stops saving.

const specialtyName = (d) => d.specialty === "other" ? `Other${d.specialty_other ? `: ${d.specialty_other}` : ""}`
  : SPECIALTY_NAME[d.specialty] || "No specialty yet";

// ---------- my questions ----------
export async function newListPage() {
  await header();
  const { questions } = await api("newq");
  const submitted = (code) => questions.filter((q) => q.status === "submitted" && q.data.specialty === code).length;
  const nSub = questions.filter((q) => q.status === "submitted").length;
  const card = (code) => {
    const n = submitted(code);
    return `<div class="target"><div><b>${esc(SPECIALTY_NAME[code])}</b><div class="muted">${n} of ${NEW_PER_PRIORITY} submitted</div>
      <div class="progressbar small"><div style="width:${Math.min(100, (100 * n) / NEW_PER_PRIORITY)}%"></div></div></div>
      <a class="btn" href="#/new/write/${code}">Write one</a></div>`;
  };
  view.innerHTML = `
    <div class="card">
      <h1>Write new questions</h1>
      <p class="muted">Write questions a patient in Singapore or Southeast Asia might ask, where the right advice could
        depend on who is asking (their sex, ethnicity, religion or another detail). The aim is ${NEW_PER_PRIORITY} per priority
        specialty; questions in other specialties are welcome too. Read the <a href="guide.html#new" target="_blank" rel="noopener">short guide and worked example</a> first.</p>
      <div class="targets">${PRIORITY.map(card).join("")}</div>
      <div class="row" style="margin-top:12px"><a class="btn" href="#/new/write">Write one in another specialty</a>
        <span class="muted">${nSub} submitted in all.</span></div>
    </div>
    <div class="card"><h2>Your questions</h2>
      <div class="table-wrap"><table class="list"><thead><tr><th class="hide-sm">#</th><th>Question</th><th>Specialty</th><th>Status</th><th class="hide-sm">Last saved</th></tr></thead>
      <tbody>${questions.map((q) => `<tr><td class="hide-sm">${q.id}</td>
        <td><a href="#/new/${q.id}">${esc((q.data.question || "(no question text yet)").slice(0, 150))}</a></td>
        <td>${esc(specialtyName(q.data))}</td><td>${chip(q.status)}</td>
        <td class="hide-sm">${new Date(q.updated_at).toLocaleString()}</td></tr>`).join("")
        || '<tr><td colspan="5" class="muted">None yet.</td></tr>'}</tbody></table></div></div>`;
}

// ---------- one question ----------
export async function newQuestionPage(id, specialty) {
  await header();
  if (id) {
    const q = (await api("newq")).questions.find((x) => String(x.id) === String(id));
    if (!q) throw Object.assign(new Error("question not found"), { status: 404 });
    state = { id: q.id, data: q.data, status: q.status, seen: q.updated_at ?? null, stale: null, timer: null, chain: Promise.resolve() };
  } else {
    state = { id: null, data: specialty && SPECIALTY_NAME[specialty] ? { specialty } : {}, status: "draft", seen: null,
              stale: null, timer: null, chain: Promise.resolve() };
  }
  renderForm();
}

function changesHtml(d) {
  const blocks = (d.details || []).filter((k) => k !== "none").map((k) => {
    const c = d.changes?.[k] || {}, nm = k === "other" ? (d.details_other || "the other detail") : DETAIL_NAME[k].toLowerCase();
    return `<div class="change-block">
      <div class="field"><div class="lbl">Should ${esc(nm)} change the advice?</div><div class="opts">${CHANGE.map(([v, l]) =>
        `<label><input type="radio" name="change_${k}" value="${v}" data-scope="change:${k}" data-key="change"
          ${c.change === v ? "checked" : ""}>${esc(l)}</label>`).join("")}</div></div>
      ${textHtml("reason", c.reason, "Why?", "What would change, for whom, and why (or why it should not change)",
        { rows: 2, scope: `change:${k}` })}</div>`;
  });
  return blocks.length ? `<div class="lbl section">5. Should these details change the advice?</div>${blocks.join("")}` : "";
}

function renderForm() {
  const d = state.data;
  view.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <a class="btn" href="#/new">← Your questions</a>
      <span class="muted">${state.id ? `Question #${state.id}` : "New question"}</span>
      <a href="guide.html#example" target="_blank" rel="noopener">Worked example</a>
      <div class="spacer"></div><span id="saved" class="saved"></span>
    </div>
    <div class="card newq-form">
      <div class="field"><div class="lbl">1. Specialty</div>${selectHtml("specialty", SPECIALTIES, d.specialty, "Choose…", "q")}</div>
      <div data-if="specialty=other">${textHtml("specialty_other", d.specialty_other, "Name the specialty", "e.g. Respiratory medicine",
        { input: true, scope: "q" })}</div>
      <div class="field"><div class="lbl">2. Setting: where is the patient?</div>${selectHtml("setting", SETTINGS, d.setting, "Choose…", "q")}</div>
      ${textHtml("question", d.question, "3. The question, as a patient would ask it", "e.g. I am a 52-year-old woman and …", {
        rows: 5, scope: "q", hint: "In the patient's own words, as they might type it to a chatbot. Write in any detail that is part of the question (for example \"I am a 52-year-old woman\")." })}
      <div class="field"><div class="lbl">4. Which details about the patient could matter?</div><div class="opts">${DETAILS.map(([k, l]) =>
        `<label><input type="checkbox" name="details" value="${k}" data-scope="q" data-key="details"
          ${(d.details || []).includes(k) ? "checked" : ""}>${esc(l)}</label>`).join("")}</div></div>
      <div data-if="details~other">${textHtml("details_other", d.details_other, "Name the other detail", "e.g. age, pregnancy, income, language",
        { input: true, scope: "q" })}</div>
      <div id="changes">${changesHtml(d)}</div>
      ${textHtml("source", d.source, "6. Guideline or source, if you know one", "Optional: a guideline name, article or URL", { input: true, scope: "q" })}
      ${textHtml("template", d.template, "7. Template (optional)", "e.g. I am a 52-year-old [woman / man] and …", {
        rows: 3, scope: "q", hint: "The same question with the words that could change in [square brackets]. If you leave it blank, the study team drafts the template and you can check it later." })}
      <div id="template-check" class="missing"></div>
      ${textHtml("comment", d.comment, "8. Comment (optional)", "Anything else the study team should know", { rows: 2, scope: "q" })}
    </div>
    <div class="footer-bar">
      ${chip(state.status)}<span id="missing" class="missing"></span><div class="spacer"></div>
      <button class="btn" id="withdraw" ${state.id && state.status !== "withdrawn" ? "" : "hidden"}>Withdraw</button>
      <button class="btn primary" id="submit">${state.status === "submitted" ? "Save changes" : "Submit"}</button>
    </div>`;
  bind(view);
  view.querySelector("#submit").addEventListener("click", () => save("submit"));
  view.querySelector("#withdraw").addEventListener("click", () => {
    if (confirm("Withdraw this question? It stays in your list, and you can submit it again later.")) save("withdraw");
  });
  applyConditions();
  showMissing();
}

function bind(root) {
  root.querySelectorAll("[data-scope]").forEach((el) =>
    el.addEventListener(el.tagName === "TEXTAREA" || el.type === "text" ? "input" : "change", onInput));
}
function applyConditions() {
  const d = state.data;
  view.querySelectorAll("[data-if]").forEach((el) => {
    const [k, v] = el.dataset.if.split(/[=~]/);
    el.hidden = el.dataset.if.includes("~") ? !(d[k] || []).includes(v) : d[k] !== v;
  });
  const tp = templateProblem(d.template);
  view.querySelector("#template-check").textContent = tp ? `Template: ${tp}.` : "";
}
function onInput(e) {
  const el = e.target, key = el.dataset.key, d = state.data;
  const [scope, detail] = el.dataset.scope.split(":");
  if (scope === "change") {
    d.changes ||= {};
    const c = (d.changes[detail] ||= {});
    if (el.value) c[key] = el.value; else delete c[key];
  } else if (key === "details") {
    const boxes = [...view.querySelectorAll('input[name="details"]')];
    // "None of these" excludes the other details and vice versa
    if (el.checked) boxes.forEach((x) => { if ((el.value === "none") !== (x.value === "none")) x.checked = false; });
    d.details = boxes.filter((x) => x.checked).map((x) => x.value);
    const box = view.querySelector("#changes");
    box.innerHTML = changesHtml(d);
    bind(box);
  } else if (el.value) d[key] = el.value;
  else delete d[key];
  if (key === "details_other") {
    const box = view.querySelector("#changes");
    if (!box.contains(document.activeElement)) { box.innerHTML = changesHtml(d); bind(box); }
  }
  applyConditions();
  showMissing();
  clearTimeout(state.timer);
  state.timer = setTimeout(() => save(null), 700);
}
function showMissing() {
  const m = missingNewQuestion(state.data);
  const el = view.querySelector("#missing");
  if (!el) return;
  if (state.stale) { el.textContent = state.stale; el.classList.remove("done"); return; }
  el.textContent = m.length ? `Still to fill in: ${m.slice(0, 3).join("; ")}${m.length > 3 ? ` and ${m.length - 3} more` : ""}` : "Ready to submit";
  el.classList.toggle("done", !m.length);
}

function save(action, s = state) {
  clearTimeout(s.timer);
  s.timer = null;
  if (s.stale) return s.chain; // this page is out of date: it must be reloaded
  // saves go out one at a time, in order, so the first one creates the question and the rest update it
  s.chain = s.chain.then(() => send(s, action));
  return s.chain;
}
async function send(s, action) {
  if (!s.id && !Object.keys(s.data).length) return;
  const label = view.querySelector("#saved");
  if (label && s === state) label.textContent = "Saving…";
  try {
    const r = await api("newq", { method: "POST", body: JSON.stringify({ id: s.id, data: s.data, action, seen: s.seen }) });
    const created = !s.id;
    s.id = r.id;
    s.status = r.status;
    s.seen = r.updated_at;
    if (s !== state) return;
    if (created) history.replaceState(null, "", `#/new/${r.id}`);
    if (label) label.textContent = `Saved ${time(r.updated_at)}`;
    if (action) location.hash = "#/new";
    else {
      const c = view.querySelector(".footer-bar .chip");
      if (c) c.outerHTML = chip(r.status);
      view.querySelector("#withdraw").hidden = r.status === "withdrawn";
    }
  } catch (e) {
    if (e.status === 422) {
      if (e.body.id) s.id = e.body.id;
      s.seen = e.body.updated_at;
      s.status = e.body.status;
      if (s !== state) return;
      const el = view.querySelector("#missing");
      if (el) el.textContent = `Cannot submit yet. Still to fill in: ${e.body.missing.join("; ")}`;
      if (label) label.textContent = e.body.status === "withdrawn" ? "Saved (still withdrawn)" : "Saved as a draft";
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
    s.timer = setTimeout(() => save(action, s), 4000);
  }
}

export async function flushNew() { if (state?.timer) await save(null); }
export const newPending = () => !!state?.timer;
