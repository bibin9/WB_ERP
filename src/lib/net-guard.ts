/**
 * Where this server may be told to connect.
 *
 * The Tally connector posts to whatever host and port an administrator types.
 * On a cloud host that is a way into the host's own private network: point it
 * at the database's internal address, or the cloud's metadata service, and the
 * server makes the request on the attacker's behalf — the error message even
 * says whether something answered. So a destination must be a public host,
 * and what its name resolves to is checked again just before connecting,
 * because a name can be pointed somewhere private after it was saved.
 *
 * Pure, so it is tested directly (scripts/test-security-fixes.mjs).
 */

/** Whether an IPv4 or IPv6 address is private, local, or otherwise not the public internet. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) ||           // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224                              // multicast and reserved
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.includes(":")) {
    return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
  }
  return true; // not an address at all: refuse rather than guess
}

/** Why a host an administrator typed cannot be used, or null if it can. */
export function hostProblem(host: string): string | null {
  const h = host.trim().toLowerCase();
  if (!h) return "Enter the address of the computer running Tally.";
  if (!/^[a-z0-9.-]{1,253}$/.test(h) || h.startsWith("-") || h.includes("..")) {
    return "Enter just a host name or IP address — no http://, slashes, spaces or port.";
  }
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || !h.includes(".")) {
    return "That is an address inside the server's own network. Tally has to be reachable at a public address (for example through your office's static IP or a secure tunnel).";
  }
  if (/^[0-9.]+$/.test(h) && isPrivateAddress(h)) {
    return "That is a private or local address, which this server cannot be pointed at. Use Tally's public address.";
  }
  return null;
}

/** A port an administrator typed, or null if it is not one. */
export function cleanPort(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}
