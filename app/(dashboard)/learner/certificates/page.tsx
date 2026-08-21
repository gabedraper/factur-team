import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Award, Download } from "lucide-react";
import Link from "next/link";

export default async function CertificatesPage() {
  const supabase = await createClient();

  const user = await getAuthedUser();

  if (!user) return null;

  const { data: certificates } = await supabase
    .from("certificates")
    .select("*, courses(title, description)")
    .eq("user_id", user.id)
    .order("issued_at", { ascending: false });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">My Certificates</h1>
        <p className="text-muted-foreground mt-1">
          {certificates?.length ?? 0} certificate
          {(certificates?.length ?? 0) !== 1 ? "s" : ""} earned
        </p>
      </div>

      {certificates && certificates.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {certificates.map((cert) => {
            const course = cert.courses as {
              title: string;
              description: string | null;
            } | null;
            return (
              <Card
                key={cert.id}
                className="overflow-hidden border-2 border-yellow-200 bg-gradient-to-br from-yellow-50 to-white"
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <Award className="h-8 w-8 text-yellow-500" />
                    <Badge
                      variant="outline"
                      className="text-xs bg-white border-yellow-300"
                    >
                      Completed
                    </Badge>
                  </div>
                  <CardTitle className="text-lg mt-2">
                    {course?.title || "Unknown Course"}
                  </CardTitle>
                  {course?.description && (
                    <CardDescription className="line-clamp-2">
                      {course.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Certificate No.
                      </span>
                      <span className="font-mono text-xs">{cert.cert_number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Issued by</span>
                      <span>{cert.issuer_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date</span>
                      <span>
                        {new Date(cert.issued_at).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                  <Button asChild className="w-full mt-4" size="sm">
                    <a href={`/api/certificates/${cert.id}`} download>
                      <Download className="h-4 w-4 mr-2" />
                      Download PDF
                    </a>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Award className="h-16 w-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium mb-1">No certificates yet</p>
          <p className="text-sm mb-4">
            Complete a course to earn your first certificate
          </p>
          <Button asChild variant="outline">
            <Link href="/learner">Browse Courses</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
