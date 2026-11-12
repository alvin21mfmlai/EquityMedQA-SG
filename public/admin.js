import { contactHtml } from "./site.js";

const KEY = "emqsg_admin_token";
let token = null;
try { token = localStorage.getItem(KEY); } catch {}
if (location.hash.startsWith("#k=")) {
  token = decodeURIComponent(location.hash.slice(3));
  try { localStorage.setItem(KEY, token); } catch {}
  history.replaceState(null, "", location.pathname);
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const h = () => ({ Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" });
const $ = (id) => document.getElementById(id);

async function refresh() {
  const r = await fetch("/api/admin?action=progress", { headers: h() });
  const b = await r.json();
  if (!r.ok) {
    $("summary").textContent = `Not allowed: ${b.error}. Open this page with the admin link.`;
    $("contact").textContent = "";
    $("rows").innerHTML = "";
    return;
  }
  // the totals count the real accounts; test accounts are listed, marked, and left out
  const real = b.annotators.filter((a) => !a.is_test), nTest = b.annotators.length - real.length;
  const sum = (k) => real.reduce((s, a) => s + a[k], 0);
  $("summary").textContent = `${b.questions_loaded} questions and ${b.sets_loaded} rating sets loaded; `
    + `${sum("reviews_complete")} reviews complete, ${sum("new_submitted")} new questions submitted, `
    + `${sum("refs_complete")} of ${sum("refs_assigned")} assigned references complete, `
    + `${sum("complete")} of ${sum("assigned")} assigned rating sets complete.`
    + (nTest ? ` Not counted: ${nTest} test account${nTest > 1 ? "s" : ""}.` : "");
  const c = contactHtml(b.contact);
  $("contact").innerHTML = c ? `Contact shown to doctors: ${c}.`
    : `<span class="missing">No contact is shown to doctors. Set <span class="kbd">CONTACT_EMAIL</span> (and, if you like,
       <span class="kbd">CONTACT_NAME</span>) in the project's environment variables and redeploy (DEPLOY.md).</span>`;
  const started = (n) => (n ? ` <span class="muted">(+${n} started)</span>` : "");
  $("rows").innerHTML = b.annotators.map((a) => `<tr><td>${a.id}</td><td>${esc(a.name)}${a.is_test ? ' <span class="chip test">test</span>' : ""}${a.email ? `<div class="muted">${esc(a.email)}</div>` : ""}</td>
    <td>${a.role}</td><td>${a.reviews_complete}${started(a.reviews_in_progress)}</td>
    <td>${a.new_submitted}${a.new_drafts ? ` <span class="muted">(+${a.new_drafts} drafts)</span>` : ""}</td>
    <td>${a.refs_assigned ? `${a.refs_complete}/${a.refs_assigned}${started(a.refs_in_progress)}${a.refs_declined ? ` <span class="muted">(${a.refs_declined} declined)</span>` : ""}` : "-"}</td>
    <td>${a.assigned ? `${a.complete}/${a.assigned}${started(a.in_progress)}; calibration ${a.calibration_complete}/${a.calibration}` : "-"}</td>
    <td>${a.not_blind ? `${a.not_blind} questions` : "-"}</td><td>${a.last_saved ? new Date(a.last_saved).toLocaleString() : "-"}</td>
    <td>${a.role === "admin" ? "yes" : `<input type="checkbox" data-id="${a.id}" ${a.active ? "checked" : ""}>`}</td></tr>`).join("");
  document.querySelectorAll("input[data-id]").forEach((el) => el.addEventListener("change", async () => {
    await fetch("/api/admin", { method: "POST", headers: h(), body: JSON.stringify({ action: "set_active", id: Number(el.dataset.id), active: el.checked }) });
  }));
}
async function download(what, fmt) {
  const test = $("include-test").checked;
  const r = await fetch(`/api/admin?action=export&what=${what}&format=${fmt}${test ? "&include_test=1" : ""}`, { headers: h() });
  if (!r.ok) return alert("Export failed");
  const blob = fmt === "json" ? new Blob([JSON.stringify(await r.json(), null, 1)], { type: "application/json" }) : await r.blob();
  const name = what === "ratings" ? "annotations" : what;
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob),
    download: `${name}_${new Date().toISOString().slice(0, 10)}${test ? "_with_test" : ""}.${fmt}` });
  a.click();
  URL.revokeObjectURL(a.href);
}
$("refresh").onclick = refresh;
document.querySelectorAll("[data-export]").forEach((el) => (el.onclick = () => download(el.dataset.export, el.dataset.format)));
$("add").onclick = async () => {
  const name = $("name").value.trim();
  if (!name) return;
  const r = await fetch("/api/admin", { method: "POST", headers: h(),
    body: JSON.stringify({ action: "create_annotator", name, email: $("email").value, test: $("test").checked }) });
  const b = await r.json();
  const p = $("link");
  p.hidden = false;
  p.textContent = r.ok
    ? `#${b.id} ${b.name}${b.test ? ` (test account, ${b.refs_assigned} demo references)` : ""}: ${location.origin}/#k=${b.token}  (copy it now; it is shown only once)`
    : `Failed: ${b.error}`;
  if (r.ok) { $("name").value = ""; $("email").value = ""; $("test").checked = false; }
  refresh();
};
// Sign out: this browser forgets the admin link (a doctor's link kept in the same browser is separate and stays)
$("signout").onclick = () => {
  token = null;
  try { localStorage.removeItem(KEY); } catch {}
  $("link").hidden = true;
  $("link").textContent = "";
  refresh().then(() => { $("summary").textContent = "Signed out. Open this page with the admin link to come back."; });
};
refresh();
