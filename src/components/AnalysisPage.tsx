import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { AnalysisResult } from "@/types";
import {
  Upload,
  FileText,
  Loader2,
  ArrowRight,
  Shield,
  FileUp,
  X,
  AlertCircle,
  Gift,
} from "lucide-react";

interface AnalysisPageProps {
  onAnalysisComplete: (result: AnalysisResult) => void;
  isGuest: boolean;
  /** The server refused a guest's second analysis: open the login screen with this message. */
  onLoginRequired: (message: string) => void;
}

// Vercel functions reject request bodies over 4.5MB, so preview builds use a 4MB limit.
const MAX_MB = __PREVIEW_DEPLOY__ ? 4 : 5;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const MAX_JD_CHARS = 50_000;

function validateFile(file: File, allowed: string[]): string | null {
  const ext = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (!allowed.includes(ext)) return `Unsupported file type. Allowed: ${allowed.join(", ")}`;
  if (file.size > MAX_BYTES) return `File size exceeds ${MAX_MB}MB limit`;
  if (file.size === 0) return "File is empty";
  return null;
}

export function AnalysisPage({ onAnalysisComplete, isGuest, onLoginRequired }: AnalysisPageProps) {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jdText, setJdText] = useState("");
  const [jdTitle, setJdTitle] = useState("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!resumeFile || (!jdText.trim() && !jdFile)) return;
    setIsAnalyzing(true);
    setError(null);
    const form = new FormData();
    form.append("resume", resumeFile);
    if (jdTitle.trim()) form.append("jdTitle", jdTitle.trim());
    if (jdText.trim()) form.append("jdText", jdText.trim());
    else if (jdFile) form.append("jdFile", jdFile);
    try {
      const { result } = await api.analyze(form);
      onAnalysisComplete(result);
    } catch (err) {
      if (err instanceof ApiError && err.code === "login_required") {
        onLoginRequired(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <h1 className="text-3xl font-bold text-slate-900 mb-2">New Analysis</h1>
      <p className="text-slate-600 mb-8">Upload your resume and target job description to get started.</p>

      {isGuest && (
        <div role="note" className="flex items-start gap-2 p-4 mb-6 rounded-lg bg-cyan-50 text-cyan-900 text-sm border border-cyan-200">
          <Gift className="w-4 h-4 mt-0.5 shrink-0" />
          Your first analysis is free - no account needed. Log in afterwards to save it and run more.
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 p-4 mb-6 rounded-lg bg-rose-50 text-rose-700 text-sm border border-rose-200">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Step 1: Resume */}
      <Card className="mb-6 bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="w-8 h-8 bg-slate-900 text-cyan-400 rounded-lg flex items-center justify-center text-sm font-bold">1</span>
            Upload Resume
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!resumeFile ? (
            <div
              className={`
                border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors
                ${dragOver ? "border-cyan-500 bg-cyan-50" : "border-slate-300 hover:border-slate-400"}
              `}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) handleResumeUpload(file);
              }}
              onClick={() => document.getElementById("resume-upload")?.click()}
            >
              <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <p className="text-slate-600 mb-2">Drag and drop your resume here, or click to browse</p>
              <p className="text-sm text-slate-400">PDF or DOCX · Max {MAX_MB}MB</p>
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
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-cyan-600" />
                <div>
                  <p className="font-medium text-slate-900">{resumeFile.name}</p>
                  <p className="text-sm text-slate-500">
                    {(resumeFile.size / 1024).toFixed(1)} KB · Ready to analyze
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setResumeFile(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2 mt-4 text-xs text-slate-500">
            <Shield className="w-3 h-3" />
            Your file is processed in memory and discarded. Only the analysis result is saved to your history.
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Job Description */}
      <Card className="mb-6 bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="w-8 h-8 bg-slate-900 text-cyan-400 rounded-lg flex items-center justify-center text-sm font-bold">2</span>
            Job Description
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="jd-title">Job Title (optional)</Label>
              <Input
                id="jd-title"
                placeholder="e.g. Data Engineer - detected from the JD if left empty"
                className="mt-2"
                maxLength={120}
                value={jdTitle}
                onChange={(e) => setJdTitle(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="jd-text">Paste Job Description</Label>
              <Textarea
                id="jd-text"
                placeholder="Paste the job description here..."
                className="mt-2 min-h-[200px]"
                maxLength={MAX_JD_CHARS}
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
              />
              {jdText && jdFile && (
                <p className="text-xs text-slate-500 mt-1">Pasted text is used instead of the uploaded file.</p>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-sm text-slate-400">or</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <div>
              <Label>Upload Job Description</Label>
              <div className="mt-2">
                {!jdFile ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => document.getElementById("jd-upload")?.click()}
                  >
                    <FileUp className="w-4 h-4 mr-2" />
                    Upload JD File
                  </Button>
                ) : (
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileText className="w-8 h-8 text-cyan-600" />
                      <div>
                        <p className="font-medium text-slate-900">{jdFile.name}</p>
                        <p className="text-sm text-slate-500">
                          {(jdFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setJdFile(null)}>
                      <X className="w-4 h-4" />
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

      <Button
        size="lg"
        className="w-full bg-slate-900 hover:bg-slate-800 text-white"
        disabled={!resumeFile || (!jdText.trim() && !jdFile) || isAnalyzing}
        onClick={handleAnalyze}
      >
        {isAnalyzing ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Analyzing Your Fit...
          </>
        ) : (
          <>
            Analyze My Fit
            <ArrowRight className="w-4 h-4 ml-2" />
          </>
        )}
      </Button>
    </div>
  );
}