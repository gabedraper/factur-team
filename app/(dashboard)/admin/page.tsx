import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Users, BookOpen, Map, Award } from "lucide-react";

export default async function AdminDashboard() {
  const supabase = await createClient();

  const [
    { count: userCount },
    { count: courseCount },
    { count: pathCount },
    { count: certCount },
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("courses").select("*", { count: "exact", head: true }),
    supabase.from("learning_paths").select("*", { count: "exact", head: true }),
    supabase.from("certificates").select("*", { count: "exact", head: true }),
  ]);

  const stats = [
    {
      title: "Total Users",
      value: userCount ?? 0,
      description: "Registered accounts",
      icon: <Users className="h-5 w-5 text-blue-600" />,
      bg: "bg-blue-50",
    },
    {
      title: "Courses",
      value: courseCount ?? 0,
      description: "Created courses",
      icon: <BookOpen className="h-5 w-5 text-green-600" />,
      bg: "bg-green-50",
    },
    {
      title: "Learning Paths",
      value: pathCount ?? 0,
      description: "Defined paths",
      icon: <Map className="h-5 w-5 text-purple-600" />,
      bg: "bg-purple-50",
    },
    {
      title: "Certificates Issued",
      value: certCount ?? 0,
      description: "Completions",
      icon: <Award className="h-5 w-5 text-yellow-600" />,
      bg: "bg-yellow-50",
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your LMS</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <div className={`${stat.bg} p-2 rounded-md`}>{stat.icon}</div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stat.value}</div>
              <CardDescription>{stat.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
