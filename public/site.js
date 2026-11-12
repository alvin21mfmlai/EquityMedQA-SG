// Who doctors can contact, shown on every page (11 Nov 2026). The study team sets it with the environment variables
// CONTACT_EMAIL and CONTACT_NAME; GET /api/site returns it without a personal link. Used by the site, the guide and the
// admin page. When no contact is set, the places that would show it stay hidden.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let site = null;
export function siteInfo() {
  site ||= fetch("/api/site").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return site;
}

// "Name, address" with the address as a mail link; "" when there is no contact
export function contactHtml(c) {
  if (!c) return "";
  const mail = c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "";
  return [c.name ? esc(c.name) : "", mail].filter(Boolean).join(", ");
}

// Fill every [data-contact] element under root: the attribute's text, then the contact. Hidden when none is set.
export async function fillContact(root = document) {
  const html = contactHtml((await siteInfo()).contact);
  root.querySelectorAll("[data-contact]").forEach((el) => {
    el.innerHTML = html ? `${esc(el.dataset.contact || "Study team:")} ${html}` : "";
    el.hidden = !html;
  });
}
