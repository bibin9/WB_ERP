/**
 * Where the company's email goes out from, as configuration rather than code.
 *
 * Every client has a different mail server and none of them should need a
 * developer. The host, the port, how it is secured, who it signs in as and
 * what address it sends from are all master data, set once in Settings and
 * changed there when the client moves mail provider.
 *
 * The password is the exception to everything else in this system being
 * readable. It is written but never read back — the screen shows that one is
 * set, not what it is — and it is encrypted at rest rather than sitting in a
 * column somebody with a database viewer can read. A mail password is a way
 * into the company's mailbox, and the mailbox is where every contract, invoice
 * and price the company has ever sent lives.
 *
 * Not server-only: the settings form validates before anything is saved.
 */

export const SECURITY_MODES = ["STARTTLS", "SSL/TLS", "None"] as const;
export type SecurityMode = (typeof SECURITY_MODES)[number];

export const SECURITY_HELP: Record<string, string> = {
  STARTTLS:
    "Starts in the clear and upgrades to an encrypted connection. What Microsoft 365 and most modern servers use, normally on port 587.",
  "SSL/TLS":
    "Encrypted from the first byte. Older servers and some hosting companies use this, normally on port 465.",
  None:
    "No encryption at all. Only for a mail relay inside your own network — never for anything reachable from outside.",
};

/**
 * What a given provider needs, so nobody has to look it up.
 *
 * Microsoft 365 is first because it is what this client uses, and because its
 * settings are the ones people most often get wrong: the server is not
 * outlook.com, and the port is not 465.
 */
export type MailPreset = {
  key: string;
  label: string;
  host: string;
  port: number;
  security: SecurityMode;
  /** What somebody setting this up needs to know before they start. */
  note: string;
};

export const MAIL_PRESETS: MailPreset[] = [
  {
    key: "m365",
    label: "Microsoft 365 / Outlook (work account)",
    host: "smtp.office365.com",
    port: 587,
    security: "STARTTLS",
    note:
      "Sign in with the full mailbox address. Microsoft turns SMTP AUTH off by default on new tenants, " +
      "so your IT will need to enable it for this mailbox, and an app password is required where " +
      "multi-factor authentication is on.",
  },
  {
    key: "exchange",
    label: "Exchange Server (on your own network)",
    host: "",
    port: 587,
    security: "STARTTLS",
    note:
      "Use the internal name of your Exchange or mail relay server. A relay that only accepts connections " +
      "from inside the network may need no password at all.",
  },
  {
    key: "gmail",
    label: "Google Workspace / Gmail",
    host: "smtp.gmail.com",
    port: 587,
    security: "STARTTLS",
    note: "Needs an app password rather than the account password, generated in the Google account settings.",
  },
  {
    key: "custom",
    label: "Something else",
    host: "",
    port: 587,
    security: "STARTTLS",
    note: "Your mail provider or IT department will have the server name, the port and which encryption to use.",
  },
];

export const presetFor = (key: string): MailPreset =>
  MAIL_PRESETS.find((p) => p.key === key) ?? MAIL_PRESETS[MAIL_PRESETS.length - 1];

/** The port a mode normally runs on, offered as a default rather than forced. */
export function defaultPortFor(security: string): number {
  if (security === "SSL/TLS") return 465;
  if (security === "None") return 25;
  return 587;
}

/* ========================================================= addresses == */

/**
 * Whether something is shaped like an email address.
 *
 * Deliberately loose. The only way to know an address works is to send to it,
 * and a regex strict enough to reject every bad address rejects real ones too —
 * apostrophes in Irish surnames, plus-addressing, long new top-level domains.
 * This catches the typo that matters: no at-sign, no domain, or a space in the
 * middle.
 */
export function looksLikeEmail(value: string): boolean {
  const v = String(value ?? "").trim();
  if (!v || /\s/.test(v)) return false;
  const at = v.indexOf("@");
  if (at < 1 || at !== v.lastIndexOf("@")) return false;
  const domain = v.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".") && domain.length > 3;
}

