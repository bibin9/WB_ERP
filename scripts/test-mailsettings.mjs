/**
 * Mail server settings as master data.
 *
 * The rules worth protecting:
 *   - a password is written and never read back, so a screen can only ever say
 *     whether one is set;
 *   - a configuration nobody has tested is a configuration nobody should
 *     trust, and the sentence says so;
 *   - a sign-in name with no password is the commonest half-finished setup and
 *     fails at the server with a message nobody can read.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { mailsettings: lib } = await importLibs(["mailsettings"]);
const {
  SECURITY_MODES, SECURITY_HELP, MAIL_PRESETS, presetFor, defaultPortFor,
  looksLikeEmail, parseRecipients, checkRecipients,
  checkSettings, maskSecret, mailVerdict, canSend,
} = lib;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

const good = (extra = {}) => ({
  host: "smtp.office365.com", port: 587, security: "STARTTLS",
  username: "quotes@wandb.ae", hasPassword: true,
  fromName: "White & Bright", fromEmail: "quotes@wandb.ae", isActive: true, ...extra,
});

/* ================================================== what the words mean == */

ok("every security mode is explained in plain English",
  SECURITY_MODES.every((m) => (SECURITY_HELP[m] || "").length > 40), SECURITY_MODES.join(", "));

ok("there is a preset for Microsoft 365", MAIL_PRESETS.some((p) => p.key === "m365"));
{
  const m = presetFor("m365");
  ok("  pointing at the right server", m.host === "smtp.office365.com", m.host,
  );
  ok("  on the right port", m.port === 587, String(m.port));
  ok("  with the right security", m.security === "STARTTLS");
  ok("  and warns that SMTP AUTH is off by default",
    /SMTP AUTH off by default/.test(m.note), m.note.slice(0, 80));
  ok("  and that MFA needs an app password", /app password/.test(m.note));
}

ok("an unknown preset falls back to something usable", presetFor("nonsense").key === "custom");
ok("there is a preset for an on-premise Exchange", MAIL_PRESETS.some((p) => p.key === "exchange"));

ok("STARTTLS defaults to 587", defaultPortFor("STARTTLS") === 587);
ok("SSL/TLS defaults to 465", defaultPortFor("SSL/TLS") === 465);
ok("no encryption defaults to 25", defaultPortFor("None") === 25);
ok("anything unrecognised defaults to 587", defaultPortFor("what") === 587);

/* ======================================================== addresses === */

ok("an ordinary address is accepted", looksLikeEmail("procurement@emiratessteel.ae") === true);
ok("plus-addressing is accepted", looksLikeEmail("quotes+crm@wandb.ae") === true,
  "a regex strict enough to reject every bad address rejects real ones too");
ok("an apostrophe in a name is accepted", looksLikeEmail("o'brien@example.com") === true);

ok("nothing is refused", looksLikeEmail("") === false);
ok("no at-sign is refused", looksLikeEmail("procurement.example.com") === false);
ok("two at-signs are refused", looksLikeEmail("a@b@c.com") === false);
ok("nothing before the at-sign is refused", looksLikeEmail("@example.com") === false);
ok("no dot in the domain is refused", looksLikeEmail("someone@localhost") === false);
ok("a space in the middle is refused", looksLikeEmail("some one@example.com") === false,
  "the typo that actually happens when somebody pastes two addresses into one box");
ok("a trailing dot is refused", looksLikeEmail("a@example.") === false);

ok("addresses split on commas", parseRecipients("a@b.com, c@d.com").length === 2);
ok("  and on semicolons, the way Outlook writes them",
  parseRecipients("a@b.com; c@d.com").length === 2);
ok("  ignoring empty gaps", parseRecipients("a@b.com,,  ;c@d.com").length === 2);

{
  const r = checkRecipients("procurement@steel.ae; projects@steel.ae");
  ok("a list of good addresses is accepted", r.ok === true);
  ok("  and comes back parsed", r.to.length === 2 && r.to[0] === "procurement@steel.ae");
}

ok("an empty list is refused", checkRecipients("  ").ok === false);

{
  const r = checkRecipients("procurement@steel.ae, not-an-address");
  ok("one bad address in a list is refused", r.ok === false);
  ok("  naming the bad one, not the good one",
    /not-an-address/.test(r.error) && !/procurement/.test(r.error), r.error);
}

/* ========================================================= settings === */

ok("a complete configuration is accepted", checkSettings(good()).ok === true);

{
  const r = checkSettings(good({ host: "" }));
  ok("no server name is refused", r.ok === false);
  ok("  and asks for it", /mail server name/.test(r.error), r.error);
}

