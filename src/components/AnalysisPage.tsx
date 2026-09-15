import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AnalysisResult } from "@/types";
import { AlertCircle, ArrowRight, CheckCircle2, Circle, FileText, FileUp, FlaskConical, Gift, Loader2, Shield, Upload, X } from "lucide-react";

interface AnalysisPageProps {
  onAnalysisComplete: (result: AnalysisResult) => void;
  isGuest: boolean;
  /** The server refused a guest's second analysis: open the login screen with this message. */
  onLoginRequired: (message: string) => void;
  onTryDemo: () => void;
}

// These mirror the server's limits (server/src/config.ts). The server re-checks everything.
// Vercel functions reject request bodies over 4.5MB, so builds deployed there use a 4MB limit.
const MAX_MB = __PREVIEW_DEPLOY__ ? 4 : 5;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const MIN_JD_CHARS = 50;
const MAX_JD_CHARS = 50_000;
/** The server stops document parsing after this long (parse deadline). */
const PARSE_DEADLINE_SECONDS = 20;

function validateFile(file: File, allowed: string[]): string | null {
  const ext = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (!allowed.includes(ext)) return `Unsupported file type. Allowed: ${allowed.join(", ")}`;
  if (file.size > MAX_BYTES) return `File size exceeds ${MAX_MB}MB limit`;
  if (file.size === 0) return "File is empty";
  return null;
}

function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-start gap-2 text-sm", done ? "text-slate-800" : "text-slate-500")}>
      {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />}
      <span>
        <span className="sr-only">{done ? "Done: " : "To do: "}</span>
        {children}
      </span>
    </li>
  );
}

