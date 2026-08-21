"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Plus } from "lucide-react";

import {
  getRoleCoursesAll,
  addRoleCourse,
  removeRoleCourse,
} from "@/actions/role-training";

interface Course {
  id: string;
  title: string;
}

interface RoleCourse {
  id: string;
  role_id: string;
  course_id: string;
  courses: Course;
}

export default function RoleTrainingPage() {
  const [roleCourses, setRoleCourses] = useState<RoleCourse[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const data = await getRoleCoursesAll();
    setRoleCourses(data.roleCourses);
    setRoles(data.roles);
    setAllCourses(data.courses);
  }

  function showMessage(text: string, type: "success" | "error") {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  }

  async function handleAdd(role: string) {
    const courseId = selected[role];
    if (!courseId) return;
    const result = await addRoleCourse(role, courseId);
    if (result.success) {
      setSelected((s) => ({ ...s, [role]: "" }));
      load();
    } else {
      showMessage(result.error || "Failed to add course", "error");
    }
  }

  async function handleRemove(id: string) {
    await removeRoleCourse(id);
    load();
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Role Training</h1>
        <p className="text-muted-foreground mt-1">
          Assign courses to each role — members see their assigned courses automatically when they log in.
        </p>
      </div>

      {message && (
        <div className={`mb-6 p-3 rounded-md text-sm ${message.type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {roles.map((roleRow) => {
          const role = roleRow.id;
          const assigned = roleCourses.filter((rc) => rc.role_id === role);
          const assignedIds = assigned.map((rc) => rc.course_id);
          const available = allCourses.filter((c) => !assignedIds.includes(c.id));

          return (
            <Card key={role}>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  {roleRow.name}
                  <Badge variant="secondary">{assigned.length} course{assigned.length !== 1 ? "s" : ""}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Assigned courses */}
                {assigned.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {assigned.map((rc) => (
                      <div
                        key={rc.id}
                        className="flex items-center gap-2 bg-muted rounded-md px-3 py-1.5 text-sm"
                      >
                        <span>{rc.courses.title}</span>
                        <button
                          onClick={() => handleRemove(rc.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No courses assigned yet.</p>
                )}

                {/* Add course */}
                {available.length > 0 && (
                  <div className="flex gap-2">
                    <Select
                      value={selected[role] || ""}
                      onValueChange={(val) => setSelected((s) => ({ ...s, [role]: val }))}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Add a course..." />
                      </SelectTrigger>
                      <SelectContent>
                        {available.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => handleAdd(role)}
                      disabled={!selected[role]}
                      size="sm"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
