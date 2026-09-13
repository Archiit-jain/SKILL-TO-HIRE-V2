import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { User, UserSettings } from "@/types";
import {
  User as UserIcon,
  Shield,
  Bell,
  LogOut,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Save,
  KeyRound,
  Loader2,
} from "lucide-react";

interface SettingsPageProps {
  user: User;
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
  onAccountDeleted: () => void;
}

type Notice = { kind: "ok" | "error"; text: string } | null;

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      role={notice.kind === "error" ? "alert" : "status"}
      className={`text-sm ${notice.kind === "error" ? "text-rose-600" : "text-emerald-600"}`}
    >
      {notice.text}
    </p>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative mt-1">
      <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={128}
        className="pl-10 pr-10"
      />
      <button
        type="button"
        aria-label={show ? "Hide password" : "Show password"}
        onClick={() => setShow(!show)}
        className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

const errText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

export function SettingsPage({ user, onLogout, onUserUpdated, onAccountDeleted }: SettingsPageProps) {
  // Profile
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [profilePassword, setProfilePassword] = useState("");
  const [profileNotice, setProfileNotice] = useState<Notice>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  // Preferences
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<Notice>(null);

  // Delete
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteNotice, setDeleteNotice] = useState<Notice>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((err) => setSettingsNotice({ kind: "error", text: errText(err) }));
  }, []);

  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileNotice(null);
    try {
      const { user: updated } = await api.updateProfile(name, email, emailChanged ? profilePassword : undefined);
      onUserUpdated(updated);
      setProfilePassword("");
      setProfileNotice({ kind: "ok", text: "Profile saved" });
    } catch (err) {
      setProfileNotice({ kind: "error", text: errText(err) });
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordNotice(null);
    if (newPassword.length < 8) return setPasswordNotice({ kind: "error", text: "New password must be at least 8 characters" });
    if (newPassword !== confirmPassword) return setPasswordNotice({ kind: "error", text: "New passwords do not match" });
    setSavingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice({ kind: "ok", text: "Password changed. Other devices have been signed out." });
    } catch (err) {
      setPasswordNotice({ kind: "error", text: errText(err) });
    } finally {
      setSavingPassword(false);
    }
  };

  const updateSetting = async (patch: Partial<UserSettings>) => {
    if (!settings) return;
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSettingsNotice(null);
    try {
      await api.saveSettings(next);
    } catch (err) {
      setSettings(previous);
      setSettingsNotice({ kind: "error", text: errText(err) });
    }
  };

  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.confirm("Permanently delete your account and all saved analyses? This cannot be undone.")) return;
    setDeleting(true);
    setDeleteNotice(null);
    try {
      await api.deleteAccount(deletePassword);
      onAccountDeleted();
    } catch (err) {
      setDeleteNotice({ kind: "error", text: errText(err) });
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <h1 className="text-3xl font-bold text-slate-900 mb-8">Settings</h1>

      {/* Account */}
      <Card className="mb-6 bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-cyan-600" />
            Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={saveProfile}>
            <div>
              <Label htmlFor="settings-name">Name</Label>
              <Input id="settings-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required className="mt-1" />
            </div>
            <div>
              <Label htmlFor="settings-email">Email</Label>
              <div className="relative mt-1">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <Input id="settings-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" required className="pl-10" />
              </div>
            </div>
            {emailChanged && (
              <div>
                <Label htmlFor="settings-profile-password">Current password (required to change email)</Label>
                <PasswordInput id="settings-profile-password" value={profilePassword} onChange={setProfilePassword} autoComplete="current-password" />
              </div>
            )}
            <div className="flex items-center gap-4">
              <Button type="submit" className="bg-slate-900 hover:bg-slate-800 text-white" disabled={savingProfile}>
                {savingProfile ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Changes
              </Button>
              <NoticeBox notice={profileNotice} />
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Password */}
      <Card className="mb-6 bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-cyan-600" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={savePassword}>
            <div>
              <Label htmlFor="current-password">Current password</Label>
              <PasswordInput id="current-password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
            </div>
            <div>
              <Label htmlFor="new-password">New password</Label>
              <PasswordInput id="new-password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" placeholder="Minimum 8 characters" />
            </div>
            <div>
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <PasswordInput id="confirm-password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
            </div>
            <div className="flex items-center gap-4">
              <Button type="submit" className="bg-slate-900 hover:bg-slate-800 text-white" disabled={savingPassword || !currentPassword || !newPassword}>
                {savingPassword && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Update Password
              </Button>
              <NoticeBox notice={passwordNotice} />
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Privacy */}
      <Card className="mb-6 bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyan-600" />
            Privacy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-slate-900">Privacy Mode</p>
              <p className="text-sm text-slate-500">
                Redact emails, phone numbers and links from saved evidence, and don't store your resume's file name.
                Applies to new analyses.
              </p>
            </div>
            <Switch
              checked={settings?.privacyMode ?? true}
              disabled={!settings}
              onCheckedChange={(v) => updateSetting({ privacyMode: v })}
              aria-label="Privacy mode"
            />
          </div>
          <div className="p-4 bg-slate-50 rounded-lg">
            <p className="text-sm text-slate-600">
              <strong>Data Handling:</strong> Uploaded files are processed in memory and discarded immediately. Only
              the analysis result (scores, matched skills and short evidence snippets) is saved to your history, and
              you can delete it at any time.
            </p>
          </div>
          <NoticeBox notice={settingsNotice} />
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card className="mb-6 bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-cyan-600" />
            Preferences
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-slate-900">Email Notifications</p>
              <p className="text-sm text-slate-500">
                Save your preference for updates about your analysis results. (Email delivery is not configured yet.)
              </p>
            </div>
            <Switch
              checked={settings?.notifications ?? true}
              disabled={!settings}
              onCheckedChange={(v) => updateSetting({ notifications: v })}
              aria-label="Email notifications"
            />
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="bg-white border-rose-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-rose-600">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-900">Logout</p>
              <p className="text-sm text-slate-500">Sign out of your account</p>
            </div>
            <Button variant="outline" onClick={onLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
          <form onSubmit={deleteAccount} className="space-y-3">
            <div>
              <p className="font-medium text-slate-900">Delete Account</p>
              <p className="text-sm text-slate-500">
                Permanently delete your account and all associated data. Enter your password to confirm.
              </p>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <PasswordInput id="delete-password" value={deletePassword} onChange={setDeletePassword} autoComplete="current-password" placeholder="Current password" />
              </div>
              <Button type="submit" variant="destructive" disabled={!deletePassword || deleting}>
                {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Delete
              </Button>
            </div>
            <NoticeBox notice={deleteNotice} />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
