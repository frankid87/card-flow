"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArtworkResponse, GamePieceResponse, ElementEnum } from "../types";
import { apiFetch, getToken } from "../lib/api";

const ELEMENTS: ElementEnum[] = [
  "Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral",
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MAX_PIECES = 12;

type Player = "player1" | "player2";

function loadFromSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export default function Dashboard() {
  const router = useRouter();
  const [artworks, setArtworks] = useState<ArtworkResponse[]>([]);
  const [selectedArtwork, setSelectedArtwork] = useState<ArtworkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activePlayer, setActivePlayer] = useState<Player>("player1");

  const [player1Pieces, setPlayer1Pieces] = useState<GamePieceResponse[]>(() =>
    loadFromSession("player1Pieces", [])
  );
  const [player2Pieces, setPlayer2Pieces] = useState<GamePieceResponse[]>(() =>
    loadFromSession("player2Pieces", [])
  );

  // Form state
  const [name, setName] = useState("");
  const [element, setElement] = useState<ElementEnum>("Neutral");
  const [baseHp, setBaseHp] = useState(100);
  const [baseAtk, setBaseAtk] = useState(10);

  useEffect(() => {
    // Redirect to login if no token
    if (!getToken()) {
      router.push("/login");
      return;
    }
    apiFetch("/artworks")
      .then((r) => r.json())
      .then((data) => setArtworks(data))
      .catch(() => setError("Failed to load artworks."));
  }, [router]);

  // Persist pieces to sessionStorage whenever they change
  useEffect(() => {
    sessionStorage.setItem("player1Pieces", JSON.stringify(player1Pieces));
  }, [player1Pieces]);

  useEffect(() => {
    sessionStorage.setItem("player2Pieces", JSON.stringify(player2Pieces));
  }, [player2Pieces]);

  const currentPieces = activePlayer === "player1" ? player1Pieces : player2Pieces;
  const canAddMore = currentPieces.length < MAX_PIECES;
  const canStartGame = player1Pieces.length === MAX_PIECES && player2Pieces.length === MAX_PIECES;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedArtwork || !canAddMore) return;
    setLoading(true);
    setError(null);
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      const piece: GamePieceResponse = await res.json();
      if (activePlayer === "player1") {
        setPlayer1Pieces((prev) => [...prev, piece]);
      } else {
        setPlayer2Pieces((prev) => [...prev, piece]);
      }
      setName("");
      setElement("Neutral");
      setBaseHp(100);
      setBaseAtk(10);
      setSelectedArtwork(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setLoading(false);
    }
  }

  function handleStartGame() {
    router.push("/game");
  }

  function handleReset() {
    setPlayer1Pieces([]);
    setPlayer2Pieces([]);
    sessionStorage.removeItem("player1Pieces");
    sessionStorage.removeItem("player2Pieces");
  }

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <div className="flex items-baseline gap-4 mb-2">
        <h1 className="text-3xl font-bold">CardFlow — Setup</h1>
        <button onClick={handleReset} className="text-sm text-red-500 hover:underline">
          Reset
        </button>
      </div>
      <p className="text-gray-500 mb-6">Create {MAX_PIECES} pieces per player, then start the game.</p>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded" role="alert">
          {error}
        </div>
      )}

      {/* Player tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(["player1", "player2"] as Player[]).map((p) => {
          const pieces = p === "player1" ? player1Pieces : player2Pieces;
          const isActive = activePlayer === p;
          const full = pieces.length === MAX_PIECES;
          return (
            <button
              key={p}
              onClick={() => setActivePlayer(p)}
              className={`px-4 py-2 rounded font-semibold border-2 transition-colors ${
                isActive
                  ? "bg-blue-600 text-white border-blue-600"
                  : full
                  ? "bg-green-50 text-green-700 border-green-400"
                  : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
              }`}
            >
              {p === "player1" ? "Player 1" : "Player 2"} ({pieces.length}/{MAX_PIECES})
              {full && " ✓"}
            </button>
          );
        })}

        {canStartGame && (
          <button
            onClick={handleStartGame}
            className="ml-auto px-6 py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700"
          >
            Start Game →
          </button>
        )}
      </div>

      <div className="flex gap-8">
        {/* Left: artwork picker + form */}
        <div className="flex-1 min-w-0">
          <section className="mb-6">
            <h2 className="text-lg font-semibold mb-2">
              Select Artwork — {activePlayer === "player1" ? "Player 1" : "Player 2"}
            </h2>
            {artworks.length === 0 ? (
              <p className="text-gray-400 text-sm">No artworks found. Add some via the API first.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {artworks.map((art) => (
                  <button
                    key={art.id}
                    onClick={() => setSelectedArtwork(art)}
                    className={`border-2 rounded overflow-hidden w-16 h-16 flex-shrink-0 ${
                      selectedArtwork?.id === art.id ? "border-blue-500" : "border-gray-300"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={art.image_url}
                      alt={art.prompt ?? "artwork"}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </section>

          {selectedArtwork && canAddMore && (
            <section>
              <h2 className="text-lg font-semibold mb-2">New Piece</h2>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-xs">
                <label className="flex flex-col gap-1 text-sm">
                  Name
                  <input
                    className="border rounded px-2 py-1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Element
                  <select
                    className="border rounded px-2 py-1"
                    value={element}
                    onChange={(e) => setElement(e.target.value as ElementEnum)}
                  >
                    {ELEMENTS.map((el) => (
                      <option key={el} value={el}>{el}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Base HP
                  <input type="number" min={1} className="border rounded px-2 py-1"
                    value={baseHp} onChange={(e) => setBaseHp(Number(e.target.value))} required />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Base ATK
                  <input type="number" min={1} className="border rounded px-2 py-1"
                    value={baseAtk} onChange={(e) => setBaseAtk(Number(e.target.value))} required />
                </label>
                <button type="submit" disabled={loading}
                  className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50">
                  {loading ? "Creating…" : `Add to ${activePlayer === "player1" ? "Player 1" : "Player 2"}`}
                </button>
              </form>
            </section>
          )}

          {!canAddMore && (
            <p className="text-green-600 font-semibold mt-4">
              ✓ {activePlayer === "player1" ? "Player 1" : "Player 2"} roster is full!
            </p>
          )}
        </div>

        {/* Right: piece list — text only, no PieceRenderer to avoid layout issues */}
        <div className="w-64 flex-shrink-0">
          <h2 className="text-lg font-semibold mb-2">
            {activePlayer === "player1" ? "Player 1" : "Player 2"} Pieces
          </h2>
          {currentPieces.length === 0 ? (
            <p className="text-gray-400 text-sm">No pieces yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {currentPieces.map((piece, i) => (
                <div key={piece.id} className="flex items-center gap-2 p-2 border rounded bg-gray-50 text-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={piece.artwork.image_url}
                    alt={piece.name}
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <span className="text-gray-400 mr-1">{i + 1}.</span>
                    <span className="font-semibold">{piece.name}</span>
                    <div className="text-gray-500 text-xs">{piece.element} · HP {piece.base_hp} · ATK {piece.base_atk}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
