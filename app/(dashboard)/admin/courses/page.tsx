"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Plus, Search, BookMarked, Users, CheckCircle2, User } from "lucide-react";
import { createCourse, getCoursesWithStats } from "@/actions/courses";
import { getCourseGradientStyle } from "@/lib/course-colors";

const ALPHABET = ["All", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [letter, setLetter] = useState("All");
  const [loading, setLoading] = useState(true);
  // Cleared in `finally`, so a failed load stops rather than spinning forever.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    getCoursesWithStats()
      .then(setCourses)
      .catch((e) =>
        setLoadError(e instanceof Error ? e.message : "Couldn't load courses.")
      )
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    setCreating(true);
    const fd = new FormData();
    fd.append("title", "New Course");
    const result = await createCourse(fd);
    if (result?.success && result?.course?.id) {
      router.push(`/instructor/courses/${result.course.id}`);
    }
    setCreating(false);
  }

  const filtered = courses.filter((c) => {
    const matchesSearch = c.title.toLowerCase().includes(search.toLowerCase());
    const matchesLetter = letter === "All" || c.title.toUpperCase().startsWith(letter);
    return matchesSearch && matchesLetter;
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">All Courses</h1>
          <p className="text-muted-foreground mt-1">{courses.length} courses total</p>
        </div>
        <Button onClick={handleCreate} disabled={creating}>
          <Plus className="h-4 w-4 mr-2" />
          {creating ? "Creating..." : "New Course"}
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search courses..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setLetter("All"); }}
          className="pl-9"
        />
      </div>

      {/* Alphabet filter */}
      <div className="flex flex-wrap gap-1 mb-6">
        {ALPHABET.map((l) => (
          <button
            key={l}
            onClick={() => { setLetter(l); setSearch(""); }}
            className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
              letter === l
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Results count */}
      {(search || letter !== "All") && (
        <p className="text-sm text-muted-foreground mb-4">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Course grid */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Loading...</div>
      ) : loadError ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {loadError}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>{courses.length === 0 ? "No courses yet." : "No courses match your search."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((course) => (
            <Link
              key={course.id}
              href={`/admin/courses/${course.id}`}
              className="group rounded-xl border overflow-hidden hover:shadow-md transition-shadow bg-card flex flex-col"
            >
              {/* Gradient header with title */}
              <div
                className="relative h-32 flex items-end p-3"
                style={getCourseGradientStyle(course.id)}
              >
                <div className="absolute inset-0 bg-black/20" />
                <div className="relative z-10 w-full">
                  <Badge
                    variant={course.is_published ? "default" : "secondary"}
                    className="text-[10px] mb-1.5 opacity-90"
                  >
                    {course.is_published ? "Published" : "Draft"}
                  </Badge>
                  <p className="font-bold text-white text-base leading-snug line-clamp-2 drop-shadow">
                    {course.title}
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="p-3 flex-1 space-y-2 text-xs text-muted-foreground">
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div className="flex flex-col items-center gap-0.5">
                    <BookMarked className="h-3.5 w-3.5" />
                    <span className="font-semibold text-foreground text-sm">{course.lessonCount}</span>
                    <span>lessons</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <Users className="h-3.5 w-3.5" />
                    <span className="font-semibold text-foreground text-sm">{course.enrolledCount}</span>
                    <span>enrolled</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span className="font-semibold text-foreground text-sm">{course.completedCount}</span>
                    <span>done</span>
                  </div>
                </div>
                {course.ownerName && (
                  <div className="flex items-center gap-1 pt-1 border-t">
                    <User className="h-3 w-3 shrink-0" />
                    <span className="truncate">{course.ownerName}</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
