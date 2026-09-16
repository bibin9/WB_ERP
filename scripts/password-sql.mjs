/**
 * Set a user's password directly in a database, for when nobody can sign in.
 *
 *   npm run user:password-sql
 *   npm run user:password-sql -- --email=someone@wandb.ae
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

const email = ((process.argv.find((a) => a.startsWith("--email=")) ?? "").split("=")[1] || "admin@wandb.ae")
  .trim()
  .toLowerCase();

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
    const first = await askHidden(`New password for ${email} (hidden as you type): `);
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
// Stricter than the app's own six-character floor, because this is how an
// administrator account gets its password.
if (password.length < 12) {
  console.error("\nUse at least 12 characters for an administrator. Nothing was produced.\n");
  process.exit(1);
}
if (/'/.test(email)) {
  console.error("\nThat email address cannot be right. Nothing was produced.\n");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);

console.log(`
Run this against the database whose ${email} you mean — for Pre-Prod, in
Railway: Pre-Prod -> Postgres -> Database -> Data, in the query box.

UPDATE "User"
   SET "passwordHash"      = '${hash}',
       "failedAttempts"    = 0,
       "lockedUntil"       = NULL,
       "mustReset"         = false,
       "passwordChangedAt" = NOW()
 WHERE email = '${email}';

It should report 1 row updated. Then sign in with the password you just typed.
Setting passwordChangedAt also signs out anyone already signed in as ${email}.
`);
