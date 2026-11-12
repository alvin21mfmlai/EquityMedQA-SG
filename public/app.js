// The doctors' site (v2, work item c): home, question review, new questions, Phase 1A references (for doctors who have
// references assigned; the pages call them answer keys), and the v1 rating mode (for doctors who have rating sets
// assigned). Routing by URL hash.
import { NEW_PER_PRIORITY, PRIORITY, SPECIALTY_NAME } from "./forms.js";
import { esc, fail, header, signOut, signedOutPage, takeLink, view } from "./common.js";
import { flushReview, reviewListPage, reviewPage, reviewPending } from "./review_page.js";
import { flushNew, newListPage, newPending, newQuestionPage } from "./new_page.js";
import { flushRating, ratingListPage, ratingPending, setPage } from "./rating_page.js";
import { flushRef, refListPage, refPage, refPending } from "./ref_page.js";

async function home() {
  const me = await header();
  const rv = me.review, pct = rv.total ? Math.round((100 * rv.complete) / rv.total) : 0;
  const sub = (code) => me.new_questions.filter((x) => x.specialty === code && x.status === "submitted").reduce((s, x) => s + x.n, 0);
  const nSub = me.new_questions.filter((x) => x.status === "submitted").reduce((s, x) => s + x.n, 0);
  const rp = me.progress, rf = me.refs, rfPct = rf.assigned ? Math.round((100 * (rf.complete + rf.declined)) / rf.assigned) : 0;
  view.innerHTML = `
    <div class="card">
      <h1>Welcome, ${esc(me.name)}</h1>
      <p class="muted">${rf.assigned ? "Three tasks: review the study's 250 questions, write new ones, and write answer keys for the questions assigned to you. These pages"
        : "Two tasks: review the study's 250 questions, and write new ones. Both pages"} show questions only,
        never a model's answers or any AI-drafted answer key or label, so nothing here tells you what an AI wrote. Your
        work saves as you go. Read the <a href="guide.html" target="_blank" rel="noopener">guide</a> first.</p>
      ${me.test ? `<p class="notes">This is a <b>test account</b>, for trying the site. What you enter here is kept apart
        from the study's data.</p>` : ""}
    </div>
    <div class="tasks">
      <div class="card task">
        <h2>1 · Review the questions</h2>
        <p class="muted">Is each question relevant here, realistic and clearly worded, in the right specialty? About a minute each.</p>
        <div class="row"><div class="progressbar" title="${pct}%"><div style="width:${pct}%"></div></div>
          <span>${rv.complete} of ${rv.total} reviewed</span></div>
        <p><a class="btn primary" href="#/review">${rv.complete || rv.in_progress ? "Continue reviewing" : "Start reviewing"}</a></p>
      </div>
      <div class="card task">
        <h2>2 · Write new questions</h2>
        <p class="muted">Questions where the right advice could depend on who is asking. Aim for ${NEW_PER_PRIORITY} per priority specialty.</p>
        <ul class="plain">${PRIORITY.map((c) => `<li>${esc(SPECIALTY_NAME[c])}: ${sub(c)} of ${NEW_PER_PRIORITY}</li>`).join("")}</ul>
        <p><a class="btn primary" href="#/new">Write questions</a> <span class="muted">${nSub} submitted in all</span></p>
      </div>
      ${rf.assigned ? `<div class="card task">
        <h2>3 · Write answer keys</h2>
        <p class="muted">For each question assigned to you, write its answer key: what a good answer must and must not
          contain, in two stages. You see the question only.</p>
        <div class="row"><div class="progressbar" title="${rfPct}%"><div style="width:${rfPct}%"></div></div>
          <span>${rf.complete} of ${rf.assigned} complete</span></div>
        <p><a class="btn primary" href="#/refs">${rf.complete || rf.in_progress || rf.declined ? "Continue" : "Start"}</a></p>
      </div>` : ""}
      ${rp.assigned ? `<div class="card task">
        <h2>Rate answers</h2>
        <p class="muted">This separate task shows MedGemma's answers and an AI-drafted answer key (called the reference
          there). After you rate a question there, you can no longer write or change a blind answer key for it.</p>
        <p>${rp.complete} of ${rp.assigned} sets complete. <a class="btn" href="#/sets">Open</a></p>
      </div>` : ""}
    </div>`;
}

async function route() {
  await Promise.all([flushReview(), flushNew(), flushRating(), flushRef()]).catch(() => {});
  // a personal link opened in this tab (after signing out, or by another doctor): start afresh with it
  if (takeLink()) return location.reload();
  const h = location.hash, m = (re) => h.match(re);
  let r;
  try {
    if (m(/^#\/signed-out$/)) signedOutPage();
    else if ((r = m(/^#\/review\/(.+)$/))) await reviewPage(decodeURIComponent(r[1]));
    else if (m(/^#\/review$/)) await reviewListPage();
    else if ((r = m(/^#\/new\/write(?:\/([a-z_]+))?$/))) await newQuestionPage(null, r[1]);
    else if ((r = m(/^#\/new\/(\d+)$/))) await newQuestionPage(r[1]);
    else if (m(/^#\/new$/)) await newListPage();
    else if ((r = m(/^#\/ref\/(.+)$/))) await refPage(decodeURIComponent(r[1]));
    else if (m(/^#\/refs$/)) await refListPage();
    else if ((r = m(/^#\/set\/(.+)$/))) await setPage(decodeURIComponent(r[1]));
    else if (m(/^#\/sets$/)) await ratingListPage();
    else await home();
    window.scrollTo(0, 0);
  } catch (e) { fail(e); }
}
window.addEventListener("hashchange", route);
// Sign out: save what is pending, forget the personal link, and reload so that nothing of the session stays in the page
document.getElementById("signout").addEventListener("click", async () => {
  await Promise.all([flushReview(), flushNew(), flushRating(), flushRef()]).catch(() => {});
  // a save that failed (no connection) is still waiting to be sent again: signing out now would drop it
  if ((reviewPending() || newPending() || ratingPending() || refPending())
      && !confirm("Your last changes could not be saved yet (is the connection down?). Sign out anyway? They would be lost.")) return;
  signOut();
  location.hash = "#/signed-out";
  location.reload();
});
window.addEventListener("beforeunload", (e) => {
  if (reviewPending() || newPending() || ratingPending() || refPending()) {
    flushReview(); flushNew(); flushRating(); flushRef();
    e.preventDefault();
  }
});
route();
