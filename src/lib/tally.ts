import "server-only";

/**
 * Tally (TallyPrime / Tally.ERP 9) connector — talks to Tally's built-in
 * XML-over-HTTP gateway. Requires Tally running with "Enable HTTP" on
 * (Gateway of Tally → F1 → Advanced/Connectivity), reachable on host:port
 * (default 9000) from this server.
 */

/** POST an XML request to Tally and return the raw XML response. Fails fast if unreachable. */
export async function tallyRequest(host: string, port: number, xml: string, timeoutMs = 8000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${host}:${port}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml;charset=utf-8" },
      body: xml,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Tally returned HTTP ${res.status}`);
    return await res.text();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted")) throw new Error("Timed out — is Tally running with HTTP enabled on that host/port?");
    throw new Error(`Could not reach Tally: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal "are you there" request — lists the open companies in Tally. */
export function companyListXml(): string {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="List of Companies" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}

/** Request to export all ledgers (name, parent group, opening balance) from a Tally company. */
export function ledgersExportXml(tallyCompany: string): string {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerCollection</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${escapeXml(tallyCompany)}</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="LedgerCollection" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>Name, Parent, OpeningBalance</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function unescapeXml(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#4;/g, "").trim();
}

export type TallyLedger = { name: string; parent: string; openingBalance: number };

/** Parse the ledger-collection XML Tally returns into structured rows (no XML lib needed). */
export function parseLedgers(xml: string): TallyLedger[] {
  const out: TallyLedger[] = [];
  const blocks = xml.match(/<LEDGER[\s>][\s\S]*?<\/LEDGER>/gi) || [];
  for (const b of blocks) {
    const nameAttr = b.match(/<LEDGER[^>]*NAME="([^"]*)"/i)?.[1];
    const name = unescapeXml(nameAttr ?? b.match(/<NAME>([\s\S]*?)<\/NAME>/i)?.[1] ?? "");
    if (!name) continue;
    const parent = unescapeXml(b.match(/<PARENT>([\s\S]*?)<\/PARENT>/i)?.[1] ?? "");
    const ob = parseFloat((b.match(/<OPENINGBALANCE>([\s\S]*?)<\/OPENINGBALANCE>/i)?.[1] ?? "0").replace(/[^0-9.\-]/g, "")) || 0;
    out.push({ name, parent, openingBalance: ob });
  }
  return out;
}

/** Map a Tally group/parent name to our account type. */
export function mapGroupToType(parent: string): string {
  const p = parent.toLowerCase();
  if (/(sundry creditor|current liabilit|duties|provision|loan.*(liab)|bank o\/?d|outstanding)/.test(p)) return "Liability";
  if (/(capital|reserve|surplus|equity)/.test(p)) return "Equity";
  if (/(sales|direct income|indirect income|income)/.test(p)) return "Income";
  if (/(purchase|direct expense|indirect expense|expense)/.test(p)) return "Expense";
  if (/(asset|debtor|cash|bank|stock|deposit|advance|investment)/.test(p)) return "Asset";
  return "Asset";
}

/** Extract open company names from the company-list XML. */
export function parseCompanyNames(xml: string): string[] {
  const names = [...xml.matchAll(/<NAME>([\s\S]*?)<\/NAME>/gi)].map((m) => unescapeXml(m[1])).filter(Boolean);
  return Array.from(new Set(names));
}
