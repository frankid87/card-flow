"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GamePieceResponse, SessionResponse } from "../../types";
import Board from "../../components/Board";
import { apiFetch } from "../../lib/api";

export default function GamePage() {
  const router = useRouter();

  const [gameMode, setGameMode] = useState<"pvp" | "pvc" | "pvp_remote">("pvp");
  const [sessionLink, setSessionLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myPieces, setMyPieces] = useState<GamePieceResponse[]>([]);
  const [allPiecesData, setAllPiecesData] = useState<GamePieceResponse[]>([]);
  const [piecesLoading, setPiecesLoading] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("myPieces");
    if (raw) {
      try { setMyPieces(JSON.parse(raw)); } catch { /* ignore */ }
    }
  }, []);

  // Load all piece data (including opponent pieces) from board_state
  useEffect(() => {
    if (!session) return;

    const existingIds = new Set(myPieces.map(p => p.id.toString()));
    const missingIds = session.board_state
      .filter(bp => !existingIds.has(bp.piece_id.toString()))
      .map(bp => bp.piece_id.toString());
    const uniqueIds = Array.from(new Set(missingIds));

    if (uniqueIds.length === 0) {
          setAllPiecesData(myPieces);
      return;
    }

    async function fetchMissing() {
      setPiecesLoading(true);
      try {
        const res = await apiFetch("/pieces/by-ids", {
          method: "POST",
          body: JSON.stringify(uniqueIds),
        });
        if (res.ok) {
          const data: GamePieceResponse[] = await res.json();
          setAllPiecesData([...myPieces, ...data]);
        } else {
          setAllPiecesData(myPieces);
        }
      } catch {
        setAllPiecesData(myPieces);
      } finally {
        setPiecesLoading(false);
      }
    }
    fetchMissing();
  }, [session, myPieces]);

  async function handleStartGame() {
    if (myPieces.length < 12) {
      router.push("/pieces/select?returnTo=/game");
      return;
    }
    setIsStarting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        player_piece_ids: myPieces.map((p) => p.id),
        game_mode: gameMode,
        ai_depth: 3,
      };
      // PvP local: opponent_piece_ids same as player (both sides controlled locally)
      if (gameMode === "pvp") {
        body.opponent_piece_ids = myPieces.map((p) => p.id);
      }
      if (gameMode === "pvc") {
        body.difficulty = difficulty;
        // opponent_piece_ids omitted — backend picks random pieces
      }
      // pvp_remote: opponent_piece_ids omitted — P2 provides them at join

      const res = await apiFetch("/game/session", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.detail ?? "Failed to start game session.");
        return;
      }
      const data: SessionResponse = await res.json();
      setSession(data);
      if (data.game_mode === "pvp_remote") {
        // Redirect P1 to the remote game page where the WebSocket is active
        router.push(`/game/remote/${data.session_id}`);
        return;
      }
    } catch {
      setError("Network error starting game session.");
    } finally {
      setIsStarting(false);
    }
  }

  if (error && !session) {
    return (
      <main style={{ padding: "2rem", maxWidth: "640px", margin: "0 auto" }}>
        <div style={{ padding: "1rem", backgroundColor: "#fee2e2", color: "#dc2626", borderRadius: "8px", marginBottom: "1rem" }}>
          {error}
          </div>
          <button onClick={() => window.location.href = "/"}
          style={{ padding: "0.5rem 1rem", backgroundColor: "#2563eb", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>
            ← Home
          </button>
      </main>
    );
  }

  if (session) {
    if (session.game_mode === "pvp_remote" && session.status === "waiting" && sessionLink) {
      return (
        <main style={{ padding: "2rem", maxWidth: "560px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
        <button onClick={() => router.push("/")}
          style={{ padding: "0.375rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.875rem", cursor: "pointer", backgroundColor: "white" }}>
          ← Home
        </button>
            <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>Multiplayer Remoto</h1>
          </div>
          <div style={{ padding: "1.5rem", border: "1px solid #d1d5db", borderRadius: "8px", backgroundColor: "#f9fafb", marginBottom: "1.5rem" }}>
            <p style={{ fontWeight: "600", marginBottom: "0.75rem" }}>Link di invito:</p>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <code style={{ flex: 1, padding: "0.5rem 0.75rem", backgroundColor: "white", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.8rem", wordBreak: "break-all" }}>
                {sessionLink}
              </code>
              <button onClick={async () => { await navigator.clipboard.writeText(sessionLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); }}
                style={{ padding: "0.5rem 1rem", backgroundColor: linkCopied ? "#16a34a" : "#2563eb", color: "white", border: "none", borderRadius: "6px", fontSize: "0.875rem", cursor: "pointer", whiteSpace: "nowrap" }}>
                {linkCopied ? "✓ Copiato!" : "Copia link"}
          </button>
        </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem 1.25rem", backgroundColor: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", color: "#92400e" }}>
            <span style={{ fontSize: "1.25rem" }}>⏳</span>
            <span style={{ fontWeight: "500" }}>In attesa dell&apos;avversario…</span>
          </div>
        </main>
  );
}

    return (
      <main style={{ padding: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <button onClick={() => router.push("/")}
            style={{ padding: "0.375rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.875rem", cursor: "pointer", backgroundColor: "white" }}>
            ← Home
          </button>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>Battle Checkers</h1>
          <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            {gameMode === "pvp" ? "Player 1 vs Player 2" : "Player vs Computer"}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          {piecesLoading ? (
            <div style={{ padding: "2rem", color: "#6b7280" }}>Caricamento pedine…</div>
          ) : (
            <Board
              boardState={session.board_state}
              sessionId={session.session_id}
              currentTurn={session.current_turn}
              winner={session.winner}
              pieces={allPiecesData.length > 0 ? allPiecesData : myPieces}
              onSessionUpdate={(updatedSession) => {
                setSession(updatedSession);
              }}
            />
          )}
        </div>
      </main>
    );
  }

  // Pre-game setup
  return (
    <main style={{ padding: "2rem", maxWidth: "480px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
        <button onClick={() => router.push("/")}
          style={{ padding: "0.375rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.875rem", cursor: "pointer", backgroundColor: "white" }}>
          ← Home
        </button>
        <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>Nuova partita</h1>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {/* Pieces status */}
        <div style={{ padding: "0.75rem 1rem", border: "1px solid #d1d5db", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.9rem", color: myPieces.length === 12 ? "#16a34a" : "#6b7280" }}>
            {myPieces.length === 12 ? `✓ ${myPieces.length} pedine selezionate` : `${myPieces.length} / 12 pedine selezionate`}
          </span>
          <button onClick={() => router.push("/pieces/select?returnTo=/game")}
            style={{ padding: "0.375rem 0.75rem", border: "1px solid #2563eb", borderRadius: "6px", fontSize: "0.8rem", cursor: "pointer", backgroundColor: "white", color: "#2563eb" }}>
            {myPieces.length === 12 ? "Cambia" : "Seleziona pedine"}
          </button>
        </div>

        {/* Game mode */}
        <div>
          <label style={{ display: "block", fontWeight: "600", marginBottom: "0.5rem" }}>Modalità</label>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {(["pvp", "pvc", "pvp_remote"] as const).map((mode) => (
              <button key={mode} onClick={() => setGameMode(mode)}
                style={{ padding: "0.5rem 1.25rem", borderRadius: "6px", border: "2px solid", borderColor: gameMode === mode ? "#2563eb" : "#d1d5db", backgroundColor: gameMode === mode ? "#eff6ff" : "white", color: gameMode === mode ? "#2563eb" : "#374151", fontWeight: gameMode === mode ? "600" : "400", cursor: "pointer" }}>
                {mode === "pvp" ? "vs Giocatore" : mode === "pvc" ? "vs Computer" : "Remoto"}
              </button>
            ))}
          </div>
        </div>

        {gameMode === "pvc" && (
          <div>
            <label style={{ display: "block", fontWeight: "600", marginBottom: "0.5rem" }}>Difficoltà AI</label>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              {(["easy", "medium", "hard"] as const).map((d) => (
                <button key={d} onClick={() => setDifficulty(d)}
                  style={{ padding: "0.5rem 1.25rem", borderRadius: "6px", border: "2px solid", borderColor: difficulty === d ? "#2563eb" : "#d1d5db", backgroundColor: difficulty === d ? "#eff6ff" : "white", color: difficulty === d ? "#2563eb" : "#374151", fontWeight: difficulty === d ? "600" : "400", cursor: "pointer" }}>
                  {d === "easy" ? "Facile" : d === "medium" ? "Media" : "Difficile"}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{ padding: "0.75rem", backgroundColor: "#fee2e2", color: "#dc2626", borderRadius: "6px", fontSize: "0.875rem" }}>
            ⚠️ {error}
          </div>
        )}

        <button onClick={handleStartGame} disabled={isStarting}
          style={{ padding: "0.75rem 1.5rem", backgroundColor: isStarting ? "#93c5fd" : "#2563eb", color: "white", border: "none", borderRadius: "8px", fontSize: "1rem", fontWeight: "600", cursor: isStarting ? "not-allowed" : "pointer" }}>
          {isStarting ? "Avvio…" : myPieces.length < 12 ? "Seleziona pedine e avvia" : "Avvia partita"}
        </button>
      </div>
    </main>
  );
}

