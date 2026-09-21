/**
 * Applying a built-in role's default permissions without undoing the
 * administrator's changes.
 *
 * The seed runs on every boot. It used to write each built-in role's
 * permissions and approval level straight from the defaults, every time — so
 * a screen an administrator took away from the Storekeeper in Access Control
 * came back on the next deploy, and a raised approval level fell back. Nothing
 * said so.
 *
 * Now each role remembers which default (screen, action) pairs have already
 * been applied, in `seededPermissions`. A pair is applied once: if an
 * administrator later removes it, it stays removed. A pair the seed has never
 * applied — a screen added to the system since, or an action added to a
 * role's defaults — is added, because nobody has had the chance to decide
 * against it yet.
 *
 * And the other way: a pair the seed applied that is no longer a default is
 * withdrawn. Adding alone could never take anything back, so when the
 * September 2026 access review narrowed the roles — a Site Engineer could read
 * every salary — the old grants would have stayed on every role that already
 * had them. What an administrator granted by hand was never applied by the
 * seed, so it is not touched. An install from before `seededPermissions`
 * existed has an empty record; its permissions were rewritten by the old seed
 * on every boot, so they are all the seed's, and are compared as such.
 *
 * Pure: no database, so it is tested on its own.
 */

const parse = (json) => {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

/**
 * @param {string} storedJson    the role's current permissions
 * @param {string} seededJson    what the seed has applied before
 * @param {Record<string,string[]>} defaults  the role's default permissions, per screen
 * @returns {{ permissions: string, seeded: string, added: string[], removed: string[] }}
 */
export function mergeRoleDefaults(storedJson, seededJson, defaults) {
  const perms = parse(storedJson);
  const seeded = parse(seededJson);
  const added = [];
  const removed = [];

  // Withdraw first: what the seed granted and no longer grants.
  const legacy = Object.keys(seeded).length === 0;
  const applied = legacy ? parse(storedJson) : seeded;
  for (const [screen, actions] of Object.entries(applied)) {
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if ((defaults[screen] ?? []).includes(action)) continue;
      if (Array.isArray(perms[screen]) && perms[screen].includes(action)) {
        perms[screen] = perms[screen].filter((a) => a !== action);
        removed.push(`${screen}.${action}`);
      }
      if (Array.isArray(seeded[screen])) seeded[screen] = seeded[screen].filter((a) => a !== action);
    }
    // An action an administrator added still needs the screen to be visible.
    if (Array.isArray(perms[screen])) {
      if (perms[screen].length === 0) delete perms[screen];
      else if (!perms[screen].includes("view")) perms[screen] = ["view", ...perms[screen]];
    }
    if (Array.isArray(seeded[screen]) && seeded[screen].length === 0) delete seeded[screen];
  }

  for (const [screen, actions] of Object.entries(defaults)) {
    for (const action of actions) {
      const already = Array.isArray(seeded[screen]) && seeded[screen].includes(action);
      if (already) continue;
      const have = new Set(Array.isArray(perms[screen]) ? perms[screen] : []);
      if (!have.has(action)) {
        have.add(action);
        // Any action implies view, as Access Control itself enforces.
        have.add("view");
        added.push(`${screen}.${action}`);
      }
      perms[screen] = [...have];
      seeded[screen] = [...new Set([...(Array.isArray(seeded[screen]) ? seeded[screen] : []), action])];
    }
  }

  return { permissions: JSON.stringify(perms), seeded: JSON.stringify(seeded), added, removed };
}
