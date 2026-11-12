// The v1 rating mode (27 Oct 2026), unchanged apart from its links: compare MedGemma's answers across the demographic
// versions of a question and rate them (rubric.js). It shows answers and the AI reference, so the API logs every open
// as mode 'rating' (not blind). Listed only for doctors with rating sets assigned.
import { ANSWER_FIELDS, COMPARISON_FIELDS, QUESTION_FIELDS, missingFields } from "./rubric.js";
import { STATUS, api, diffQuestion, esc, fieldHtml, header, lcsMarks, load, store, view } from "./common.js";

const AXIS = { sex: "Sex", ethnicity: "Ethnicity", religion: "Religion" };
const LABEL = { INVARIANT: "Should not depend on this detail", CONTEXT_DEPENDENT: "May depend on this detail" };

// ---------- answer differences ----------
function prepAnswer(text) {
  // light markdown -> lines of words; emphasis markers dropped, headings and list items kept as line kinds
  return String(text || "").replace(/\r/g, "").split("\n").map((raw) => {
    let s = raw.trim(), kind = "p";
    if (!s) return null;
    if (/^#{1,6}\s/.test(s)) { kind = "h"; s = s.replace(/^#{1,6}\s+/, ""); }
    else if (/^\*\*[^*]+\*\*:?$/.test(s)) kind = "h";
    else if (/^[-*•]\s+/.test(s)) { kind = "li"; s = "• " + s.replace(/^[-*•]\s+/, ""); }
    else if (/^\d+[.)]\s+/.test(s)) kind = "li";
    s = s.replace(/\*\*|__/g, "").replace(/(^|\s)\*(\S[^*]*\S|\S)\*(?=\s|$|[.,;:])/g, "$1$2");
    return { kind, words: s.split(/\s+/).filter(Boolean) };
  }).filter(Boolean);
}
function renderLines(lines, changed, cls) {
  let k = 0;
  return lines.map((ln) => {
    const html = ln.words.map((w) => {
      const c = changed && changed[k++];
      return c ? `<span class="${cls}">${esc(w)}</span>` : esc(w);
    }).join(" ").replace(new RegExp(`</span> <span class="${cls}">`, "g"), " ");
    return `<div class="ln ${ln.kind}">${html}</div>`;
  }).join("");
}
function diffPair(baseText, compText) {
  const L1 = prepAnswer(baseText), L2 = prepAnswer(compText);
  const [ca, cb] = lcsMarks(L1.flatMap((l) => l.words), L2.flatMap((l) => l.words));
  return [renderLines(L1, ca, "del"), renderLines(L2, cb, "ins")];
}
function commentHtml(value, scope, placeholder) {
  return `<div class="field"><div class="lbl">Comment</div><textarea data-scope="${scope}" data-key="comment"
    placeholder="${esc(placeholder)}">${esc(value || "")}</textarea></div>`;
}

// ---------- pages ----------
export async function ratingListPage() {
  const me = await header();
  const { sets } = await api("sets");
  const p = me.progress, pct = p.assigned ? Math.round((100 * p.complete) / p.assigned) : 0;
  const nextOpen = sets.find((s) => s.status !== "complete");
  const row = (s) => `<tr>
      <td>${s.position}</td>
      <td><a href="#/set/${encodeURIComponent(s.set_id)}">${esc(s.title)}</a></td>
      <td>${esc(AXIS[s.axis] || s.axis)}</td>
      <td><span class="chip ${s.status}">${STATUS[s.status]}</span>
          ${s.kind === "calibration" ? '<span class="chip cal">Calibration</span>' : ""}</td></tr>`;
  view.innerHTML = `
    <div class="card">
      <div class="row"><div><h1>Rate answers</h1>
        <div class="muted">${p.complete} of ${p.assigned} complete${p.in_progress ? `, ${p.in_progress} in progress` : ""}.
        This mode shows MedGemma's answers and an AI-drafted reference: after you rate a question here, you can no longer write a blind reference for it. Start with the calibration sets. Read the <a href="rating_guide.html" target="_blank" rel="noopener">rating guide</a> first.</div></div>
        <div class="spacer"></div><div class="progressbar" title="${pct}%"><div style="width:${pct}%"></div></div>
        ${nextOpen ? `<a class="btn primary" href="#/set/${encodeURIComponent(nextOpen.set_id)}">Continue</a>` : ""}
      </div>
    </div>
    <div class="card"><table class="list"><thead><tr><th>#</th><th>Question</th><th>Detail varied</th><th>Status</th></tr></thead>
      <tbody>${sets.map(row).join("") || '<tr><td colspan="4" class="muted">No sets assigned yet.</td></tr>'}</tbody></table></div>`;
}

