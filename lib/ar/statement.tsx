// Rendered on the server by renderToStream in the statement route, so this
// must not carry "use client" -- the server cannot call a client function, and
// under Turbopack the PDF simply fails to render rather than warning.
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";

export type StatementLine = {
  /*
   * What we are owed, against the two ways a client can be in credit: a memo we
   * issued, and a payment they sent that is not yet applied to anything. Kept
   * apart because a client checking the statement looks for the one they
   * remember.
   */
  kind: "invoice" | "credit" | "payment";
  ref: string;
  txn_date: string | null;
  due_date: string | null;
  original: number;
  /** Positive on an invoice, negative on a credit, so the column simply adds. */
  balance: number;
  age_days: number | null;
  pay_link: string | null;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

const shortDate = new Intl.DateTimeFormat("en-US", {
  day: "2-digit", month: "short", year: "numeric",
});

const on = (iso: string | null) =>
  iso ? shortDate.format(new Date(`${iso}T00:00:00`)) : "—";

/**
 * The five columns the A/R ageing report uses, so a client querying the
 * statement and Breno reading the board are looking at the same arithmetic.
 * Each invoice sits in exactly one bucket -- these are not cumulative.
 *
 * Credits stand apart rather than being netted into the newest column. An
 * unapplied payment has no due date and so no age, and folding it into
 * "Current" produces the worst possible line: a client with a five thousand
 * dollar invoice not yet due and a separate four and a half thousand credit
 * would read "Current $500", which is true of nothing.
 */
export function buckets(lines: StatementLine[]) {
  const b = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91: 0, credits: 0 };
  for (const l of lines) {
    if (l.kind !== "invoice") {
      b.credits += l.balance;
      continue;
    }
    const a = l.age_days ?? 0;
    if (a <= 0) b.current += l.balance;
    else if (a <= 30) b.d1_30 += l.balance;
    else if (a <= 60) b.d31_60 += l.balance;
    else if (a <= 90) b.d61_90 += l.balance;
    else b.d91 += l.balance;
  }
  return b;
}

const s = StyleSheet.create({
  page: { padding: 44, fontFamily: "Helvetica", fontSize: 9.5, color: "#1a1a1a" },

  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  logo: { width: 128, height: 40, objectFit: "contain" },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", textAlign: "right" },
  meta: { fontSize: 9, color: "#5a5a5a", textAlign: "right", marginTop: 3 },

  client: { marginTop: 26 },
  clientLabel: { fontSize: 8, color: "#5a5a5a", letterSpacing: 1, textTransform: "uppercase" },
  clientName: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 3 },

  table: { marginTop: 22, borderTop: "1px solid #cfd4da" },
  row: { flexDirection: "row", borderBottom: "1px solid #e6e9ed", paddingVertical: 6 },
  headRow: {
    flexDirection: "row", borderBottom: "1px solid #cfd4da",
    paddingVertical: 6, backgroundColor: "#f4f6f8",
  },
  th: { fontSize: 7.5, color: "#5a5a5a", letterSpacing: 0.8, textTransform: "uppercase" },

  cInv:  { width: "26%", paddingHorizontal: 6 },
  cDate: { width: "14%", paddingHorizontal: 6 },
  cDue:  { width: "14%", paddingHorizontal: 6 },
  cAge:  { width: "14%", paddingHorizontal: 6, textAlign: "right" },
  cAmt:  { width: "17%", paddingHorizontal: 6, textAlign: "right" },
  cBal:  { width: "17%", paddingHorizontal: 6, textAlign: "right" },

  late: { color: "#a3231c", fontFamily: "Helvetica-Bold" },
  credit: { color: "#1f6b45" },
  creditRef: { color: "#1f6b45", fontFamily: "Helvetica-Oblique" },

  totalRow: {
    flexDirection: "row", borderTop: "1px solid #cfd4da",
    paddingTop: 8, marginTop: 2,
  },
  totalLabel: { width: "83%", paddingHorizontal: 6, textAlign: "right", fontFamily: "Helvetica-Bold" },
  // Six ageing cells now that credits have their own.
  totalValue: { width: "17%", paddingHorizontal: 6, textAlign: "right", fontFamily: "Helvetica-Bold" },

  ageing: { marginTop: 26, borderTop: "1px solid #cfd4da", paddingTop: 10 },
  // The section heading needs its own weight, or it reads as a sixth column
  // label sitting on top of "Current".
  ageingHeading: {
    fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1,
    textTransform: "uppercase", marginBottom: 10,
  },
  ageingRow: { flexDirection: "row" },
  ageingCell: { width: "16.6%" },
  ageingLabel: { fontSize: 7.5, color: "#5a5a5a", letterSpacing: 0.8, textTransform: "uppercase" },
  ageingValue: { fontSize: 10, marginTop: 3 },

  foot: {
    position: "absolute", bottom: 32, left: 44, right: 44,
    fontSize: 8, color: "#7a7a7a", textAlign: "center",
  },
});

