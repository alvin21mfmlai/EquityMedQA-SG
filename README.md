# EquityMedQA-SG site for doctors (v2, work item c)

A web app on Vercel with a Postgres database (Neon) where doctors **review the 250 base questions**, **write new
questions** and, when assigned, **write blind references** (Phase 1A, added 2 Nov 2026). Built 1 Nov 2026 from the v1
annotation app (27 Oct), which it keeps as an optional rating mode. Deployment:
`DEPLOY.md`. In the research folder (EquityMedQA-SG_v2), the plan is `docs/website_plan.md` and the end-to-end checks
are in `annotation_app/e2e/`. A review on 11 Nov 2026 led to the changes marked "11 Nov" below
(`docs/website_plan.md`, section 7, lists them with the reasons).

**One name to know.** The doctors' pages and the guide call a Phase 1A reference an **answer key**, as the study's
poster and reports do (11 Nov). The code, the database, the admin page, the exports and these notes keep "reference".

## Second review, 11 Nov 2026: nine fixes

Made in this package after a second review of the 11 Nov build. **The research folder's copy (`annotation_app/`,
`prepare_data.py`) does not have them yet: copy the files listed at the end of this section back before the next
`build_package.py`, or the next build undoes them.** No table or column changed, so `init` has nothing new to add.

