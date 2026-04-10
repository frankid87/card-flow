"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GamePieceResponse, GameState } from "../../types";
import Board from "../../components/Board";

// Place player pieces on rows 6-7, opponent on rows 0-1
// Checkers-style: only dark squares (row+col odd)
function buildInitialPositions(
  player1: GamePieceResponse[],
  player2: GamePieceResponse[]
): Array<{
  piece: GamePieceResponse;
  state: GameState;
  position: [number, number];
  owner: "player" | "opponent";
}> {
  const darkSquares = (startRow: number, count: number): [number, number][] => {
    const squares: [number, number][] = [];
    for (let row = startRow; row < startRow + 3 && squares.length < count; row++) {
      for (let col = 0; col < 8 && squares.length < count; col++) {
        if ((row + col) % 2 === 1) squares.push([row, col]);
      }
    }
    return squares;
  };

  const p2Positions = darkSquares(0, player2.length);
  const p1Positions = darkSquares(5, player1.length);

  const makeState = (piece: GamePieceResponse): GameState => ({
    id: `state-${piece.id}`,
    piece_id: piece.id,
    current_hp: piece.base_hp,
    is_evolved: false,
  });

  return [
    ...player2.map((piece, i) => ({
      piece,
      state: makeState(piece),
      position: p2Positions[i] ?? [0, i],
      owner: "opponent" as const,
    })),
    ...player1.map((piece, i) => ({
      piece,
      state: makeState(piece),
      position: p1Positions[i] ?? [7, i],
      owner: "player" as const,
    })),
  ];
}

export default function GamePage() {
  const router = useRouter();
  const [boardPieces, setBoardPieces] = useState<ReturnType<typeof buildInitialPositions> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const p1Raw = sessionStorage.getItem("player1Pieces");
      const p2Raw = sessionStorage.getItem("player2Pieces");
      if (!p1Raw || !p2Raw) {
        setError("No game setup found. Please set up pieces first.");
        return;
      }
      const p1: GamePieceResponse[] = JSON.parse(p1Raw);
      const p2: GamePieceResponse[] = JSON.parse(p2Raw);
      setBoardPieces(buildInitialPositions(p1, p2));
    } catch {
      setError("Failed to load game data.");
    }
  }, []);

  if (error) {
    return (
      <main className="p-8 max-w-2xl mx-auto">
        <div className="p-4 bg-red-100 text-red-700 rounded mb-4">{error}</div>
        <button
          onClick={() => router.push("/")}
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          ← Back to Setup
        </button>
      </main>
    );
  }

  if (!boardPieces) {
    return <main className="p-8"><p className="text-gray-500">Loading…</p></main>;
  }

  return (
    <main className="p-8">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.push("/")}
          className="px-3 py-1 border rounded text-sm hover:bg-gray-100"
        >
          ← Setup
        </button>
        <h1 className="text-2xl font-bold">Battle Checkers</h1>
        <span className="text-sm text-gray-500">Player 1 (bottom) vs Player 2 (top)</span>
      </div>

      <div className="overflow-auto">
        <Board pieces={boardPieces} />
      </div>

      <div className="mt-4 text-sm text-gray-500 space-y-1">
        <p>
          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "3px solid #2563eb", marginRight: 6, verticalAlign: "middle" }} />
          Player 1 (bottom)
          &nbsp;&nbsp;
          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "3px solid #dc2626", marginRight: 6, verticalAlign: "middle" }} />
          Player 2 (top)
        </p>
        <p>🟢 Verde = mosse valide &nbsp; 🔵 Azzurro = pezzo selezionato</p>
        <p>Clicca un pezzo per selezionarlo, poi clicca una casella verde per muovere o attaccare.</p>
      </div>
    </main>
  );
}
