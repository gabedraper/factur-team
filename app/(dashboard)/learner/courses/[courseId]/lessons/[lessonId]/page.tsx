"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { markLessonComplete } from "@/actions/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Download,
  Trophy,
  Eye,
} from "lucide-react";
import { getCourseGradientStyle, extractFirstImage } from "@/lib/course-colors";

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

interface LessonContent {
  url?: string;
  body?: string;
  fileUrl?: string;
  fileName?: string;
  questions?: QuizQuestion[];
}

interface LessonData {
  id: string;
  title: string;
  type: string;
  content: LessonContent | null;
  duration_minutes: number | null;
  module_id: string;
  modules: {
    id: string;
    title: string;
    course_id: string;
    courses: {
      id: string;
      title: string;
    } | null;
  } | null;
}

export default function LessonViewerPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPreview = searchParams.get("preview") === "true";
  const courseId = params.courseId as string;
  const lessonId = params.lessonId as string;
  const supabase = createClient();

  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [courseComplete, setCourseComplete] = useState(false);
  const [marking, setMarking] = useState(false);

  // Quiz state
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(0);
  const [quizPassed, setQuizPassed] = useState(false);

  // Navigation
  const [prevLessonId, setPrevLessonId] = useState<string | null>(null);
  const [nextLessonId, setNextLessonId] = useState<string | null>(null);

  useEffect(() => {
    loadLesson();
  }, [lessonId]);

  async function loadLesson() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("lessons")
      .select(
        "*, modules(id, title, course_id, courses(id, title))"
      )
      .eq("id", lessonId)
      .single();

    if (data) {
      setLesson(data);
      const content = data.content as LessonContent | null;
      if (content?.questions) {
        setQuizAnswers(new Array(content.questions.length).fill(-1));
      }
    }

    // Check if already completed
    const { data: progressData } = await supabase
      .from("lesson_progress")
      .select("id")
      .eq("user_id", user.id)
      .eq("lesson_id", lessonId)
      .single();

    setIsCompleted(!!progressData);

    // Load navigation: get all lessons in course ordered
    const { data: modulesData } = await supabase
      .from("modules")
      .select("id, lessons(id, position)")
      .eq("course_id", courseId)
      .order("position");

    if (modulesData) {
      const allLessons: string[] = [];
      for (const mod of modulesData) {
        const sorted = (mod.lessons as { id: string; position: number }[]).sort(
          (a, b) => a.position - b.position
        );
        allLessons.push(...sorted.map((l) => l.id));
      }
      const idx = allLessons.indexOf(lessonId);
      setPrevLessonId(idx > 0 ? allLessons[idx - 1] : null);
      setNextLessonId(idx < allLessons.length - 1 ? allLessons[idx + 1] : null);
    }
  }

  async function handleMarkComplete(score?: number) {
    if (isPreview) return;
    setMarking(true);
    const result = await markLessonComplete(lessonId, score);
    setProgress(result.progress);
    setIsCompleted(true);
    if (result.certificateIssued || result.progress === 100) {
      setCourseComplete(true);
    }
    setMarking(false);
  }

  function handleQuizSubmit() {
    const questions = (lesson?.content as LessonContent)?.questions || [];
    if (quizAnswers.some((a) => a === -1)) {
      alert("Please answer all questions before submitting.");
      return;
    }
    const correct = questions.filter(
      (q, i) => q.correctIndex === quizAnswers[i]
    ).length;
    const score = Math.round((correct / questions.length) * 100);
    setQuizScore(score);
    setQuizPassed(score >= 70);
    setQuizSubmitted(true);

    if (score >= 70) {
      handleMarkComplete(score);
    }
  }

  if (!lesson) {
    return <div className="p-8 text-muted-foreground">Loading lesson...</div>;
  }

  const content = lesson.content as LessonContent | null;
  const courseName =
    lesson.modules?.courses?.title || "Course";

  const isYouTube = (url: string) =>
    url.includes("youtube.com") || url.includes("youtu.be");

  function toYouTubeEmbed(url: string): string {
    // Already an embed URL
    if (url.includes("youtube.com/embed/")) return url;
    // youtu.be/VIDEO_ID
    const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
    if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}`;
    // youtube.com/watch?v=VIDEO_ID
    const watchMatch = url.match(/[?&]v=([^?&]+)/);
    if (watchMatch) return `https://www.youtube.com/embed/${watchMatch[1]}`;
    return url;
  }

  return (
    <div className="p-6 max-w-4xl pb-20">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
        <Link href="/learner" className="hover:text-foreground">
          My Learning
        </Link>
        <span>/</span>
        <Link
          href={`/learner/courses/${courseId}`}
          className="hover:text-foreground"
        >
          {courseName}
        </Link>
        <span>/</span>
        <span className="text-foreground">{lesson.title}</span>
      </div>

      {/* Preview mode banner */}
      {isPreview && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-3">
          <Eye className="h-5 w-5 text-yellow-600 shrink-0" />
          <div>
            <p className="font-semibold text-yellow-800">Preview Mode</p>
            <p className="text-sm text-yellow-700">
              You are previewing this lesson. Progress will not be tracked and quizzes won't count.
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="ml-auto shrink-0">
            <Link href={`/instructor/courses/${courseId}`}>Back to Editor</Link>
          </Button>
        </div>
      )}

      {/* Course complete banner */}
      {courseComplete && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
          <Trophy className="h-6 w-6 text-green-600" />
          <div>
            <p className="font-semibold text-green-800">
              Congratulations! You've completed the course!
            </p>
            <p className="text-sm text-green-700">
              Your certificate has been issued.{" "}
              <Link
                href="/learner/certificates"
                className="underline font-medium"
              >
                Download it here
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* Lesson hero */}
      {(() => {
        const heroImage = content?.body ? extractFirstImage(content.body) : null;
        const bgStyle = heroImage
          ? { backgroundImage: `url(${heroImage})`, backgroundSize: "cover", backgroundPosition: "center" }
          : getCourseGradientStyle(courseId);
        return (
          <div className="relative h-48 rounded-xl mb-6 overflow-hidden flex items-end" style={bgStyle}>
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative z-10 p-6 w-full">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-white/20 text-white border-white/30 capitalize backdrop-blur-sm">
                  {lesson.type}
                </Badge>
                {lesson.duration_minutes && (
                  <span className="text-sm text-white/80">{lesson.duration_minutes} min</span>
                )}
                {isCompleted && (
                  <Badge className="bg-green-500 text-white border-transparent">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Completed
                  </Badge>
                )}
              </div>
              <h1 className="text-2xl font-bold text-white">{lesson.title}</h1>
            </div>
          </div>
        );
      })()}

      {progress > 0 && (
        <div className="mb-6">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Course Progress</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Lesson content */}
      <div className="mb-6">
        {lesson.type === "video" && content?.url && (
          <div className="rounded-lg overflow-hidden bg-black aspect-video">
            {isYouTube(content.url) ? (
              <iframe
                src={toYouTubeEmbed(content.url)}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video
                src={content.url}
                controls
                className="w-full h-full"
              />
            )}
          </div>
        )}

        {lesson.type === "text" && content?.body && (
          <Card>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none pt-6">
              <div
                dangerouslySetInnerHTML={{ __html: content.body }}
              />
            </CardContent>
          </Card>
        )}

        {lesson.type === "file" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">File Resource</CardTitle>
              <CardDescription>
                Download the file below to complete this lesson
              </CardDescription>
            </CardHeader>
            <CardContent>
              {content?.fileUrl ? (
                <a
                  href={content.fileUrl}
                  download={content.fileName}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  {content.fileName || "Download File"}
                </a>
              ) : (
                <p className="text-muted-foreground">No file attached yet.</p>
              )}
            </CardContent>
          </Card>
        )}

        {lesson.type === "quiz" && (
          <Card>
            <CardHeader>
              <CardTitle>Quiz</CardTitle>
              <CardDescription>
                Answer all questions. You need 70% or higher to pass.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {(content?.questions || []).map((q, qIdx) => (
                <div key={qIdx} className="space-y-3">
                  <p className="font-medium">
                    {qIdx + 1}. {q.question}
                  </p>
                  <div className="space-y-2">
                    {q.options.map((opt, oIdx) => {
                      let optClass =
                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors";
                      if (quizSubmitted) {
                        if (oIdx === q.correctIndex) {
                          optClass =
                            "flex items-center gap-3 p-3 rounded-lg border border-green-500 bg-green-50 cursor-default";
                        } else if (
                          oIdx === quizAnswers[qIdx] &&
                          oIdx !== q.correctIndex
                        ) {
                          optClass =
                            "flex items-center gap-3 p-3 rounded-lg border border-red-500 bg-red-50 cursor-default";
                        }
                      } else if (quizAnswers[qIdx] === oIdx) {
                        optClass =
                          "flex items-center gap-3 p-3 rounded-lg border border-primary bg-primary/5 cursor-pointer";
                      }
                      return (
                        <label key={oIdx} className={optClass}>
                          <input
                            type="radio"
                            name={`q-${qIdx}`}
                            checked={quizAnswers[qIdx] === oIdx}
                            onChange={() => {
                              if (!quizSubmitted) {
                                const updated = [...quizAnswers];
                                updated[qIdx] = oIdx;
                                setQuizAnswers(updated);
                              }
                            }}
                            disabled={quizSubmitted}
                            className="w-4 h-4"
                          />
                          <span className="text-sm">{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              {quizSubmitted ? (
                <div
                  className={`p-4 rounded-lg ${quizPassed ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}
                >
                  <p
                    className={`font-semibold ${quizPassed ? "text-green-800" : "text-red-800"}`}
                  >
                    {quizPassed ? "Quiz Passed!" : "Quiz Failed"}
                  </p>
                  <p
                    className={`text-sm ${quizPassed ? "text-green-700" : "text-red-700"}`}
                  >
                    Score: {quizScore}%{" "}
                    {!quizPassed && "(Need 70% to pass)"}
                  </p>
                  {!quizPassed && (
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const questions = content?.questions || [];
                        setQuizAnswers(
                          new Array(questions.length).fill(-1)
                        );
                        setQuizSubmitted(false);
                        setQuizScore(0);
                        setQuizPassed(false);
                      }}
                    >
                      Try Again
                    </Button>
                  )}
                </div>
              ) : (
                <Button onClick={handleQuizSubmit} disabled={marking || isPreview}>
                  {isPreview ? "Submit Quiz (Preview — disabled)" : "Submit Quiz"}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Sticky bottom progress bar */}
      <div className="fixed bottom-0 left-64 right-0 bg-background border-t px-6 py-3 z-10">
        <div className="max-w-4xl flex items-center gap-4">
          <span className="text-sm text-muted-foreground shrink-0">Course Progress</span>
          <div className="flex-1">
            <div className="h-2.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <span className="text-sm font-semibold shrink-0">{progress}%</span>
        </div>
      </div>

      {/* Mark complete / navigation */}
      <div className="flex items-center justify-between pt-4 border-t">
        <div>
          {prevLessonId ? (
            <Button variant="outline" asChild>
              <Link
                href={`/learner/courses/${courseId}/lessons/${prevLessonId}`}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Previous
              </Link>
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href={`/learner/courses/${courseId}`}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Course Outline
              </Link>
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {!isCompleted && lesson.type !== "quiz" && !isPreview && (
            <Button onClick={() => handleMarkComplete()} disabled={marking}>
              <CheckCircle className="h-4 w-4 mr-2" />
              {lesson.type === "file" ? "Mark as Downloaded" : "Mark Complete"}
            </Button>
          )}

          {nextLessonId && (
            <Button asChild>
              <Link
                href={`/learner/courses/${courseId}/lessons/${nextLessonId}`}
              >
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