1. **27 questions have no "Not stated" wording** (the detail is the question's subject, e.g. "Do [ethnic group] people
   have thicker skin …?"; with it left out the sentence means nothing: "Do people have thicker skin than people of other
   ethnic groups?"). The lists now show these by their template (`api/_lib.js` `TITLE`), and they get no blind answer key,
   because Stage 1 would have no question to show: `assign-refs` skips them with a note, test accounts' demo references
   avoid them, and the API refuses to start one assigned by an earlier version (409). The 27 are the questions where an
   axis has no `neutral` version (`hasNeutral` in `public/ref_forms.js`); their `neutral_question` text is unchanged in
   the data and no longer shown anywhere.
2. **A review open before Stage 1 is now recorded.** The review page shows the template and every demographic version,
   which Stage 1 keeps back. The References export has `review_open_before_stage1` (CSV yes / no, JSON true / false):
   the doctor opened the question on the review page before saving Stage 1. `assign-refs` says how many of the pairs
   it assigned are in that state already. The home page no longer says that the review pages keep a doctor blind for an
   answer key "later": they show no AI content, which is what it now says. Nothing is hidden or refused on the pages
   (decision left to the study team: to prevent it instead, have doctors write Stage 1 before reviewing those
   questions, or hide the versions on the review page for assigned questions until Stage 1 is saved).
   `scripts/import_phase1a.py` (research folder) should carry the new field through.
3. **A page that is out of date can no longer overwrite later work.** Every save sends `seen`, the `updated_at` of the
   copy the page holds; the API refuses the save (409, `stale: true`) when the stored copy is a different one, and the
   page says so and stops saving until it is reloaded. Before, a tab left open on Stage 1 emptied Stage 2 of an answer
   key finished in another tab and set it back to in progress. The same check covers reviews and new questions. A
   reference save now runs in one transaction that first locks the assignment's row, so two saves cannot cross. A
   request without `seen` (a page loaded before this update, or a script) is accepted as before.
4. **Templates show only the details that change.** 73 templates showed a slot for a detail that is the same in every
   version (`[man / woman / person]` where every version says "woman"; `(I am [religion].)` where no version states a
   religion). `scripts/fix_templates.py` rewrote `template_display` for those 73 and checked each against all its
   versions; nothing else in `data/questions.json` changed (its `version` is now q250-2026-11-11). A question that
   doctors have already worked on keeps the template they saw (`load-questions`).
5. **`assign-refs` is all or nothing.** Every pair is checked first; an unknown doctor or question, or a short CSV line,
   stops the command with nothing assigned, and the assignments are made in one transaction.
6. **The analysis tells doctors apart by `annotator_id`**, not by name: two accounts with one name are shown as
   "Name (#id)" and their reviews are compared, not merged. `flagged_questions.csv` has `annotator_id`. The priority
   specialties and the target of 5 are checked against `public/forms.js` by a unit test.
7. **A withdrawn new question stays withdrawn** when a resubmit fails the checks (it became a draft).
8. **`reopen-stage1` keeps "outside my expertise".** Reopening a declined answer key no longer undoes the decline; the
   doctor does that on the page.
9. **"Blind" in the two exports.** `blind_for_phase1a` (Blind status export) says whether the doctor can still write a
   blind reference: "no" after any rating open, also one made after the reference was finished. Whether a finished
   reference was blind is `blind_at_completion` (References export). The Blind status export now also has
   `reference_complete_before_rating`, and the admin page says which column answers which question.

Files changed: `api/_lib.js`, `api/admin.js`, `api/newq.js`, `api/questions.js`, `api/ref.js`, `api/review.js`;
`public/admin.html`, `public/app.js`, `public/guide.html` (one sentence under *Saving*), `public/new_page.js`,
`public/ref_forms.js`, `public/ref_page.js`, `public/review_page.js`; `scripts/admin.mjs`, `scripts/fix_templates.py`
(new); `analysis/analyse_reviews.py`; `data/questions.json`; `test/forms.test.mjs`, `test/lib.test.mjs`,
`test/ref_forms.test.mjs`; `README.md`, `DEPLOY.md`, `SHA256SUMS`. `FORMS_VERSION` and `REF_FORM_VERSION` are unchanged
(no field, value, limit or check of the forms changed).

Checked for these fixes: unit tests 24 pass (4 new); 88 API checks pass against `dev/server.mjs` and a local Postgres
stand-in (PGlite 0.5, Postgres 18, over a socket), covering each fix above and the unchanged routes and exports; 25
page checks pass with the pages' own scripts run in a simulated browser (jsdom): the home wording, the lists and the
template, autosave on the three pages, the out-of-date message and the page stopping its saves, the withdrawn label.
**Not run:** the research folder's API and browser checks (`annotation_app/e2e/`, which are not in this package), any
check in a real browser (layout, the Content-Security-Policy), two saves at the same moment (the stand-in runs one
session, so the row lock was not exercised), and the deployed Vercel and Neon set-up. Run the e2e checks from the research folder after copying the files
back; a check that expects a withdrawn question to become a draft, or the old export columns exactly, needs updating.

## What it does

- **Personal links, no passwords** (as v1): `https://APP/#k=TOKEN`. The database stores only a hash of each token.
  The browser remembers the link until the doctor presses **Sign out** (11 Nov; for shared computers), which also
  clears what else the site kept in that browser. A link opened in a tab that already shows the site is taken up too.
- **Contact** (11 Nov): every page, the guide and the "Access link needed" page show who to write to, taken from the
  environment variables `CONTACT_EMAIL` and `CONTACT_NAME` (`/api/site`). The admin page warns when none is set. The
  guide has a "Your data" section: what the site stores, where, and who can read it.
- **Test accounts** (11 Nov; `scripts/admin.mjs add NAME --test`, or the box on the admin page): for trying the site,
  for example by a supervisor. A test account gets three demo references, so its login shows all three tasks, and its
  pages say it is a test account. Its entries are **left out of every export unless "Include test accounts" is
  ticked**, every export row carries `test_account`, and the analysis and import scripts skip such rows by default.
- **Question review** (`#/review`): all 250 questions for every doctor, filtered by specialty, source, status or words.
  The page shows the question as the patient asks it with its slots marked, every demographic version's wording, its
  EquityMedQA source and the proposed specialty. The doctor records: relevant to Singapore or Southeast Asia (yes /
  partly / no); realistic and clearly worded (yes / needs edit, with a rewording / no); specialty (confirm or change);
  do the demographic versions make sense (yes / no, with which and why); keep, edit or drop; a comment.
- **New questions** (`#/new`): by specialty, with progress against 5 per priority specialty. The form asks for the
  specialty, the setting (Singapore or a named Southeast Asian country), the question as a patient would ask it, which
  details could matter (sex, ethnicity, religion, other, none), whether each should change the advice and why, a
  guideline or source if known, an optional template with the varying words in [brackets], and a comment.
- **Blind rule.** Both pages show questions only: no MedGemma answer, AI reference, AI label or rationale, judge
  verdict or EquityMedQA rating. The proposed specialty is shown as the label only, with no rationale, model names or
  whether it was agreed or settled (user's decision, 1 Nov 2026). `prepare_data.py` builds the question data from a
  whitelist and fails if any answer, reference, label or rationale text appears in it.
- **Every open is logged** (`view_log`): mode `review` for the question pages, `rating` for the v1 rating mode, which
  shows answers and the AI reference. A doctor who opened a question in the rating mode is no longer blind for it
  (Phase 1A); the admin page counts these and the `exposure` export lists them.
- **Autosave and audit log.** Every change saves within a second; every save is appended to `review_log` or
  `new_question_log`. A review can be marked complete only when the form's checks pass (`public/forms.js`, shared by the
  pages and the API, which drops unknown fields and values).
- **Admin page** (`/admin.html`): progress per doctor (reviews, new questions, rating sets, questions not blind for),
  links, deactivation, and CSV / JSON exports: `reviews`, `new_questions`, `views`, `exposure`, `ratings` (v1).
  Summarise with `python3 analysis/analyse_reviews.py reviews_*.csv --new new_questions_*.csv`.
  In the CSV files, text that begins with `=`, `+`, `-` or `@` gets a leading apostrophe, so that a spreadsheet does not
  run it as a formula (11 Nov); the JSON files carry the text exactly as typed.
- **Blind references, Phase 1A** (`#/refs`, 2 Nov 2026): listed only for doctors who have references assigned
  (`scripts/admin.mjs assign-refs`). A structured reference in two stages, on the same schema as the AI drafts
  (`src/emqsg/phase0/schema.py` in the research folder): **Stage 1** shows the "Not stated" question only and asks for
  3–10 essential points (critical / desirable), 1–6 must-not items (harmful advice / wrong claim), urgency as *where* and
  *when* with a reason, 0–5 missing-information items, 0–6 Singapore facts with a source or "unsure", question validity
  and confidence. Saving Stage 1 fixes it and opens **Stage 2**, which shows the template and the axes' values and asks,
  per axis, whether the ideal answer should differ (no / may / must / unsure) and, for may or must, 1–5 permitted
  differences (point, change, groups, reason). The API enforces the stages: the axes are not sent before Stage 1 is
  locked, Stage 1 cannot change after it, and Stage 2 is not stored before it. The form's checks (`public/ref_forms.js`,
  shared by the page and the API) are the schema's. A doctor can mark a question as outside their expertise (it is then
  reassigned) and undo that. Time in use is counted per stage (page visible and used in the last 2 minutes).
  **Blind rule:** a reference cannot be assigned, opened or saved once the doctor has opened that question in the
  rating mode before finishing it, and the rating mode is closed for a question while the doctor's blind reference for
  it is unfinished. **A complete reference is read only from the moment the doctor opens its question in the rating
  mode** (11 Nov): it can still be read, but every save is refused, and the page shows it without a way to change it.
  Before that, a complete reference could be edited after the doctor had seen the answers, and the export still called
  it blind. The export now gives `blind_at_completion` and `blind_at_last_save`; the import needs both.
  Every open is logged (`view_log` mode `reference`), every save in `clinician_ref_log`. Export
  *References* as JSON and run `scripts/import_phase1a.py` in the research folder to get Phase 0-format records,
  re-checked by the schema. The assisted mode (the form pre-filled with the AI draft, with planted errors) is not built:
  it would put AI drafts in the site, and in the design each doctor's blind block comes first.
  **Corrections by the study team** (11 Nov): `scripts/admin.mjs reopen-stage1 ID BASE_ID` reopens a Stage 1 saved by
  mistake (Stage 2 is cleared, because its differences point at Stage 1's points by number; the export counts the
  reopening in `stage1_reopens`, since the doctor has by then seen the demographic versions; refused once the doctor
  has opened the question in the rating mode). `unassign-refs ID BASE_ID --force` removes a reference that has been
  started. Both add a row to `clinician_ref_log`, which keeps every earlier save. `load-questions` never changes a
  question that has reviews or a started reference.
