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
 * @param names lib module names, without extension. Order does not matter;
 *              dependencies between them are rewritten to point at each other.
 * @returns the imported modules, keyed by name.
 */
export async function importLibs(names) {
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
