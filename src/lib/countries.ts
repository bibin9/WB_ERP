/**
 * Countries and the nationality word that goes with each.
 *
 * The employee profile asks for a nationality, and a nationality is what MOHRE,
 * a visa application and an insurance schedule all want. But people think in
 * countries: somebody typing "Philippines" means "Filipino", and a plain list
 * of demonyms leaves them scrolling. So each entry carries both, and the search
 * matches either.
 *
 * Free text is still accepted. A list like this is never complete enough to
 * refuse what somebody's passport actually says.
 */

export type Country = {
  /** The country, as people search for it. */
  country: string;
  /** The nationality, which is what gets stored. */
  nationality: string;
};

/** Nationalities common in a UAE workforce, offered first. */
export const COMMON_NATIONALITIES = [
  "Emirati", "Indian", "Pakistani", "Bangladeshi", "Filipino", "Nepali", "Sri Lankan",
  "Egyptian", "Syrian", "Jordanian", "Lebanese", "Sudanese", "British",
];

export const COUNTRIES: Country[] = [
  { country: "United Arab Emirates", nationality: "Emirati" },
  { country: "India", nationality: "Indian" },
  { country: "Pakistan", nationality: "Pakistani" },
  { country: "Bangladesh", nationality: "Bangladeshi" },
  { country: "Philippines", nationality: "Filipino" },
  { country: "Nepal", nationality: "Nepali" },
  { country: "Sri Lanka", nationality: "Sri Lankan" },
  { country: "Egypt", nationality: "Egyptian" },
  { country: "Syria", nationality: "Syrian" },
  { country: "Jordan", nationality: "Jordanian" },
  { country: "Lebanon", nationality: "Lebanese" },
  { country: "Sudan", nationality: "Sudanese" },
  { country: "Saudi Arabia", nationality: "Saudi" },
  { country: "Oman", nationality: "Omani" },
  { country: "Qatar", nationality: "Qatari" },
  { country: "Kuwait", nationality: "Kuwaiti" },
  { country: "Bahrain", nationality: "Bahraini" },
  { country: "Yemen", nationality: "Yemeni" },
  { country: "Iraq", nationality: "Iraqi" },
  { country: "Iran", nationality: "Iranian" },
  { country: "Palestine", nationality: "Palestinian" },
  { country: "United Kingdom", nationality: "British" },
  { country: "Ireland", nationality: "Irish" },
  { country: "United States", nationality: "American" },
  { country: "Canada", nationality: "Canadian" },
  { country: "Australia", nationality: "Australian" },
  { country: "New Zealand", nationality: "New Zealander" },
  { country: "South Africa", nationality: "South African" },
  { country: "Nigeria", nationality: "Nigerian" },
  { country: "Kenya", nationality: "Kenyan" },
  { country: "Uganda", nationality: "Ugandan" },
  { country: "Tanzania", nationality: "Tanzanian" },
  { country: "Ethiopia", nationality: "Ethiopian" },
  { country: "Ghana", nationality: "Ghanaian" },
  { country: "Cameroon", nationality: "Cameroonian" },
  { country: "Morocco", nationality: "Moroccan" },
  { country: "Algeria", nationality: "Algerian" },
  { country: "Tunisia", nationality: "Tunisian" },
  { country: "Libya", nationality: "Libyan" },
  { country: "Somalia", nationality: "Somali" },
  { country: "Eritrea", nationality: "Eritrean" },
  { country: "China", nationality: "Chinese" },
  { country: "Japan", nationality: "Japanese" },
  { country: "South Korea", nationality: "South Korean" },
  { country: "Indonesia", nationality: "Indonesian" },
  { country: "Malaysia", nationality: "Malaysian" },
  { country: "Singapore", nationality: "Singaporean" },
  { country: "Thailand", nationality: "Thai" },
  { country: "Vietnam", nationality: "Vietnamese" },
  { country: "Myanmar", nationality: "Burmese" },
  { country: "Cambodia", nationality: "Cambodian" },
  { country: "Afghanistan", nationality: "Afghan" },
  { country: "Bhutan", nationality: "Bhutanese" },
  { country: "Maldives", nationality: "Maldivian" },
  { country: "Kazakhstan", nationality: "Kazakh" },
  { country: "Uzbekistan", nationality: "Uzbek" },
  { country: "Turkmenistan", nationality: "Turkmen" },
  { country: "Kyrgyzstan", nationality: "Kyrgyz" },
  { country: "Tajikistan", nationality: "Tajik" },
  { country: "Azerbaijan", nationality: "Azerbaijani" },
  { country: "Armenia", nationality: "Armenian" },
  { country: "Georgia", nationality: "Georgian" },
  { country: "Turkey", nationality: "Turkish" },
  { country: "Russia", nationality: "Russian" },
  { country: "Ukraine", nationality: "Ukrainian" },
  { country: "Belarus", nationality: "Belarusian" },
  { country: "Moldova", nationality: "Moldovan" },
  { country: "Poland", nationality: "Polish" },
  { country: "Czech Republic", nationality: "Czech" },
  { country: "Slovakia", nationality: "Slovak" },
  { country: "Hungary", nationality: "Hungarian" },
  { country: "Romania", nationality: "Romanian" },
  { country: "Bulgaria", nationality: "Bulgarian" },
  { country: "Serbia", nationality: "Serbian" },
  { country: "Croatia", nationality: "Croatian" },
  { country: "Bosnia and Herzegovina", nationality: "Bosnian" },
  { country: "North Macedonia", nationality: "Macedonian" },
  { country: "Albania", nationality: "Albanian" },
  { country: "Greece", nationality: "Greek" },
  { country: "Cyprus", nationality: "Cypriot" },
  { country: "Italy", nationality: "Italian" },
  { country: "Spain", nationality: "Spanish" },
  { country: "Portugal", nationality: "Portuguese" },
  { country: "France", nationality: "French" },
  { country: "Germany", nationality: "German" },
  { country: "Netherlands", nationality: "Dutch" },
  { country: "Belgium", nationality: "Belgian" },
  { country: "Luxembourg", nationality: "Luxembourgish" },
  { country: "Switzerland", nationality: "Swiss" },
  { country: "Austria", nationality: "Austrian" },
  { country: "Denmark", nationality: "Danish" },
  { country: "Sweden", nationality: "Swedish" },
  { country: "Norway", nationality: "Norwegian" },
  { country: "Finland", nationality: "Finnish" },
  { country: "Iceland", nationality: "Icelandic" },
  { country: "Estonia", nationality: "Estonian" },
  { country: "Latvia", nationality: "Latvian" },
  { country: "Lithuania", nationality: "Lithuanian" },
  { country: "Brazil", nationality: "Brazilian" },
  { country: "Argentina", nationality: "Argentine" },
  { country: "Chile", nationality: "Chilean" },
  { country: "Colombia", nationality: "Colombian" },
  { country: "Peru", nationality: "Peruvian" },
  { country: "Venezuela", nationality: "Venezuelan" },
  { country: "Ecuador", nationality: "Ecuadorian" },
  { country: "Bolivia", nationality: "Bolivian" },
  { country: "Uruguay", nationality: "Uruguayan" },
  { country: "Paraguay", nationality: "Paraguayan" },
  { country: "Mexico", nationality: "Mexican" },
  { country: "Cuba", nationality: "Cuban" },
  { country: "Dominican Republic", nationality: "Dominican" },
  { country: "Jamaica", nationality: "Jamaican" },
  { country: "Trinidad and Tobago", nationality: "Trinidadian" },
  { country: "Senegal", nationality: "Senegalese" },
  { country: "Ivory Coast", nationality: "Ivorian" },
  { country: "Mali", nationality: "Malian" },
  { country: "Niger", nationality: "Nigerien" },
  { country: "Chad", nationality: "Chadian" },
  { country: "Zambia", nationality: "Zambian" },
  { country: "Zimbabwe", nationality: "Zimbabwean" },
  { country: "Malawi", nationality: "Malawian" },
  { country: "Mozambique", nationality: "Mozambican" },
  { country: "Rwanda", nationality: "Rwandan" },
  { country: "Burundi", nationality: "Burundian" },
  { country: "Madagascar", nationality: "Malagasy" },
  { country: "Mauritius", nationality: "Mauritian" },
  { country: "Seychelles", nationality: "Seychellois" },
  { country: "Comoros", nationality: "Comorian" },
  { country: "Djibouti", nationality: "Djiboutian" },
];

