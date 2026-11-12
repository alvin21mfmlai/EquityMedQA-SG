# Deploying the EquityMedQA-SG site for doctors (Vercel + Neon)

This folder is the complete, ready-to-deploy package (v2, built for work item c; with the nine fixes of the second
review, 11 Nov 2026: `README.md` lists them). The question data is already built:
nothing from the research repository is needed. It works for a **new** deployment and as an **upgrade** of the v1
annotation app deployed from the 28 Oct package: the new tables are added beside the old ones, and existing links,
rating sets and ratings are kept.

## What is in the package

| path | what | goes where |
|---|---|---|
| `public/` | the website: home, question review, new questions, Phase 1A references (the pages call them answer keys), the v1 rating mode, admin page, guides | Vercel (static) |
| `api/` | the serverless functions (11; `_lib.js` = database and auth). The Hobby plan allows 12 per deployment | Vercel (functions) |
| `vercel.json`, `package.json`, `package-lock.json` | Vercel settings (security headers, `public/` as output) and the one dependency (`pg`) | Vercel |
| `schema.sql` | the database tables | Neon, via `admin.mjs init` |
| `data/questions.json` | the 250 base questions as doctors see them: questions only, no answers, references or AI labels | Neon, via `admin.mjs load-questions` |
| `scripts/admin.mjs` | set up the database, load the questions, create accounts (real or test) and links, assign and correct references | runs on your computer |
| `scripts/fix_templates.py` | makes each template show only the details that change between versions; already run on `data/questions.json` (README, second review) | runs on your computer |
| `analysis/analyse_reviews.py` | summarises the exports: progress, confirmed specialties, agreement between doctors, flagged questions, new questions | runs on your computer |
| `dev/`, `test/`, `run.sh` | local test server, unit tests, a Docker wrapper for machines without Node | runs on your computer |
| `README.md` | how the site works, and what was tested | |
| `SHA256SUMS` | checksums of every file in the package (`sha256sum -c SHA256SUMS`) | |

`.vercelignore` keeps everything except the site and functions off Vercel; the question data reaches the database
only through `admin.mjs`.

## Before you start

- **The plan.** The free Vercel Hobby plan is for personal, non-commercial use. Vercel's fair-use guidelines (read
  11 Nov 2026) count a deployment as commercial when it is "used for the purpose of financial gain of anyone involved
  in any part of the production of the project, including a paid employee or consultant writing the code". Work done
  as an employee may therefore need the Pro plan or A\*STAR's approval: settle this before step 1, because it decides
  which Vercel account the project goes under. The steps are the same on either plan.
  There is no patient data: the questions are synthetic. The doctors' names, emails
  (optional), reviews and new questions will be stored on Vercel and Neon. The guide's "Your data" section tells the
  doctors this (`public/guide.html`): check its wording against your institution's rules, and change it if you host
  the site or the database elsewhere.
- **The contact address.** Decide which address doctors should write to (a lost link, a question, a mistake to
  correct). Every page and the guide show it once it is set (step 2). Without it, the pages say "the study team" and
  give no address, and the admin page shows a warning.
- **Tools.** Node.js 22 (`node -v`). On a machine without Node but with Docker, use `./run.sh`: `./run.sh vercel …`
  for `npx vercel …`, and `./run.sh admin …` for `node scripts/admin.mjs …`. Python 3.10 or later for the analysis
  script (standard library only).

## Steps

