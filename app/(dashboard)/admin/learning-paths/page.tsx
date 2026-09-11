"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Map, Pencil, Trash2, BookOpen, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

interface Course {
  id: string;
  title: string;
  is_published: boolean;
}

interface PathCourse {
  id: string;
  course_id: string;
  position: number;
  courses: Course;
}

interface LearningPath {
  id: string;
  name: string;
  description: string | null;
  target_role: string | null;
  created_at: string;
}

export default function LearningPathsPage() {
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [pathCourses, setPathCourses] = useState<Record<string, PathCourse[]>>({});
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetRole, setTargetRole] = useState("");

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editingPath, setEditingPath] = useState<LearningPath | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editRole, setEditRole] = useState("");

  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    loadPaths();
    loadAllCourses();
    loadRoles();
  }, []);

  async function loadPaths() {
    const { data } = await supabase
      .from("learning_paths")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setPaths(data);
  }

  /*
   * The roles from Settings, for the target picker.
   *
   * It used to offer learner / instructor / manager / admin -- four names from
   * the old LMS that exist nowhere in this company. Somebody choosing one was
   * labelling the path with a role nobody holds.
   */
  async function loadRoles() {
    const { data } = await supabase
      .from("org_roles")
      .select("id, name")
      .eq("active", true)
      .order("name");
    if (data) setRoles(data as { id: string; name: string }[]);
  }

  async function loadAllCourses() {
    const { data } = await supabase
      .from("courses")
      .select("id, title, is_published")
      .order("title");
    if (data) setAllCourses(data);
  }

  async function loadPathCourses(pathId: string) {
    const { data } = await supabase
      .from("learning_path_courses")
      .select("*, courses(id, title, is_published)")
      .eq("path_id", pathId)
      .order("position");
    if (data) {
      setPathCourses((prev) => ({ ...prev, [pathId]: data as PathCourse[] }));
    }
  }

  async function handleCreate() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("learning_paths").insert({
      name,
      description,
      target_role: targetRole,
      created_by: user.id,
    });
    setName("");
    setDescription("");
    setTargetRole("learner");
    setCreateOpen(false);
    setLoading(false);
    loadPaths();
  }

  async function handleSaveEdit() {
    if (!editingPath) return;
    setLoading(true);
    await supabase.from("learning_paths").update({
      name: editName,
      description: editDescription,
      target_role: editRole,
    }).eq("id", editingPath.id);
    setEditOpen(false);
    setLoading(false);
    loadPaths();
  }

  async function handleDeletePath(pathId: string) {
    if (!confirm("Delete this learning path? This will not delete the courses.")) return;
    await supabase.from("learning_paths").delete().eq("id", pathId);
    loadPaths();
  }

  async function handleAddCourse(pathId: string, courseId: string) {
    const existing = pathCourses[pathId] || [];
    if (existing.some((pc) => pc.course_id === courseId)) return;
    await supabase.from("learning_path_courses").insert({
      path_id: pathId,
      course_id: courseId,
      position: existing.length,
    });
    loadPathCourses(pathId);
  }

  async function handleRemoveCourse(pathId: string, pathCourseId: string) {
    await supabase.from("learning_path_courses").delete().eq("id", pathCourseId);
    loadPathCourses(pathId);
  }

  function openEdit(path: LearningPath) {
    setEditingPath(path);
    setEditName(path.name);
    setEditDescription(path.description || "");
    setEditRole(path.target_role || "");
    setEditOpen(true);
  }

  function toggleExpand(pathId: string) {
    if (expandedPath === pathId) {
      setExpandedPath(null);
    } else {
      setExpandedPath(pathId);
      if (!pathCourses[pathId]) loadPathCourses(pathId);
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <PageHeader
          title="Learning Paths"
          description="Organize courses into role-based learning paths"
        />
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Path
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Learning Path</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Path Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Onboarding for New Hires" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this path for?" />
              </div>
              <div className="space-y-2">
                <Label>Target Role</Label>
                <Select value={targetRole} onValueChange={setTargetRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} disabled={!name || loading} className="w-full">
                {loading ? "Creating..." : "Create Path"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Learning Path</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Path Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Target Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSaveEdit} disabled={!editName || loading} className="w-full">
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-4">
        {paths.map((path) => (
          <Card key={path.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <Map className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-lg">{path.name}</CardTitle>
                      <span className="text-xs px-2 py-0.5 rounded-full border font-medium text-muted-foreground">
                        {path.target_role || "Everyone"}
                      </span>
                    </div>
                    {path.description && (
                      <CardDescription className="mt-1">{path.description}</CardDescription>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => openEdit(path)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive hover:text-destructive" onClick={() => handleDeletePath(path.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 ml-1" onClick={() => toggleExpand(path.id)}>
                    {expandedPath === path.id ? "Hide Courses" : "Manage Courses"}
                  </Button>
                </div>
              </div>
            </CardHeader>

            {expandedPath === path.id && (
              <CardContent className="pt-0">
                <div className="border-t pt-4 space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Courses in this path</p>

                  {/* Current courses */}
                  {(pathCourses[path.id] || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No courses added yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {(pathCourses[path.id] || []).map((pc, idx) => (
                        <div key={pc.id} className="flex items-center justify-between p-2 rounded-md bg-muted/40">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-5">{idx + 1}.</span>
                            <BookOpen className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">{pc.courses?.title}</span>
                            {!pc.courses?.is_published && (
                              <Badge variant="secondary" className="text-xs">Draft</Badge>
                            )}
                          </div>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => handleRemoveCourse(path.id, pc.id)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add course dropdown */}
                  <div className="flex gap-2 pt-1">
                    <Select onValueChange={(courseId) => handleAddCourse(path.id, courseId)}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Add a course to this path..." />
                      </SelectTrigger>
                      <SelectContent>
                        {allCourses
                          .filter((c) => !(pathCourses[path.id] || []).some((pc) => pc.course_id === c.id))
                          .map((course) => (
                            <SelectItem key={course.id} value={course.id}>
                              {course.title} {!course.is_published ? "(Draft)" : ""}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        ))}

        {paths.length === 0 && (
          <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
            <Map className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>No learning paths yet. Create one to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