export function StatementDocument({
  clientName, lines, asAt, payLink, logo,
}: {
  clientName: string;
  lines: StatementLine[];
  asAt: string;
  payLink: string | null;
  /** The wordmark as raw bytes; absent falls back to the name set in type. */
  logo: Buffer | null;
}) {
  const total = lines.reduce((t, l) => t + l.balance, 0);
  const b = buckets(lines);

  const ageing: [string, number][] = [
    ["Current", b.current],
    ["1–30", b.d1_30],
    ["31–60", b.d31_60],
    ["61–90", b.d61_90],
    ["91+", b.d91],
    ...(b.credits !== 0 ? ([["Credits", b.credits]] as [string, number][]) : []),
  ];

  return (
    <Document title={`Statement — ${clientName}`}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          {logo
            ? <Image style={s.logo} src={logo} />
            : <Text style={{ fontSize: 15, fontFamily: "Helvetica-Bold" }}>Factur</Text>}
          <View>
            <Text style={s.title}>Statement of Account</Text>
            <Text style={s.meta}>As at {on(asAt)}</Text>
          </View>
        </View>

        <View style={s.client}>
          <Text style={s.clientLabel}>Account</Text>
          <Text style={s.clientName}>{clientName}</Text>
        </View>

        <View style={s.table}>
          <View style={s.headRow}>
            <Text style={[s.th, s.cInv]}>Invoice</Text>
            <Text style={[s.th, s.cDate]}>Date</Text>
            <Text style={[s.th, s.cDue]}>Due</Text>
            <Text style={[s.th, s.cAge]}>Days</Text>
            <Text style={[s.th, s.cAmt]}>Amount</Text>
            <Text style={[s.th, s.cBal]}>Balance</Text>
          </View>

          {lines.map((l) => {
            const isCredit = l.kind !== "invoice";
            const late = !isCredit && (l.age_days ?? 0) > 0;
            return (
              <View key={`${l.kind}-${l.ref}`} style={s.row} wrap={false}>
                <Text style={[s.cInv, ...(isCredit ? [s.creditRef] : [])]}>
                  {l.kind === "credit"
                    ? `Credit memo ${l.ref}`
                    : l.kind === "payment"
                      ? `Payment ${l.ref}`
                      : l.ref}
                </Text>
                <Text style={s.cDate}>{on(l.txn_date)}</Text>
                <Text style={s.cDue}>{on(l.due_date)}</Text>
                <Text style={[s.cAge, ...(late ? [s.late] : [])]}>
                  {late ? l.age_days : "—"}
                </Text>
                <Text style={s.cAmt}>{isCredit ? "—" : money.format(l.original)}</Text>
                <Text style={[s.cBal, ...(isCredit ? [s.credit] : [])]}>
                  {money.format(l.balance)}
                </Text>
              </View>
            );
          })}

          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Total outstanding</Text>
            <Text style={s.totalValue}>{money.format(total)}</Text>
          </View>
        </View>

        <View style={s.ageing}>
          <Text style={s.ageingHeading}>Ageing</Text>
          <View style={s.ageingRow}>
            {ageing.map(([label, value]) => (
              <View key={label} style={s.ageingCell}>
                <Text style={s.ageingLabel}>{label}</Text>
                <Text style={[
                  s.ageingValue,
                  ...(value > 0 && label !== "Current" ? [s.late] : []),
                  ...(label === "Credits" ? [s.credit] : []),
                ]}>
                  {money.format(value)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={s.foot} fixed>
          {payLink
            ? `Pay online: ${payLink}`
            : "Please contact accounts@facturmfg.com with any query on this statement."}
        </Text>
      </Page>
    </Document>
  );
}
