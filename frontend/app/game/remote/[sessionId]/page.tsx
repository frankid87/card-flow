"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  BoardPieceState,
  GamePieceResponse,
  SessionResponse,
  WsIncomingMessage,
  WsMoveMessage,
} from "../../../../types";
import Board from "../../../../components/Board";
import { apiFetch, getToken } from "../../../../lib/api";

const WS_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
    /^http/,
    "ws"
  );

// ─── State shape ────────────────────────────────────────────────────────────

interface RemoteGameState {
  boardState: BoardPieceState[];
  currentTurn: "player" | "opponent";
  winner: string | null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function RemoteGamePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  // Session / pieces
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [allPieces, setAllPieces] = useState<GamePieceResponse[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Remote game state (kept in sync via WS board_update)
  const [gameState, setGameState] = useState<RemoteGameState | null>(null);

  // WebSocket / role
  const wsRef = useRef<WebSocket | null>(null);
  const [localRole, setLocalRole] = useState<"player" | "opponent" | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  // wsReady: true only after join is complete (or session already ready)
  const [wsReady, setWsReady] = useState(false);
  // Prevent double-join in React StrictMode
  const joinAttemptedRef = useRef(false);

  // UI flags
  const [opponentWaiting, setOpponentWaiting] = useState(false);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);

  // Load all pieces on the board from the backend whenever gameState changes
  useEffect(() => {
    if (!gameState || gameState.boardState.length === 0) return;
    const ids = gameState.boardState.map(p => p.piece_id).join(",");
    apiFetch(`/pieces/by-ids?ids=${ids}`)
      .then(r => r.json())
      .then((pieces: GamePieceResponse[]) => setAllPieces(pieces))
      .catch(() => {}); // silently fail — board still works without artwork
  }, [gameState?.boardState.length]); // re-run when board size changes (captures/joins)

  // ── 9.1: fetch session on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;

    // Check token before attempting to load — redirect to login preserving URL
    if (!getToken()) {
      const redirect = encodeURIComponent(`/game/remote/${sessionId}`);
      router.push(`/login?redirect=${redirect}`);
      return;
    }

