import { FlaskConical } from "lucide-react";

/** Shown only on Vercel preview builds, where the backend database lives in temporary storage. */
export function PreviewBanner({ className = "" }: { className?: string }) {
  if (!__PREVIEW_DEPLOY__) return null;
  return (
    <div
      role="note"
      className={`flex items-center justify-center gap-2 bg-amber-100 text-amber-900 text-xs px-4 py-2 ${className}`}
    >
      <FlaskConical className="w-4 h-4 shrink-0" />
      <span>
        <strong>Preview build - under development.</strong> Accounts and analyses are stored temporarily and may reset
        at any time. Don't upload real personal documents.
      </span>
    </div>
  );
}
