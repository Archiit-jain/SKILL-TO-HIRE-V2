import { Database } from "lucide-react";

/**
 * Shown only when the server reports that saved data is not persistent (a deployment without a hosted database, where
 * storage lives in the instance's temporary directory). Hidden until the server has answered.
 */
export function PreviewBanner({ persistentStorage, className = "" }: { persistentStorage?: boolean; className?: string }) {
  if (persistentStorage !== false) return null;
  return (
    <div role="note" className={`flex items-center justify-center gap-2 bg-amber-100 text-amber-900 text-xs px-4 py-2 ${className}`}>
      <Database className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>
        <strong>Temporary storage.</strong> Accounts and analyses on this deployment can reset at any time. Use sample
        documents, not real personal data.
      </span>
    </div>
  );
}
