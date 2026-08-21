import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Plus, Users } from "lucide-react";

export default async function InstructorDashboard() {
  const supabase = await createClient();

  const user = await getAuthedUser();

  const { data: courses } = await supabase
    .from("courses")
    .select("*")
    .eq("instructor_id", user?.id || "")
    .order("created_at", { ascending: false });

  const publishedCount = courses?.filter((c) => c.is_published).length ?? 0;
  const draftCount = courses?.filter((c) => !c.is_published).length ?? 0;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Instructor Dashboard</h1>
          <p className="text-muted-foreground mt-1">Manage your courses</p>
        </div>
        <Button asChild>
          <Link href="/instructor/courses/new">
            <Plus className="h-4 w-4 mr-2" />
            New Course
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Courses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{courses?.length ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Published
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{publishedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Drafts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600">{draftCount}</div>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-xl font-semibold mb-4">Recent Courses</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {courses && courses.length > 0 ? (
          courses.slice(0, 6).map((course) => (
            <Card key={course.id} className="overflow-hidden">
              <div
                className="h-32 bg-gradient-to-br from-blue-400 to-indigo-600"
                style={
                  course.thumbnail_url
                    ? { backgroundImage: `url(${course.thumbnail_url})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : {}
                }
              />
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base line-clamp-1">{course.title}</CardTitle>
                  <Badge variant={course.is_published ? "default" : "secondary"}>
                    {course.is_published ? "Published" : "Draft"}
                  </Badge>
                </div>
                {course.description && (
                  <CardDescription className="line-clamp-2">
                    {course.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <Button asChild size="sm" variant="outline" className="w-full">
                  <Link href={`/instructor/courses/${course.id}`}>Edit Course</Link>
                </Button>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="col-span-3 text-center py-12 text-muted-foreground">
            <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No courses yet.</p>
            <Button asChild className="mt-4">
              <Link href="/instructor/courses/new">Create your first course</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
