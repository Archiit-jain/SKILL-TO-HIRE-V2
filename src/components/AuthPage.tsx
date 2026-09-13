import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sparkles,
  Mail,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  Shield,
  ArrowRight,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface AuthPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (name: string, email: string, password: string) => Promise<void>;
}

export function AuthPage({ onLogin, onSignup }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (next: "login" | "signup") => {
    setMode(next);
    setError(null);
    setPassword("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await onLogin(email, password);
      } else {
        await onSignup(name, email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-12 h-12 bg-cyan-500 rounded-xl flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-slate-900" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Skill2Hire</h1>
          <p className="text-slate-400">
            Know Your Skills. Bridge Your Gaps. Get Hired.
          </p>
        </div>

        <Card className="bg-white border-0 shadow-xl">
          <CardContent className="p-8">
            {/* Tabs */}
            <div className="flex bg-slate-100 rounded-lg p-1 mb-6">
              <button
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                  mode === "login"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                type="button"
                onClick={() => switchMode("login")}
              >
                Login
              </button>
              <button
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                  mode === "signup"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                type="button"
                onClick={() => switchMode("signup")}
              >
                Sign Up
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 text-rose-700 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
              {mode === "signup" && (
                <div>
                  <Label htmlFor="name">Name</Label>
                  <div className="relative mt-1">
                    <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <Input
                      id="name"
                      placeholder="Your full name"
                      className="pl-10"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      maxLength={80}
                      required
                    />
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="email">Email</Label>
                <div className="relative mt-1">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    className="pl-10"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    maxLength={254}
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative mt-1">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Minimum 8 characters"
                    className="pl-10 pr-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                    minLength={8}
                    maxLength={128}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-slate-900 hover:bg-slate-800 text-white"
                disabled={submitting}
              >
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {mode === "login" ? "Login" : "Create Account"}
                {!submitting && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Shield className="w-3 h-3" />
              Passwords are hashed and your data is never shared
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}