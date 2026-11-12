"""Summarise the doctors' question reviews and new questions (work item c). Standard library only.

    python3 analysis/analyse_reviews.py reviews_YYYY-MM-DD.csv [--new new_questions_YYYY-MM-DD.csv]
                                        [--labels ../data/labels/specialty_labels.csv] [--include-test]

Input: the admin page's exports. Writes next to the reviews export:
- review_summary.md: progress per doctor; relevance, wording and keep/edit/drop counts; how often the proposed specialty
  is confirmed (overall, by proposed specialty and, with --labels, by how the label was made: agreed by both AI
  classifiers or settled by hand); agreement between doctors on each field (% agreement and Krippendorff's alpha);
  new questions per doctor and specialty against the target per priority specialty (NEW_PER_PRIORITY below).
- specialty_confirmed.csv: one row per base question with every doctor's reviewed specialty and the consensus (the
  label every reviewing doctor gave, else "disputed"). The confirmed label is the record (work pointers, item b).
- flagged_questions.csv: questions any doctor marked not relevant, needing an edit or not realistic, with versions that
  do not make sense, or to edit or drop, with their rewording and comments.
Only complete reviews count; in-progress ones are reported as such.
Rows from test accounts (column test_account = yes; the export leaves them out unless "Include test accounts" was
ticked) are skipped, and the summary says how many, unless --include-test is given.
In the CSV exports, text that begins with =, +, - or @ carries a leading apostrophe (so that a spreadsheet does not run
it as a formula); it is passed on unchanged.
Doctors are told apart by annotator_id, not by name (11 Nov 2026, second review): two accounts with the same name are two
doctors, shown as "Name (#id)". An export without that column (none is known) falls back to the name.
"""
import argparse
import collections
import csv
import itertools
from pathlib import Path

# The priority specialties and the target per doctor, as in public/forms.js (PRIORITY, NEW_PER_PRIORITY): a unit test
# (test/forms.test.mjs) fails if the two files stop agreeing.
PRIORITY = ["dermatology", "cardiology", "psychiatry", "neurology_dev", "general_practice"]
NEW_PER_PRIORITY = 5
FIELDS = ["relevant", "realistic", "versions", "decision", "reviewed_primary"]


def krippendorff_nominal(units):
    """units: unit -> list of values from different raters. None if undefined (as in analyse_annotations.py, v1)."""
    pairs = collections.Counter()
    for vals in units.values():
        m = len(vals)
        if m < 2:
            continue
        for a, b in itertools.permutations(range(m), 2):
            pairs[(vals[a], vals[b])] += 1 / (m - 1)
    n_c = collections.Counter()
    for (a, _), w in pairs.items():
        n_c[a] += w
    n = sum(n_c.values())
    if n <= 1:
        return None
    d_o = sum(w for (a, b), w in pairs.items() if a != b) / n
    d_e = sum(n_c[a] * n_c[b] for a in n_c for b in n_c if a != b) / (n * (n - 1))
    return None if d_e == 0 else 1 - d_o / d_e