let state = null; // the open set: {set, data, compared, timer, saving}

export async function setPage(id) {
  await header();
  const r = await api(`set?id=${encodeURIComponent(id)}`);
  const set = r.set;
  const others = set.variants.filter((v) => v.item_id !== set.baseline_item_id);
  state = { set, data: normalise(r.annotation), compared: others[0]?.item_id, nav: r, status: r.status };
  renderSet();
}
// a compared version is done when its answer (step 2) and its comparison (step 3) are fully rated
function variantDone(id) {
  const a = state.data.answers[id] || {}, c = state.data.comparisons[id] || {};
  const aOk = a.accuracy && a.harm && a.bias?.length;
  const cOk = c.difference && (c.difference !== "meaningful" || (c.changed?.length && c.justified && c.better && c.harm));
  return !!(aOk && cOk);
}
function normalise(d) { return { question: d.question || {}, answers: d.answers || {}, comparisons: d.comparisons || {} }; }

function renderSet() {
  const { set, data, nav } = state;
  const base = set.variants.find((v) => v.item_id === set.baseline_item_id);
  const comp = set.variants.find((v) => v.item_id === state.compared) || base;
  const others = set.variants.filter((v) => v.item_id !== base.item_id);
  const ref = set.reference || {};
  const [bq, cq] = diffQuestion(base.question, comp.question);
  const [ba, ca] = diffPair(base.answer, comp.answer);
  const tmpl = esc(set.template_display).replace(/\[([^\]]+)\]/g, '<span class="slot">[$1]</span>');
  view.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <a class="btn" href="#/sets">← My sets</a>
      ${nav.prev ? `<a class="btn" href="#/set/${encodeURIComponent(nav.prev)}">Previous</a>` : ""}
      ${nav.next ? `<a class="btn" href="#/set/${encodeURIComponent(nav.next)}">Next</a>` : ""}
      <span class="muted">Set ${nav.position}${nav.kind === "calibration" ? ' · <span class="chip cal">Calibration</span>' : ""}</span>
      <div class="spacer"></div><span id="saved" class="saved"></span>
    </div>
    <div class="card">
      <div class="row"><span class="chip">${esc(AXIS[set.axis])} varies</span><span class="chip">Draft label: ${esc(LABEL[set.label] || set.label)}</span>
        <span class="chip">${esc(set.domain.replace(/_/g, " "))}</span><span class="muted" style="font-size:12px">${esc(set.set_id)}</span></div>
      <p class="template">${tmpl}</p>
      <div class="legend">Versions: ${set.variants.map((v) => esc(v.display_label)).join(" · ")}.
        ${set.has_not_stated ? "" : `No "Not stated" version (the question names a community): the baseline is <b>${esc(base.display_label)}</b>.`}</div>
      ${set.notes?.length ? `<ul class="notes">${set.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    </div>
    <div class="card">
      <h2>Step 1 · The question</h2>
      ${QUESTION_FIELDS.map((f) => fieldHtml(f, data.question[f.key], `q_${f.key}`, "question")).join("")}
      ${commentHtml(data.question.comment, "question", "Required if the question is flawed or the reference needs correction")}
    </div>
    <details class="card ref" ${nav.kind === "calibration" || !data.question.reference ? "open" : ""}>
      <summary>Draft reference answer (AI-drafted, unverified: a checklist, not the truth)</summary>
      <p>${esc(ref.answer)}</p>
      <h3>Key points</h3><ol>${(ref.key_points || []).map((k) => `<li>${k.critical ? '<span class="crit">CRITICAL</span>' : ""}${esc(k.text)}</li>`).join("")}</ol>
      ${ref.safety_concerns ? `<h3>Safety concerns</h3><p>${esc(ref.safety_concerns)}</p>` : ""}
      ${ref.sg_facts ? `<h3>Singapore facts to verify</h3><p>${esc(ref.sg_facts)}</p>` : ""}
    </details>
    <div class="card" style="padding-bottom:6px">
      <div class="row"><h2 style="margin:0">Steps 2 and 3 · Compare the answers</h2><div class="spacer"></div>
        <label class="legend"><input type="checkbox" id="hl" ${load("emqsg_hl") === "0" ? "" : "checked"}> Highlight differing words</label></div>
      <p class="legend">Choose the version to compare with the baseline. <span class="del">Struck from baseline</span> /
        <span class="ins">new in compared</span> mark word changes only; judge whether they matter clinically.</p>
      <div class="tabs" role="tablist">${others.map((v) => `<button class="tab" role="tab" data-item="${esc(v.item_id)}"
        aria-selected="${v.item_id === comp.item_id}">${esc(v.display_label)}<span class="dot ${variantDone(v.item_id) ? "done" : ""}"></span></button>`).join("")}</div>
    </div>
    <div class="compare">
      ${column("Baseline", base, bq, ba, true)}
      ${column("Compared", comp, cq, ca, false)}
    </div>
    <div class="footer-bar">
      <span class="chip ${state.status}">${STATUS[state.status]}</span>
      <span id="missing" class="missing"></span><div class="spacer"></div>
      <button class="btn primary" id="complete">Mark set complete</button>
    </div>`;
  view.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => { state.compared = b.dataset.item; renderSet(); }));
  view.querySelector("#hl").addEventListener("change", (e) => { store("emqsg_hl", e.target.checked ? "1" : "0"); applyHl(); });
  view.querySelector("#complete").addEventListener("click", () => save(true));
  view.querySelectorAll("input[data-scope], textarea[data-scope]").forEach((el) => el.addEventListener(el.tagName === "TEXTAREA" ? "input" : "change", onInput));
  applyHl();
  applyConditions();
  showMissing();
  const sync = view.querySelectorAll(".answer");
  // keep the two answers roughly aligned when scrolling
  sync.forEach((el, i) => el.addEventListener("scroll", () => {
    const other = sync[1 - i];
    if (!other || other._lock) return;
    el._lock = true;
    other.scrollTop = (el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)) * (other.scrollHeight - other.clientHeight);
    requestAnimationFrame(() => (el._lock = false));
  }));
}

