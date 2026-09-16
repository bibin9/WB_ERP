/**
 * The pieces every printed document is built from.
 *
 * One letterhead, one title block, one table, one totals box, one set of
 * signature boxes — so a quotation, a purchase order and a goods received note
 * look like they came from the same company, and a change to the letterhead
 * reaches all of them at once. When the client's own templates arrive, this is
 * the file that changes; the documents themselves only say what goes where.
 *
 * Drawn with @react-pdf/renderer on the server, never in a browser, so the PDF
 * that is downloaded, printed and emailed is the same file every time.
 */
import React from "react";
import { Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";
import type { Letterhead } from "@/lib/document-settings";

// No hyphenation. The renderer breaks words to fit by default, which turned
// "Square metre" into "Square me-tre" in a unit column — on a commercial
// document a unit or a name is never broken across lines.
Font.registerHyphenationCallback((word) => [word]);

export const INK = "#1A1F2B";
export const MUTED = "#5B6472";
export const RULE = "#D9DEE5";
export const SHADE = "#F2F4F7";

const styles = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingBottom: 72,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
    lineHeight: 1.35,
  },
  label: { fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: MUTED },
  right: { textAlign: "right" },
});

export const money = (n: number) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const quantity = (n: number) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * 16 Sep 2026, in UAE time.
 *
 * Written out rather than left to the locale, which spells September "Sept" in
 * some versions and "Sep" in others — the same document must not change its
 * dates depending on which server printed it.
 */