export function AnalysisPage({ onAnalysisComplete, isGuest, onLoginRequired, onTryDemo }: AnalysisPageProps) {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jdText, setJdText] = useState("");
  const [jdTitle, setJdTitle] = useState("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
  }, []);

  const trimmedJd = jdText.trim();
  const jdTooShort = trimmedJd.length > 0 && trimmedJd.length < MIN_JD_CHARS;
  const jdReady = trimmedJd.length >= MIN_JD_CHARS || (!trimmedJd && !!jdFile);
  const ready = !!resumeFile && jdReady;

  // Client-side checks are for UX only; the server re-validates size, extension and file signature.
  const handleResumeUpload = (file: File) => {
    const problem = validateFile(file, [".pdf", ".docx"]);
    setError(problem);
    if (!problem) setResumeFile(file);
  };

  const handleJdUpload = (file: File) => {
    const problem = validateFile(file, [".pdf", ".docx", ".txt"]);
    setError(problem);
    if (!problem) setJdFile(file);
  };

  const handleAnalyze = async () => {
    if (!ready || !resumeFile) return;
    setIsAnalyzing(true);
    setError(null);
    setElapsed(0);
    const started = Date.now();
    timer.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const form = new FormData();
    form.append("resume", resumeFile);
    if (jdTitle.trim()) form.append("jdTitle", jdTitle.trim());
    if (trimmedJd) form.append("jdText", trimmedJd);
    else if (jdFile) form.append("jdFile", jdFile);
    try {
      const { result } = await api.analyze(form);
      onAnalysisComplete(result);
    } catch (err) {
      if (err instanceof ApiError && err.code === "login_required") {
        onLoginRequired(err.message);
        return;
      }
      const message = err instanceof Error ? err.message : "Analysis failed";
      setError(err instanceof ApiError && err.code === "server_busy" ? `${message} Your files are still selected, so you can try again.` : message);
    } finally {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <h1 className="mb-2 text-2xl font-bold text-slate-900 sm:text-3xl">New Analysis</h1>
      <p className="mb-6 text-slate-600">Add your resume and the job description you're targeting.</p>

      {isGuest && (
        <div role="note" className="mb-6 flex flex-col gap-3 rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900 sm:flex-row sm:items-center">
          <Gift className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
          <span className="flex-1">Your first analysis is free, no account needed. Log in afterwards to save it and run more.</span>
          <Button variant="outline" size="sm" className="border-cyan-300 bg-white" onClick={onTryDemo}>
            <FlaskConical className="mr-2 h-4 w-4" aria-hidden="true" />
            See a sample first
          </Button>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-6 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Step 1: Resume */}
      <Card className="mb-6 border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-cyan-400">1</span>
            Resume
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!resumeFile ? (
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose a resume file"
              className={cn(
                "cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 sm:p-12",
                dragOver ? "border-cyan-500 bg-cyan-50" : "border-slate-300 hover:border-slate-400"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) handleResumeUpload(file);
              }}
              onClick={() => document.getElementById("resume-upload")?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  document.getElementById("resume-upload")?.click();
                }
              }}
            >
              <Upload className="mx-auto mb-4 h-10 w-10 text-slate-400" aria-hidden="true" />
              <p className="mb-2 text-slate-600">Drag and drop your resume here, or click to browse</p>
              <p className="text-sm text-slate-400">PDF or DOCX · up to {MAX_MB}MB · PDFs up to 20 pages · text-based, not scanned images</p>
              <input
                id="resume-upload"
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleResumeUpload(file);
                  e.target.value = "";
                }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-8 w-8 shrink-0 text-cyan-600" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{resumeFile.name}</p>
                  <p className="text-sm text-slate-500">{(resumeFile.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" aria-label="Remove resume" disabled={isAnalyzing} onClick={() => setResumeFile(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
            <Shield className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            Files are read in memory and not stored. Only the analysis result is saved.
          </p>
        </CardContent>
      </Card>

      {/* Step 2: Job Description */}
      <Card className="mb-6 border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-cyan-400">2</span>
            Job description
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="jd-title">Job title (optional)</Label>
              <Input
                id="jd-title"
                placeholder="e.g. Data Engineer - detected from the job description if left empty"
                className="mt-2"
                maxLength={120}
                value={jdTitle}
                onChange={(e) => setJdTitle(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="jd-text">Paste the job description</Label>
              <Textarea
                id="jd-text"
                placeholder="Paste the full job description, including the requirements and preferred sections..."
                className="mt-2 min-h-[200px]"
                maxLength={MAX_JD_CHARS}
                value={jdText}
                aria-describedby="jd-count"
                aria-invalid={jdTooShort}
                onChange={(e) => setJdText(e.target.value)}
              />
              <div id="jd-count" className="mt-1 flex flex-wrap justify-between gap-2 text-xs">
                <span className={jdTooShort ? "text-rose-600" : "text-slate-500"}>
                  {jdTooShort ? `At least ${MIN_JD_CHARS} characters needed - include the requirements.` : trimmedJd && jdFile ? "Pasted text is used instead of the uploaded file." : " "}
                </span>
                <span className="tabular-nums text-slate-500">
                  {trimmedJd.length.toLocaleString()} / {MAX_JD_CHARS.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-sm text-slate-400">or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <div>
              <Label htmlFor="jd-upload-button">Upload the job description</Label>
              <div className="mt-2">
                {!jdFile ? (
                  <Button id="jd-upload-button" variant="outline" className="w-full" onClick={() => document.getElementById("jd-upload")?.click()}>
                    <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />
                    Upload JD file (PDF, DOCX or TXT)
                  </Button>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <FileText className="h-8 w-8 shrink-0 text-cyan-600" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{jdFile.name}</p>
                        <p className="text-sm text-slate-500">{(jdFile.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" aria-label="Remove job description file" disabled={isAnalyzing} onClick={() => setJdFile(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <input
                  id="jd-upload"
                  type="file"
                  accept=".pdf,.docx,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleJdUpload(file);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Readiness */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-slate-800">{ready ? "Ready to analyze" : "Before you analyze"}</p>
        <ul className="space-y-1">
          <Check done={!!resumeFile}>Resume selected (PDF or DOCX)</Check>
          <Check done={jdReady}>Job description pasted ({MIN_JD_CHARS}+ characters) or uploaded</Check>
        </ul>
      </div>

      <Button
        size="lg"
        className="w-full bg-slate-900 text-white hover:bg-slate-800"
        disabled={!ready || isAnalyzing}
        onClick={handleAnalyze}
        aria-describedby={isAnalyzing ? "analysis-status" : undefined}
      >
        {isAnalyzing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Analyzing... {elapsed}s
          </>
        ) : (
          <>
            Analyze my fit
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </>
        )}
      </Button>
      {isAnalyzing && (
        <p id="analysis-status" role="status" className="mt-3 text-center text-sm text-slate-600">
          Uploading your files, extracting their text and matching them against the job description. Large or complex PDFs can take up
          to {PARSE_DEADLINE_SECONDS} seconds.
        </p>
      )}
    </div>
  );
}
