/**
 * The nationality picker, and the MOL Person ID label.
 *
 * The rule worth holding: somebody typing "Philippines" is looking for
 * "Filipino". A plain list of demonyms cannot answer that, which is why this
 * field is not the datalist the other master-data fields use. Free text still
 * has to work — a list of nationalities is never complete enough to argue with
 * somebody's passport.
 */
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const { countries } = await importLibs(["countries"]);
const { COUNTRIES, COMMON_NATIONALITIES, searchCountries } = countries;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const read = (p) => fs.readFileSync(p, "utf8");
const names = (list) => list.map((c) => c.nationality);

/* ===================== the list itself ================================== */

ok("the list is substantial", COUNTRIES.length > 100, `${COUNTRIES.length} countries`);
ok("every entry has both a country and a nationality",
  COUNTRIES.every((c) => c.country.trim() && c.nationality.trim()));
ok("no country appears twice",
  new Set(COUNTRIES.map((c) => `${c.country}|${c.nationality}`)).size === COUNTRIES.length);
ok("every commonly hired nationality is in the list",
  COMMON_NATIONALITIES.every((n) => COUNTRIES.some((c) => c.nationality === n)),
  COMMON_NATIONALITIES.filter((n) => !COUNTRIES.some((c) => c.nationality === n)).join(", ") || "all present");
ok("the UAE is there, under the word people use", COUNTRIES.some((c) => c.nationality === "Emirati"));

/* ===================== searching by country ============================= */

// The whole reason this is not a datalist.
for (const [typed, expected] of [
  ["Philippines", "Filipino"],
  ["philippines", "Filipino"],
  ["United Arab", "Emirati"],
  ["Nepal", "Nepali"],
  ["Bangladesh", "Bangladeshi"],
  ["Sri Lanka", "Sri Lankan"],
  ["Egypt", "Egyptian"],
  ["United Kingdom", "British"],
  ["Netherlands", "Dutch"],
  ["Myanmar", "Burmese"],
]) {
  const hits = names(searchCountries(typed));
  ok(`typing "${typed}" offers ${expected}`, hits.includes(expected), hits.slice(0, 4).join(", ") || "nothing");
}

/* ===================== searching by nationality ========================= */

for (const typed of ["Filipino", "Indian", "Emirati", "Pakistani", "British"]) {
  ok(`typing "${typed}" still finds itself`, names(searchCountries(typed)).includes(typed));
}
ok("a partial word works", names(searchCountries("fil")).includes("Filipino"));
ok("case does not matter", names(searchCountries("FILIPINO")).includes("Filipino"));
ok("surrounding spaces do not matter", names(searchCountries("  indian  ")).includes("Indian"));

/* ===================== the order it offers them ========================= */
{
  // "ind" must not put Sudan above India just because it contains the letters.
  const hits = names(searchCountries("ind"));
  ok("a word beginning with what was typed comes first", hits[0] === "Indian", hits.slice(0, 3).join(", "));
  ok("but a buried match is still offered", hits.includes("Indonesian"), hits.join(", "));

  const exact = names(searchCountries("Chad"));
  ok("an exact match wins outright", exact[0] === "Chadian", exact.slice(0, 3).join(", "));
}
{
  const empty = names(searchCountries(""));
  ok("an empty box suggests the ones actually hired here", empty.length > 0 && empty.includes("Emirati"),
    empty.slice(0, 5).join(", "));
  ok("and does not dump the whole world into the list", empty.length <= 20, `${empty.length}`);
}
ok("nonsense offers nothing rather than everything", searchCountries("zzqq").length === 0);
ok("the list is bounded, so a broad search cannot render 200 rows",
  searchCountries("a").length <= 20, `${searchCountries("a").length}`);

/* ===================== a company's own list ============================= */
{
  const extras = ["Kosovar", "Filipino"];
  const hits = searchCountries("", extras);
  ok("a nationality an admin added on Master Data is offered first",
    hits[0]?.nationality === "Kosovar", names(hits).slice(0, 3).join(", "));
  ok("and one that duplicates the built-in list is not shown twice",
    names(searchCountries("", extras)).filter((n) => n === "Filipino").length === 1);
  ok("a custom one is searchable", names(searchCountries("koso", extras)).includes("Kosovar"));
}

/* ===================== how it is wired in =============================== */
{
  const input = read("src/components/NationalityInput.tsx");
  ok("it is a plain text input underneath, so anything can still be typed",
    /<input/.test(input) && /value=\{value\}/.test(input));
  ok("choosing with the keyboard does not submit the form",
    /e\.key === "Enter"[\s\S]{0,200}?e\.preventDefault\(\)/.test(input),
    "otherwise picking a nationality saves the whole profile");
  ok("the list closes on Escape", /e\.key === "Escape"/.test(input));
  ok("and a click on an option lands before the list closes",
    /blurTimer/.test(input), "blur fires before click, so closing is deferred");
  ok("it is reachable by screen reader", /role="combobox"/.test(input) && /role="listbox"/.test(input) && /role="option"/.test(input));

  const profile = read("src/app/(app)/hr/employees/[id]/page.tsx");
  ok("the employee profile uses it", /<NationalityInput/.test(profile));
  ok("and passes the company's own nationalities", /extras=\{ownNationalities\}/.test(profile));
  ok("which come from Master Data", /type: "Nationality"/.test(profile));

  // "Labour Card No" is the MOL Person ID — the number WPS and MOHRE use.
  ok("the profile calls it MOL Person ID", /label="MOL Person ID"/.test(profile));
  ok("and no longer calls it a labour card number", !/label="Labour Card No/.test(profile));
  ok("the field behind it is unchanged, so nothing had to migrate",
    /name="labourCardNo"/.test(profile));

  // The card's expiry keeps its own name: it is the work permit that expires,
  // not the person's identifier.
  ok("the card expiry is still called a labour card expiry",
    /label="Labour Card expiry"/.test(profile));

  ok("the export column is named the same way",
    /header: "MOL Person ID"/.test(read("src/app/(app)/export/actions.ts")));
  ok("so is the WPS complaint when it is missing",
    /"no MOL Person ID"/.test(read("src/app/(app)/hr/payroll/actions.ts")));
  ok("and the employee search hint", /MOL Person ID/.test(read("src/app/(app)/hr/page.tsx")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
