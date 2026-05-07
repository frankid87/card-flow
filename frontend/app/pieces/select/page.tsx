"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { GamePieceResponse } from "../../../types";
import { apiFetch } from "../../../lib/api";

const MAX_PIECES = 12;

function SelectPiecesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "/game";

  const [pieces, setPieces] = useState<GamePieceResponse[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/pieces")
      .then(r => r.json())
      .then(data => { setPieces(data); setLoading(false); })
      .catch(() => { setError("Errore nel caricamento delle pedine."); setLoading(false); });
  }, []);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_PIECES) {
        next.add(id);
      }
      return next;
    });
  }

  function handleConfirm() {
    const selectedPieces = pieces.filter(p => selected.has(p.id.toString()));
    sessionStorage.setItem("myPieces", JSON.stringify(selectedPieces));
    router.push(returnTo);
  }

  if (loading) return <main style={{ padding: "2rem", color: "#6b7280" }}>Caricamento…</main>;

  return (
    <main style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem", flexWrap: "wrap" }}>
        <button onClick={() => router.push("/pieces/create")}
          style={{ padding: "0.375rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.875rem", cursor: "pointer", backgroundColor: "white" }}>
          + Crea pedine
        </button>
        <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>Le mie pedine</h1>
        <span style={{ fontSize: "0.875rem", color: "#6b7280", marginLeft: "auto" }}>
          {selected.size} / {MAX_PIECES} selezionate
        </span>
      </div>

      {error && <div style={{ padding: "0.75rem", backgroundColor: "#fee2e2", color: "#dc2626", borderRadius: "6px", marginBottom: "1rem" }}>{error}</div>}

      {pieces.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#6b7280" }}>
          <p style={{ marginBottom: "1rem" }}>Non hai ancora creato nessuna pedina.</p>
          <button onClick={() => router.push("/pieces/create")}
            style={{ padding: "0.75rem 1.5rem", backgroundColor: "#2563eb", color: "white", border: "none", borderRadius: "8px", fontWeight: "600", cursor: "pointer" }}>
            Crea la tua prima pedina
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
            {pieces.map(piece => {
              const isSelected = selected.has(piece.id.toString());
              const isDisabled = !isSelected && selected.size >= MAX_PIECES;
              return (
                <button key={piece.id.toString()} onClick={() => toggle(piece.id.toString())} disabled={isDisabled}
                  style={{
                    border: `2px solid ${isSelected ? "#2563eb" : "#d1d5db"}`,
                    borderRadius: "10px",
                    padding: "0.75rem",
                    backgroundColor: isSelected ? "#eff6ff" : isDisabled ? "#f9fafb" : "white",
                    cursor: isDisabled ? "not-allowed" : "pointer",
                    opacity: isDisabled ? 0.5 : 1,
                    textAlign: "left",
                    position: "relative",
                  }}>
                  {isSelected && (
                    <div style={{ position: "absolute", top: "0.4rem", right: "0.4rem", width: "20px", height: "20px", borderRadius: "50%", backgroundColor: "#2563eb", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: "bold" }}>
                      ✓
                    </div>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={piece.artwork.image_url} alt={piece.name}
                    style={{ width: "100%", height: "80px", objectFit: "cover", borderRadius: "6px", marginBottom: "0.5rem" }} />
                  <div style={{ fontWeight: "600", fontSize: "0.9rem", marginBottom: "0.25rem" }}>{piece.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{piece.element}</div>
                  <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>HP {piece.base_hp} · ATK {piece.base_atk}</div>
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={handleConfirm} disabled={selected.size !== MAX_PIECES}
              style={{
                padding: "0.75rem 2rem",
                backgroundColor: selected.size === MAX_PIECES ? "#2563eb" : "#93c5fd",
                color: "white",
                border: "none",
                borderRadius: "8px",
                fontWeight: "600",
                fontSize: "1rem",
                cursor: selected.size === MAX_PIECES ? "pointer" : "not-allowed",
              }}>
              {selected.size === MAX_PIECES ? "Conferma selezione →" : `Seleziona ancora ${MAX_PIECES - selected.size} pedine`}
            </button>
          </div>
        </>
      )}
    </main>
  );
}

export default function SelectPiecesPage() {
  return (
    <Suspense fallback={<main style={{ padding: "2rem", color: "#6b7280" }}>Caricamento…</main>}>
      <SelectPiecesContent />
    </Suspense>
  );
}