1. **Deploy the site.** From this folder:

       npm install
       npx vercel login                 # shows a link to open in a browser, on any device; approve there
       npx vercel deploy --prod         # new: create a new project; do not change the detected settings

   (Without Node: `./run.sh vercel login`, then `./run.sh vercel deploy --prod`. This uses Vercel CLI 63.1.2.)

   The first deployment asks a few questions. Choose your account or team; create a **new** project (do not link to
   an existing one); **type the project's name**, `equitymedqa-sg-annotation` (with `./run.sh` the name offered is
   `app`, the folder's name inside Docker); the code is in `./`; do not customise the settings (`vercel.json` gives
   them). The name becomes the site's address, `https://NAME.vercel.app`, if that is free. The command ends by
   printing the production address: that is the one to give out, not the longer address of the single deployment.

   The functions run in Singapore (`"regions": ["sin1"]` in `vercel.json`; Vercel's default is Washington, D.C.), to
   be next to the database of step 2. If you put the database elsewhere, change the region to match.

   *Upgrading v1:* choose to link to the existing project instead (`equitymedqa-sg-annotation`), so the URL, the
   database connection and every existing link stay the same.

2. **Add the database and the contact address.**

   *The database* (new deployments only; an upgrade keeps v1's). In the Vercel dashboard, open the Neon integration
   (the project's *Storage* tab, or the Vercel Marketplace, *Neon*, *Install*): create a new Neon account through
   Vercel, choose the region **Singapore** (AWS ap-southeast-1) and the **Free** plan, and name the database. Then,
   under *Storage*, the database, *Connect Project*: choose this project and tick *Production* (the other
   environments do no harm). Leave the optional services, the preview branches and the custom prefix alone. This sets
   `DATABASE_URL` (pooled, used by the site) and `DATABASE_URL_UNPOOLED` (direct, used in step 3).

   *The contact address.* In the dashboard: the project, *Environment Variables* (under *Settings*). Add
   `CONTACT_EMAIL` (the address doctors should write to) and, if you like, `CONTACT_NAME` (for example the study's or
   your name), for Production. From the command line, `./run.sh vercel env add CONTACT_EMAIL production` does the
   same and asks for the value (CLI 63; newer versions of the CLI write `--environment production`).

   Then redeploy (`npx vercel deploy --prod`): variables reach only deployments made after they were set.

3. **Set up the tables, load the questions and create accounts**, from this folder. Copy the value of
   `DATABASE_URL_UNPOOLED` from the database's page under *Storage* (the part that starts with `postgres`), and keep
   it private: it holds the database's password. To keep it out of the terminal's history, let the shell read it
   (nothing shows as you paste):

       read -rs DATABASE_URL && export DATABASE_URL            # paste the value, press Enter
       export APP_URL=https://YOUR-APP.vercel.app
       node scripts/admin.mjs init                              # creates or upgrades the tables; safe to run again
       node scripts/admin.mjs load-questions data/questions.json  # expect: 250 questions
       node scripts/admin.mjs add-admin "Your name"             # prints your admin link once (skip if you have one)
       node scripts/admin.mjs add "Your name (test)" --test     # a test account for yourself: prints its link once
       node scripts/admin.mjs add "Dr A" a@example.org          # prints Dr A's personal link once; repeat per doctor

   **Run `init` again after every update of the site.** An update can add a column, and the site answers
   "server error" until the database has it.

   Nothing needs assigning for the review and new questions: every doctor can review all 250 and write new ones.
   (Rating sets for the v1 mode are loaded and assigned from the v1 package, only if that task is run.)

   **Test accounts** are for trying the site: yours, and one for anyone who should see it before the doctors do (a
   supervisor, say). `add NAME --test`, or the *Test account* box on the admin page, makes one. It gets three demo
   references, so its login shows all three tasks (`--refs N` for another number, `--refs 0` for none), and its pages
   say that it is a test account. What it enters is **left out of every export unless you tick *Include test
   accounts***, and the analysis and import scripts skip it. `set-test ID yes|no` changes an existing account.

   **Phase 1A references (only when that task starts):** list the base ids a doctor should write blind references for,
   one per line (`data/questions.json` has them), and assign them:

       node scripts/admin.mjs assign-refs --annotators 2,3 --base-ids pilot_ids.txt   # each id to each doctor, in order
       node scripts/admin.mjs assign-refs --csv refs.csv                              # or pairs: annotator_id,base_id

   Every pair is checked before any is assigned: an unknown doctor or base id stops the command with nothing
   assigned. A pair is skipped if that doctor has opened the question in the rating mode (not blind), or if the
   question has no "Not stated" wording (27 of the 250, where the detail is the question's subject: Stage 1 would have
   no question to show). **Assign answer keys before the doctor reviews those questions, and ask the doctor to write
   Stage 1 first:** the review page shows the demographic versions that Stage 1 keeps back. The command says when a
   doctor has already opened an assigned question there, and the References export records it
   (`review_open_before_stage1`). `unassign-refs ID BASE_ID` takes back one that has not been started. The doctor then sees an *Answer keys* task on the home page: that is
   what the pages call a reference.

   On Windows PowerShell, use `$env:DATABASE_URL='…'` instead of `export`.

4. **Check it works.** Open your admin link: it should say "250 questions … loaded", list the accounts, and show the
   contact address. Open your test account's link in a private window: the home page says it is a test account and
   shows three tasks. If the private window shows a Vercel sign-in page instead, the address is protected: use the
   production address, or look at the project's *Settings*, *Deployment Protection* (doctors have no Vercel account).
   The free database goes to sleep after five minutes without use, so the first page after a pause is slower. Review a question, submit a new question, and write one answer key through both stages. Press
   *Sign out* and check that the site then asks for the link. On the admin page, tick *Include test accounts* and
   export each file (step 6): your entries should be there, marked `test_account` = yes, and absent when the box is
   not ticked. Then, **before sending the doctors their links, let one other person try it** with a test account of
   their own and the guide, and fix whatever they find unclear.

5. **Send each doctor their link privately**, with the guide (`https://YOUR-APP.vercel.app/guide`). Treat a link like a
   password; if one leaks, run `node scripts/admin.mjs reset-token ID` and the old link stops working. The browser
   remembers the link until the doctor presses *Sign out*; say so to anyone who uses a shared computer.

6. **Export and analyse.** On the admin page, export *Question reviews* and *New questions* as CSV, then:

       python3 analysis/analyse_reviews.py reviews_YYYY-MM-DD.csv --new new_questions_YYYY-MM-DD.csv

   It writes `review_summary.md`, `specialty_confirmed.csv` (the doctors' specialty per question, and the consensus)
   and `flagged_questions.csv` next to the export. The *Blind status* export lists, per doctor and question, whether
   the doctor opened it in the rating mode (then not blind for Phase 1A). For Phase 1A, export *References*: the CSV
   gives one row per assignment (status, minutes per stage, urgency, should-differ per axis, `blind_at_completion`,
   `blind_at_last_save`, `stage1_reopens`, `review_open_before_stage1`); the JSON carries each whole reference and goes
   into the research folder's `scripts/import_phase1a.py`. Whether a finished reference was written blind is
   `blind_at_completion` here. The *Blind status* export's `blind_for_phase1a` answers another question, whether the
   doctor can still write a blind reference: it is "no" after any rating open, also one made after the reference was
   finished (`reference_complete_before_rating` there says which).

   Test accounts are left out unless *Include test accounts* is ticked (the file name then ends in `_with_test`).
   In the CSV files, text that begins with `=`, `+`, `-` or `@` has a leading apostrophe, so that a spreadsheet shows
   it as text; the JSON files carry the text exactly as typed.

7. **If the forms or the guide change,** edit `public/forms.js` and `public/guide.html` together and bump
   `FORMS_VERSION`; for the reference form, `public/ref_forms.js` and the guide's *Answer keys* section, with
   `REF_FORM_VERSION`. Every save records the version. **If the questions change,** rebuild `data/questions.json` in the
   research folder, run `python3 scripts/fix_templates.py data/questions.json --write` on it (until `prepare_data.py`
   has that rule; `npm test` fails if a template shows a slot that never changes) and run `load-questions` again: a question that already has reviews, or a reference that has been
   started, is never changed.

8. **If a doctor asks for a correction** to a reference (answer key):

       node scripts/admin.mjs reopen-stage1 ID BASE_ID          # Stage 1 was saved by mistake
       node scripts/admin.mjs unassign-refs ID BASE_ID --force  # remove a reference that has been started

   `reopen-stage1` opens Stage 1 again with what was saved and clears Stage 2, which the doctor then redoes. The export
   counts it (`stage1_reopens`), because the doctor has by then seen the demographic versions. It is refused once the
   doctor has opened the question in the rating mode. A question the doctor marked as outside their expertise stays so
   marked: the doctor undoes that on the page. A page the doctor has open on that reference is out of date after
   either command and asks to be reloaded. Both commands add a row to the log of saves, which keeps every
   earlier version. A complete reference cannot be changed at all once its doctor has opened the question in the
   rating mode: the site shows it read only.

## Local test (optional, before deploying)

With Docker, and from this folder:

    docker run -d --name annot-pg -e POSTGRES_PASSWORD=devpw -e POSTGRES_DB=annot -p 127.0.0.1:55432:5432 postgres:16
    export DATABASE_URL=postgres://postgres:devpw@127.0.0.1:55432/annot APP_URL=http://localhost:3000
    export CONTACT_EMAIL=you@example.org CONTACT_NAME="Study team"      # optional: the contact line on the pages
    node scripts/admin.mjs init && node scripts/admin.mjs load-questions data/questions.json && node scripts/admin.mjs add "Test" --test
    npm run dev                                   # http://localhost:3000/#k=… (the link printed by "add")
    docker rm -f -v annot-pg                      # afterwards

Unit tests: `npm test`.