export const date = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai", day: "2-digit", month: "numeric", year: "numeric",
  }).formatToParts(new Date(d));
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${get("day")} ${MONTHS[Number(get("month")) - 1]} ${get("year")}`;
};

/* ================================================================ page == */

/**
 * An A4 page with the letterhead at the top and the footer at the bottom of
 * every page, however many pages the content runs to.
 */
export function DocumentFile({
  lh,
  title,
  watermark,
  children,
}: {
  lh: Letterhead;
  /** Also the PDF's own title, which is what a PDF reader shows in its tab. */
  title: string;
  /** Across every page — DRAFT, SUPERSEDED. A document that must not be mistaken for the real one. */
  watermark?: string | null;
  children: React.ReactNode;
}) {
  return (
    <Document title={title} author={lh.companyName} creator="White & Bright Group ERP" producer="White & Bright Group ERP">
      <Page size="A4" style={styles.page} wrap>
        <LetterheadBand lh={lh} />
        {watermark ? (
          <Text
            fixed
            style={{
              position: "absolute",
              top: 360,
              left: 70,
              fontSize: 72,
              fontFamily: "Helvetica-Bold",
              color: "#C62828",
              opacity: 0.1,
              transform: "rotate(-32deg)",
            }}
          >
            {watermark}
          </Text>
        ) : null}
        {children}
        <FooterBand lh={lh} />
      </Page>
    </Document>
  );
}

function LetterheadBand({ lh }: { lh: Letterhead }) {
  // The client's own artwork, when they have supplied it, replaces the whole
  // generated band. Their letterhead is their decision, not ours.
  if (lh.headerImage) {
    return (
      <View fixed style={{ marginBottom: 14 }}>
        <Image src={lh.headerImage} style={{ width: "100%", maxHeight: 100, objectFit: "contain" }} />
      </View>
    );
  }
  return (
    <View
      fixed
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingBottom: 10,
        marginBottom: 14,
        borderBottomWidth: 2,
        borderBottomColor: lh.accent,
      }}
    >
      {lh.logo ? (
        <Image src={lh.logo} style={{ height: 42, maxWidth: 150, objectFit: "contain", marginRight: 14 }} />
      ) : null}
      <View style={{ flexGrow: 1 }}>
        {/* The name in a box of its own, as with the title: a larger line
            sharing a box with smaller ones was drawn over the address. */}
        <View style={{ marginBottom: 2 }}>
          <Text style={[styles.bold, { fontSize: 13, lineHeight: 1.2 }]}>{lh.companyName}</Text>
        </View>
        {lh.addressLine ? <Text style={styles.muted}>{lh.addressLine}</Text> : null}
        {lh.contact ? <Text style={styles.muted}>{lh.contact}</Text> : null}
      </View>
      {lh.trn ? <Text style={[styles.bold, { color: lh.accent }]}>{lh.trn}</Text> : null}
    </View>
  );
}

/** A4 in points, and the band the footer occupies at the foot of every page. */
const A4_HEIGHT = 841.89;
const FOOTER_HEIGHT = 58;
const FOOTER_GAP = 14;

function FooterBand({ lh }: { lh: Letterhead }) {
  // Positioned from the top, and the page number kept out of the footer box.
  // A `bottom`-anchored box holding the page number, on a page with a line
  // height set, was drawn thousands of points off the sheet: the text was in
  // the file, so extracting it "found" the footer, and nothing showed on paper.
  // Inside a fixed-height box the page number was measured before its text
  // existed and left out altogether. scripts/test-documents.mjs checks where
  // both land.
  const top = A4_HEIGHT - FOOTER_GAP - FOOTER_HEIGHT;
  return (
    <>
      <View
        fixed
        style={{ position: "absolute", top, height: FOOTER_HEIGHT - 11, left: 40, right: 40, justifyContent: "flex-end" }}
      >
        {lh.footerImage ? (
          <Image src={lh.footerImage} style={{ width: "100%", maxHeight: 44, objectFit: "contain" }} />
        ) : (
          <View style={{ borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 5 }}>
            {lh.footerNote ? <Text style={[styles.muted, { fontSize: 7 }]}>{lh.footerNote}</Text> : null}
            <Text style={[styles.muted, { fontSize: 7 }]}>
              {[lh.companyName, lh.addressLine, lh.trn].filter(Boolean).join("  ·  ")}
            </Text>
          </View>
        )}
      </View>
      <Text
        fixed
        style={[styles.muted, { position: "absolute", top: A4_HEIGHT - FOOTER_GAP - 9, left: 40, right: 40, fontSize: 7, textAlign: "right" }]}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </>
  );
}

/* ============================================================== title == */

export function TitleBlock({
  lh,
  title,
  subtitle,
  meta,
}: {
  lh: Letterhead;
  title: string;
  subtitle?: string | null;
  /** Label and value pairs down the right: number, date, reference. */
  meta: [string, string][];
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 14 }}>
      <View style={{ maxWidth: "55%" }}>
        {/* Each line in its own box with its own line height: a large title
            sharing a box with small text was laid out over the text below it. */}
        <View>
          <Text style={[styles.bold, { fontSize: 18, lineHeight: 1.15, color: lh.accent, letterSpacing: 0.5 }]}>
            {title}
          </Text>
        </View>
        {subtitle ? (
          <View style={{ marginTop: 4 }}>
            <Text style={styles.muted}>{subtitle}</Text>
          </View>
        ) : null}
      </View>
      {/* A fixed share of the width, and values that wrap inside it: a long
          job name must not run off the right edge of the sheet. */}
      <View style={{ width: "44%" }}>
        {meta
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <View key={label} style={{ flexDirection: "row", marginBottom: 2 }}>
              <Text style={[styles.label, { width: 72, paddingTop: 1.5 }]}>{label}</Text>
              <Text style={[styles.bold, { flex: 1, textAlign: "right" }]}>{value}</Text>
            </View>
          ))}
      </View>
    </View>
  );
}

/* ============================================================ parties == */

/** A labelled box of address lines — To, Supplier, Deliver to. Blank lines are dropped. */
export function PartyBox({ label, lines }: { label: string; lines: (string | null | undefined)[] }) {
  const shown = lines.map((l) => String(l ?? "").trim()).filter(Boolean);
  return (
    <View style={{ flex: 1, borderWidth: 0.5, borderColor: RULE, padding: 8, marginRight: 8 }}>
      <Text style={[styles.label, { marginBottom: 3 }]}>{label}</Text>
      {shown.length ? (
        shown.map((l, i) => (
          <Text key={i} style={i === 0 ? styles.bold : undefined}>
            {l}
          </Text>
        ))
      ) : (
        <Text style={styles.muted}>—</Text>
      )}
    </View>
  );
}

export function PartyRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", marginBottom: 12, marginRight: -8 }}>{children}</View>;
}

/* ============================================================== table == */

export type Column<R> = {
  label: string;
  /** Proportion of the table's width. */
  flex: number;
  align?: "left" | "right" | "center";
  value: (row: R, index: number) => string;
};

export function ItemsTable<R>({ lh, columns, rows }: { lh: Letterhead; columns: Column<R>[]; rows: R[] }) {
  return (
    <View style={{ marginBottom: 10 }}>
      {/* Not `fixed`: in this renderer that repeats an element on every page of
          the document, including pages after the table has ended. */}
      <View style={{ flexDirection: "row", backgroundColor: SHADE, borderBottomWidth: 1, borderBottomColor: lh.accent }}>
        {columns.map((c) => (
          <Text
            key={c.label}
            style={[styles.label, { flex: c.flex, padding: 5, textAlign: c.align ?? "left", color: INK }]}
          >
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((row, i) => (
        // A row is never split across a page break — half a line on each page
        // is how a quantity gets read against the wrong description.
        <View
          key={i}
          wrap={false}
          style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE }}
        >
          {columns.map((c) => (
            <Text key={c.label} style={{ flex: c.flex, padding: 5, textAlign: c.align ?? "left" }}>
              {c.value(row, i)}
            </Text>
          ))}
        </View>
      ))}
      {rows.length === 0 ? <Text style={[styles.muted, { padding: 6 }]}>No lines.</Text> : null}
    </View>
  );
}

/* ============================================================= totals == */

export function TotalsBox({
  lh,
  rows,
  words,
}: {
  lh: Letterhead;
  /** Label, value, and whether it is the figure that matters. */
  rows: [string, string, boolean?][];
  words?: string | null;
}) {
  return (
    <View wrap={false} style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 12 }}>
      <View style={{ width: 250 }}>
        {rows.map(([label, value, strong]) => (
          <View
            key={label}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingVertical: 3,
              paddingHorizontal: 5,
              ...(strong ? { backgroundColor: SHADE, borderTopWidth: 1, borderTopColor: lh.accent } : {}),
            }}
          >
            <Text style={strong ? styles.bold : undefined}>{label}</Text>
            <Text style={strong ? styles.bold : undefined}>{value}</Text>
          </View>
        ))}
        {words ? <Text style={[styles.muted, { fontSize: 8, marginTop: 4, textAlign: "right" }]}>{words}</Text> : null}
      </View>
    </View>
  );
}

/* ============================================================== prose == */

export function TextSection({ heading, text }: { heading: string; text?: string | null }) {
  const body = String(text ?? "").trim();
  if (!body) return null;
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={[styles.label, { marginBottom: 3 }]}>{heading}</Text>
      <Text>{body}</Text>
    </View>
  );
}

/* ========================================================= signatures == */

export function Signatures({ boxes }: { boxes: { label: string; name?: string | null; note?: string | null }[] }) {
  return (
    <View wrap={false} style={{ flexDirection: "row", marginTop: 18, marginRight: -12 }}>
      {boxes.map((b) => (
        <View key={b.label} style={{ flex: 1, marginRight: 12 }}>
          <View style={{ height: 38, borderBottomWidth: 0.5, borderBottomColor: INK }} />
          <Text style={[styles.label, { marginTop: 3 }]}>{b.label}</Text>
          {b.name ? <Text style={styles.bold}>{b.name}</Text> : null}
          {b.note ? <Text style={[styles.muted, { fontSize: 7 }]}>{b.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function SmallPrint({ children }: { children: React.ReactNode }) {
  return <Text style={[styles.muted, { fontSize: 7.5, marginTop: 6, marginBottom: 8 }]}>{children}</Text>;
}
