import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * QUERY_LOG_FILE, when set, writes every query and how long it took to that
 * file, one JSON line each. It is for scripts/profile-pages.mjs, which reads
 * the file to see what each screen asks of the database. Never set it on a
 * deployed environment: the file grows with every query.
 */
const queryLog = process.env.QUERY_LOG_FILE;

function create(): PrismaClient {
  if (!queryLog) return new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }, "error"] });
  // Not an import: this file is also bundled for the edge runtime, which has
  // no file system, and only a Node server with the variable set gets here.
  const { appendFileSync } = (process as unknown as { getBuiltinModule(id: string): typeof import("node:fs") }).getBuiltinModule("node:fs");
  client.$on("query", (e) => {
    appendFileSync(queryLog as string, JSON.stringify({ at: Date.now(), ms: e.duration, query: e.query, params: e.params }) + "\n");
  });
  return client as unknown as PrismaClient;
}

export const db = globalForPrisma.prisma ?? create();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
