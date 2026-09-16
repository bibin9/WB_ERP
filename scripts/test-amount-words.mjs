/**
 * Amounts in words, as they go under the total on a UAE document.
 *
 * Checked against the cases that go wrong: teens, hyphenated tens, gaps inside
 * a number (a million and five), the fils, and floating-point noise that turns
 * eighteen fils into seventeen.
 */
import { importLibs } from "./lib-shim.mjs";
const { "amount-words": w } = await importLibs(["amount-words"]);
const { amountInWords, wholeInWords } = w;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const eq = (name, got, want) => ok(name, got === want, got === want ? "" : `got "${got}", wanted "${want}"`);

eq("nought", wholeInWords(0), "Zero");
eq("a teen", wholeInWords(13), "Thirteen");
eq("hyphenated tens", wholeInWords(42), "Forty-Two");
eq("a round ten has no hyphen", wholeInWords(70), "Seventy");
eq("hundreds", wholeInWords(305), "Three Hundred Five");
eq("a gap inside a million", wholeInWords(1000005), "One Million Five");
eq("an empty thousands group is skipped", wholeInWords(2000300), "Two Million Three Hundred");
eq("the quotation total from the test data", amountInWords(1726149.18),
  "UAE Dirhams One Million Seven Hundred Twenty-Six Thousand One Hundred Forty-Nine and Eighteen Fils Only");
eq("no fils says none", amountInWords(500), "UAE Dirhams Five Hundred Only");
eq("floating-point noise does not lose a fils", amountInWords(0.1 + 0.08), "UAE Dirhams Zero and Eighteen Fils Only");
eq("a credit note keeps its sign", amountInWords(-250.5), "Minus UAE Dirhams Two Hundred Fifty and Fifty Fils Only");
eq("another currency is named as itself", amountInWords(12.01, "USD"), "USD Twelve and One Cents Only");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
