// Shared by every page: the access token, API calls, escaping, the header and the form widgets.
import { fillContact } from "./site.js";

// ---------- access token (from the personal link #k=TOKEN, kept in this browser until the doctor signs out) ----------
const TOKEN_KEY = "emqsg_token";
export function store(k, v) { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
export function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
let token = load(TOKEN_KEY);
// Take the personal link from the address bar: when the site is opened with it, and also when it is opened in a tab
// that already shows the site (then only the part after # changes and the page is not loaded again: app.js calls this
// on every change of address, and reloads the page when a link was taken, so that nothing of the earlier session stays).
export function takeLink() {
  if (!location.hash.startsWith("#k=")) return false;
  token = decodeURIComponent(location.hash.slice(3));
  store(TOKEN_KEY, token);
  history.replaceState(null, "", location.pathname + "#/");
  return true;
}
takeLink();

// Sign out (for shared computers): this browser forgets the personal link and everything else the site kept in it
// (the review filter). The admin page's own link is separate and stays. Saved work is on the server and is not touched.
export function signOut() {
  token = null;
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("emqsg_") && k !== "emqsg_admin_token") localStorage.removeItem(k);
  } catch {}
}
export function signedOutPage() {
  view.innerHTML = `<div class="card"><h1>Signed out</h1><p>This browser has forgotten your personal link. Your saved work
    is kept. To come back, open your personal link again.</p><p class="muted" data-contact="Lost your link? Ask the study team:" hidden></p></div>`;
  fillContact(view);
}

export async function api(path, opts = {}) {
  const r = await fetch(`/api/${path}`, {
    ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}`, ...(opts.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || r.statusText), { status: r.status, body });
  return body;
}

export const view = document.getElementById("view");
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const STATUS = { complete: "Complete", in_progress: "In progress", not_started: "Not started",
                        draft: "Draft", submitted: "Submitted", withdrawn: "Withdrawn", declined: "Outside my expertise" };
export const chip = (status) => `<span class="chip ${status}">${STATUS[status] || esc(status)}</span>`;
export const slots = (t) => esc(t).replace(/\[([^\]]+)\]/g, '<span class="slot">[$1]</span>');
export const time = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function fail(e) {
  if (e.status === 401) {
    document.getElementById("signout").hidden = true;
    view.innerHTML = `<div class="card"><h1>Access link needed</h1><p>Open this site with your personal link
      (it ends in <span class="kbd">#k=…</span>). If you have lost it, ask the study team for a new one.</p>
      <p class="muted" data-contact="Study team:" hidden></p></div>`;
    fillContact(view);
  } else if (e.status === 409) {
    view.innerHTML = `<div class="card"><h1>Not available</h1><p>${esc(e.message)}</p><p><a class="btn" href="#/">Home</a></p></div>`;
  } else view.innerHTML = `<p class="err">Something went wrong: ${esc(e.message)}. Reload the page; your saved work is kept.</p>`;
}

export async function header() {
  const me = await api("me");
  document.getElementById("who").textContent = `${me.name}${me.test ? " · test account" : ""} · ${me.review.complete}/${me.review.total} reviewed`;
  document.getElementById("signout").hidden = false;
  // the rating mode (answers and AI reference) is listed only for doctors who have rating sets assigned, and the
  // answer keys (Phase 1A references) only for doctors who have some assigned
  document.getElementById("nav-rate").hidden = !me.progress.assigned;
  document.getElementById("nav-refs").hidden = !me.refs.assigned;
  return me;
}

// the contact line at the foot of every page
fillContact();

// ---------- word-level differences (longest common subsequence) ----------
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}%.-]/gu, "").replace(/\.$/, "");
export function lcsMarks(a, b) {
  // returns [aChanged[], bChanged[]] over flat word arrays
  const n = a.length, m = b.length, A = a.map(norm), B = b.map(norm);
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ca = new Array(n).fill(true), cb = new Array(m).fill(true);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ca[i] = cb[j] = false; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return [ca, cb];
}
export function diffQuestion(baseQ, compQ) {
  const a = baseQ.split(/\s+/), b = compQ.split(/\s+/);
  const [ca, cb] = lcsMarks(a, b);
  const r = (ws, ch, cls) => ws.map((w, i) => (ch[i] ? `<span class="${cls}">${esc(w)}</span>` : esc(w))).join(" ");
  return [r(a, ca, "del"), r(b, cb, "ins")];
}

// ---------- form widgets ----------
// a fixed-choice field: radio buttons, or checkboxes when f.multi
export function fieldHtml(f, value, name, scope, cond) {
  const multi = !!f.multi;
  const opts = f.options.map(([k, lbl]) => {
    const on = multi ? (value || []).includes(k) : value === k;
    return `<label><input type="${multi ? "checkbox" : "radio"}" name="${esc(name)}" value="${esc(k)}"
      data-scope="${scope}" data-key="${f.key}" ${on ? "checked" : ""}>${esc(lbl)}</label>`;
  }).join("");
  return `<div class="field" ${cond ? `data-when="${cond}"` : ""}><div class="lbl">${esc(f.label)}</div><div class="opts">${opts}</div></div>`;
}
export function selectHtml(key, options, value, blank, scope = "") {
  return `<select data-key="${key}" ${scope ? `data-scope="${scope}"` : ""}><option value="">${esc(blank)}</option>${options.map(([k, l]) =>
    `<option value="${esc(k)}" ${value === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
}
export function textHtml(key, value, label, placeholder, { rows = 2, input = false, scope = "", hint = "" } = {}) {
  const attrs = `data-key="${key}" ${scope ? `data-scope="${scope}"` : ""} placeholder="${esc(placeholder)}"`;
  return `<div class="field" data-for="${key}"><div class="lbl">${esc(label)}</div>${hint ? `<div class="hint">${hint}</div>` : ""}${input
    ? `<input type="text" ${attrs} value="${esc(value || "")}">`
    : `<textarea ${attrs} rows="${rows}">${esc(value || "")}</textarea>`}</div>`;
}
