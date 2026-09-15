/**
 * Sending through the company's own mail server, against a real database.
 *
 * The rules that matter here are not about arithmetic:
 *   - a send that fails is written down, because "we sent it and it bounced"
 *     and "we never sent it" look identical afterwards otherwise;
 *   - the password never reaches a log, an error message or a screen;
 *   - a company with no mail server set up is told who can set one up, not
 *     handed a stack trace.
 *
 * Nothing here talks to a real mail server. The failure cases are produced by
 * pointing at a closed port, which is exactly what a wrong host looks like.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const libs = await importLibs(["mailer", "mailsettings", "secrets", "db"]);
const { db } = libs["db"];
const { sendMail, sendTest, mailSettingsFor, mailReady, escapeHtml, sendsFor, safeError } = libs["mailer"];
const { seal } = libs["secrets"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

const co = await db.company.findFirst({ where: { code: "WBE" } });
const PASSWORD = "sup3r-s3cret-app-password";

const clear = async () => {
  await db.emailLog.deleteMany({ where: { companyId: co.id, kind: { in: ["test", "unit-test"] } } });
  await db.emailSettings.deleteMany({ where: { companyId: co.id } });
};

await clear();

try {
  /* =============================== nothing set up is a sentence, not a crash */
  {
    const ready = await mailReady(co.id);
    ok("a company with no mail server cannot send", ready.ok === false);
    ok("  and is told who can set one up", /An administrator can add one under/.test(ready.error), ready.error);

    const res = await sendMail({
      companyId: co.id, to: "someone@example.com", subject: "x", text: "x", kind: "unit-test",
    });
    ok("  and sending is refused rather than throwing", res.ok === false);
  }

  ok("settings for a company with none read back as nothing",
    (await mailSettingsFor(co.id)) === null);

  /* =========================================== the password never comes back */
  await db.emailSettings.create({
    data: {
      companyId: co.id,
      // A closed port: what a wrong host or a blocked firewall looks like.
      host: "127.0.0.1", port: 1, security: "None",
      username: "quotes@wandb.ae", password: seal(PASSWORD),
      fromName: "White & Bright", fromEmail: "quotes@wandb.ae",
      isActive: true,
    },
  });

  {
    const s = await mailSettingsFor(co.id);
    ok("settings read back for a screen", s !== null && s.host === "127.0.0.1");
    ok("  saying a password is set", s.hasPassword === true);
    ok("  but not what it is", !("password" in s),
      "the shape handed to a screen has no password field at all");
    ok("  and nothing in it contains the secret",
      !JSON.stringify(s).includes(PASSWORD) && !JSON.stringify(s).includes("s3cret"));
  }

  /* ==================== redaction, on errors that actually carry the secret */

  /**
   * Tested directly rather than through a send.
   *
   * A connection-refused error never contains the password, so asserting its
   * absence after one proves nothing — which is exactly what mutation testing
   * showed when removing the redaction broke no test at all. The errors that
   * DO carry it are authentication failures, where the server quotes the
   * command back, and those are produced here rather than waited for.
   */
  {
    const quoted = new Error(`535 5.7.3 Authentication unsuccessful [AUTH LOGIN ${PASSWORD}]`);
    const out = safeError(quoted, PASSWORD);
    ok("a server error quoting the password has it removed", !out.includes(PASSWORD), out);
    ok("  leaving the part a person needs", /535 5\.7\.3 Authentication unsuccessful/.test(out), out);
    ok("  with something in its place", /••••/.test(out), out);
  }

  {
    const b64 = Buffer.from(PASSWORD, "utf8").toString("base64");
    const out = safeError(new Error(`Command failed: AUTH PLAIN ${b64}`), PASSWORD);
    ok("base64 of the password is removed too", !out.includes(b64), out,
      "an SMTP AUTH line carries the credentials encoded, not in the clear");
  }

  {
    const out = safeError(new Error("AUTH LOGIN dXNlckBleGFtcGxlLmNvbQ== refused"), PASSWORD);
    ok("an AUTH line is blanked even when the secret is not recognised",
      !/dXNlckBleGFtcGxlLmNvbQ==/.test(out), out,
      "the username is encoded on that line as well");
  }

  ok("an ordinary error is left readable",
    safeError(new Error("Connection timed out"), PASSWORD) === "Connection timed out");
  ok("a string error survives", safeError("Mailbox full", PASSWORD) === "Mailbox full");
  ok("something that is not an error at all still reads",
    safeError({ odd: true }, PASSWORD).length > 5, safeError({ odd: true }, PASSWORD));
  ok("no secret to redact is handled", safeError(new Error("plain failure"), null) === "plain failure");
  ok("a very long error is trimmed", safeError(new Error("x".repeat(5000)), null).length <= 500);

  /* ================================= a failure is written down, and redacted */
  {
    const res = await sendMail({
      companyId: co.id, to: "procurement@example.com", subject: "Quotation WBE/QTN/26/0001",
      text: "Please find our quotation.", kind: "unit-test", entity: "quotation", entityId: "q-1",
      sentBy: "Estimator",
    });
    ok("a send to a closed port fails", res.ok === false);
    ok("  with something a person can read", (res.error || "").length > 5, res.error);

    /**
     * The rule this whole file exists for.
     */
    ok("  and the password is nowhere in the error", !res.error.includes(PASSWORD), res.error.slice(0, 120));
    ok("  nor base64 of it", !res.error.includes(Buffer.from(PASSWORD).toString("base64")));

    const logs = await db.emailLog.findMany({ where: { companyId: co.id, kind: "unit-test" } });
    ok("a failed send is recorded", logs.length === 1,
      "we sent it and it bounced, and we never sent it, look identical otherwise");
    ok("  marked as failed", logs[0].ok === false);
    ok("  with who it was for", logs[0].toAddresses === "procurement@example.com");
    ok("  and the subject", /Quotation WBE/.test(logs[0].subject));
    ok("  against the document it belongs to", logs[0].entity === "quotation" && logs[0].entityId === "q-1");
    ok("  and by whom", logs[0].sentBy === "Estimator");

    ok("  the stored error carries no password either", !String(logs[0].error).includes(PASSWORD),
      String(logs[0].error).slice(0, 120));
    ok("  nor base64 of it", !String(logs[0].error).includes(Buffer.from(PASSWORD).toString("base64")));
  }

  /* ========================================= addresses are checked first === */
  {
    await db.emailLog.deleteMany({ where: { companyId: co.id, kind: "unit-test" } });
    const res = await sendMail({
      companyId: co.id, to: "not-an-address", subject: "x", text: "x", kind: "unit-test",
    });
    ok("a bad address is refused", res.ok === false);
    ok("  naming it", /not-an-address/.test(res.error), res.error);

    const logs = await db.emailLog.count({ where: { companyId: co.id, kind: "unit-test" } });
    ok("  and nothing is logged, because nothing was attempted", logs === 0,
      "a log entry would say we tried to send to an address we never tried");
  }

  ok("an empty recipient list is refused",
    (await sendMail({ companyId: co.id, to: "  ", subject: "x", text: "x", kind: "unit-test" })).ok === false);

  /* ======================================= a test records what it found === */
  {
    const res = await sendTest({ companyId: co.id, to: "me@example.com", by: "Administrator", companyName: "WBE" });
    ok("a test against a closed port fails", res.ok === false);

    const s = await db.emailSettings.findUnique({ where: { companyId: co.id } });
    ok("  and the failure is remembered on the settings", s.lastTestOk === false);
    ok("  with when", !!s.lastTestedAt);
    ok("  and what the server said", (s.lastTestError || "").length > 0, String(s.lastTestError).slice(0, 80));
    ok("  which is not the password", !String(s.lastTestError).includes(PASSWORD));
  }

  /* ================================================= switched off means off */
  {
    await db.emailSettings.update({ where: { companyId: co.id }, data: { isActive: false } });
    const ready = await mailReady(co.id);
    ok("a switched-off configuration cannot send", ready.ok === false);
    ok("  and says an administrator can turn it back on",
      /turn it back on in Settings/.test(ready.error), ready.error);

    const before = await db.emailLog.count({ where: { companyId: co.id } });
    await sendMail({ companyId: co.id, to: "a@b.com", subject: "x", text: "x", kind: "unit-test" });
    const after = await db.emailLog.count({ where: { companyId: co.id } });
    ok("  and nothing is attempted or logged", after === before);
    await db.emailSettings.update({ where: { companyId: co.id }, data: { isActive: true } });
  }

  /* ============================== an unreadable password is explained ===== */
  {
    await db.emailSettings.update({
      where: { companyId: co.id },
      data: { password: "written-before-any-of-this-existed" },
    });
    const res = await sendMail({ companyId: co.id, to: "a@b.com", subject: "x", text: "x", kind: "unit-test" });
    ok("a password that cannot be decrypted is refused", res.ok === false);
    ok("  explaining that AUTH_SECRET changed", /AUTH_SECRET/.test(res.error), res.error);
    ok("  and what to do about it", /Enter the password again in Settings/.test(res.error), res.error);
  }

  /* ========================================================= odds and ends */
  ok("html is escaped for a mail body",
    escapeHtml('<script>&"') === "&lt;script&gt;&amp;&quot;", escapeHtml('<script>&"'));

  {
    // Its own send rather than one from an earlier block, so the assertion does
    // not depend on which clean-ups have run above it — and a readable password
    // again, because the block above deliberately broke it.
    await db.emailSettings.update({ where: { companyId: co.id }, data: { password: seal(PASSWORD) } });
    await sendMail({
      companyId: co.id, to: "listing@example.com", subject: "Listing check", text: "x",
      kind: "unit-test", entity: "quotation", entityId: "q-listing", sentBy: "Estimator",
    });
    const sends = await sendsFor("quotation", "q-listing");
    ok("a document can list its own sends", sends.length === 1, `${sends.length} found`);
    ok("  newest first, with what happened", sends[0].ok === false && sends[0].subject === "Listing check");
  }
} finally {
  await clear();
}

/* ==================================================== how it is written = */

const src = prose("src/lib/mailer.ts");
ok("the file says why no server name is hardcoded",
  /the moment one does, a client on a different provider needs a developer/.test(src));
ok("and is honest about what a send can claim",
  /a system that says "delivered" is lying about the difference/.test(src));
ok("and says why errors are redacted",
  /an SMTP AUTH line contains base64 of the username and password/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
