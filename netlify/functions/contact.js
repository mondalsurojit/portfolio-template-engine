// Contact form delivery via the Gmail API.
//
// Replaces the old Google Apps Script webhook. The function exchanges the
// long-lived Gmail refresh token (pushed from the CMS to the engine's env)
// for a short-lived access token, then sends an HTML email via the Gmail
// REST API as the owner's authenticated Gmail user.
//
// Required env vars (all pushed by the CMS deploy):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GMAIL_REFRESH_TOKEN
//
// POST body: { name, email, message, to }
//   `to` is computed client-side from data.settings.receiverEmail || data.user.email.

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Designed for cross-client compatibility (Gmail, Apple Mail, Outlook).
// Uses table layout, inline styles, and a single accent color.
function buildHtmlEmail({ name, email, message }) {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>New contact form submission</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="padding:28px 32px 22px;border-bottom:1px solid #f3f4f6;">
          <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6366f1;">New contact form submission</p>
          <h1 style="margin:8px 0 0;font-size:20px;font-weight:600;color:#0f172a;line-height:1.4;">${safeName} reached out via your portfolio</h1>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;">From</p>
          <p style="margin:0;font-size:15px;color:#0f172a;font-weight:500;">${safeName}</p>
          <a href="mailto:${safeEmail}" style="display:inline-block;margin-top:2px;font-size:13px;color:#6366f1;text-decoration:none;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;">${safeEmail}</a>
        </td></tr>
        <tr><td style="padding:18px 32px 28px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;">Message</p>
          <div style="padding:16px 18px;background:#f8fafc;border-radius:8px;border-left:3px solid #6366f1;font-size:14px;line-height:1.6;color:#1e293b;white-space:pre-wrap;">${safeMessage}</div>
        </td></tr>
        <tr><td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #f1f5f9;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Reply directly to this email to respond to ${safeName}.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Build an RFC 2822 message, then base64url-encode (Gmail API requirement).
function buildRawMessage({ to, fromName, fromEmail, subject, html }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    // Reply-To routes a Reply in the inbox straight back to the sender.
    `Reply-To: "${fromName.replace(/"/g, "")}" <${fromEmail}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
  ].join("\r\n");
  const raw = `${headers}\r\n\r\n${html}`;
  return Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function fetchAccessToken() {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh returned no access_token");
  return data.access_token;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { result: "error", message: "Method not allowed" });
  }

  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET ||
    !process.env.GMAIL_REFRESH_TOKEN
  ) {
    console.error("[contact] Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_REFRESH_TOKEN");
    return json(500, { result: "error", message: "Email service not configured." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { result: "error", message: "Invalid JSON body." });
  }

  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const message = String(payload.message || "").trim();
  const to = String(payload.to || "").trim();

  if (!name || !email || !message || !to) {
    return json(400, { result: "error", message: "Missing required fields." });
  }
  if (!EMAIL_RE.test(email) || !EMAIL_RE.test(to)) {
    return json(400, { result: "error", message: "Invalid email address." });
  }
  if (message.length > 5000) {
    return json(413, { result: "error", message: "Message is too long (max 5000 characters)." });
  }

  try {
    const accessToken = await fetchAccessToken();
    const raw = buildRawMessage({
      to,
      fromName: name,
      fromEmail: email,
      subject: `[Portfolio] ${name} contacted`,
      html: buildHtmlEmail({ name, email, message }),
    });

    const sendRes = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    if (!sendRes.ok) {
      const body = await sendRes.text();
      console.error("[contact] Gmail send failed:", sendRes.status, body);
      return json(502, { result: "error", message: "Failed to send email." });
    }

    return json(200, { result: "success" });
  } catch (err) {
    console.error("[contact] Unhandled error:", err.message);
    return json(500, { result: "error", message: "Server error." });
  }
};