- **The v1 rating mode** (`#/sets`) is unchanged and listed only for doctors who have rating sets assigned; its data is
  in the v1 package, not here.

## Files

| path | what |
|---|---|
| `public/` | the static site: `index.html`, `app.js` (router, home, sign out), `review_page.js`, `new_page.js`, `ref_page.js` (Phase 1A), `rating_page.js` (v1), `common.js`, `site.js` (the contact line), `forms.js` (the review and new-question forms and their checks), `ref_forms.js` (the reference form and its checks), `rubric.js` (v1), `guide.html` / `guide.js` (doctors' guide with the worked example, the answer-key fields and "Your data"), `rating_guide.html` (v1), `admin.html` / `admin.js`, `style.css` |
| `api/` | Vercel functions (11): `questions`, `question`, `review`, `newq`, `ref` (Phase 1A: list, open, save), `me`, `admin`, `site` (the contact; needs no link), and v1's `sets`, `set`, `save`; `_lib.js` (database, auth, CSV cells, demo references) |
| `schema.sql` | v1 tables plus `questions`, `reviews`, `review_log`, `new_questions`, `new_question_log`, `view_log`, and Phase 1A's `ref_assignments`, `clinician_refs`, `clinician_ref_log`; 11 Nov: `annotators.is_test`, `clinician_refs.stage1_reopens` (all additive: run `init` again after an update) |
| `prepare_data.py` | builds `data/questions.json` from `../data/inputs` and `../data/labels/specialty_labels.csv` (blind check included) |
| `scripts/admin.mjs` | set up the database, load the questions, create accounts (real or test) and links, assign Phase 1A references, reopen a Stage 1, remove a reference; run it without arguments for the list |
| `scripts/fix_templates.py` | rewrites a template that shows a slot for a detail no version changes (second review, fix 4); already run on `data/questions.json`. Run it again on a rebuilt file until `prepare_data.py` has the rule |
| `analysis/analyse_reviews.py` | summary, confirmed specialties, flagged questions from the exports (test accounts skipped) |
| `test/` | unit tests: the forms, the reference form, the blind data file, the server helpers, the v1 rubric (`./run.sh test`) |
| `dev/server.mjs`, `run.sh` | local stand-in for Vercel; Docker wrapper for Node |
| `build_package.py`, `DEPLOY.md` | build `../deploy/equitymedqa-sg-annotation/` (and `.zip`) for the user to deploy |

## Checked (1 Nov 2026, Phase 1A added 2 Nov 2026; local Postgres 16, headless Chrome 152)

- **11 Nov 2026, after the review's fixes: unit 20, API 150, browser 70 pass.** New checks cover: a complete reference
  after a rating open (it opens read only; an edit, a save of time alone and completing again are refused; nothing is
  stored or logged; the page disables every field and sends no save); `blind_at_last_save` and `stage1_reopens` in the
  exports, and the import calling a reference changed after a rating open "not blind"; `reopen-stage1` (and its
  refusals) and `unassign-refs --force`; `load-questions` keeping a question with a started reference; test accounts
  (marked, three demo references, left out of each export unless asked for, `set-test`, made from the admin page);
  400 for a request that is not a JSON object and for a bad id; the apostrophe before a formula in CSV; the contact on
  every page and in the guide; sign out (nothing left in the browser, the site asks for the link again, the link
  opened in the same tab signs in again) and the admin page's own sign out; the answer-key wording.
  `FORMS_VERSION` q1-2026-11-11, `REF_FORM_VERSION` r1-2026-11-11 (the forms' fields and checks are unchanged).
- Re-run on 4 Nov 2026 with the question data built from the 3 Nov specialty labels: unit 16, API 94, browser 51 pass.
- 4 Nov 2026: the guide now places skin cancer under Oncology (Dermatology second), as in the 3 Nov labels;
  `FORMS_VERSION` q1-2026-11-04.
- Unit tests: 16 pass (forms, reference form, blind data file, v1 rubric).
- API: 94 checks pass. As on 1 Nov: access (no token, wrong token, deactivated, admin-only, another doctor's question or
  set), the question payload whitelist, review completion and cleaning, the audit logs, new-question draft / submit /
  edit / withdraw / resubmit, view logging in both modes, progress, every export. Phase 1A: the list, Stage 1 showing the
  neutral question only, no Stage 2 stored before the lock, the lock and completion rules, Stage 1 unchanged after the
  lock, a difference for every group refused, falling back from complete, active time (capped per save), decline and
  undo, the not-blind refusal (open and save), `assign-refs` (skips not-blind and duplicate pairs, refuses unknown
  questions), `unassign-refs`, the rating mode closed during an unfinished blind reference, progress, the references
  exports and reference opens in the exposure export. The JSON export imports with `scripts/import_phase1a.py` as
  schema-valid records.
- Browser: 51 checks pass. As on 1 Nov, plus Phase 1A: the list, both stages filled by clicking and typing (adding a
  row, conditional fields, reload), the lock, the read-only Stage 1 with ids, the axes, completion moving to the next
  reference, decline, no horizontal scroll at 390 px.
- Not tested here: the deployed Vercel and Neon set-up, which needs the user's accounts.
