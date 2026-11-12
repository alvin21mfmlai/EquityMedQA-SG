// GET /api/site -> what every page may show without a personal link: who to contact (11 Nov 2026).
// Set CONTACT_EMAIL, and optionally CONTACT_NAME, in the project's environment variables (DEPLOY.md). contact is null
// when neither is set; the admin page then says so.
import { contact, handler, send } from "./_lib.js";

export default handler(["GET"], async (req, res) => send(res, 200, { contact: contact() }));
