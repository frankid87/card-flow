"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArtworkResponse, ElementEnum } from "../../../types";
import { apiFetch } from "../../../lib/api";

const ELEMENTS: ElementEnum[] = ["Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral"];

export default function CreatePiecePage() {
  const router = useRouter();
  const [artworks, setArtworks] = useState<ArtworkResponse[]>([]);
  const [selectedArtwork, setSelectedArtwork] = useState<ArtworkResponse | null>(null);
  const [name, setName] = useState("");
  const [element, setElement] = useState<ElementEnum>("Neutral");
  const [baseHp, setBaseHp] = useState(75);
  const [baseAtk, setBaseAtk] = useState(75);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Artwork creation
  const [imageUrl, setImageUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [creatingArtwork, setCreatingArtwork] = useState(false);

  useEffect(() => {
    apiFetch("/artworks").then(r => r.json()).then(setArtworks).catch(() => {});
  }, []);

  async function handleCreateArtwork(e: React.FormEvent) {
    e.preventDefault();
    setCreatingArtwork(true);
    setError(null);
    try {
      const res = await apiFetch("/artworks", {
        method: "POST",
        body: JSON.stringify({ image_url: imageUrl, prompt }),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? "Errore");
      const art: ArtworkResponse = await res.json();
      setArtworks(prev => [...prev, art]);
      setSelectedArtwork(art);
      setImageUrl("");
      setPrompt("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setCreatingArtwork(false);
    }
  }

  async function handleCreatePiece(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedArtwork) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch("/pieces", {
        method: "POST",
        body: JSON.stringify({
          artwork_id: selectedArtwork.id,
          name,
          element,
          base_hp: baseHp,
          base_atk: baseAtk,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? "Errore");
      setSuccess(`Pedina "${name}" creata!`);
      setName("");
      setElement("Neutral");
      setBaseHp(75);
      setBaseAtk(75);
      setSelectedArtwork(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "640px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
        <button onClick={() => router.push("/pieces/select")}
          style={{ padding: "0.375rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.875rem", cursor: "pointer", backgroundColor: "white" }}>
          ← Le mie pedine
        </button>
        <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>Crea una pedina</h1>
      </div>

      {error && <div style={{ padding: "0.75rem", backgroundColor: "#fee2e2", color: "#dc2626", borderRadius: "6px", marginBottom: "1rem" }}>{error}</div>}
      {success && <div style={{ padding: "0.75rem", backgroundColor: "#dcfce7", color: "#16a34a", borderRadius: "6px", marginBottom: "1rem" }}>✓ {success}</div>}

      {/* Step 1: artwork */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontWeight: "600", marginBottom: "0.75rem" }}>1. Scegli o crea un artwork</h2>

        {artworks.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
            {artworks.map(art => (
              <button key={art.id} onClick={() => setSelectedArtwork(art)}
                style={{ border: `2px solid ${selectedArtwork?.id === art.id ? "#2563eb" : "#d1d5db"}`, borderRadius: "8px", overflow: "hidden", width: "64px", height: "64px", cursor: "pointer", padding: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={art.image_url} alt={art.prompt ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </button>
            ))}
          </div>
        )}

        <details style={{ border: "1px solid #d1d5db", borderRadius: "8px", padding: "0.75rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: "500", fontSize: "0.9rem" }}>+ Aggiungi nuovo artwork</summary>
          <form onSubmit={handleCreateArtwork} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.75rem" }}>
            <input placeholder="URL immagine" value={imageUrl} onChange={e => setImageUrl(e.target.value)} required
              style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "0.5rem 0.75rem" }} />
            <input placeholder="Descrizione (opzionale)" value={prompt} onChange={e => setPrompt(e.target.value)}
              style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "0.5rem 0.75rem" }} />
            <button type="submit" disabled={creatingArtwork}
              style={{ padding: "0.5rem 1rem", backgroundColor: "#6b7280", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>
              {creatingArtwork ? "…" : "Crea artwork"}
            </button>
          </form>
        </details>
      </section>

      {/* Step 2: piece stats */}
      {selectedArtwork && (
        <section>
          <h2 style={{ fontWeight: "600", marginBottom: "0.75rem" }}>2. Definisci le statistiche</h2>
          <form onSubmit={handleCreatePiece} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: "320px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.9rem" }}>
              Nome
              <input value={name} onChange={e => setName(e.target.value)} required
                style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "0.5rem 0.75rem" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.9rem" }}>
              Elemento
              <select value={element} onChange={e => setElement(e.target.value as ElementEnum)}
                style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "0.5rem 0.75rem" }}>
                {ELEMENTS.map(el => <option key={el} value={el}>{el}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.9rem" }}>
              HP base (75-100)
              <input type="number" min={75} max={100} value={baseHp}
                onChange={e => {
                  const v = Number(e.target.value);
                  setBaseHp(v);
                  // Auto-adjust ATK to keep sum = 150
                  const atk = 150 - v;
                  if (atk >= 50 && atk <= 75) setBaseAtk(atk);
                }} required
                style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "0.5rem 0.75rem" }} />
              {baseHp < 75 || baseHp > 100 && (
                <span style={{ color: "#dc2626", fontSize: "0.75rem" }}>Deve essere tra 75 e 100</span>
              )}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.9rem" }}>
              ATK base (50-75)
              <input type="number" min={50} max={75} value={baseAtk}
                onChange={e => {
                  const v = Number(e.target.value);
                  setBaseAtk(v);
                  // Auto-adjust HP to keep sum = 150
                  const hp = 150 - v;
                  if (hp >= 75 && hp <= 100) setBaseHp(hp);
                }} required
                style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "0.5rem 0.75rem" }} />
              {baseAtk < 50 || baseAtk > 75 && (
                <span style={{ color: "#dc2626", fontSize: "0.75rem" }}>Deve essere tra 50 e 75</span>
              )}
            </label>

            {/* Somma HP+ATK */}
            <div style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "6px",
              fontSize: "0.85rem",
              textAlign: "center",
              backgroundColor: baseHp + baseAtk === 150 ? "#dcfce7" : "#fef3c7",
              color: baseHp + baseAtk === 150 ? "#16a34a" : "#92400e",
              border: `1px solid ${baseHp + baseAtk === 150 ? "#86efac" : "#fcd34d"}`,
            }}>
              {baseHp + baseAtk === 150
                ? `✓ HP ${baseHp} + ATK ${baseAtk} = ${baseHp + baseAtk} (OK)`
                : `⚠ HP ${baseHp} + ATK ${baseAtk} = ${baseHp + baseAtk} (deve essere 150)`
              }
            </div>
            <button type="submit" disabled={loading || baseHp + baseAtk !== 150}
              style={{ padding: "0.75rem", backgroundColor: (loading || baseHp + baseAtk !== 150) ? "#93c5fd" : "#2563eb", color: "white", border: "none", borderRadius: "8px", fontWeight: "600", cursor: (loading || baseHp + baseAtk !== 150) ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
              {loading ? "Creazione…" : baseHp + baseAtk !== 150 ? "Somma HP+ATK deve essere 150" : "Crea pedina"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}


