// Deliberately NOT a client component: this is rendered on the server by
// renderToStream in the certificate route. It carried "use client", which
// webpack tolerated and Turbopack does not -- the server cannot call a client
// function, so the PDF failed to render at all under Next 16.
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    padding: 60,
    fontFamily: "Helvetica",
  },
  border: {
    border: "3px solid #B8860B",
    padding: 40,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  innerBorder: {
    border: "1px solid #B8860B",
    padding: 30,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  lmsName: {
    fontSize: 13,
    color: "#B8860B",
    letterSpacing: 4,
    textTransform: "uppercase",
    marginBottom: 20,
  },
  heading: {
    fontSize: 36,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
    marginBottom: 8,
    letterSpacing: 2,
  },
  subheading: {
    fontSize: 12,
    color: "#666",
    marginBottom: 30,
    letterSpacing: 1,
  },
  certifies: {
    fontSize: 14,
    color: "#555",
    fontFamily: "Helvetica-Oblique",
    marginBottom: 16,
  },
  learnerName: {
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
    marginBottom: 16,
  },
  hasCompleted: {
    fontSize: 14,
    color: "#555",
    fontFamily: "Helvetica-Oblique",
    marginBottom: 12,
  },
  courseTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
    marginBottom: 30,
    textAlign: "center",
  },
  divider: {
    width: 200,
    height: 1,
    backgroundColor: "#B8860B",
    marginBottom: 24,
  },
  dateText: {
    fontSize: 12,
    color: "#777",
    marginBottom: 30,
  },
  footer: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginTop: 20,
  },
  issuerSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "40%",
  },
  signatureLine: {
    width: "100%",
    height: 1,
    backgroundColor: "#333",
    marginBottom: 6,
  },
  issuerLabel: {
    fontSize: 10,
    color: "#555",
  },
  issuerName: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#1a2744",
  },
  certNumber: {
    fontSize: 9,
    color: "#aaa",
    textAlign: "right",
  },
});

interface CertificateDocumentProps {
  learnerName: string;
  courseTitle: string;
  issuerName: string;
  certNumber: string;
  issuedAt: string;
  lmsName?: string;
}

export function CertificateDocument({
  learnerName,
  courseTitle,
  issuerName,
  certNumber,
  issuedAt,
  lmsName = "Team Learning Academy",
}: CertificateDocumentProps) {
  const formattedDate = new Date(issuedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.border}>
          <View style={styles.innerBorder}>
            <Text style={styles.lmsName}>{lmsName}</Text>
            <Text style={styles.heading}>Certificate of Completion</Text>
            <Text style={styles.subheading}>
              ✦ ✦ ✦
            </Text>
            <Text style={styles.certifies}>This certifies that</Text>
            <Text style={styles.learnerName}>{learnerName}</Text>
            <Text style={styles.hasCompleted}>
              has successfully completed the course
            </Text>
            <Text style={styles.courseTitle}>{courseTitle}</Text>
            <View style={styles.divider} />
            <Text style={styles.dateText}>Completed on {formattedDate}</Text>
            <View style={styles.footer}>
              <View style={styles.issuerSection}>
                <View style={styles.signatureLine} />
                <Text style={styles.issuerLabel}>Issued by</Text>
                <Text style={styles.issuerName}>{issuerName}</Text>
              </View>
              <Text style={styles.certNumber}>Certificate No: {certNumber}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
