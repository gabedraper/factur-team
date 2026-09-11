"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { updateLesson, lessonVideoUploadTicket } from "@/actions/lessons";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, Upload } from "lucide-react";
import RichTextEditor from "@/components/rich-text-editor";
import { PageHeader } from "@/components/ui/page-header";

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

interface LessonContent {
  url?: string;
  videoPath?: string;
  videoName?: string;
  body?: string;
  fileUrl?: string;
  fileName?: string;
  questions?: QuizQuestion[];
}

interface Lesson {
  id: string;
  title: string;
  type: string;
  content: LessonContent | null;
  duration_minutes: number | null;
  module_id: string;
  owner_id: string | null;
  modules: { course_id: string } | null;
}

export default function LessonEditPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.courseId as string;
  const lessonId = params.lessonId as string;
  const supabase = createClient();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("text");
  const [duration, setDuration] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoPath, setVideoPath] = useState("");
  const [videoName, setVideoName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const videoFile = useRef<HTMLInputElement>(null);
  const [textBody, setTextBody] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [allUsers, setAllUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadLesson();
    supabase.from("profiles").select("id, full_name").order("full_name").then(({ data }) => {
      setAllUsers(data || []);
    });
  }, [lessonId]);

  async function loadLesson() {
    const { data } = await supabase
      .from("lessons")
      .select("*, modules(course_id)")
      .eq("id", lessonId)
      .single();

    if (data) {
      setLesson(data);
      setTitle(data.title);
      setType(data.type);
      setDuration(data.duration_minutes?.toString() || "");
      setOwnerId(data.owner_id || "");
      const c = data.content as LessonContent | null;
      if (c) {
        setVideoUrl(c.url || "");
        setVideoPath(c.videoPath || "");
        setVideoName(c.videoName || "");
        setTextBody(c.body || "");
        setFileUrl(c.fileUrl || "");
        setFileName(c.fileName || "");
        setQuestions(c.questions || []);
      }
    }
  }

  function buildContent(): LessonContent {
    switch (type) {
      case "video":
        // An uploaded file and a link are alternatives, never both: whichever
        // was set last is the one the lesson holds.
        return videoPath ? { videoPath, videoName } : { url: videoUrl };
      case "text":
        return { body: textBody };
      case "file":
        return { fileUrl, fileName };
      case "quiz":
        return { questions };
      default:
        return {};
    }
  }

  async function uploadVideo(chosen: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const ticket = await lessonVideoUploadTicket(lessonId, chosen.name);
      if (!ticket.success) throw new Error(ticket.error);

      // Straight from the browser into storage on a one-shot ticket, so the
      // recording never has to fit through a server action body.
      const { error } = await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, chosen, {
          contentType: chosen.type || undefined,
        });
      if (error) throw new Error(error.message);

      setVideoPath(ticket.path);
      setVideoName(chosen.name);
      setVideoUrl("");
    } catch (e) {
      setUploadError(
        e instanceof Error ? e.message : "Could not upload that video"
      );
    } finally {
      setUploading(false);
      if (videoFile.current) videoFile.current.value = "";
    }
  }

  async function handleSave() {
    setSaving(true);
    await updateLesson(lessonId, courseId, {
      title,
      type: type as "video" | "text" | "quiz" | "file",
      content: buildContent() as Record<string, unknown>,
      duration_minutes: duration ? parseInt(duration) : undefined,
      owner_id: ownerId || null,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function addQuestion() {
    setQuestions([
      ...questions,
      { question: "", options: ["", "", "", ""], correctIndex: 0 },
    ]);
  }

  function removeQuestion(idx: number) {
    setQuestions(questions.filter((_, i) => i !== idx));
  }

  function updateQuestion(
    idx: number,
    field: keyof QuizQuestion,
    value: string | number | string[]
  ) {
    const updated = [...questions];
    updated[idx] = { ...updated[idx], [field]: value };
    setQuestions(updated);
  }

  if (!lesson) {
    return <div className="p-8 text-muted-foreground">Loading lesson...</div>;
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <Button variant="ghost" asChild className="mb-4 -ml-2">
          <Link href={`/instructor/courses/${courseId}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Course
          </Link>
        </Button>
        <PageHeader title="Edit Lesson" />
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Lesson Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Lesson title"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="quiz">Quiz</SelectItem>
                    <SelectItem value="file">File</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Duration (minutes)</Label>
                <Input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="e.g. 15"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Content Owner</Label>
              <Select
                value={ownerId || "none"}
                onValueChange={(v) => setOwnerId(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select owner..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No owner</SelectItem>
                  {allUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Content editor based on type */}
        {type === "video" && (
          <Card>
            <CardHeader>
              <CardTitle>Video Content</CardTitle>
              <CardDescription>
                Upload the video file, or point at one already hosted somewhere
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Video File</Label>
                <input
                  ref={videoFile}
                  type="file"
                  className="hidden"
                  accept="video/mp4,video/quicktime,video/webm"
                  onChange={(e) =>
                    e.target.files?.[0] && uploadVideo(e.target.files[0])
                  }
                />
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    disabled={uploading}
                    onClick={() => videoFile.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {uploading
                      ? "Uploading..."
                      : videoPath
                        ? "Replace Video"
                        : "Upload Video"}
                  </Button>
                  {videoPath && (
                    <span className="text-sm text-muted-foreground truncate">
                      {videoName || "Uploaded video"}
                    </span>
                  )}
                </div>
                <p
                  className={
                    uploadError
                      ? "text-sm text-red-600 dark:text-red-400"
                      : "text-sm text-muted-foreground"
                  }
                >
                  {uploadError ||
                    "MP4, MOV or WebM. Save the lesson once it has uploaded."}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Video URL</Label>
                <Input
                  value={videoUrl}
                  onChange={(e) => {
                    setVideoUrl(e.target.value);
                    setVideoPath("");
                    setVideoName("");
                  }}
                  placeholder="https://www.youtube.com/embed/... or direct .mp4 URL"
                  disabled={uploading}
                />
                <p className="text-sm text-muted-foreground">
                  A Loom, Vidyard or YouTube address. Paste the address itself,
                  not the embed code.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {type === "text" && (
          <Card>
            <CardHeader>
              <CardTitle>Text Content</CardTitle>
              <CardDescription>
                Use the toolbar to format text, add headings, lists, links, and images
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RichTextEditor
                value={textBody}
                onChange={setTextBody}
                placeholder="Write your lesson content here..."
              />
            </CardContent>
          </Card>
        )}

        {type === "file" && (
          <Card>
            <CardHeader>
              <CardTitle>File Content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>File URL</Label>
                <Input
                  value={fileUrl}
                  onChange={(e) => setFileUrl(e.target.value)}
                  placeholder="https://storage.example.com/file.pdf"
                />
              </div>
              <div className="space-y-2">
                <Label>File Name (display name)</Label>
                <Input
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="e.g. Employee Handbook.pdf"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {type === "quiz" && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Quiz Questions</CardTitle>
                  <CardDescription>
                    Learners must score 70% or higher to pass
                  </CardDescription>
                </div>
                <Button size="sm" onClick={addQuestion}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Question
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {questions.map((q, qIdx) => (
                <div key={qIdx} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-2">
                      <Label>Question {qIdx + 1}</Label>
                      <Input
                        value={q.question}
                        onChange={(e) =>
                          updateQuestion(qIdx, "question", e.target.value)
                        }
                        placeholder="Enter question text"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive mt-6"
                      onClick={() => removeQuestion(qIdx)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Label>Options (select the correct answer)</Label>
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`correct-${qIdx}`}
                          checked={q.correctIndex === oIdx}
                          onChange={() =>
                            updateQuestion(qIdx, "correctIndex", oIdx)
                          }
                          className="w-4 h-4"
                        />
                        <Input
                          value={opt}
                          onChange={(e) => {
                            const newOptions = [...q.options];
                            newOptions[oIdx] = e.target.value;
                            updateQuestion(qIdx, "options", newOptions);
                          }}
                          placeholder={`Option ${oIdx + 1}`}
                          className="h-8 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {questions.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-4">
                  No questions yet. Click &quot;Add Question&quot; to get started.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/instructor/courses/${courseId}`}>Cancel</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
