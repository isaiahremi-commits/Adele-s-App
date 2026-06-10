"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    // Session cookie is set by the browser client; go to the original path.
    router.push(redirect);
    router.refresh();
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ background: "var(--background)" }}>
      <div className="card p-8 w-full" style={{ maxWidth: 380 }}>
        <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--primary)" }}>Manadele</h1>
        <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>Sign in to continue</p>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="text-sm">
            <span style={{ color: "var(--muted)" }}>Email</span>
            <input type="email" required autoComplete="email" className="input mt-1"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="text-sm">
            <span style={{ color: "var(--muted)" }}>Password</span>
            <input type="password" required autoComplete="current-password" className="input mt-1"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && (
            <div className="text-sm p-2 rounded-md" style={{ background: "rgba(239,159,39,0.15)", color: "var(--amber)" }}>
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary mt-2" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "var(--background)" }} />}>
      <LoginForm />
    </Suspense>
  );
}
