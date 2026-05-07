"use client";

import { useState, useCallback } from "react";
import { GamePieceResponse, BoardPieceState, SessionResponse, BreachActivation } from "../types";
import PieceRenderer from "./PieceRenderer";
import BreachAnimation from "./BreachAnimation";
import { apiFetch } from "../lib/api";

interface BoardProps {
  boardState: BoardPieceState[];
  sessionId: string;
  currentTurn: "player" | "opponent";
  winner: string | null;
  pieces: GamePieceResponse[];
  onSessionUpdate: (session: SessionResponse) => void;
  localRole?: "player" | "opponent";
}

export default function Board({
  boardState,
  sessionId,
  currentTurn,
  winner,
  pieces,
  onSessionUpdate,
  localRole,
}: BoardProps) {
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [highlightedSquares, setHighlightedSquares] = useState<[number, number][]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [breachActivations, setBreachActivations] = useState<BreachActivation[]>([]);

  const getPieceData = (pieceId: string) =>
    pieces.find((p) => p.id === pieceId) ?? null;

  const selectedBoardPiece = boardState.find((p) => p.piece_id === selectedPieceId) ?? null;
  const selectedPieceData = selectedBoardPiece ? getPieceData(selectedBoardPiece.piece_id) : null;

  /** Re-fetch session from backend to sync state (used after errors) */
  const refreshSession = useCallback(async () => {
    try {
      const res = await apiFetch(`/game/${sessionId}`);
      if (res.ok) {
        const refreshed: SessionResponse = await res.json();
        onSessionUpdate(refreshed);
      }
    } catch { /* ignore */ }
  }, [sessionId, onSessionUpdate]);

  const handlePieceSelect = useCallback(
    async (pieceId: string) => {
      if (isLoading || winner) return;
      setError(null);
      setSelectedPieceId(pieceId);
      setHighlightedSquares([]);
      setIsLoading(true);
      try {
        const res = await apiFetch(`/game/${sessionId}/valid-moves/${pieceId}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.detail ?? "Failed to fetch valid moves");
          setSelectedPieceId(null);
          return;
        }
        const data = await res.json();
        setHighlightedSquares(data.moves ?? []);
      } catch {
        setError("Network error fetching valid moves");
        setSelectedPieceId(null);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, winner, sessionId]
  );

  const handleMove = useCallback(
    async (row: number, col: number) => {
      if (!selectedPieceId || isLoading || winner) return;
      setError(null);
      setIsLoading(true);
      try {
        const res = await apiFetch(`/game/${sessionId}/move`, {
          method: "POST",
          body: JSON.stringify({ piece_id: selectedPieceId, to_position: [row, col] }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.detail ?? "Move failed");
          setSelectedPieceId(null);
          setHighlightedSquares([]);
          // If it's a turn conflict, re-fetch the session state from backend
          if (res.status === 400 && body.detail?.toLowerCase().includes("turn")) {
            refreshSession();
          }
          return;
        }
        const session: SessionResponse = await res.json();

        // Show Breach animation if any activations
        if (session.breach_activations && session.breach_activations.length > 0) {
          setBreachActivations(session.breach_activations);
        }

        onSessionUpdate(session);
        setSelectedPieceId(null);
        setHighlightedSquares([]);
      } catch {
        setError("Network error applying move");
        setSelectedPieceId(null);
        setHighlightedSquares([]);
      } finally {
        setIsLoading(false);
      }
    },
    [selectedPieceId, isLoading, winner, sessionId, onSessionUpdate, refreshSession]
  );

  const handleSquareClick = useCallback(
    (row: number, col: number) => {
      if (isLoading || winner) return;

      const isHighlighted = highlightedSquares.some(([r, c]) => r === row && c === col);
      if (isHighlighted) {
        handleMove(row, col);
        return;
      }

      const occupant = boardState.find((p) => p.position[0] === row && p.position[1] === col);
      if (occupant && occupant.owner === currentTurn) {
        if (occupant.piece_id === selectedPieceId) {
          // Deselect
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
    [isLoading, winner, highlightedSquares, boardState, currentTurn, selectedPieceId, handleMove, handlePieceSelect]
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
              ? `🏆 Winner: ${winner === "player" ? "Player 1" : "Player 2"}!`
              : isLoading
              ? "⏳ Loading..."
              : `Turn: ${currentTurn === "player" ? "Player 1 🔵" : "Player 2 🔴"}`}
          </div>
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
            🔵 {playerCount} pieces &nbsp; 🔴 {opponentCount} pieces
          </span>
        </div>

        {/* Error message */}
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
            <span>&#9888;&#65039; {error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontWeight: "bold" }}>&#10005;</button>
          </div>
        )}

        {/* Board with Breach overlay */}
        <div style={{ position: "relative" }}>
          {/* Breach animation overlay */}
          <BreachAnimation
            activations={breachActivations}
            onComplete={() => setBreachActivations([])}
          />

          {/* Board grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 4rem)",
              width: "fit-content",
              border: "3px solid #1f2937",
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
              opacity: isLoading ? 0.6 : 1,
              pointerEvents: isLoading ? "none" : "auto",
            }}
          >
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

                const isInactiveTurn = occupant && occupant.owner !== currentTurn;
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
                      cursor: winner || isLoading ? "default" : "pointer",
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
                          opacity: isInactiveTurn ? 0.6 : 1,
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
        {/* Role labels — shown only in remote mode */}
        {localRole && (
          <div style={{ marginBottom: "0.75rem", display: "flex", flexDirection: "column", gap: "0.25rem" }} data-testid="role-labels">
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem" }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", border: `2px solid ${localRole === "player" ? "#2563eb" : "#dc2626"}` }} />
              <span
                style={{ color: localRole === "player" ? "#2563eb" : "#dc2626", fontWeight: 600 }}
                data-testid="label-own-pieces"
              >
                Le tue pedine
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem" }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", border: `2px solid ${localRole === "player" ? "#dc2626" : "#2563eb"}` }} />
              <span
                style={{ color: "#6b7280" }}
                data-testid="label-opponent-pieces"
              >
                Pedine avversario
              </span>
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
                <span style={{ color: "#6b7280" }}>Element</span>
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
                <span style={{ fontWeight: "600", color: "#f97316" }}>&#9876;&#65039; {selectedPieceData.base_atk}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>Evolved</span>
                <span>{selectedBoardPiece.is_evolved ? "&#128081; Yes" : "No"}</span>
              </div>
              {/* Show Breach ability hint when piece is evolved */}
              {selectedBoardPiece.is_evolved && (
                <div style={{
                  marginTop: "0.5rem",
                  padding: "0.3rem 0.5rem",
                  backgroundColor: "#fef3c7",
                  border: "1px solid #f59e0b",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  textAlign: "center",
                  color: "#92400e",
                }}>
                  &#9889; Breach: AOE damage on diagonals
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>Player</span>
                <span style={{ color: selectedBoardPiece.owner === "player" ? "#2563eb" : "#dc2626", fontWeight: "600" }}>
                  {selectedBoardPiece.owner === "player" ? "P1 &#128309;" : "P2 &#128308;"}
                </span>
              </div>
            </div>
          </>
        ) : (
          <p style={{ color: "#9ca3af", textAlign: "center", marginTop: "2rem" }}>
            Select a piece to see stats
          </p>
        )}
      </div>
    </div>
  );
}