    async function loadSession() {
      try {
        const res = await apiFetch(`/game/${sessionId}`);
        if (!res.ok) {
          setLoadError("Sessione non trovata.");
          return;
        }
        const data: SessionResponse = await res.json();
        setSession(data);
        setGameState({
          boardState: data.board_state,
          currentTurn: data.current_turn,
          winner: data.winner,
        });

        // Load pieces from sessionStorage (always, for any status)
        const myRaw = sessionStorage.getItem("myPieces");
        let knownPieces: GamePieceResponse[] = [];
        if (myRaw) {
          try { knownPieces = JSON.parse(myRaw); } catch { /* ignore */ }
        }

        // Fetch any pieces not already in sessionStorage (e.g. opponent's pieces for P1)
        const knownIds = new Set(knownPieces.map(p => p.id.toString()));
        const missingIds = data.board_state
          .map(p => p.piece_id.toString())
          .filter(id => !knownIds.has(id));

        if (missingIds.length > 0) {
          try {
            const piecesRes = await apiFetch("/pieces/by-ids", {
              method: "POST",
              body: JSON.stringify(missingIds),
            });
            if (piecesRes.ok) {
              const extra: GamePieceResponse[] = await piecesRes.json();
              knownPieces = [...knownPieces, ...extra];
            }
          } catch { /* ignore — board renders without artwork */ }
        }
        setAllPieces(knownPieces);

        // Decode our user_id from the JWT
        const token = getToken();
        let myUserId: string | null = null;
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split(".")[1]));
            myUserId = payload.sub ?? null;
          } catch { /* ignore */ }
        }

        if (data.status === "waiting") {
          const isP1 = myUserId !== null && data.player_user_id === myUserId;

          if (isP1) {
            setWsReady(true);
            setOpponentWaiting(true);
            return;
          }

          // P2: needs pieces to join
          const myPiecesRaw = sessionStorage.getItem("myPieces");
          if (!myPiecesRaw) {
            router.push(`/pieces/select?returnTo=/game/remote/${sessionId}`);
            return;
          }

          const myPieces: GamePieceResponse[] = JSON.parse(myPiecesRaw);
          if (myPieces.length < 12) {
            router.push(`/pieces/select?returnTo=/game/remote/${sessionId}`);
            return;
          }

          // Guard against double invocation (React StrictMode)
          if (joinAttemptedRef.current) return;
          joinAttemptedRef.current = true;

          try {
            const joinRes = await apiFetch(`/game/${sessionId}/join`, {
              method: "POST",
              body: JSON.stringify({ opponent_piece_ids: myPieces.map(p => p.id) }),
            });
            if (joinRes.ok) {
              const updated: SessionResponse = await joinRes.json();
              setSession(updated);
              setGameState({
                boardState: updated.board_state,
                currentTurn: updated.current_turn,
                winner: updated.winner,
              });
              setAllPieces(myPieces);
              setWsReady(true);
              return;
            } else {
              const err = await joinRes.json().catch(() => ({}));
              // 409 = already joined by us (StrictMode second call) — treat as success
              if (joinRes.status === 409) {
                setWsReady(true);
                return;
              }
              setLoadError(err.detail ?? "Impossibile unirsi alla sessione.");
            }
          } catch {
            setLoadError("Errore di rete durante il join.");
          }

        } else if (data.status === "ready") {
          // Check we are one of the two players
          const isParticipant =
            myUserId !== null &&
            (data.player_user_id === myUserId || data.opponent_user_id === myUserId);

          if (!isParticipant) {
            setLoadError("Questa sessione è già completa.");
            return;
          }
          setWsReady(true);
        }
      } catch {
        setLoadError("Errore di rete nel caricamento della sessione.");
      }
    }

    loadSession();
  }, [sessionId]);

  // ── 9.2: open WebSocket once session is loaded ───────────────────────────
  // Keep a ref to the latest message handler to avoid stale closures
  const handleWsMessageRef = useRef<(msg: WsIncomingMessage) => void>(() => {});

  const handleWsMessage = useCallback((msg: WsIncomingMessage) => {
    switch (msg.type) {
      case "role_assigned":
        setLocalRole(msg.role);
        break;

      case "board_update":
        setGameState({
          boardState: msg.board_state,
          currentTurn: msg.current_turn,
          winner: msg.winner,
        });
        setOpponentWaiting(false);
        setOpponentDisconnected(false);
        break;

      case "opponent_joined":
        setOpponentWaiting(false);
        break;

      case "opponent_disconnected":
        setOpponentDisconnected(true);
        break;

      case "error":
        setWsError(msg.detail ?? msg.code);
        break;
    }
  }, []);

  // Keep ref in sync so the WS onmessage always calls the latest version
  useEffect(() => {
    handleWsMessageRef.current = handleWsMessage;
  }, [handleWsMessage]);

  useEffect(() => {
    if (!sessionId || !wsReady) return;
    const token = getToken();
    if (!token) {
      const redirect = encodeURIComponent(`/game/remote/${sessionId}`);
      router.push(`/login?redirect=${redirect}`);
      return;
    }

    const ws = new WebSocket(`${WS_BASE}/game/${sessionId}/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setWsError(null);
    };

    ws.onmessage = (event) => {
      let msg: WsIncomingMessage;
      try {
        msg = JSON.parse(event.data as string) as WsIncomingMessage;
      } catch {
        return;
      }
      console.log("[WS] received:", msg.type, msg);
      // Use ref to always call the latest handler (avoids stale closure)
      handleWsMessageRef.current(msg);
    };

    ws.onerror = () => {
      setWsError("Connessione WebSocket interrotta.");
    };

    ws.onclose = (e) => {
      setWsConnected(false);
      console.log("[WS] closed, code:", e.code, "reason:", e.reason);
      if (e.code === 4001) setWsError("Autenticazione fallita (token non valido).");
      else if (e.code === 4003) setWsError("Sessione piena — impossibile connettersi.");
      else if (e.code !== 1000 && e.code !== 1001) setWsError("Connessione WebSocket interrotta.");
    };

    return () => {
      ws.close();
    };
  }, [sessionId, wsReady]);

  // ── 9.4: send move via WebSocket ─────────────────────────────────────────
  const handleWsMove = useCallback(
    (pieceId: string, toPosition: [number, number]) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const msg: WsMoveMessage = {
        type: "move",
        piece_id: pieceId,
        to_position: toPosition,
      };
      wsRef.current.send(JSON.stringify(msg));
    },
    []
  );

  // ── Derived ───────────────────────────────────────────────────────────────
  const isMyTurn =
    localRole !== null && gameState !== null && gameState.currentTurn === localRole;

  const effectiveWinner = gameState?.winner ?? null;

  // ── Render: loading ───────────────────────────────────────────────────────
  if (loadError) {
    return (
      <main style={{ padding: "2rem", maxWidth: "560px", margin: "0 auto" }}>
        <div style={{ padding: "1rem", backgroundColor: "#fee2e2", color: "#dc2626", borderRadius: "8px", marginBottom: "1rem" }}>
          {loadError}
        </div>
        <button
          onClick={() => router.push("/")}
          style={{ padding: "0.5rem 1rem", backgroundColor: "#2563eb", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}
        >
          ← Home
        </button>
      </main>
    );
  }

  if (!session || !gameState) {
    return (
      <main style={{ padding: "2rem", textAlign: "center", color: "#6b7280" }}>
        Caricamento sessione…
      </main>
    );
  }

  // ── 8.4: session already has a winner ────────────────────────────────────
  if (effectiveWinner) {
    return (
      <main style={{ padding: "2rem", maxWidth: "560px", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
          <button
            onClick={() => router.push("/")}
            style={{ padding: "0.375rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.875rem", cursor: "pointer", backgroundColor: "white" }}
          >
            ← Home
          </button>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>Partita terminata</h1>
        </div>
        <div style={{ padding: "1.5rem", backgroundColor: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🏆</div>
          <div style={{ fontWeight: "bold", fontSize: "1.25rem" }}>
            {effectiveWinner === localRole ? "Hai vinto!" : "Hai perso."}
          </div>
          <div style={{ color: "#6b7280", marginTop: "0.25rem" }}>
            Vincitore: {effectiveWinner === "player" ? "Giocatore 1" : "Giocatore 2"}
          </div>
        </div>
        <div style={{ overflowX: "auto", pointerEvents: "none", opacity: 0.7 }}>
          <RemoteBoard
            gameState={gameState}
            sessionId={sessionId}
            allPieces={allPieces}
            localRole={localRole}
            isMyTurn={false}
            onMove={handleWsMove}
          />
        </div>
      </main>
    );
  }

  // ── Lobby: waiting for opponent ───────────────────────────────────────────
  if (opponentWaiting) {
    const inviteLink = `${typeof window !== "undefined" ? window.location.origin : ""}/game/remote/${sessionId}`;
    return (
      <main style={{ padding: "2rem", maxWidth: "560px", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
          <button
            onClick={() => router.push("/")}
            style={{ padding: "0.375rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.875rem", cursor: "pointer", backgroundColor: "white" }}
          >
            ← Home
          </button>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>Multiplayer Remoto</h1>
        </div>

        {/* Invite link — shown to P1 (identified by player_user_id in session) */}
        <InviteLink link={inviteLink} />

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem 1.25rem", backgroundColor: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", color: "#92400e" }}>
          <span style={{ fontSize: "1.25rem" }}>⏳</span>
          <span style={{ fontWeight: "500" }}>In attesa dell&apos;avversario…</span>
        </div>
      </main>
    );
  }

  // ── Active game ───────────────────────────────────────────────────────────
  return (
    <main style={{ padding: "2rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <button
          onClick={() => router.push("/")}
          style={{ padding: "0.375rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.875rem", cursor: "pointer", backgroundColor: "white" }}
        >
          ← Home
        </button>
        <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>Multiplayer Remoto</h1>
        {localRole && (
          <span style={{
            padding: "0.25rem 0.75rem",
            borderRadius: "9999px",
            fontSize: "0.8rem",
            fontWeight: "600",
            backgroundColor: localRole === "player" ? "#eff6ff" : "#fef2f2",
            color: localRole === "player" ? "#2563eb" : "#dc2626",
            border: `1px solid ${localRole === "player" ? "#bfdbfe" : "#fecaca"}`,
          }}>
            {localRole === "player" ? "🔵 Sei Giocatore 1" : "🔴 Sei Giocatore 2"}
          </span>
        )}
        {!wsConnected && (
          <span style={{ fontSize: "0.8rem", color: "#f59e0b" }}>⚠️ Connessione in corso…</span>
        )}
      </div>

      {/* WS error */}
      {wsError && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", backgroundColor: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "6px", color: "#dc2626", fontSize: "0.875rem", display: "flex", justifyContent: "space-between" }}>
          <span>⚠️ {wsError}</span>
          <button onClick={() => setWsError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontWeight: "bold" }}>✕</button>
        </div>
      )}

      {/* 9.5: opponent disconnected banner */}
      {opponentDisconnected && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", backgroundColor: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "6px", color: "#92400e", fontSize: "0.875rem" }}>
          ⚠️ Avversario disconnesso, in attesa di riconnessione…
        </div>
      )}

      {/* 9.3: turn indicator */}
      {!isMyTurn && localRole && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", backgroundColor: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "6px", color: "#374151", fontSize: "0.875rem" }}>
          ⏳ In attesa della mossa avversaria…
        </div>
      )}

      {/* Board */}
      <div style={{ overflowX: "auto" }}>
        <RemoteBoard
          gameState={gameState}
          sessionId={sessionId}
          allPieces={allPieces}
          localRole={localRole}
          isMyTurn={isMyTurn}
          onMove={handleWsMove}
        />
      </div>

      {/* Legend */}
      <div style={{ marginTop: "1rem", fontSize: "0.875rem", color: "#6b7280" }}>
        <p>
          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "3px solid #2563eb", marginRight: 6, verticalAlign: "middle" }} />
          {localRole === "player" ? "Le tue pedine" : "Pedine avversario"}
          &nbsp;&nbsp;
          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "3px solid #dc2626", marginRight: 6, verticalAlign: "middle" }} />
          {localRole === "opponent" ? "Le tue pedine" : "Pedine avversario"}
        </p>
        <p>🟢 Verde = mosse valide &nbsp; 🔵 Blu = pedina selezionata</p>
      </div>
    </main>
  );
}

// ─── RemoteBoard ─────────────────────────────────────────────────────────────
// Wraps the existing Board component, intercepting moves to send via WebSocket
// and enforcing role-based interaction (9.3, 9.4).

interface RemoteBoardProps {
  gameState: RemoteGameState;
  sessionId: string;
  allPieces: GamePieceResponse[];
  localRole: "player" | "opponent" | null;
  isMyTurn: boolean;
  onMove: (pieceId: string, toPosition: [number, number]) => void;
}

// ─── InviteLink ──────────────────────────────────────────────────────────────
function InviteLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ padding: "1.25rem", border: "1px solid #d1d5db", borderRadius: "8px", backgroundColor: "#f9fafb", marginBottom: "1.25rem" }}>
      <p style={{ fontWeight: "600", marginBottom: "0.75rem", fontSize: "0.9rem" }}>Condividi questo link con l&apos;avversario:</p>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <code style={{ flex: 1, padding: "0.5rem 0.75rem", backgroundColor: "white", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.8rem", wordBreak: "break-all" }}>
          {link}
        </code>
        <button
          onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          style={{ padding: "0.5rem 1rem", backgroundColor: copied ? "#16a34a" : "#2563eb", color: "white", border: "none", borderRadius: "6px", fontSize: "0.875rem", cursor: "pointer", whiteSpace: "nowrap" }}>
          {copied ? "✓ Copiato!" : "Copia link"}
        </button>
      </div>
    </div>
  );
}

function RemoteBoard({  gameState,
  sessionId,
  allPieces,
  localRole,
  isMyTurn,
  onMove,
}: RemoteBoardProps) {
  // Build a filtered view of the session that Board can consume.
  // We pass a fake SessionResponse so Board's onSessionUpdate is never
  // actually used for HTTP moves — we intercept via the WS path instead.
  const fakeSession: SessionResponse = {
    session_id: sessionId,
    game_mode: "pvp_remote",
    current_turn: gameState.currentTurn,
    winner: gameState.winner,
    board_state: gameState.boardState,
  };

  // Board calls onSessionUpdate after a successful HTTP move.
  // In remote mode we never want HTTP moves, so this is a no-op.
  // The actual move is sent via WebSocket in handleSquareClick below.
  // We achieve this by passing a custom Board that overrides move handling.
  // Since Board is not easily extensible for WS, we use a thin wrapper
  // that passes the right props and relies on the `localRole` filtering.

  return (
    <RemoteBoardInner
      boardState={gameState.boardState}
      sessionId={sessionId}
      currentTurn={gameState.currentTurn}
      winner={gameState.winner}
      pieces={allPieces}
      localRole={localRole}
      isMyTurn={isMyTurn}
      onMove={onMove}
      fakeSession={fakeSession}
    />
  );
}

// ─── RemoteBoardInner ─────────────────────────────────────────────────────────
// A self-contained board that sends moves via WebSocket and enforces role rules.

interface RemoteBoardInnerProps {
  boardState: BoardPieceState[];
  sessionId: string;
  currentTurn: "player" | "opponent";
  winner: string | null;
  pieces: GamePieceResponse[];
  localRole: "player" | "opponent" | null;
  isMyTurn: boolean;
  onMove: (pieceId: string, toPosition: [number, number]) => void;
  fakeSession: SessionResponse;
}

import { useState as useStateInner, useCallback as useCallbackInner } from "react";
import PieceRenderer from "../../../../components/PieceRenderer";

function RemoteBoardInner({
  boardState,
  sessionId,
  currentTurn,
  winner,
  pieces,
  localRole,
  isMyTurn,
  onMove,
}: RemoteBoardInnerProps) {
  const [selectedPieceId, setSelectedPieceId] = useStateInner<string | null>(null);
  const [highlightedSquares, setHighlightedSquares] = useStateInner<[number, number][]>([]);
  const [isLoading, setIsLoading] = useStateInner(false);
  const [error, setError] = useStateInner<string | null>(null);

  const getPieceData = (pieceId: string) =>
    pieces.find((p) => p.id === pieceId) ?? null;

  const selectedBoardPiece = boardState.find((p) => p.piece_id === selectedPieceId) ?? null;
  const selectedPieceData = selectedBoardPiece ? getPieceData(selectedBoardPiece.piece_id) : null;

  // Interaction is disabled when it's not our turn or there's a winner
  const interactionDisabled = !isMyTurn || !!winner || isLoading;

  const handlePieceSelect = useCallbackInner(
    async (pieceId: string) => {
      if (interactionDisabled) return;
      setError(null);
      setSelectedPieceId(pieceId);
      setHighlightedSquares([]);
      setIsLoading(true);
      try {
        const token = getToken();
        const headers: HeadersInit = token
          ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
          : { "Content-Type": "application/json" };
        const res = await fetch(
          `${(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")}/game/${sessionId}/valid-moves/${pieceId}`,
          { headers }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError((body as { detail?: string }).detail ?? "Impossibile recuperare le mosse valide");
          setSelectedPieceId(null);
          return;
        }
        const data = await res.json() as { moves?: [number, number][] };
        setHighlightedSquares(data.moves ?? []);
      } catch {
        setError("Errore di rete nel recupero delle mosse valide");
        setSelectedPieceId(null);
      } finally {
        setIsLoading(false);
      }
    },
    [interactionDisabled, sessionId]
  );

  const handleMove = useCallbackInner(
    (row: number, col: number) => {
      if (!selectedPieceId || interactionDisabled) return;
      // Send move via WebSocket (9.4)
      onMove(selectedPieceId, [row, col]);
      setSelectedPieceId(null);
      setHighlightedSquares([]);
    },
    [selectedPieceId, interactionDisabled, onMove]
  );

  const handleSquareClick = useCallbackInner(
    (row: number, col: number) => {
      if (interactionDisabled) return;

      const isHighlighted = highlightedSquares.some(([r, c]) => r === row && c === col);
      if (isHighlighted) {
        handleMove(row, col);
        return;
      }

      const occupant = boardState.find((p) => p.position[0] === row && p.position[1] === col);
      // 9.3: only allow selecting own pieces
      if (occupant && occupant.owner === localRole) {
        if (occupant.piece_id === selectedPieceId) {
          setSelectedPieceId(null);
          setHighlightedSquares([]);
        } else {
          handlePieceSelect(occupant.piece_id);
        }
      } else {
        setSelectedPieceId(null);
        setHighlightedSquares([]);
      }
    },
    [interactionDisabled, highlightedSquares, boardState, localRole, selectedPieceId, handleMove, handlePieceSelect]
  );

  const playerCount = boardState.filter((p) => p.owner === "player").length;
  const opponentCount = boardState.filter((p) => p.owner === "opponent").length;

  return (
    <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>
      <div>
        {/* Turn indicator */}
        <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{
            padding: "0.4rem 1rem",
            borderRadius: "9999px",
            fontWeight: "bold",
            fontSize: "0.9rem",
            backgroundColor: winner ? "#16a34a" : currentTurn === "player" ? "#2563eb" : "#dc2626",
            color: "white",
            opacity: isLoading ? 0.7 : 1,
          }}>
            {winner
              ? `🏆 Vincitore: ${winner === "player" ? "Giocatore 1" : "Giocatore 2"}!`
              : isLoading
              ? "⏳ Caricamento…"
              : `Turno: ${currentTurn === "player" ? "Giocatore 1 🔵" : "Giocatore 2 🔴"}`}
          </div>
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
            🔵 {playerCount} pedine &nbsp; 🔴 {opponentCount} pedine
          </span>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginBottom: "0.5rem",
            padding: "0.5rem 0.75rem",
            backgroundColor: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: "6px",
            color: "#dc2626",
            fontSize: "0.85rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontWeight: "bold" }}>✕</button>
          </div>
        )}

        {/* Board grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(8, 4rem)",
          width: "fit-content",
          border: "3px solid #1f2937",
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          opacity: isLoading ? 0.6 : 1,
          pointerEvents: interactionDisabled && !winner ? "none" : "auto",
        }}>
          {Array.from({ length: 8 }, (_, row) =>
            Array.from({ length: 8 }, (_, col) => {
              const isLight = (row + col) % 2 === 0;
              const isHighlighted = highlightedSquares.some(([r, c]) => r === row && c === col);
              const occupant = boardState.find((p) => p.position[0] === row && p.position[1] === col);
              const isSelected = occupant?.piece_id === selectedPieceId;
              const occupantData = occupant ? getPieceData(occupant.piece_id) : null;

              let squareBg = isLight ? "#f5deb3" : "#8b4513";
              if (isHighlighted) squareBg = "#4ade80";
              if (isSelected) squareBg = "#60a5fa";

              const pieceBorder = occupant
                ? occupant.owner === "player" ? "3px solid #2563eb" : "3px solid #dc2626"
                : "none";

              // 9.3: dim pieces that don't belong to the local player
              const isOwnPiece = occupant?.owner === localRole;
              const hpPct = occupant && occupantData
                ? Math.max(0, (occupant.current_hp / occupantData.base_hp) * 100)
                : 0;
              const hpColor = hpPct > 60 ? "#22c55e" : hpPct > 30 ? "#f59e0b" : "#ef4444";

              return (
                <div
                  key={`${row}-${col}`}
                  style={{
                    width: "4rem", height: "4rem",
                    backgroundColor: squareBg,
                    border: "1px solid rgba(0,0,0,0.15)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: winner || interactionDisabled ? "default" : "pointer",
                    position: "relative",
                    boxSizing: "border-box",
                    flexDirection: "column",
                    padding: "2px",
                  }}
                  onClick={() => handleSquareClick(row, col)}
                  data-testid={`square-${row}-${col}`}
                >
                  {occupant && occupantData && (
                    <>
                      <div style={{
                        width: "2.6rem", height: "2.6rem",
                        flexShrink: 0,
                        borderRadius: "50%",
                        border: pieceBorder,
                        overflow: "hidden",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                        // Dim opponent pieces slightly when it's not their turn
                        opacity: !isOwnPiece && !isMyTurn ? 0.5 : 1,
                      }}>
                        <PieceRenderer
                          data={occupantData}
                          state={{ current_hp: occupant.current_hp, is_evolved: occupant.is_evolved }}
                        />
                      </div>
                      <div style={{
                        width: "2.6rem", height: "4px",
                        backgroundColor: "rgba(0,0,0,0.3)",
                        borderRadius: "2px",
                        marginTop: "2px",
                        overflow: "hidden",
                      }}>
                        <div style={{
                          width: `${hpPct}%`,
                          height: "100%",
                          backgroundColor: hpColor,
                          borderRadius: "2px",
                          transition: "width 0.3s",
                        }} />
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Stats panel */}
      <div style={{
        width: "180px",
        minHeight: "200px",
        border: "2px solid #d1d5db",
        borderRadius: "8px",
        padding: "0.75rem",
        backgroundColor: "#f9fafb",
        fontSize: "0.85rem",
      }}>
        {/* 7.5: role labels */}
        {localRole && (
          <div style={{ marginBottom: "0.75rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem" }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", border: `2px solid ${localRole === "player" ? "#2563eb" : "#dc2626"}` }} />
              <span style={{ color: localRole === "player" ? "#2563eb" : "#dc2626", fontWeight: 600 }}>Le tue pedine</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem" }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", border: `2px solid ${localRole === "player" ? "#dc2626" : "#2563eb"}` }} />
              <span style={{ color: "#6b7280" }}>Pedine avversario</span>
            </div>
          </div>
        )}

        {selectedBoardPiece && selectedPieceData ? (
          <>
            <div style={{ fontWeight: "bold", marginBottom: "0.5rem", fontSize: "1rem" }}>
              {selectedPieceData.name}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedPieceData.artwork.image_url}
              alt={selectedPieceData.name}
              style={{ width: "100%", borderRadius: "8px", marginBottom: "0.5rem", objectFit: "cover", height: "100px" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>Elemento</span>
                <span style={{ fontWeight: "600" }}>{selectedPieceData.element}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>HP</span>
                <span style={{ fontWeight: "600", color: "#ef4444" }}>
                  {Math.ceil(selectedBoardPiece.current_hp)} / {selectedPieceData.base_hp}
                </span>
              </div>
              <div style={{ width: "100%", height: "6px", backgroundColor: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{
                  width: `${Math.max(0, (selectedBoardPiece.current_hp / selectedPieceData.base_hp) * 100)}%`,
                  height: "100%",
                  backgroundColor: selectedBoardPiece.current_hp / selectedPieceData.base_hp > 0.6 ? "#22c55e" : selectedBoardPiece.current_hp / selectedPieceData.base_hp > 0.3 ? "#f59e0b" : "#ef4444",
                  borderRadius: "3px",
                  transition: "width 0.3s",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>ATK</span>
                <span style={{ fontWeight: "600", color: "#f97316" }}>⚔️ {selectedPieceData.base_atk}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>Evoluta</span>
                <span>{selectedBoardPiece.is_evolved ? "👑 Sì" : "No"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>Giocatore</span>
                <span style={{ color: selectedBoardPiece.owner === "player" ? "#2563eb" : "#dc2626", fontWeight: "600" }}>
                  {selectedBoardPiece.owner === localRole ? "Tu" : "Avversario"}
                </span>
              </div>
            </div>
          </>
        ) : (
          <p style={{ color: "#9ca3af", textAlign: "center", marginTop: "2rem" }}>
            Seleziona una pedina per vedere le statistiche
          </p>
        )}
      </div>
    </div>
  );
}
