"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "../lib/api";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
    }
  }, [router]);

  return (
    <main style={{ padding: "2rem", maxWidth: "480px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "0.5rem" }}>CardFlow</h1>
      <p style={{ color: "#6b7280", marginBottom: "2rem" }}>Battle Checkers con pedine personalizzate</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <button onClick={() => router.push("/pieces/create")}
          style={{ padding: "1rem 1.5rem", backgroundColor: "white", border: "2px solid #d1d5db", borderRadius: "10px", textAlign: "left", cursor: "pointer" }}>
          <div style={{ fontWeight: "600", marginBottom: "0.25rem" }}>🎨 Crea pedine</div>
          <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>Crea nuove pedine con artwork e statistiche</div>
        </button>

        <button onClick={() => router.push("/pieces/select?returnTo=/game")}
          style={{ padding: "1rem 1.5rem", backgroundColor: "white", border: "2px solid #d1d5db", borderRadius: "10px", textAlign: "left", cursor: "pointer" }}>
          <div style={{ fontWeight: "600", marginBottom: "0.25rem" }}>⚔️ Scegli le tue pedine</div>
          <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>Seleziona 12 pedine per la prossima partita</div>
        </button>

        <button onClick={() => router.push("/game")}
          style={{ padding: "1rem 1.5rem", backgroundColor: "#2563eb", border: "none", borderRadius: "10px", textAlign: "left", cursor: "pointer", color: "white" }}>
          <div style={{ fontWeight: "600", marginBottom: "0.25rem" }}>🎮 Gioca</div>
          <div style={{ fontSize: "0.875rem", opacity: 0.85 }}>Avvia una nuova partita</div>
        </button>
      </div>
    </main>
  );
}
