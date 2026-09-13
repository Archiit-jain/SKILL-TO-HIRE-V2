import { useEffect, useRef, useState } from "react";

const GSI_SRC = "https://accounts.google.com/gsi/client";

interface GoogleIdApi {
  initialize(options: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    ux_mode?: "popup" | "redirect";
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: { theme?: string; size?: string; text?: string; shape?: string; width?: number; logo_alignment?: string }
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load Google sign-in"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

interface GoogleSignInButtonProps {
  clientId: string;
  /** Receives the Google ID token (JWT). The server verifies it; the client never trusts it. */
  onCredential: (credential: string) => void;
  text?: "signin_with" | "signup_with" | "continue_with";
}

/** Official Google Identity Services button (popup flow). */
export function GoogleSignInButton({ clientId, onCredential, text = "continue_with" }: GoogleSignInButtonProps) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !container.current || !window.google) return;
        const id = window.google.accounts.id;
        id.initialize({
          client_id: clientId,
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: (response) => {
            if (response.credential) callback.current(response.credential);
          },
        });
        container.current.innerHTML = "";
        id.renderButton(container.current, {
          theme: "outline",
          size: "large",
          text,
          shape: "rectangular",
          logo_alignment: "center",
          width: Math.min(container.current.offsetWidth || 320, 400),
        });
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, text]);

  return (
    <div>
      <div ref={container} className="flex justify-center min-h-[44px]" />
      {error && <p className="text-xs text-rose-600 text-center mt-1">{error}</p>}
    </div>
  );
}