/** Split a typed list of addresses on commas or semicolons. */
export function parseRecipients(value: string): string[] {
  return String(value ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function checkRecipients(value: string): { ok: true; to: string[] } | { ok: false; error: string } {
  const list = parseRecipients(value);
  if (!list.length) return { ok: false, error: "Enter at least one address to send to." };

  const bad = list.filter((a) => !looksLikeEmail(a));
  if (bad.length) {
    return {
      ok: false,
      error: `${bad.join(", ")} ${bad.length === 1 ? "does not look like an email address" : "do not look like email addresses"}.`,
    };
  }
  return { ok: true, to: list };
}

/* ========================================================== settings == */

export type MailSettingsLike = {
  host?: string | null;
  port?: number | null;
  security?: string | null;
  username?: string | null;
  /** Whether a password has been saved. Never the password itself. */
  hasPassword?: boolean;
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
  isActive?: boolean;
};

/**
 * Whether these settings are complete enough to try.
 *
 * "Try" rather than "work": the only way to know a mail server works is to
 * talk to it, which is what the Send a test button is for. This catches what
 * can be known without a connection.
 */
export function checkSettings(s: MailSettingsLike): { ok: true } | { ok: false; error: string } {
  const host = String(s.host ?? "").trim();
  if (!host) return { ok: false, error: "Enter the mail server name." };
  if (/\s/.test(host)) return { ok: false, error: "A server name cannot contain spaces." };
  if (host.startsWith("http")) {
    return { ok: false, error: "That looks like a web address. A mail server is a name like smtp.office365.com." };
  }

  const port = Number(s.port) || 0;
  if (port < 1 || port > 65535) return { ok: false, error: "Enter the port number, normally 587." };

  if (!(SECURITY_MODES as readonly string[]).includes(String(s.security ?? ""))) {
    return { ok: false, error: "Choose how the connection is secured." };
  }

  const from = String(s.fromEmail ?? "").trim();
  if (!from) return { ok: false, error: "Enter the address email should come from." };
  if (!looksLikeEmail(from)) return { ok: false, error: `${from} does not look like an email address.` };

  const replyTo = String(s.replyTo ?? "").trim();
  if (replyTo && !looksLikeEmail(replyTo)) {
    return { ok: false, error: `${replyTo} does not look like an email address.` };
  }

  // A username with no password is the commonest half-finished setup, and it
  // fails at the server with a message nobody can read.
  if (String(s.username ?? "").trim() && !s.hasPassword) {
    return { ok: false, error: "There is a sign-in name but no password. Enter the password, or clear the name." };
  }

  return { ok: true };
}

/**
 * A password, as it is safe to show.
 *
 * Never the real one. The screen needs to say whether one is set, and this is
 * the whole of what it is allowed to say.
 */
export const maskSecret = (hasPassword: boolean): string => (hasPassword ? "••••••••" : "");

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Where email stands for this company, in a sentence.
 *
 * Leads with whether anything can actually be sent, because that is the only
 * question anybody has, and says plainly when it has never been tested — a
 * configuration nobody has tried is a configuration nobody should trust.
 */
export function mailVerdict(
  s: MailSettingsLike & { lastTestedAt?: Date | string | null; lastTestOk?: boolean | null; lastTestError?: string | null },
): string {
  if (!s.host) {
    return "No mail server set up yet, so nothing can be sent. Add one to email quotations straight from the system.";
  }

  const fit = checkSettings(s);
  if (!fit.ok) return `Not ready: ${fit.error}`;

  if (s.isActive === false) {
    return `Turned off. ${s.host} is set up, but nothing will be sent until it is switched back on.`;
  }

  if (!s.lastTestedAt) {
    return `Set up for ${s.host}, but never tested. Send a test before relying on it.`;
  }
  if (s.lastTestOk === false) {
    return `The last test failed on ${fmtDate(s.lastTestedAt)}: ${s.lastTestError ?? "no reason given"}`;
  }
  return `Sending through ${s.host} as ${s.fromEmail}. Last tested ${fmtDate(s.lastTestedAt)}.`;
}

/** Whether mail can actually be sent right now. */
export function canSend(
  s: MailSettingsLike | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!s || !s.host) {
    return {
      ok: false,
      error:
        "No mail server has been set up for this company yet. An administrator can add one under " +
        "Settings, and then quotations can be emailed straight from here.",
    };
  }
  if (s.isActive === false) {
    return { ok: false, error: "Email is switched off for this company. An administrator can turn it back on in Settings." };
  }
  return checkSettings(s);
}