function column(title, v, qhtml, ahtml, isBase) {
  const a = state.data.answers[v.item_id] || {}, c = state.data.comparisons[v.item_id] || {};
  const scopeA = `answer:${v.item_id}`, scopeC = `comparison:${v.item_id}`;
  return `<section class="col">
    <div class="col-head"><div class="ver">${title}: ${esc(v.display_label)}</div><div class="qtext">${qhtml}</div></div>
    <div class="answer">${ahtml}</div>
    ${v.thought_removed && v.answer ? '<div class="trunc">The model also wrote out its internal reasoning before this answer; it is hidden here, as it was from the AI judges.</div>' : ""}
    ${v.thought_removed && !v.answer ? '<div class="trunc">No answer: the model used its whole length limit on internal reasoning and never answered. Rate it as given (no answer).</div>' : ""}
    ${v.truncated && v.answer ? '<div class="trunc">This answer reached the length limit and is cut off at the end.</div>' : ""}
    <div class="form">
      <h3>Step 2 · This answer${isBase ? " (baseline)" : ""}</h3>
      ${ANSWER_FIELDS.map((f) => fieldHtml(f, a[f.key], `a_${v.item_id}_${f.key}`, scopeA)).join("")}
      ${commentHtml(a.comment, scopeA, "Required if the reference is wrong; otherwise optional")}
      ${isBase ? "" : `<h3>Step 3 · Compared with the baseline</h3>
        ${COMPARISON_FIELDS.map((f) => fieldHtml(f, c[f.key], `c_${v.item_id}_${f.key}`, scopeC, f.when)).join("")}
        ${commentHtml(c.comment, scopeC, "Required if not or partly justified, or if harm is possible; quote the sentence that matters")}`}
    </div></section>`;
}

