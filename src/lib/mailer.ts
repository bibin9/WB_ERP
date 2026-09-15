import "server-only";
import nodemailer from "nodemailer";
import { db } from "./db";
import { unseal } from "./secrets";
import { canSend, checkRecipients, parseRecipients } from "./mailsettings";

/**
 * Sending email through the company's own mail server.
 *
 * Everything about the connection comes from EmailSettings, which is master
 * data an administrator fills in — host, port, how it is secured, who it signs
 * in as, and what address it sends from. No server name appears anywhere in
 * this file, because the moment one does, a client on a different provider
 * needs a developer.
 *
 * What is said about a send
 * -------------------------
 * "Accepted by the mail server" is the strongest honest claim, and it is the
 * one this makes. Whether the customer received it, read it, or found it in
 * junk is beyond anything the sending side can know, and a system that says
 * "delivered" is lying about the difference.
 *
 * The password never leaves this file. It is unsealed, handed to the transport
 * and forgotten; it is not logged, not returned, and deliberately stripped out
 * of any error message before that message is shown to anybody.
 */

export type SendResult =
  | { ok: true; messageId: string | null; accepted: string[] }
  | { ok: false; error: string };

/**
 * Anything a mail server says that might carry the password back out.
 *
 * Servers quote the failing command surprisingly often, and an SMTP AUTH line
 * contains base64 of the username and password. Showing that on a settings
 * screen, or writing it into the send log, would put the mailbox password into
 * a place anybody with read access can find it.
 */
export function safeError(err: unknown, secret: string | null): string {
  let message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "The mail server refused the message.";

  if (secret) {
    message = message.split(secret).join("••••");
    // Base64 of the credentials, as it appears in a quoted AUTH command.
    try {
      const b64 = Buffer.from(secret, "utf8").toString("base64");
      if (b64) message = message.split(b64).join("••••");
    } catch {
      /* nothing to redact */
    }
  }
  // An AUTH line with anything after it is never worth showing.
  message = message.replace(/AUTH\s+(PLAIN|LOGIN)\s+\S+/gi, "AUTH $1 ••••");
  return message.slice(0, 500);
}

/** The settings for a company, with whether a password is set but not what it is. */
export async function mailSettingsFor(companyId: string) {
  const row = await db.emailSettings.findUnique({ where: { companyId } });
  if (!row) return null;
  const { password, ...rest } = row;
  return { ...rest, hasPassword: !!password };
}

/** Whether this company can send at all, for a screen to ask before offering to. */
export async function mailReady(companyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const settings = await mailSettingsFor(companyId);
  return canSend(settings);
}

type Outgoing = {
  companyId: string;
  to: string;
  cc?: string | null;
  subject: string;
  /** Plain text, for mail clients that will not show HTML. */
  text: string;
  html?: string | null;
  attachments?: { filename: string; content: string | Buffer; contentType?: string }[];
  /** For the log, so a document can list its own sends. */
  kind: string;
  entity?: string | null;
  entityId?: string | null;
  sentBy?: string | null;
};

/**
 * Send one message, and record what happened either way.
 *
 * A failure is logged as carefully as a success. "We sent it and it bounced"
 * and "we never sent it" look identical afterwards unless the attempt is
 * written down, and the first is the one somebody needs to act on.
 */
export async function sendMail(out: Outgoing): Promise<SendResult> {
  const row = await db.emailSettings.findUnique({ where: { companyId: out.companyId } });

  const settings = row ? { ...row, hasPassword: !!row.password } : null;
  const ready = canSend(settings);
  if (!ready.ok) return ready;

  const recipients = checkRecipients(out.to);
  if (!recipients.ok) return recipients;
  const cc = parseRecipients(out.cc ?? "");

  const secret = row!.username ? unseal(row!.password) : null;
  if (row!.username && !secret) {
    return {
      ok: false,
      error:
        "The saved mail password could not be read. This happens when the application's AUTH_SECRET " +
        "changes. Enter the password again in Settings.",
    };
  }

  const transport = nodemailer.createTransport({
    host: row!.host,
    port: row!.port,
    // Implicit TLS on 465; STARTTLS is negotiated on the others.
    secure: row!.security === "SSL/TLS",
    requireTLS: row!.security === "STARTTLS",
    auth: row!.username ? { user: row!.username, pass: secret! } : undefined,
    // A mail server that never answers must not hang a form for minutes.
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });

  const from = row!.fromName ? `"${row!.fromName}" <${row!.fromEmail}>` : row!.fromEmail;

  try {
    const info = await transport.sendMail({
      from,
      to: recipients.to,
      cc: cc.length ? cc : undefined,
      replyTo: row!.replyTo || undefined,
      subject: out.subject,
      text: out.text,
      html: out.html || undefined,
      attachments: out.attachments,
    });

    await db.emailLog.create({
      data: {
        companyId: out.companyId,
        kind: out.kind,
        entity: out.entity ?? null,
        entityId: out.entityId ?? null,
        toAddresses: recipients.to.join(", "),
        ccAddresses: cc.length ? cc.join(", ") : null,
        subject: out.subject.slice(0, 500),
        sentBy: out.sentBy ?? null,
        ok: true,
        messageId: info.messageId ?? null,
      },
    });

    return { ok: true, messageId: info.messageId ?? null, accepted: recipients.to };
  } catch (err) {
    const error = safeError(err, secret);
    await db.emailLog.create({
      data: {
        companyId: out.companyId,
        kind: out.kind,
        entity: out.entity ?? null,
        entityId: out.entityId ?? null,
        toAddresses: recipients.to.join(", "),
        ccAddresses: cc.length ? cc.join(", ") : null,
        subject: out.subject.slice(0, 500),
        sentBy: out.sentBy ?? null,
        ok: false,
        error,
      },
    });
    return { ok: false, error };
  } finally {
    transport.close();
  }
}

/**
 * Prove the settings work, by sending to whoever asked.
 *
 * To the person testing rather than to a customer, because the point is to
 * find out whether the server accepts us — and discovering it does not by
 * sending rubbish to a client is an expensive way to learn.
 */
export async function sendTest(input: {
  companyId: string;
  to: string;
  by: string;
  companyName?: string;
}): Promise<SendResult> {
  const res = await sendMail({
    companyId: input.companyId,
    to: input.to,
    subject: `Test message from ${input.companyName ?? "the ERP"}`,
    text:
      `This is a test from the ERP, sent by ${input.by}.\n\n` +
      `If you are reading it, the mail server settings work and quotations can be emailed from the system.\n`,
    html:
      `<p>This is a test from the ERP, sent by ${escapeHtml(input.by)}.</p>` +
      `<p>If you are reading it, the mail server settings work and quotations can be emailed from the system.</p>`,
    kind: "test",
    sentBy: input.by,
  });

  await db.emailSettings.update({
    where: { companyId: input.companyId },
    data: {
      lastTestedAt: new Date(),
      lastTestOk: res.ok,
      lastTestError: res.ok ? null : res.error,
    },
  }).catch(() => {
    /* the settings row may have gone; the log already has the attempt */
  });

  return res;
}

/** Escape text going into an HTML mail body. */
export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The sends against one document, newest first. */
export async function sendsFor(entity: string, entityId: string) {
  return db.emailLog.findMany({
    where: { entity, entityId },
    orderBy: { sentAt: "desc" },
  });
}
