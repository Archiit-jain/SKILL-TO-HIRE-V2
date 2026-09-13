import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { api, ApiError } from "@/lib/api";
import { AuthProviders, SignupResult } from "@/types";
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
  ArrowLeft,
  MailCheck,
  Info,
} from "lucide-react";

interface AuthPageProps {
  providers: AuthProviders;
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (name: string, email: string, password: string) => Promise<SignupResult>;
  onGoogle: (credential: string) => Promise<void>;
  /** Why the auth screen was opened, e.g. the free analysis has been used. */
  notice?: string | null;
  initialMode?: "login" | "signup";
  /** Return to the app as a guest. */
  onBack?: () => void;
}

export function AuthPage({ providers, onLogin, onSignup, onGoogle, notice, initialMode = "login", onBack }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Set after sign-up (or an unverified login): shows the "check your inbox" panel. */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  const switchMode = (next: "login" | "signup") => {
    setMode(next);
    setError(null);
    setPassword("");
  };

  const toError = (err: unknown) =>
    err instanceof ApiError ? { message: err.message, code: err.code } : { message: err instanceof Error ? err.message : "Something went wrong" };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await onLogin(email, password);
      } else {
        const result = await onSignup(name, email, password);
        setPendingEmail(result.email);
        setResendState("idle");
      }
    } catch (err) {
      const e = toError(err);
      if (e.code === "email_not_verified") {
        setPendingEmail(email.trim().toLowerCase());
        setResendState("idle");
      }
      setError(e);
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async (credential: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await onGoogle(credential);
    } catch (err) {
      setError(toError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async (address: string) => {
    setResendState("sending");
    try {
      await api.resendVerification(address);
      setResendState("sent");
    } catch (err) {
      setError(toError(err));
      setResendState("idle");
    }
  };

  const emailSignupDisabled = mode === "signup" && !providers.emailSignup;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4 pt-14">
      <div className="w-full max-w-md">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        )}
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
            {pendingEmail ? (
              <div className="text-center space-y-4" role="status">
                <div className="w-14 h-14 mx-auto rounded-full bg-cyan-50 flex items-center justify-center">
                  <MailCheck className="w-7 h-7 text-cyan-600" />
                </div>
                <h2 className="text-xl font-semibold text-slate-900">Verify your email</h2>
                <p className="text-sm text-slate-600">
                  We sent a verification link to <strong className="break-all">{pendingEmail}</strong>. Open it to activate
                  your account. Check your spam folder if you don't see it.
                </p>
                {error && error.code !== "email_not_verified" && (
                  <p role="alert" className="text-sm text-rose-600">{error.message}</p>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={resendState !== "idle"}
                  onClick={() => resend(pendingEmail)}
                >
                  {resendState === "sending" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {resendState === "sent" ? "Link sent - check your inbox" : "Resend verification email"}
                </Button>
                <button
                  type="button"
                  className="text-sm text-slate-500 hover:text-slate-900"
                  onClick={() => {
                    setPendingEmail(null);
                    setError(null);
                    switchMode("login");
                  }}
                >
                  Back to login
                </button>
              </div>
            ) : (
              <>
                {notice && (
                  <div role="note" className="flex items-start gap-2 p-3 mb-5 rounded-lg bg-cyan-50 text-cyan-900 text-sm">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    {notice}
                  </div>
                )}

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

                {providers.googleClientId && (
                  <>
                    <GoogleSignInButton
                      clientId={providers.googleClientId}
                      onCredential={handleGoogle}
                      text={mode === "signup" ? "signup_with" : "signin_with"}
                    />
                    <div className="flex items-center gap-3 my-5">
                      <div className="flex-1 h-px bg-slate-200" />
                      <span className="text-xs text-slate-400">or use email</span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                  </>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 text-rose-700 text-sm">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <div>
                        {error.message}
                        {error.code === "email_unverified_exists" && (
                          <button
                            type="button"
                            className="block mt-1 font-medium underline"
                            onClick={() => {
                              setPendingEmail(email.trim().toLowerCase());
                              setError(null);
                              resend(email.trim().toLowerCase());
                            }}
                          >
                            Resend verification email
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {emailSignupDisabled && (
                    <div role="note" className="p-3 rounded-lg bg-amber-50 text-amber-900 text-sm">
                      Email sign-up isn't available on this deployment yet
                      {providers.googleClientId ? " - please continue with Google above." : "."}
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
                          disabled={emailSignupDisabled}
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
                        disabled={emailSignupDisabled}
                      />
                    </div>
                    {mode === "signup" && (
                      <p className="text-xs text-slate-500 mt-1">Use a real address - we'll send a link to verify it. Temporary emails aren't accepted.</p>
                    )}
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
                        disabled={emailSignupDisabled}
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
                    disabled={submitting || emailSignupDisabled}
                  >
                    {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {mode === "login" ? "Login" : "Create Account"}
                    {!submitting && <ArrowRight className="w-4 h-4 ml-2" />}
                  </Button>
                </form>
              </>
            )}

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