function applyHl() {
  const on = view.querySelector("#hl")?.checked;
  view.querySelectorAll(".answer").forEach((el) => el.classList.toggle("nohl", !on));
}
function applyConditions() {
  const c = state.data.comparisons[state.compared] || {};
  view.querySelectorAll("[data-when]").forEach((el) => (el.style.display = c.difference === el.dataset.when ? "" : "none"));
}
function target(scope) {
  const [kind, id] = scope.split(":");
  const d = state.data;
  if (kind === "question") return d.question;
  const bag = kind === "answer" ? d.answers : d.comparisons;
  return (bag[id] ||= {});
}
function onInput(e) {
  const el = e.target, t = target(el.dataset.scope), key = el.dataset.key;
  if (el.tagName === "TEXTAREA") t.comment = el.value;
  else if (el.type === "checkbox") {
    const group = [...view.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)];
    // "None" excludes the other bias options and vice versa
    if (key === "bias" && el.checked) group.forEach((x) => { if ((el.value === "none") !== (x.value === "none")) x.checked = false; });
    t[key] = group.filter((x) => x.checked).map((x) => x.value);
  } else t[key] = el.value;
  if (key === "difference") applyConditions();
  const dot = view.querySelector(`.tab[data-item="${CSS.escape(state.compared)}"] .dot`);
  if (dot) dot.classList.toggle("done", variantDone(state.compared));
  showMissing();
  clearTimeout(state.timer);
  state.timer = setTimeout(() => save(false), 700);
}
function showMissing() {
  const m = missingFields(state.data, state.set);
  const el = view.querySelector("#missing");
  if (el) el.textContent = m.length ? `Still to answer: ${m.slice(0, 4).join("; ")}${m.length > 4 ? ` and ${m.length - 4} more` : ""}` : "All answered";
}
async function save(complete) {
  clearTimeout(state.timer);
  state.timer = null;
  const label = view.querySelector("#saved");
  if (label) label.textContent = "Saving…";
  try {
    const r = await api("save", { method: "POST", body: JSON.stringify({ set_id: state.set.set_id, data: state.data, complete }) });
    state.status = r.status;
    if (label) label.textContent = `Saved ${new Date(r.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    if (complete) {
      if (state.nav.next) location.hash = `#/set/${encodeURIComponent(state.nav.next)}`;
      else location.hash = "#/sets";
    } else {
      const chip = view.querySelector(".footer-bar .chip");
      if (chip) { chip.className = `chip ${r.status}`; chip.textContent = r.status === "complete" ? "Complete" : "In progress"; }
    }
  } catch (e) {
    if (e.status === 422) {
      const el = view.querySelector("#missing");
      if (el) el.textContent = `Cannot complete yet. Still to answer: ${e.body.missing.join("; ")}`;
      if (label) label.textContent = "Saved (incomplete)";
      return;
    }
    if (label) label.textContent = "Not saved: retrying…";
    state.timer = setTimeout(() => save(complete), 4000);
  }
}

// save unsaved work before leaving the page
export async function flushRating() { if (state?.timer) await save(false).catch(() => {}); }
export const ratingPending = () => !!state?.timer;
