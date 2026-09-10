// Rendered on the server by renderToStream in the statement route, so this
// must not carry "use client" -- the server cannot call a client function, and
// under Turbopack the PDF simply fails to render rather than warning.
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export type StatementLine = {
  invoice_no: string;
  txn_date: string | null;
  due_date: string | null;
  original: number;
  balance: number;
  age_days: number;
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
 */
export function buckets(lines: StatementLine[]) {
  const b = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91: 0 };
  for (const l of lines) {
    const a = l.age_days;
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
  brand: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
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

  cInv:  { width: "18%", paddingHorizontal: 6 },
  cDate: { width: "17%", paddingHorizontal: 6 },
  cDue:  { width: "17%", paddingHorizontal: 6 },
  cAge:  { width: "14%", paddingHorizontal: 6, textAlign: "right" },
  cAmt:  { width: "17%", paddingHorizontal: 6, textAlign: "right" },
  cBal:  { width: "17%", paddingHorizontal: 6, textAlign: "right" },

  late: { color: "#a3231c", fontFamily: "Helvetica-Bold" },

  totalRow: {
    flexDirection: "row", borderTop: "1px solid #cfd4da",
    paddingTop: 8, marginTop: 2,
  },
  totalLabel: { width: "83%", paddingHorizontal: 6, textAlign: "right", fontFamily: "Helvetica-Bold" },
  totalValue: { width: "17%", paddingHorizontal: 6, textAlign: "right", fontFamily: "Helvetica-Bold" },

  ageing: { marginTop: 26, borderTop: "1px solid #cfd4da", paddingTop: 10 },
  // The section heading needs its own weight, or it reads as a sixth column
  // label sitting on top of "Current".
  ageingHeading: {
    fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1,
    textTransform: "uppercase", marginBottom: 10,
  },
  ageingRow: { flexDirection: "row" },
  ageingCell: { width: "20%" },
  ageingLabel: { fontSize: 7.5, color: "#5a5a5a", letterSpacing: 0.8, textTransform: "uppercase" },
  ageingValue: { fontSize: 10, marginTop: 3 },

  foot: {
    position: "absolute", bottom: 32, left: 44, right: 44,
    fontSize: 8, color: "#7a7a7a", textAlign: "center",
  },
});

export function StatementDocument({
  clientName, lines, asAt, payLink,
}: {
  clientName: string;
  lines: StatementLine[];
  asAt: string;
  payLink: string | null;
}) {
  const total = lines.reduce((t, l) => t + l.balance, 0);
  const b = buckets(lines);

  const ageing: [string, number][] = [
    ["Current", b.current],
    ["1–30", b.d1_30],
    ["31–60", b.d31_60],
    ["61–90", b.d61_90],
    ["91+", b.d91],
  ];

  return (
    <Document title={`Statement — ${clientName}`}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <Text style={s.brand}>Factur</Text>
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

          {lines.map((l) => (
            <View key={l.invoice_no} style={s.row} wrap={false}>
              <Text style={s.cInv}>{l.invoice_no}</Text>
              <Text style={s.cDate}>{on(l.txn_date)}</Text>
              <Text style={s.cDue}>{on(l.due_date)}</Text>
              <Text style={[s.cAge, ...(l.age_days > 0 ? [s.late] : [])]}>
                {l.age_days > 0 ? l.age_days : "—"}
              </Text>
              <Text style={s.cAmt}>{money.format(l.original)}</Text>
              <Text style={s.cBal}>{money.format(l.balance)}</Text>
            </View>
          ))}

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
                <Text style={[s.ageingValue, ...(value > 0 && label !== "Current" ? [s.late] : [])]}>
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