def read(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def pct(a, b):
    return f"{a} of {b} ({100 * a / b:.0f}%)" if b else "0"


def doctor_key(r):
    """What tells one doctor from another: the account's id (the name, only if the export has no id)."""
    return r.get("annotator_id") or r["annotator"]


def doctor_labels(*tables):
    """key -> the name to print: the doctor's name, with "(#id)" added where two accounts share a name."""
    names = {}
    for rows in tables:
        for r in rows:
            names[doctor_key(r)] = r["annotator"]
    shared = {n for n, k in collections.Counter(names.values()).items() if k > 1}
    return {k: f"{n} (#{k})" if n in shared else n for k, n in names.items()}


def by_key(k):
    """Sort accounts by id (numbers in order), names after."""
    return (0, int(k), "") if str(k).isdigit() else (1, 0, str(k))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("reviews")
    ap.add_argument("--new", help="new_questions export")
    ap.add_argument("--labels", help="specialty_labels.csv (item b), for confirmation by label source")
    ap.add_argument("--include-test", action="store_true", help="keep rows from test accounts (skipped by default)")
    a = ap.parse_args()
    out = Path(a.reviews).resolve().parent

    def real(rs):
        """The rows that count, and how many test-account rows were skipped (exports before 11 Nov have no such column)."""
        kept = [r for r in rs if a.include_test or r.get("test_account") != "yes"]
        return kept, len(rs) - len(kept)

    rows, skipped = real(read(a.reviews))
    new_rows, new_skipped = real(read(a.new)) if a.new else ([], 0)
    label = doctor_labels(rows, new_rows)
    done = [r for r in rows if r["status"] == "complete"]
    md = ["# Question reviews and new questions", "", f"Export: `{Path(a.reviews).name}`; {len(done)} complete reviews, "
          f"{len(rows) - len(done)} in progress."
          + (f" Rows from test accounts skipped: {skipped}." if skipped else "")
          + (" Test accounts are included." if a.include_test else ""),
          "", "## Progress per doctor", "", "| doctor | complete | in progress |", "|---|---|---|"]
    by_doc = collections.defaultdict(collections.Counter)
    for r in rows:
        by_doc[doctor_key(r)][r["status"]] += 1
    md += [f"| {label[d]} | {c['complete']} | {c['in_progress']} |" for d, c in sorted(by_doc.items(), key=lambda x: by_key(x[0]))]

    md += ["", "## Answers (complete reviews)", ""]
    for f in ["relevant", "realistic", "versions", "decision", "specialty"]:
        c = collections.Counter(r[f] for r in done)
        md.append(f"- **{f}:** " + ", ".join(f"{k} {pct(v, len(done))}" for k, v in c.most_common()))

    # the proposed specialty, confirmed or changed
    md += ["", "## Proposed specialty: confirmed or changed", ""]
    conf = [r for r in done if r["specialty"] == "confirm"]
    md.append(f"Confirmed in {pct(len(conf), len(done))} of complete reviews.")
    md += ["", "| proposed primary | reviews | confirmed |", "|---|---|---|"]
    by_spec = collections.defaultdict(list)
    for r in done:
        by_spec[r["proposed_primary"]].append(r["specialty"] == "confirm")
    md += [f"| {s} | {len(v)} | {pct(sum(v), len(v))} |" for s, v in sorted(by_spec.items(), key=lambda x: -len(x[1]))]
    if a.labels:
        src = {r["base_id"]: r["label_source"] for r in read(a.labels)}
        by_src = collections.defaultdict(list)
        for r in done:
            by_src[src.get(r["base_id"], "unknown")].append(r["specialty"] == "confirm")
        md += ["", "By how the proposed label was made (not shown to the doctors):", ""]
        md += [f"- {s}: confirmed in {pct(sum(v), len(v))}" for s, v in sorted(by_src.items())]
    changes = collections.Counter((r["proposed_primary"], r["reviewed_primary"]) for r in done if r["specialty"] == "change")
    if changes:
        md += ["", "Changes (proposed -> reviewed): " + "; ".join(f"{p} -> {q} ({n})" for (p, q), n in changes.most_common())]

    # agreement between doctors, on questions reviewed by two or more
    md += ["", "## Agreement between doctors", ""]
    per_q = collections.defaultdict(dict)
    for r in done:
        per_q[r["base_id"]][doctor_key(r)] = r
    multi = {q: d for q, d in per_q.items() if len(d) >= 2}
    if not multi:
        md.append("No question has two complete reviews yet.")
    else:
        md += [f"{len(multi)} questions have two or more complete reviews.", "", "| field | % agreement (pairs) | Krippendorff's alpha |",
               "|---|---|---|"]
        for f in FIELDS:
            units = {q: [r[f] for r in d.values() if r[f]] for q, d in multi.items()}
            pairs = [(x, y) for v in units.values() for x, y in itertools.combinations(v, 2)]
            agree = sum(x == y for x, y in pairs) / len(pairs) if pairs else 0
            alpha = krippendorff_nominal(units)
            md.append(f"| {f} | {100 * agree:.0f}% ({len(pairs)}) | {'n/a' if alpha is None else f'{alpha:.2f}'} |")

    # the confirmed labels (the record)
    with open(out / "specialty_confirmed.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["base_id", "proposed_primary", "reviews", "reviewed_primaries", "consensus_primary", "consensus_secondary"])
        for q in sorted(per_q):
            d = per_q[q]
            prim = sorted({r["reviewed_primary"] for r in d.values()})
            sec = sorted({r["reviewed_secondary"] for r in d.values()})
            first = next(iter(d.values()))
            w.writerow([q, first["proposed_primary"], len(d),
                        ";".join(f"{label[k]}:{d[k]['reviewed_primary']}" for k in sorted(d, key=by_key)),
                        prim[0] if len(prim) == 1 else "disputed", sec[0] if len(prim) == 1 and len(sec) == 1 else ""])

    flagged = [r for r in done if r["relevant"] != "yes" or r["realistic"] != "yes" or r["versions"] == "no" or r["decision"] != "keep"]
    cols = ["base_id", "annotator_id", "annotator", "relevant", "realistic", "rewording", "versions", "versions_comment", "decision", "comment"]
    with open(out / "flagged_questions.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(sorted(flagged, key=lambda r: (r["base_id"], by_key(doctor_key(r)))))
    md += ["", f"## Flagged questions", "", f"{len({r['base_id'] for r in flagged})} questions flagged by at least one doctor "
           "(`flagged_questions.csv`)."]

    if a.new:
        nq = [r for r in new_rows if r["status"] == "submitted"]
        md += ["", "## New questions (submitted)", "", f"{len(nq)} submitted."
               + (f" Rows from test accounts skipped: {new_skipped}." if new_skipped else ""),
               "", "| doctor | " + " | ".join(PRIORITY) + " | other specialties |", "|---|" + "---|" * (len(PRIORITY) + 1)]
        by = collections.defaultdict(collections.Counter)
        for r in nq:
            by[doctor_key(r)][r["specialty"] if r["specialty"] in PRIORITY else "rest"] += 1
        md += [f"| {label[d]} | " + " | ".join(f"{c[s]} / {NEW_PER_PRIORITY}" for s in PRIORITY) + f" | {c['rest']} |"
               for d, c in sorted(by.items(), key=lambda x: by_key(x[0]))]
        det = collections.Counter(x for r in nq for x in r["details"].split(";") if x)
        md += ["", "Details that could matter: " + ", ".join(f"{k} {v}" for k, v in det.most_common())]
        ch = collections.Counter((k, r[f"{k}_change"]) for r in nq for k in ["sex", "ethnicity", "religion", "other"] if r[f"{k}_change"])
        md += ["Should change the advice: " + ", ".join(f"{k} {v}: {n}" for (k, v), n in sorted(ch.items()))]

    (out / "review_summary.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"wrote {out / 'review_summary.md'}, specialty_confirmed.csv, flagged_questions.csv"
          + (f" (review rows from test accounts skipped: {skipped})" if skipped else ""))


if __name__ == "__main__":
    main()
