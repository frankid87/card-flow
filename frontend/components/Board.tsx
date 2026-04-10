"use client";

import { useState, useCallback } from "react";
import { GamePieceResponse, GameState } from "../types";
import PieceRenderer from "./PieceRenderer";

const ELEMENTAL_MATRIX: Record<string, number> = {
  "Fire-Grass": 2.0, "Grass-Fire": 0.5,
  "Grass-Water": 2.0, "Water-Grass": 0.5,
  "Water-Fire": 2.0, "Fire-Water": 0.5,
  "Electric-Air": 2.0, "Air-Electric": 0.5,
  "Air-Earth": 2.0, "Earth-Air": 0.5,
  "Earth-Electric": 2.0, "Electric-Earth": 0.5,
};

function calculate_damage(attackerElement: string, targetElement: string, baseAtk: number): number {
  return baseAtk * (ELEMENTAL_MATRIX[`${attackerElement}-${targetElement}`] ?? 1.0);
}

interface BoardProps {
  pieces: Array<{
    piece: GamePieceResponse;
    state: GameState;
    position: [number, number];
    owner: "player" | "opponent";
  }>;
}

interface InternalPiece {
  piece: GamePieceResponse;
  current_hp: number;
  is_evolved: boolean;
  position: [number, number];
  owner: "player" | "opponent";
}

function getValidMoves(entry: InternalPiece, allPieces: InternalPiece[]): [number, number][] {
  const [row, col] = entry.position;
  const owner = entry.owner;

  const forwardRow = owner === "player" ? row - 1 : row + 1;
  const backwardRow = owner === "player" ? row + 1 : row - 1;

  const directions: [number, number][] = [
    [forwardRow, col - 1],
    [forwardRow, col + 1],
  ];
  if (entry.is_evolved) {
    directions.push([backwardRow, col - 1]);
    directions.push([backwardRow, col + 1]);
  }

  const moves: [number, number][] = [];

  for (const [r, c] of directions) {
    if (r < 0 || r > 7 || c < 0 || c > 7) continue;
    const occupant = allPieces.find((p) => p.position[0] === r && p.position[1] === c);

    if (!occupant) {
      // Empty square — normal move
      moves.push([r, c]);
    } else if (occupant.owner !== owner) {
      // Enemy on diagonal — check if jump square behind is free
      const jumpRow = r + (r - row);
      const jumpCol = c + (c - col);
      if (jumpRow >= 0 && jumpRow <= 7 && jumpCol >= 0 && jumpCol <= 7) {
        const jumpOccupant = allPieces.find(
          (p) => p.position[0] === jumpRow && p.position[1] === jumpCol
        );
        if (!jumpOccupant) {
          // Jump is valid — land behind the enemy
          moves.push([jumpRow, jumpCol]);
        }
      }
    }
    // Friendly piece — skip
  }

  return moves;
}

