/**
 * Encrypting the few things that must be stored but must not be readable.
 *
 * The case this exists for is a mail password: it cannot be hashed, because
 * the system has to present the real thing to the mail server every time it
 * sends. So the rules are that it round-trips, that it is unreadable in the
 * column, that tampering fails rather than producing something else, and that
 * an unreadable value comes back as null rather than crashing a settings
 * screen.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { secrets: lib } = await importLibs(["secrets"]);
const { seal, unseal, isReadable, sameSecret } = lib;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

const SECRET = "Tr0ub4dor&3-app-password";

/* ======================================================== round trip == */

{
  const box = seal(SECRET);
  ok("a secret comes back out as it went in", unseal(box) === SECRET);
  ok("  and what is stored is not the secret", !box.includes(SECRET),
    "a database dump, a backup, a screen-share of a table viewer");
  ok("  nor any recognisable part of it", !box.includes("app-password") && !box.includes("Tr0ub4dor"));
}

ok("an empty secret round-trips too", unseal(seal("")) === "");
ok("a very long one does", unseal(seal("x".repeat(5000))) === "x".repeat(5000));
ok("one with unicode in it does", unseal(seal("pásswörd—محمد")) === "pásswörd—محمد");

/**
 * The same secret must not produce the same stored value twice, or two
 * companies using the same password would be visibly using the same password.
 */
{
  const a = seal(SECRET);
  const b = seal(SECRET);
  ok("sealing twice gives two different values", a !== b,
    "otherwise identical passwords are identifiable as identical without decrypting anything");
  ok("  and both still read back", unseal(a) === SECRET && unseal(b) === SECRET);
}

/* ==================================================== what cannot be read */

ok("nothing reads back as nothing", unseal(null) === null);
ok("an empty string reads back as nothing", unseal("") === null);
ok("plain text in the column reads back as nothing", unseal("hunter2") === null,
  "a value written before this existed must not be handed out as though it were fine");

ok("a truncated value reads back as nothing", unseal(seal(SECRET).slice(0, 30)) === null);
ok("a value from a future format reads back as nothing",
  unseal(seal(SECRET).replace(/^v1:/, "v9:")) === null);

/**
 * Tampering must fail, not decrypt to something else.
 */
{
  const box = seal(SECRET);
  const parts = box.split(":");
  // Flip a character in the ciphertext.
  const body = parts[3];
  parts[3] = (body[0] === "A" ? "B" : "A") + body.slice(1);
  ok("a tampered value refuses to decrypt", unseal(parts.join(":")) === null,
    "AES-GCM authenticates, so a changed byte fails rather than producing different text");
}

{
  const box = seal(SECRET);
  const parts = box.split(":");
  parts[2] = Buffer.from("0".repeat(16)).toString("base64");
  ok("a forged authentication tag refuses to decrypt", unseal(parts.join(":")) === null);
}

ok("a readable value says so", isReadable(seal(SECRET)) === true);
ok("an unreadable one says so too", isReadable("rubbish") === false,
  "which is what lets a screen say 'the password needs entering again' instead of crashing");

/* ================================================== comparing secrets == */

ok("two identical secrets compare equal", sameSecret("abc", "abc") === true);
ok("two different ones do not", sameSecret("abc", "abd") === false);
ok("different lengths do not", sameSecret("abc", "abcd") === false);
ok("empty compares to empty", sameSecret("", "") === true);

/* ==================================================== how it is written = */

const src = prose("src/lib/secrets.ts");
ok("the file says why this is encrypted rather than hashed",
  /has to present the real thing to the mail server/.test(src));
ok("and is honest about what it does not protect against",
  /anybody holding both the database AND the environment can read these values/.test(src));
ok("and what it does protect against",
  /a database dump, a backup file, a support export/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
