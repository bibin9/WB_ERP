/**
 * Import the shipped `src/lib` modules from a test.
 *
 * Node's `--experimental-strip-types` resolves a relative import literally, so
 * `from "./hrpolicy"` fails where TypeScript would have found `hrpolicy.ts`.
 * Every suite used to carry its own copy of the workaround, which was fine
 * while one module imported another and stopped being fine when four did.
 *
 * This writes a temporary copy of each module with the extensions filled in,
 * imports them, and deletes the copies — so the code under test is the code
 * that ships, byte for byte apart from the import specifiers.
 */
import fs from "node:fs";

/**
 * Every lib module `name` reaches, including itself.
 *
 * A suite used to have to list the whole dependency chain by hand, and the
 * listing went stale the moment a module gained an import: the suite that
 * added it passed, and an unrelated suite that loaded the same module died
 * with "Cannot find module '.returns.shim.ts'" — a message that names neither
 * the suite at fault nor the import that caused it.
 *
 * The chain is read from the source instead. Only names that exist as
 * `src/lib/<dep>.ts` are followed, so a relative import of anything else is
 * left alone, and `seen` makes a cycle terminate rather than recurse.
 */
function reachedBy(name, seen) {
  if (seen.has(name)) return seen;
  seen.add(name);
  const src = fs.readFileSync(`src/lib/${name}.ts`, "utf8");
  for (const [, dep] of src.matchAll(/from "\.\/([a-zA-Z0-9-]+)"/g)) {
    if (fs.existsSync(`src/lib/${dep}.ts`)) reachedBy(dep, seen);
  }
  return seen;
}

/**
 * @param names lib module names, without extension. Order does not matter, and
 *              anything they import is pulled in automatically.
 * @returns the imported modules, keyed by name.
 */
export async function importLibs(requested) {
  const seen = new Set();
  for (const name of requested) reachedBy(name, seen);
  const names = [...seen];

  const written = [];
  try {
    for (const name of names) {
      const path = `src/lib/.${name}.shim.ts`;
      fs.writeFileSync(
        path,
        fs
          .readFileSync(`src/lib/${name}.ts`, "utf8")
          // posting.ts and friends are server-only; the marker is not something
          // a plain node import can satisfy, and nothing in it is under test.
          .replace(/^import "server-only";.*$/m, "")
          .replace(/from "\.\/([a-zA-Z-]+)"/g, (_m, dep) => `from "./.${dep}.shim.ts"`)
          // Node resolves a package subpath literally too, so `next/headers`
          // has to become `next/headers.js`. The framework module still throws
          // when it is called outside a request — which is the behaviour under
          // test, not something to stub away.
          .replace(/from "next\/([a-zA-Z-]+)"/g, (_m, sub) => `from "next/${sub}.js"`)
      );
      written.push(path);
    }
    const out = {};
    for (const name of names) out[name] = await import(`../src/lib/.${name}.shim.ts`);
    return out;
  } finally {
    for (const f of written) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* already gone */
      }
    }
  }
}