{
  const r = checkSettings(good({ host: "https://outlook.office.com" }));
  ok("a web address in the server box is refused", r.ok === false);
  ok("  and says what a mail server looks like",
    /a name like smtp\.office365\.com/.test(r.error), r.error);
}

ok("a server name with a space in it is refused",
  checkSettings(good({ host: "smtp office365 com" })).ok === false);

ok("port zero is refused", checkSettings(good({ port: 0 })).ok === false);
ok("port 70000 is refused", checkSettings(good({ port: 70000 })).ok === false);
ok("port 587 is fine", checkSettings(good({ port: 587 })).ok === true);
ok("port 65535 is fine", checkSettings(good({ port: 65535 })).ok === true);
ok("port 1 is fine", checkSettings(good({ port: 1 })).ok === true);

ok("a security mode nobody recognises is refused",
  checkSettings(good({ security: "Very secure" })).ok === false);

ok("no from-address is refused", checkSettings(good({ fromEmail: "" })).ok === false);
ok("a from-address that is not one is refused",
  checkSettings(good({ fromEmail: "quotes at wandb" })).ok === false);
ok("a reply-to that is not an address is refused",
  checkSettings(good({ replyTo: "nonsense" })).ok === false);
ok("no reply-to at all is fine", checkSettings(good({ replyTo: "" })).ok === true);

/**
 * The half-finished setup that fails at the server with an unreadable message.
 */
{
  const r = checkSettings(good({ hasPassword: false }));
  ok("a sign-in name with no password is refused", r.ok === false);
  ok("  and says which way to fix it", /Enter the password, or clear the name/.test(r.error), r.error);
}

ok("no sign-in name and no password is fine",
  checkSettings(good({ username: "", hasPassword: false })).ok === true,
  "a relay inside your own network may need neither");

/* ==================================== the password is never readable === */

ok("a set password shows as dots", maskSecret(true) === "••••••••");
ok("  and never as itself", !/[a-z0-9]/i.test(maskSecret(true)));
ok("an unset password shows as nothing", maskSecret(false) === "");

{
  const src = prose("src/lib/mailsettings.ts");
  ok("nothing in the module returns a password",
    !/\bpassword\s*[:=]\s*s\.password/.test(fs.readFileSync("src/lib/mailsettings.ts", "utf8")),
    "the settings shape carries hasPassword, never the secret");
  ok("and the file says why",
    /a way into the company's mailbox/.test(src));
}

/* ======================================================== the sentence == */

ok("nothing set up says so, and what it would buy",
  /No mail server set up yet/.test(mailVerdict({})) && /email quotations straight from the system/.test(mailVerdict({})));

ok("an incomplete configuration says what is wrong",
  /^Not ready: /.test(mailVerdict(good({ fromEmail: "" }))), mailVerdict(good({ fromEmail: "" })));

ok("a switched-off one says so", /Turned off/.test(mailVerdict(good({ isActive: false }))));

{
  const v = mailVerdict(good());
  ok("an untested configuration says it has never been tested", /never tested/.test(v), v);
  ok("  and to test it before relying on it", /Send a test before relying on it/.test(v), v,
    "a configuration nobody has tried is one nobody should trust");
}

{
  const v = mailVerdict(good({ lastTestedAt: new Date("2026-09-01T10:00:00Z"), lastTestOk: true }));
  ok("a tested one says where it sends from", /Sending through smtp\.office365\.com as quotes@wandb\.ae/.test(v), v);
  ok("  and when it was last tested", /Last tested/.test(v), v);
}

{
  const v = mailVerdict(good({
    lastTestedAt: new Date("2026-09-01T10:00:00Z"), lastTestOk: false,
    lastTestError: "535 authentication failed",
  }));
  ok("a failed test leads with the failure", /The last test failed/.test(v), v);
  ok("  carrying what the server actually said", /535 authentication failed/.test(v), v);
}

/* ===================================================== can we send? ==== */

{
  const r = canSend(null);
  ok("with nothing set up, nothing can be sent", r.ok === false);
  ok("  and it says who can fix it", /An administrator can add one under/.test(r.error), r.error);
}

ok("with it switched off, nothing can be sent", canSend(good({ isActive: false })).ok === false);
ok("with it half-configured, nothing can be sent", canSend(good({ host: "" })).ok === false);
ok("with it set up, mail can be sent", canSend(good()).ok === true);

/* ==================================================== how it is written = */

const src = prose("src/lib/mailsettings.ts");
ok("the file says why settings are master data rather than code",
  /none of them should need a developer/.test(src));
ok("and why the loose address check is deliberate",
  /only way to know an address works is to send to it/i.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
