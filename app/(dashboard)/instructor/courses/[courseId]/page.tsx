"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { createModule, reorderModules } from "@/actions/modules";
import { createLesson, deleteLesson } from "@/actions/lessons";
import { publishCourse, updateCourse } from "@/actions/courses";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Video,
  FileText,
  HelpCircle,
  File,
  ChevronDown,
  ChevronRight,
  Eye,
  GripVertical,
} from "lucide-react";

interface Lesson {
  id: string;
  title: string;
  type: string;
  position: number;
  duration_minutes: number | null;
}

interface Module {
  id: string;
  title: string;
  position: number;
  lessons: Lesson[];
}

interface Course {
  id: string;
  title: string;
  description: string | null;
  is_published: boolean;
  thumbnail_url: string | null;
  instructor_id: string | null;
}

const lessonTypeIcons: Record<string, React.ReactNode> = {
  video: <Video className="h-4 w-4" />,
  text: <FileText className="h-4 w-4" />,
  quiz: <HelpCircle className="h-4 w-4" />,
  file: <File className="h-4 w-4" />,
};

export default function CourseEditorPage() {
  const params = useParams();
  const courseId = params.courseId as string;
  const supabase = createClient();

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [addingModule, setAddingModule] = useState(false);
  const [newLessonModuleId, setNewLessonModuleId] = useState<string | null>(null);
  const [newLessonTitle, setNewLessonTitle] = useState("");
  const [newLessonType, setNewLessonType] = useState("text");
  const [loading, setLoading] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editOwnerId, setEditOwnerId] = useState("");
  const [allUsers, setAllUsers] = useState<{ id: string; full_name: string }[]>([]);
  // Three states, not two: still fetching, versus fetched and there is nothing
  // to show. Collapsing them left the page saying "Loading course..." forever.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draggingModuleId, setDraggingModuleId] = useState<string | null>(null);
  const [dragOverModuleId, setDragOverModuleId] = useState<string | null>(null);

  useEffect(() => {
    loadCourse();
    loadModules();
    supabase.from("profiles").select("id, full_name").order("full_name").then(({ data }) => {
      setAllUsers(data || []);
    });
  }, [courseId]);

  async function loadCourse() {
    const { data, error } = await supabase
      .from("courses")
      .select("*")
      .eq("id", courseId)
      .maybeSingle();

    if (data) {
      setCourse(data);
      setLoadError(null);
      return;
    }
    // An unpublished course someone else owns is hidden by the database rather
    // than reported as an error, so "no row" and "no permission" arrive looking
    // identical. Either way the honest answer is that it cannot be opened.
    setLoadError(
      error
        ? error.message
        : "This course either doesn't exist or isn't yours to edit. Unpublished courses are only visible to the person who owns them."
    );
  }

  async function loadModules() {
    const { data: modulesData } = await supabase
      .from("modules")
      .select("*, lessons(*)")
      .eq("course_id", courseId)
      .order("position");

    if (modulesData) {
      const sorted = modulesData.map((m) => ({
        ...m,
        lessons: (m.lessons || []).sort(
          (a: Lesson, b: Lesson) => a.position - b.position
        ),
      }));
      setModules(sorted);
      setExpandedModules(new Set(sorted.map((m) => m.id)));
    }
  }

  async function handleAddModule() {
    if (!newModuleTitle.trim()) return;
    setLoading(true);
    await createModule(courseId, newModuleTitle);
    setNewModuleTitle("");
    setAddingModule(false);
    setLoading(false);
    loadModules();
  }

  async function handleAddLesson(moduleId: string) {
    if (!newLessonTitle.trim()) return;
    setLoading(true);
    await createLesson(moduleId, courseId, {
      title: newLessonTitle,
      type: newLessonType as "video" | "text" | "quiz" | "file",
    });
    setNewLessonTitle("");
    setNewLessonType("text");
    setNewLessonModuleId(null);
    setLoading(false);
    loadModules();
  }

  async function handleDeleteLesson(lessonId: string) {
    if (!confirm("Delete this lesson?")) return;
    await deleteLesson(lessonId, courseId);
    loadModules();
  }

  async function handleTogglePublish() {
    if (!course) return;
    await publishCourse(courseId, !course.is_published);
    loadCourse();
  }

  // Modules are taught in sequence, so dropping one onto another slides it into
  // that slot and everything in between shuffles along. The "Module N" labels
  // are just the row index, so they renumber themselves once the list moves.
  async function handleDropModule(targetId: string) {
    const sourceId = draggingModuleId;
    setDraggingModuleId(null);
    setDragOverModuleId(null);
    if (!sourceId || sourceId === targetId) return;

    const from = modules.findIndex((m) => m.id === sourceId);
    const to = modules.findIndex((m) => m.id === targetId);
    if (from === -1 || to === -1) return;

    const reordered = [...modules];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setModules(reordered);

    const result = await reorderModules(courseId, reordered.map((m) => m.id));
    // The list already moved on screen; if the save failed, put back whatever
    // the database actually has rather than leave a lie on the page.
    if (!result.success) loadModules();
  }

  function toggleModule(moduleId: string) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  if (!course) {
    return (
      <div className="p-8">
        {loadError ? (
          <>
            <h1 className="text-xl font-semibold">Can&apos;t open this course</h1>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">{loadError}</p>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/instructor/courses">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to courses
              </Link>
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">Loading course...</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Button variant="ghost" asChild className="mb-4 -ml-2">
          <Link href="/instructor/courses">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Courses
          </Link>
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex-1 mr-4">
            {editingTitle ? (
              <div className="space-y-2">
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="text-2xl font-bold h-12"
                  placeholder="Course title"
                />
                <Input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Course description (optional)"
                />
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Content Owner</Label>
                  <Select value={editOwnerId} onValueChange={setEditOwnerId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select owner..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={async () => {
                    await updateCourse(courseId, { title: editTitle, description: editDescription, instructor_id: editOwnerId || undefined });
                    setEditingTitle(false);
                    loadCourse();
                  }}>Save</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingTitle(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div>
                  <h1 className="text-3xl font-bold">{course.title}</h1>
                  {course.description && (
                    <p className="text-muted-foreground mt-1">{course.description}</p>
                  )}
                </div>
                <Button size="sm" variant="ghost" className="mt-1" onClick={() => {
                  setEditTitle(course.title);
                  setEditDescription(course.description || "");
                  setEditOwnerId(course.instructor_id || "");
                  setEditingTitle(true);
                }}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={course.is_published ? "default" : "secondary"}>
              {course.is_published ? "Published" : "Draft"}
            </Badge>
            <Button
              variant={course.is_published ? "outline" : "default"}
              onClick={handleTogglePublish}
            >
              {course.is_published ? "Unpublish" : "Publish"}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Course Content</h2>
          <Button size="sm" onClick={() => setAddingModule(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Module
          </Button>
        </div>

        {addingModule && (
          <Card className="mb-4">
            <CardContent className="pt-4">
              <div className="flex gap-2">
                <Input
                  value={newModuleTitle}
                  onChange={(e) => setNewModuleTitle(e.target.value)}
                  placeholder="Module title"
                  onKeyDown={(e) => e.key === "Enter" && handleAddModule()}
                />
                <Button onClick={handleAddModule} disabled={loading}>
                  Add
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAddingModule(false)}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {modules.map((module, mIdx) => (
            <Card key={module.id}>
              <CardHeader
                draggable
                onDragStart={() => setDraggingModuleId(module.id)}
                onDragEnd={() => {
                  setDraggingModuleId(null);
                  setDragOverModuleId(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverModuleId(module.id);
                }}
                onDragLeave={() =>
                  setDragOverModuleId((id) => (id === module.id ? null : id))
                }
                onDrop={() => handleDropModule(module.id)}
                className={cn(
                  "py-3 px-4 cursor-pointer hover:bg-muted/50 flex flex-row items-center justify-between",
                  draggingModuleId === module.id && "opacity-40",
                  dragOverModuleId === module.id &&
                    draggingModuleId !== null &&
                    draggingModuleId !== module.id &&
                    "bg-primary/5 ring-1 ring-primary"
                )}
                onClick={() => toggleModule(module.id)}
              >
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/40 active:cursor-grabbing" />
                  {expandedModules.has(module.id) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="font-medium">
                    Module {mIdx + 1}: {module.title}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {module.lessons.length} lessons
                  </Badge>
                </div>
              </CardHeader>

              {expandedModules.has(module.id) && (
                <CardContent className="pb-3">
                  <div className="space-y-2">
                    {module.lessons.map((lesson, lIdx) => (
                      <div
                        key={lesson.id}
                        className="flex items-center justify-between p-2 rounded-md bg-muted/30 hover:bg-muted/60"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {lessonTypeIcons[lesson.type]}
                          </span>
                          <span className="text-sm">
                            {lIdx + 1}. {lesson.title}
                          </span>
                          <Badge variant="outline" className="text-xs capitalize">
                            {lesson.type}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            asChild
                            className="h-7 px-2"
                          >
                            <Link
                              href={`/learner/courses/${courseId}/lessons/${lesson.id}?preview=true`}
                            >
                              <Eye className="h-3 w-3" />
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            asChild
                            className="h-7 px-2"
                          >
                            <Link
                              href={`/instructor/courses/${courseId}/lessons/${lesson.id}/edit`}
                            >
                              <Pencil className="h-3 w-3" />
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteLesson(lesson.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}

                    {newLessonModuleId === module.id ? (
                      <div className="flex gap-2 pt-2">
                        <Input
                          value={newLessonTitle}
                          onChange={(e) => setNewLessonTitle(e.target.value)}
                          placeholder="Lesson title"
                          className="h-8 text-sm"
                        />
                        <Select value={newLessonType} onValueChange={setNewLessonType}>
                          <SelectTrigger className="w-28 h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="video">Video</SelectItem>
                            <SelectItem value="quiz">Quiz</SelectItem>
                            <SelectItem value="file">File</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => handleAddLesson(module.id)}
                          disabled={loading}
                        >
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => setNewLessonModuleId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-1 h-8 text-muted-foreground"
                        onClick={() => setNewLessonModuleId(module.id)}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add lesson
                      </Button>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}

          {modules.length === 0 && (
            <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
              <p>No modules yet. Add a module to start building content.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
