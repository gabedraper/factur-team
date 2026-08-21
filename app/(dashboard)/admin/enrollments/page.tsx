"use client";

import { useState, useEffect, useTransition } from "react";
import { adminEnrollUser, removeEnrollment, updateEnrollmentDeadline, getEnrollmentsAdmin } from "@/actions/enrollments";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { ClipboardList, Plus, Trash2, Calendar, Search } from "lucide-react";
import { getRoleLabel } from "@/lib/roles";
import { useSort, SortHeader } from "@/components/ui/sortable";

interface Enrollment {
  id: string;
  enrolled_at: string;
  completed_at: string | null;
  deadline: string | null;
  profiles: { id: string; full_name: string; role: string } | null;
  courses: { id: string; title: string } | null;
}

export default function AdminEnrollmentsPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [users, setUsers] = useState<{ id: string; full_name: string; role: string }[]>([]);
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Form state
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedCourse, setSelectedCourse] = useState("");
  const [deadline, setDeadline] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const supabase = createClient();
    const [enrollData, usersData, coursesData] = await Promise.all([
      getEnrollmentsAdmin(),
      supabase.from("profiles").select("id, full_name, role").order("full_name"),
      supabase.from("courses").select("id, title").order("title"),
    ]);
    setEnrollments(enrollData as unknown as Enrollment[]);
    setUsers((usersData.data || []) as any);
    setCourses((coursesData.data || []) as any);
    setLoading(false);
  }

  async function handleEnroll(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("user_id", selectedUser);
    fd.set("course_id", selectedCourse);
    if (deadline) fd.set("deadline", new Date(deadline).toISOString());
    startTransition(async () => {
      await adminEnrollUser(fd);
      setDialogOpen(false);
      setSelectedUser("");
      setSelectedCourse("");
      setDeadline("");
      await loadData();
    });
  }

  async function handleRemove(id: string) {
    if (!confirm("Remove this enrollment?")) return;
    startTransition(async () => {
      await removeEnrollment(id);
      await loadData();
    });
  }

  async function handleDeadlineChange(id: string, value: string) {
    startTransition(async () => {
      await updateEnrollmentDeadline(id, value ? new Date(value).toISOString() : null);
      await loadData();
    });
  }

  const filtered = enrollments.filter((e) => {
    const term = search.toLowerCase();
    return (
      e.profiles?.full_name?.toLowerCase().includes(term) ||
      e.courses?.title?.toLowerCase().includes(term)
    );
  });

  const isOverdue = (deadline: string | null, completed: string | null) => {
    if (!deadline || completed) return false;
    return new Date(deadline) < new Date();
  };

  // Status sorts by urgency rather than alphabetically -- overdue first, then
  // in progress, then the ones that are done and need no attention.
  const { sorted, sortProps } = useSort(filtered, {
    user: (e) => e.profiles?.full_name,
    course: (e) => e.courses?.title,
    status: (e) => (isOverdue(e.deadline, e.completed_at) ? 0 : e.completed_at ? 2 : 1),
    deadline: (e) => e.deadline,
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Enrollments</h1>
          <p className="text-muted-foreground mt-1">
            Enroll users into courses and set completion deadlines
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Enroll User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enroll User in Course</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEnroll} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>User</Label>
                <Select value={selectedUser} onValueChange={setSelectedUser} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a user..." />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name} — {getRoleLabel(u.role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Course</Label>
                <Select value={selectedCourse} onValueChange={setSelectedCourse} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a course..." />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Completion Deadline (optional)</Label>
                <Input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !selectedUser || !selectedCourse}>
                  {pending ? "Enrolling..." : "Enroll"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by user or course..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
          <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>{enrollments.length === 0 ? "No enrollments yet." : "No results found."}</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <SortHeader className="text-left px-4 py-3" {...sortProps("user")}>User</SortHeader>
                <SortHeader className="text-left px-4 py-3" {...sortProps("course")}>Course</SortHeader>
                <SortHeader className="text-left px-4 py-3" {...sortProps("status")}>Status</SortHeader>
                <SortHeader className="text-left px-4 py-3" {...sortProps("deadline")}>Deadline</SortHeader>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((e) => {
                const overdue = isOverdue(e.deadline, e.completed_at);
                const deadlineValue = e.deadline
                  ? new Date(e.deadline).toISOString().split("T")[0]
                  : "";
                return (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{e.profiles?.full_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{getRoleLabel(e.profiles?.role ?? "")}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="max-w-[220px] truncate">{e.courses?.title ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      {e.completed_at ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200">Completed</Badge>
                      ) : overdue ? (
                        <Badge variant="destructive">Overdue</Badge>
                      ) : (
                        <Badge variant="secondary">In Progress</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="date"
                        defaultValue={deadlineValue}
                        onBlur={(ev) => handleDeadlineChange(e.id, ev.target.value)}
                        className="text-xs border rounded px-2 py-1 bg-background"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRemove(e.id)}
                        disabled={pending}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
