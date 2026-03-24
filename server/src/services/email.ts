/**
 * Email service with graceful degradation.
 *
 * Configured via environment variables:
 *   SMTP_HOST       - SMTP server hostname (required to enable email)
 *   SMTP_PORT       - SMTP port (default: 587)
 *   SMTP_USER       - SMTP username
 *   SMTP_PASSWORD   - SMTP password
 *   SMTP_FROM       - Sender address (default: noreply@paperclip.local)
 *   SMTP_SECURE     - "true" for TLS on connect (port 465), default false
 */

import net from "node:net";
import tls from "node:tls";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "send_failed"; error?: string };

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    user: process.env.SMTP_USER ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.SMTP_FROM ?? "noreply@paperclip.local",
    secure: process.env.SMTP_SECURE === "true",
  };
}

function base64(str: string): string {
  return Buffer.from(str, "utf8").toString("base64");
}

function encodeHeader(value: string): string {
  // RFC 2047 base64 encoding for non-ASCII
  if (/[^\x20-\x7e]/.test(value)) {
    return `=?UTF-8?B?${base64(value)}?=`;
  }
  return value;
}

function buildRawEmail(from: string, msg: EmailMessage): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `MIME-Version: 1.0`,
  ];

  if (msg.html) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, ``);
    lines.push(
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64(msg.text),
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64(msg.html),
      ``,
      `--${boundary}--`,
    );
  } else {
    lines.push(
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64(msg.text),
    );
  }

  return lines.join("\r\n");
}

/** Send a command over a socket and wait for expected response code */
function smtpDialog(
  socket: net.Socket | tls.TLSSocket,
): {
  send: (cmd: string) => void;
  expect: (code: number) => Promise<string>;
  close: () => void;
} {
  let buffer = "";
  const pending: Array<{ code: number; resolve: (line: string) => void; reject: (err: Error) => void }> = [];

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("ascii");
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      const line = buffer.slice(0, newline + 1).trimEnd();
      buffer = buffer.slice(newline + 1);
      // Only act on complete response (last line of multi-line reply has "XXX " not "XXX-")
      const match = /^(\d{3})[ -]/.exec(line);
      if (match && pending.length > 0) {
        const isLast = line.charAt(3) === " ";
        if (isLast) {
          const waiter = pending.shift()!;
          const code = parseInt(match[1], 10);
          if (code === waiter.code) {
            waiter.resolve(line);
          } else {
            waiter.reject(new Error(`SMTP unexpected response: ${line} (expected ${waiter.code})`));
          }
        }
      }
    }
  });

  return {
    send(cmd: string) {
      socket.write(cmd + "\r\n");
    },
    expect(code: number): Promise<string> {
      return new Promise((resolve, reject) => {
        pending.push({ code, resolve, reject });
      });
    },
    close() {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    },
  };
}

async function sendViaSMTP(
  config: NonNullable<ReturnType<typeof getSmtpConfig>>,
  msg: EmailMessage,
): Promise<void> {
  const raw = buildRawEmail(config.from, msg);
  const domain = config.from.split("@")[1] ?? "localhost";

  await new Promise<void>((resolve, reject) => {
    const rawSocket = config.secure
      ? tls.connect({ host: config.host, port: config.port })
      : net.createConnection({ host: config.host, port: config.port });

    rawSocket.on("error", reject);

    // For direct TLS, wait for secureConnect; for plain TCP, wait for connect.
    const connectEvent = config.secure ? "secureConnect" : "connect";
    (rawSocket as net.Socket).once(connectEvent, async () => {
      let smtp = smtpDialog(rawSocket);
      try {
        // Greeting
        await smtp.expect(220);
        smtp.send(`EHLO ${domain}`);
        await smtp.expect(250);

        // STARTTLS upgrade if not already secure
        if (!config.secure) {
          smtp.send("STARTTLS");
          const starttlsResp = await smtp.expect(220).catch(() => null);
          if (starttlsResp) {
            // Upgrade the raw socket to TLS and create a fresh dialog on it
            const tlsSocket = await new Promise<tls.TLSSocket>((res, rej) => {
              const ts = tls.connect(
                { socket: rawSocket as net.Socket, host: config.host },
                () => res(ts),
              );
              ts.on("error", rej);
            });
            smtp = smtpDialog(tlsSocket);
            smtp.send(`EHLO ${domain}`);
            await smtp.expect(250);
          }
        }

        // AUTH LOGIN
        if (config.user) {
          smtp.send("AUTH LOGIN");
          await smtp.expect(334);
          smtp.send(base64(config.user));
          await smtp.expect(334);
          smtp.send(base64(config.password));
          await smtp.expect(235);
        }

        smtp.send(`MAIL FROM:<${config.from}>`);
        await smtp.expect(250);
        smtp.send(`RCPT TO:<${msg.to}>`);
        await smtp.expect(250);
        smtp.send("DATA");
        await smtp.expect(354);
        smtp.send(raw + "\r\n.");
        await smtp.expect(250);
        smtp.send("QUIT");
        smtp.close();
        resolve();
      } catch (err) {
        smtp.close();
        reject(err);
      }
    });
  });
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const config = getSmtpConfig();
  if (!config) {
    return { ok: false, reason: "not_configured" };
  }
  try {
    await sendViaSMTP(config, msg);
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
  return Boolean(process.env.SMTP_HOST);
}