/** Search across both the country and the nationality, so either word finds it. */
export function searchCountries(query: string, extras: string[] = [], limit = 20): Country[] {
  // A company's own master-data list first — those are the ones it actually
  // hires — then anything else the world offers.
  const known = new Set(COUNTRIES.map((c) => c.nationality.toLowerCase()));
  const added: Country[] = extras
    .filter((e) => e.trim() && !known.has(e.trim().toLowerCase()))
    .map((e) => ({ country: e.trim(), nationality: e.trim() }));
  const all = [...COUNTRIES, ...added];

  const q = query.trim().toLowerCase();
  if (!q) {
    const common = COMMON_NATIONALITIES
      .map((n) => all.find((c) => c.nationality === n))
      .filter((c): c is Country => !!c);
    return [...added, ...common].slice(0, limit);
  }

  // A match at the start of a word beats one buried in the middle, so typing
  // "ind" offers India before Sudan.
  const score = (c: Country) => {
    const n = c.nationality.toLowerCase();
    const k = c.country.toLowerCase();
    if (n === q || k === q) return 0;
    if (n.startsWith(q) || k.startsWith(q)) return 1;
    if (n.includes(q) || k.includes(q)) return 2;
    return 99;
  };

  return all
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s || a.c.nationality.localeCompare(b.c.nationality))
    .slice(0, limit)
    .map((x) => x.c);
}
