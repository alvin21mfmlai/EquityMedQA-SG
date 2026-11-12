"""Make each question's displayed template show only the details that really change (11 Nov 2026, second review).

    python3 scripts/fix_templates.py data/questions.json            # report only
    python3 scripts/fix_templates.py data/questions.json --write    # rewrite the file in place

Before this fix, 73 of the 250 templates showed a bracketed slot for a detail that is the same in every version of the
question: "[man / woman / person]" where every version says "woman", or "(I am [religion].)" where no version states a
religion. The review page says that words in [brackets] change between versions, so those slots misled.

For every slot whose detail (sex, ethnicity, religion) is not among the question's axes, this script puts the fixed
wording in its place: the one option that every version uses, or nothing for a bracketed sentence that no version has.
Each rewritten template is then checked against every version of the question; a template that cannot be checked is
left as it was and reported. Only "template_display" changes: the versions, the "Not stated" question and everything
else stay byte for byte the same. Standard library only. The same rule belongs in prepare_data.py (research folder),
which builds this file: until it is there, a rebuilt questions.json needs this script run on it again.
"""
import json
import re
import sys

ETHNIC = ["Chinese", "Malay", "Indian", "Eurasian"]
RELIGION = ["Buddhist", "Christian", "Muslim", "Hindu", "Taoist", "non-religious", "not religious"]
SLOT = re.compile(r"\[([^\]]+)\]")
PAREN = re.compile(r"\(([^()]*\[[^\]]+\][^()]*)\)")  # a bracketed sentence that holds a slot, e.g. "(I am [religion].)"


def axis_of(slot):
    if "/" in slot:
        return "sex"
    return "ethnicity" if "ethnic" in slot else "religion" if "religion" in slot else None


def literal(text):
    """Literal template text as a pattern: any spacing, and "a" or "an" before a word that may change."""
    out = []
    for part in re.split(r"(\s+)", text):
        if not part:
            continue
        out.append(r"\s*" if part.isspace() else "an?" if part.lower() in ("a", "an") else re.escape(part))
    return "".join(out)


def slot_pattern(slot, inside_paren):
    ax = axis_of(slot)
    if ax == "sex":
        return "(?:" + "|".join(re.escape(o.strip()) for o in slot.split("/")) + "|they)?"  # nothing when not stated
    names = "(?:" + "|".join(ETHNIC if ax == "ethnicity" else RELIGION) + ")"
    return r"(?:an?\s*)?" + names if inside_paren else names + "?"


def pattern(template):
    """A pattern that every version made from this template matches."""
    out, pos = [], 0
    tokens = re.compile(PAREN.pattern + "|" + SLOT.pattern)
    for m in tokens.finditer(template):
        out.append(literal(template[pos:m.start()]))
        if m.group(1) is not None:  # a bracketed sentence: present with a value, absent when the detail is not stated
            inner, p = [], 0
            for s in SLOT.finditer(m.group(1)):
                inner += [literal(m.group(1)[p:s.start()]), slot_pattern(s.group(1), True)]
                p = s.end()
            inner.append(literal(m.group(1)[p:]))
            out.append(r"(?:\(?" + "".join(inner) + r"\)?)?")
        else:
            out.append(slot_pattern(m.group(2), False))
        pos = m.end()
    out.append(literal(template[pos:]))
    return re.compile(r"\s*" + "".join(out) + r"\s*", re.I | re.S)


def fits(template, q):
    rx = pattern(template)
    return all(rx.fullmatch(v["question"]) for a in q["axes"] for v in a["versions"])


def tidy(t):
    return re.sub(r"\s+([.,?!])", r"\1", re.sub(r"\s{2,}", " ", t)).strip()


def fixed_template(q):
    """(new template, None), or (None, why not)."""
    t, varied = q["template_display"], {a["axis"] for a in q["axes"]}
    if not fits(t, q):
        return None, "the template as it is cannot be matched to the versions"
    # 1. a bracketed sentence whose slots are all for details that do not vary: no version has it
    def drop(m):
        axes = {axis_of(s) for s in SLOT.findall(m.group(1))}
        return "" if axes and not (axes & varied) else m.group(0)
    t = tidy(PAREN.sub(drop, t))
    # 2. every other slot for a detail that does not vary: the one wording that fits every version
    while True:
        m = next((m for m in SLOT.finditer(t) if axis_of(m.group(1)) not in varied), None)
        if not m:
            break
        ax = axis_of(m.group(1))
        options = [o.strip() for o in m.group(1).split("/")] if ax == "sex" else [""] + ETHNIC if ax == "ethnicity" else [""]
        good = [o for o in options if fits(tidy(t[:m.start()] + o + t[m.end():]), q)]
        if len(good) != 1:
            return None, f"[{m.group(1)}]: {len(good)} wordings fit every version ({good})"
        t = tidy(t[:m.start()] + good[0] + t[m.end():])
    left = {axis_of(s) for s in SLOT.findall(t)} - varied
    if left or not fits(t, q):
        return None, f"could not be checked against the versions (slots left: {sorted(left)})"
    return t, None


def main():
    path, write = sys.argv[1], "--write" in sys.argv[2:]
    doc = json.load(open(path, encoding="utf-8"))
    changed, skipped, stale = 0, [], 0
    for q in doc["questions"]:
        varied = {a["axis"] for a in q["axes"]}
        if not ({axis_of(s) for s in SLOT.findall(q["template_display"])} - varied):
            continue
        stale += 1
        new, why = fixed_template(q)
        if new is None:
            skipped.append((q["base_id"], why))
            continue
        if not write and changed < 5:
            print(f"{q['base_id']}\n  was: {q['template_display']}\n  now: {new}")
        q["template_display"] = new
        changed += 1
    print(f"{stale} templates had a slot that never changes: {changed} rewritten, {len(skipped)} left as they were")
    for b, why in skipped:
        print(f"  left: {b}: {why}")
    if write:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)  # the layout prepare_data.py writes
            f.write("\n")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
