"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/";

  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === "register") {
        const res = await fetch(`${API_BASE}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail ?? "Registrazione fallita");
        }
        // Auto-login after register
      }

      // Login
      const form = new URLSearchParams();
      form.append("username", username);
      form.append("password", password);
      const res = await fetch(`${API_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      if (!res.ok) throw new Error("Credenziali non valide");

      const data = await res.json();
      sessionStorage.setItem("jwt_token", data.access_token);
      sessionStorage.setItem("username", username);
      router.push(redirectTo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore sconosciuto");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ backgroundColor: "white", padding: "2rem", borderRadius: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", width: "340px" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", marginBottom: "0.25rem" }}>CardFlow</h1>

      {/* Mode tabs */}
      <div style={{ display: "flex", gap: "0", marginBottom: "1.5rem", border: "1px solid #d1d5db", borderRadius: "8px", overflow: "hidden" }}>
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(null); }}
            style={{
              flex: 1,
              padding: "0.5rem",
              border: "none",
              cursor: "pointer",
              fontWeight: mode === m ? "600" : "400",
              backgroundColor: mode === m ? "#2563eb" : "white",
              color: mode === m ? "white" : "#374151",
              fontSize: "0.9rem",
            }}
          >
            {m === "login" ? "Accedi" : "Registrati"}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: "0.75rem", backgroundColor: "#fee2e2", color: "#dc2626", borderRadius: "6px", marginBottom: "1rem", fontSize: "0.85rem" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "0.5rem 0.75rem", fontSize: "1rem" }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "0.5rem 0.75rem", fontSize: "1rem" }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ backgroundColor: "#2563eb", color: "white", border: "none", borderRadius: "6px", padding: "0.6rem", fontWeight: "bold", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}
        >
          {loading ? "…" : mode === "login" ? "Accedi" : "Registrati e accedi"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f3f4f6" }}>
      <Suspense fallback={<div style={{ color: "#6b7280" }}>Caricamento…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
