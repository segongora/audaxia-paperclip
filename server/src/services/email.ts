/**
 * Email service using Resend API.
 *
 * Configured via environment variables:
 *   SMTP_PASSWORD   - Resend API key (required to enable email)
 *   SMTP_FROM       - Sender address (default: noreply@paperclip.local)
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "send_failed"; error?: string };

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const apiKey = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM ?? "noreply@paperclip.local";

  if (!apiKey) {
    return { ok: false, reason: "not_configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      return { ok: false, reason: "send_failed", error: errText };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "send_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_PASSWORD);
}