export default function Board({ pieces: initialPieces }: BoardProps) {
  const [boardPieces, setBoardPieces] = useState<InternalPiece[]>(() =>
    initialPieces.map((e) => ({
      piece: e.piece,
      current_hp: e.state.current_hp,
      is_evolved: e.state.is_evolved,
      position: e.position,
      owner: e.owner,
    }))
  );

  // Turn management: player goes first
  const [currentTurn, setCurrentTurn] = useState<"player" | "opponent">("player");
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [highlightedSquares, setHighlightedSquares] = useState<[number, number][]>([]);
  const [winner, setWinner] = useState<"player" | "opponent" | null>(null);
  const [lastAction, setLastAction] = useState<string>("");

  const selectedPiece = boardPieces.find((p) => p.piece.id === selectedPieceId) ?? null;

  const handleSquareClick = useCallback(
    (row: number, col: number) => {
      if (winner) return;

      const clickedPiece = boardPieces.find(
        (p) => p.position[0] === row && p.position[1] === col
      );

      if (selectedPiece) {
        const isHighlighted = highlightedSquares.some(([r, c]) => r === row && c === col);

        if (isHighlighted) {
          // Capture row/col for use inside setState callback
          const destRow = row;
          const destCol = col;
          const attackerId = selectedPiece.piece.id;

          setBoardPieces((prev) => {
            let updated = [...prev];
            const attackerIdx = updated.findIndex((p) => p.piece.id === attackerId);
            if (attackerIdx === -1) return prev;

            const attacker = updated[attackerIdx];
            const fromRow = attacker.position[0];
            const fromCol = attacker.position[1];

            const rowDiff = destRow - fromRow;
            const colDiff = destCol - fromCol;
            const isJump = Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 2;

            if (isJump) {
              const midRow = fromRow + rowDiff / 2;
              const midCol = fromCol + colDiff / 2;
              const targetIdx = updated.findIndex(
                (p) => p.position[0] === midRow && p.position[1] === midCol && p.owner !== attacker.owner
              );
              if (targetIdx !== -1) {
                const target = updated[targetIdx];
                const damage = calculate_damage(
                  attacker.piece.element,
                  target.piece.element,
                  attacker.piece.base_atk
                );
                const newHp = target.current_hp - damage;
                setLastAction(
                  `${attacker.piece.name} salta su ${target.piece.name}: -${damage.toFixed(0)} HP${newHp <= 0 ? " 💀" : ` (rimane ${newHp.toFixed(0)} HP)`}`
                );
                if (newHp <= 0) {
                  updated = updated.filter((_, i) => i !== targetIdx);
                } else {
                  updated = updated.map((p, i) =>
                    i === targetIdx ? { ...p, current_hp: newHp } : p
                  );
                }
              }
            } else {
              setLastAction(`${attacker.piece.name} si sposta in (${destRow}, ${destCol})`);
            }

            const newPosition: [number, number] = [destRow, destCol];
            const isLastRow =
              (attacker.owner === "player" && destRow === 0) ||
              (attacker.owner === "opponent" && destRow === 7);

            updated = updated.map((p) =>
              p.piece.id === attackerId
                ? { ...p, position: newPosition, is_evolved: p.is_evolved || isLastRow }
                : p
            );

            const playerPieces = updated.filter((p) => p.owner === "player");
            const opponentPieces = updated.filter((p) => p.owner === "opponent");
            if (playerPieces.length === 0) setWinner("opponent");
            else if (opponentPieces.length === 0) setWinner("player");

            return updated;
          });

          // Switch turn after move
          setCurrentTurn((t) => (t === "player" ? "opponent" : "player"));
          setSelectedPieceId(null);
          setHighlightedSquares([]);
          return;
        }

        // Switch selection to another own piece
        if (clickedPiece && clickedPiece.owner === currentTurn) {
          const moves = getValidMoves(clickedPiece, boardPieces);
          setSelectedPieceId(clickedPiece.piece.id);
          setHighlightedSquares(moves);
          return;
        }

        // Deselect
        setSelectedPieceId(null);
        setHighlightedSquares([]);
        return;
      }

      // Select a piece only if it belongs to the current turn's player
      if (clickedPiece && clickedPiece.owner === currentTurn) {
        const moves = getValidMoves(clickedPiece, boardPieces);
        setSelectedPieceId(clickedPiece.piece.id);
        setHighlightedSquares(moves);
      }
    },
    [boardPieces, selectedPiece, highlightedSquares, currentTurn, winner]
  );

  const playerCount = boardPieces.filter((p) => p.owner === "player").length;
  const opponentCount = boardPieces.filter((p) => p.owner === "opponent").length;

  return (
    <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>
      {/* Board + header */}
      <div>
      {/* Turn indicator */}
      <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{
          padding: "0.4rem 1rem",
          borderRadius: "9999px",
          fontWeight: "bold",
          fontSize: "0.9rem",
          backgroundColor: currentTurn === "player" ? "#2563eb" : "#dc2626",
          color: "white",
        }}>
          {winner
            ? `🏆 Vince ${winner === "player" ? "Player 1" : "Player 2"}!`
            : `Turno: ${currentTurn === "player" ? "Player 1 🔵" : "Player 2 🔴"}`}
        </div>
        <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
          🔵 {playerCount} pezzi &nbsp; 🔴 {opponentCount} pezzi
        </span>
        {lastAction && (
          <span style={{ fontSize: "0.8rem", color: "#374151", fontStyle: "italic" }}>
            {lastAction}
          </span>
        )}
      </div>

      {/* Board */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(8, 4rem)",
          width: "fit-content",
          border: "3px solid #1f2937",
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        }}
      >
        {Array.from({ length: 8 }, (_, row) =>
          Array.from({ length: 8 }, (_, col) => {
            const isLight = (row + col) % 2 === 0;
            const isHighlighted = highlightedSquares.some(([r, c]) => r === row && c === col);
            const occupant = boardPieces.find((p) => p.position[0] === row && p.position[1] === col);
            const isSelected = occupant?.piece.id === selectedPieceId;

            let squareBg = isLight ? "#f5deb3" : "#8b4513";
            if (isHighlighted) squareBg = "#4ade80";
            if (isSelected) squareBg = "#60a5fa";

            const pieceBorder = occupant
              ? occupant.owner === "player" ? "3px solid #2563eb" : "3px solid #dc2626"
              : "none";

            const isInactiveTurn = occupant && occupant.owner !== currentTurn;
            const hpPct = occupant ? Math.max(0, (occupant.current_hp / occupant.piece.base_hp) * 100) : 0;
            const hpColor = hpPct > 60 ? "#22c55e" : hpPct > 30 ? "#f59e0b" : "#ef4444";

            return (
              <div
                key={`${row}-${col}`}
                style={{
                  width: "4rem", height: "4rem",
                  backgroundColor: squareBg,
                  border: "1px solid rgba(0,0,0,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: winner ? "default" : "pointer",
                  position: "relative",
                  boxSizing: "border-box",
                  flexDirection: "column",
                  padding: "2px",
                }}
                onClick={() => handleSquareClick(row, col)}
                data-testid={`square-${row}-${col}`}
              >
                {occupant && (
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
                        data={occupant.piece}
                        state={{ current_hp: occupant.current_hp, is_evolved: occupant.is_evolved }}
                      />
                    </div>
                    {/* Mini HP bar */}
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

      {/* Stats panel — shown when a piece is selected */}
      <div style={{
        width: "180px",
        minHeight: "200px",
        border: "2px solid #d1d5db",
        borderRadius: "8px",
        padding: "0.75rem",
        backgroundColor: "#f9fafb",
        fontSize: "0.85rem",
      }}>
        {selectedPiece ? (
          <>
            <div style={{ fontWeight: "bold", marginBottom: "0.5rem", fontSize: "1rem" }}>
              {selectedPiece.piece.name}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedPiece.piece.artwork.image_url}
              alt={selectedPiece.piece.name}
              style={{ width: "100%", borderRadius: "8px", marginBottom: "0.5rem", objectFit: "cover", height: "100px" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>Elemento</span>
                <span style={{ fontWeight: "600" }}>{selectedPiece.piece.element}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>HP</span>
                <span style={{ fontWeight: "600", color: "#ef4444" }}>
                  {Math.ceil(selectedPiece.current_hp)} / {selectedPiece.piece.base_hp}
                </span>
              </div>
              {/* HP bar */}
              <div style={{ width: "100%", height: "6px", backgroundColor: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{
                  width: `${Math.max(0, (selectedPiece.current_hp / selectedPiece.piece.base_hp) * 100)}%`,
                  height: "100%",
                  backgroundColor: selectedPiece.current_hp / selectedPiece.piece.base_hp > 0.6 ? "#22c55e" : selectedPiece.current_hp / selectedPiece.piece.base_hp > 0.3 ? "#f59e0b" : "#ef4444",
                  borderRadius: "3px",
                  transition: "width 0.3s",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>ATK</span>
                <span style={{ fontWeight: "600", color: "#f97316" }}>⚔️ {selectedPiece.piece.base_atk}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>Evolved</span>
                <span>{selectedPiece.is_evolved ? "👑 Sì" : "No"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#6b7280" }}>Giocatore</span>
                <span style={{ color: selectedPiece.owner === "player" ? "#2563eb" : "#dc2626", fontWeight: "600" }}>
                  {selectedPiece.owner === "player" ? "P1 🔵" : "P2 🔴"}
                </span>
              </div>
            </div>
          </>
        ) : (
          <p style={{ color: "#9ca3af", textAlign: "center", marginTop: "2rem" }}>
            Seleziona un pezzo per vedere le stats
          </p>
        )}
      </div>
    </div>
  );
}
