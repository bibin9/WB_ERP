/**
 * Set a user's password directly in a database, for when nobody can sign in.
 *
 *   npm run user:password-sql
 *   npm run user:password-sql -- --email=someone@wandb.ae
 *   npm run user:password-sql -- --bat
 *
 * --bat sets one starting password on every business-acceptance tester login
 * (bat.<role>@wandb.ae) in a single statement, and leaves "must change at first
 * sign-in" on — so each tester replaces it with their own before doing
 * anything, and the four-eyes checks still prove something. The administrator
 * is never included.
 *
 * Asks for the new password twice, with the typing hidden, and prints one SQL
 * statement to run against the database in question — for Railway, in the
 * Postgres service's Database tab. It connects to nothing itself, so it cannot
 * touch the wrong environment: which database the statement goes into is
 * decided by where somebody pastes it.
 *
 * Written for Pre-Prod, whose administrator came across from production with a
 * password nobody had to hand, and was then locked by three attempts to guess
 * it. The statement also clears the lock and ends any existing sessions for
 * that user, and it hashes exactly as the app does (bcrypt, cost 10), so the
 * password works at the sign-in screen and can be changed there afterwards.
 *
 * The password never goes on the command line, where it would stay in shell
 * history, and is never printed. The hash it prints cannot be turned back into
 * the password.
 */
import bcrypt from "bcryptjs";
import readline from "node:readline";
import { passwordProblem } from "../src/lib/password-policy.ts";

const bat = process.argv.includes("--bat");
const email = ((process.argv.find((a) => a.startsWith("--email=")) ?? "").split("=")[1] || "admin@wandb.ae")
  .trim()
  .toLowerCase();
/** Who the statement is for, in words and in SQL. */
const who = bat ? "every BAT tester login (bat.…@wandb.ae)" : email;
const where = bat ? `email LIKE 'bat.%@wandb.ae'` : `email = '${email}'`;

/** Ask a question with the answer hidden when there is a terminal to hide it in. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (process.stdin.isTTY) {
      // Print the question, then swallow every echo of what is typed after it.
      let asked = false;
      rl._writeToOutput = (s) => {
        if (!asked) {
          process.stdout.write(s);
          asked = true;
        }
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (process.stdin.isTTY) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

// When input is piped rather than typed, read both answers from it in order.
async function answers() {
  if (process.stdin.isTTY) {
    const first = await askHidden(`New password for ${who} (hidden as you type): `);
    const second = await askHidden("Type it again: ");
    return [first, second];
  }
  const lines = [];
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) lines.push(line);
  return [lines[0] ?? "", lines[1] ?? ""];
}

const [password, again] = await answers();

if (password !== again) {
  console.error("\nThe two did not match. Nothing was produced — run it again.\n");
  process.exit(1);
}
// The app's own rules: ten characters, not a common password, not the
// person's or the company's name. A password the sign-in screen would refuse
// to let anyone choose should not be put in behind its back.
const weak = passwordProblem(password, bat ? {} : { email });
if (weak) {
  console.error(`\n${weak}\nNothing was produced.\n`);
  process.exit(1);
}
// Stricter again for an administrator, who can reach everything.
if (!bat && password.length < 12) {
  console.error("\nUse at least 12 characters for an administrator. Nothing was produced.\n");
  process.exit(1);
}
if (/'/.test(email)) {
  console.error("\nThat email address cannot be right. Nothing was produced.\n");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);

/*
 * Printed so that copying it cannot damage it.
 *
 * The first version printed the hash on one long line. A terminal wraps a long
 * line, and copying from a wrapped terminal can put a real line break into the
 * text — which landed inside the hash. A bcrypt hash with a line break in it
 * matches no password at all, so the administrator was locked out by the very
 * statement meant to let them in, and every careful retype failed.
 *
 * Two defences, because either alone can fail. The hash is split into short
 * pieces joined in SQL, so no line is long enough to wrap. And the database
 * strips whitespace from the joined result before storing it: a bcrypt hash
 * never contains any, so removing it can only repair, never change, the hash.
 */
const pieces = hash.match(/.{1,20}/g).map((c) => `      '${c}'`).join(" ||\n");

const statement = `UPDATE "User"
   SET "passwordHash" = regexp_replace(
${pieces},
      '\\s', '', 'g'),
       "failedAttempts" = 0,
       "lockedUntil" = NULL,
       "mustReset" = ${bat ? "true" : "false"},
       "passwordChangedAt" = NOW()
 WHERE ${where};`;

const check = `SELECT email,
       CASE WHEN "passwordHash" ~ '^\\$2[aby]\\$10\\$[./A-Za-z0-9]{53}$'
            THEN 'hash intact' ELSE 'hash damaged' END AS result,
       "failedAttempts", "lockedUntil", "mustReset"
  FROM "User"
 WHERE ${where}
 ORDER BY email;`;

// Also into a file, opened in Notepad on Windows: copying from Notepad does not
// add line breaks the way copying from a terminal can.
const { writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { tmpdir } = await import("node:os");
const file = join(tmpdir(), "set-password.sql");
writeFileSync(
  file,
  `-- 1. Run this first\n${statement}\n\n-- 2. Then run this. It must say: hash intact\n${check}\n`,
);
let opened = false;
// Only for a person at a terminal — a piped run (a test) must not pop windows up.
if (process.platform === "win32" && process.stdin.isTTY) {
  try {
    const { spawn } = await import("node:child_process");
    spawn("notepad.exe", [file], { detached: true, stdio: "ignore" }).unref();
    opened = true;
  } catch {
    /* printed below either way */
  }
}

console.log(`
${opened ? `Opened in Notepad: ${file}\nCopy from Notepad rather than from this window.\n` : `Also saved to: ${file}\n`}
Run these against the database you mean — for Pre-Prod, in Railway:
Pre-Prod -> Postgres -> Database -> Data, in the query box.
They set the password for ${who}.

-- 1. Run this first
${statement}

-- 2. Then run this. It must say: hash intact
${check}

When it says "hash intact"${bat ? " on every row (11 for the BAT logins)" : ""}, sign in with the password you just typed.${bat ? "\nEach tester is asked to choose their own password straight after signing in." : ""}
Setting passwordChangedAt also signs out anyone already signed in as ${bat ? "those users" : email}.
`);
