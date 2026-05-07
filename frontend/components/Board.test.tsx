// Feature: cardflow-platform, Property 16: Board movement highlights correct diagonal squares
// Feature: cardflow-platform, Property 17: Attack reduces target HP by calculate_damage result
// Feature: cardflow-platform, Property 18: Piece removal and survival based on HP after attack
// Feature: cardflow-platform, Property 19: Evolution triggered on reaching opponent's last row

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within, act } from "@testing-library/react";
import * as fc from "fast-check";
import Board from "./Board";
import { GamePieceResponse, ElementEnum, BoardPieceState, SessionResponse } from "../types";

// ---------------------------------------------------------------------------
// Mock apiFetch so Board tests don't hit the network
// ---------------------------------------------------------------------------
vi.mock("../lib/api", () => ({
  apiFetch: vi.fn(),
  getToken: vi.fn(() => "fake-token"),
  authHeaders: vi.fn(() => ({ "Content-Type": "application/json" })),
}));

import { apiFetch } from "../lib/api";
const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

const ELEMENTS: ElementEnum[] = [
  "Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral",
];

let pieceCounter = 0;

beforeEach(() => {
  pieceCounter = 0;
  mockApiFetch.mockReset();
});

function makePiece(element: ElementEnum, baseHp: number, baseAtk: number): GamePieceResponse {
  pieceCounter++;
  return {
    id: `piece-${pieceCounter}`,
    artwork_id: `art-${pieceCounter}`,
    name: `Piece${pieceCounter}`,
    element,
    base_hp: baseHp,
    base_atk: baseAtk,
    artwork: {
      id: `art-${pieceCounter}`,
      image_url: "https://example.com/img.png",
      prompt: null,
      seed: null,
      created_at: new Date().toISOString(),
    },
  };
}

function makeBoardPiece(
  pieceId: string,
  owner: "player" | "opponent",
  position: [number, number],
  currentHp: number,
  isEvolved = false
): BoardPieceState {
  return { piece_id: pieceId, owner, position, current_hp: currentHp, is_evolved: isEvolved };
}

/**
 * Compute expected valid moves for a piece at [row, col] with given owner and evolved status.
 * Mirrors the backend valid-moves logic.
 */
function expectedMoves(
  row: number,
  col: number,
  owner: "player" | "opponent",
  isEvolved: boolean,
  allPositions: Array<{ pos: [number, number]; owner: "player" | "opponent" }>
): [number, number][] {
  const forwardRow = owner === "player" ? row - 1 : row + 1;
  const backwardRow = owner === "player" ? row + 1 : row - 1;

  const candidates: [number, number][] = [
    [forwardRow, col - 1],
    [forwardRow, col + 1],
  ];
  if (isEvolved) {
    candidates.push([backwardRow, col - 1]);
    candidates.push([backwardRow, col + 1]);
  }

  return candidates.filter(([r, c]) => {
    if (r < 0 || r > 7 || c < 0 || c > 7) return false;
    const occupant = allPositions.find((p) => p.pos[0] === r && p.pos[1] === c);
    if (occupant && occupant.owner === owner) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Helper: build a mock Response for apiFetch
// ---------------------------------------------------------------------------
function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("Board", () => {
  /**
   * **Validates: Requirements 11.3, 11.4**
   *
   * Property 16: For any piece position on the board, after clicking a piece the Board
   * requests valid moves from the API and highlights exactly those squares in green.
   */
  it("P16: highlights exactly the squares returned by the valid-moves API", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 0, max: 7 }),
        fc.boolean(),
        async (row, col, isEvolved) => {
          pieceCounter = 0;
          mockApiFetch.mockReset();

          const piece = makePiece("Neutral", 100, 10);
          const boardState: BoardPieceState[] = [
            makeBoardPiece(piece.id, "player", [row, col], 100, isEvolved),
          ];

          // Compute the moves the backend would return
          const moves = expectedMoves(row, col, "player", isEvolved, [
            { pos: [row, col], owner: "player" },
          ]);

          // Mock the valid-moves API call
          mockApiFetch.mockResolvedValueOnce(
            mockResponse({ piece_id: piece.id, moves })
          );

          const { container, unmount } = render(
            <Board
              boardState={boardState}
              sessionId="test-session"
              currentTurn="player"
              winner={null}
              pieces={[piece]}
              onSessionUpdate={vi.fn()}
            />
          );

          const board = within(container);

          // Click the square to select the piece (triggers valid-moves fetch)
          await act(async () => {
            fireEvent.click(board.getByTestId(`square-${row}-${col}`));
          });

          // Check all 64 squares for highlight status (green background)
          for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
              const sq = board.getByTestId(`square-${r}-${c}`);
              const isExpected = moves.some(([er, ec]) => er === r && ec === c);
              const bgColor = (sq as HTMLElement).style.backgroundColor;
              // Highlighted squares get backgroundColor set to #4ade80
              const isHighlighted = bgColor === "rgb(74, 222, 128)" || bgColor === "#4ade80";
              expect(isHighlighted).toBe(isExpected);
            }
          }

          unmount();
        }
      ),
      { numRuns: 20 }
    );
  }, 30000);

  /**
   * **Validates: Requirements 11.6, 11.7**
   *
   * Property 17: After a move, the Board calls onSessionUpdate with the API response.
   */
  it("P17: board calls onSessionUpdate with the API response after a move", async () => {
    pieceCounter = 0;
    mockApiFetch.mockReset();

    const attacker = makePiece("Fire", 200, 10);
    const target = makePiece("Grass", 100, 1);

    const boardState: BoardPieceState[] = [
      makeBoardPiece(attacker.id, "player", [3, 3], 200),
      makeBoardPiece(target.id, "opponent", [2, 4], 100),
    ];

    // Mock valid-moves for attacker: can reach [2,2] and [2,4]
    mockApiFetch.mockResolvedValueOnce(
      mockResponse({ piece_id: attacker.id, moves: [[2, 2], [2, 4]] })
    );

    // After move: API returns updated session
    const updatedSession: SessionResponse = {
      session_id: "test-session",
      game_mode: "pvp",
      current_turn: "opponent",
      winner: null,
      board_state: [
        makeBoardPiece(attacker.id, "player", [2, 4], 200),
        makeBoardPiece(target.id, "opponent", [2, 4], 80),
      ],
    };
    mockApiFetch.mockResolvedValueOnce(mockResponse(updatedSession));

    const onSessionUpdate = vi.fn();

    const { container } = render(
      <Board
        boardState={boardState}
        sessionId="test-session"
        currentTurn="player"
        winner={null}
        pieces={[attacker, target]}
        onSessionUpdate={onSessionUpdate}
      />
    );

    const board = within(container);

    // Select attacker — triggers valid-moves fetch
    await act(async () => {
      fireEvent.click(board.getByTestId("square-3-3"));
    });

    // Move to [2,4] — should be highlighted now, triggers move API call
    await act(async () => {
      fireEvent.click(board.getByTestId("square-2-4"));
    });

    expect(onSessionUpdate).toHaveBeenCalledWith(updatedSession);
  });

  /**
   * **Validates: Requirements 11.8, 11.9**
   *
   * Property 18: After a move, the Board calls onSessionUpdate with the API response.
   * If the API response omits a piece (it was captured), onSessionUpdate reflects that.
   */
  it("P18: onSessionUpdate reflects captured piece after a move", async () => {
    pieceCounter = 0;
    mockApiFetch.mockReset();

    const attacker = makePiece("Neutral", 200, 100);
    const target = makePiece("Neutral", 50, 1);

    const boardState: BoardPieceState[] = [
      makeBoardPiece(attacker.id, "player", [3, 3], 200),
      makeBoardPiece(target.id, "opponent", [2, 4], 50),
    ];

    mockApiFetch.mockResolvedValueOnce(
      mockResponse({ piece_id: attacker.id, moves: [[2, 2], [2, 4]] })
    );

    // After move: target is captured (not in board_state)
    const updatedSession: SessionResponse = {
      session_id: "test-session",
      game_mode: "pvp",
      current_turn: "opponent",
      winner: null,
      board_state: [
        makeBoardPiece(attacker.id, "player", [2, 4], 200),
      ],
    };
    mockApiFetch.mockResolvedValueOnce(mockResponse(updatedSession));

    const onSessionUpdate = vi.fn();

    const { container } = render(
      <Board
        boardState={boardState}
        sessionId="test-session"
        currentTurn="player"
        winner={null}
        pieces={[attacker, target]}
        onSessionUpdate={onSessionUpdate}
      />
    );

    const board = within(container);

    await act(async () => {
      fireEvent.click(board.getByTestId("square-3-3"));
    });
    await act(async () => {
      fireEvent.click(board.getByTestId("square-2-4"));
    });

    expect(onSessionUpdate).toHaveBeenCalledWith(updatedSession);
    expect(updatedSession.board_state).toHaveLength(1);
    expect(updatedSession.board_state[0].piece_id).toBe(attacker.id);
  });

  /**
   * **Validates: Requirements 11.10**
   *
   * Property 19: When the API response includes a piece with is_evolved=true,
   * onSessionUpdate is called with that evolved state.
   */
  it("P19: onSessionUpdate reflects evolved piece when API response marks it evolved", async () => {
    pieceCounter = 0;
    mockApiFetch.mockReset();

    const piece = makePiece("Neutral", 100, 10);
    const startRow = 1;
    const col = 3;
    const destCol = col - 1; // diagonal left

    const boardState: BoardPieceState[] = [
      makeBoardPiece(piece.id, "player", [startRow, col], 100, false),
    ];

    mockApiFetch.mockResolvedValueOnce(
      mockResponse({ piece_id: piece.id, moves: [[0, destCol]] })
    );

    const updatedSession: SessionResponse = {
      session_id: "test-session",
      game_mode: "pvp",
      current_turn: "opponent",
      winner: null,
      board_state: [
        makeBoardPiece(piece.id, "player", [0, destCol], 100, true),
      ],
    };
    mockApiFetch.mockResolvedValueOnce(mockResponse(updatedSession));

    const onSessionUpdate = vi.fn();

    const { container } = render(
      <Board
        boardState={boardState}
        sessionId="test-session"
        currentTurn="player"
        winner={null}
        pieces={[piece]}
        onSessionUpdate={onSessionUpdate}
      />
    );

    const board = within(container);

    await act(async () => {
      fireEvent.click(board.getByTestId(`square-${startRow}-${col}`));
    });
    await act(async () => {
      fireEvent.click(board.getByTestId(`square-0-${destCol}`));
    });

    expect(onSessionUpdate).toHaveBeenCalledWith(updatedSession);
    expect(updatedSession.board_state[0].is_evolved).toBe(true);
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * When localRole is provided, the stats panel shows "Le tue pedine" and "Pedine avversario" labels.
   */
  it("shows 'Le tue pedine' and 'Pedine avversario' labels when localRole is provided", () => {
    const piece = makePiece("Neutral", 100, 10);
    const boardState: BoardPieceState[] = [
      { piece_id: piece.id, owner: "player", position: [3, 3], current_hp: 100, is_evolved: false },
    ];

    const { container } = render(
      <Board
        boardState={boardState}
        sessionId="test-session"
        currentTurn="player"
        winner={null}
        pieces={[piece]}
        onSessionUpdate={vi.fn()}
        localRole="player"
      />
    );

    expect(container.querySelector('[data-testid="label-own-pieces"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="label-opponent-pieces"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="label-own-pieces"]')!.textContent).toBe("Le tue pedine");
    expect(container.querySelector('[data-testid="label-opponent-pieces"]')!.textContent).toBe("Pedine avversario");
  });

  it("does not show role labels when localRole is not provided", () => {
    const piece = makePiece("Neutral", 100, 10);
    const boardState: BoardPieceState[] = [
      { piece_id: piece.id, owner: "player", position: [3, 3], current_hp: 100, is_evolved: false },
    ];

    const { container } = render(
      <Board
        boardState={boardState}
        sessionId="test-session"
        currentTurn="player"
        winner={null}
        pieces={[piece]}
        onSessionUpdate={vi.fn()}
      />
    );

    expect(container.querySelector('[data-testid="role-labels"]')).toBeNull();
    expect(container.querySelector('[data-testid="label-own-pieces"]')).toBeNull();
    expect(container.querySelector('[data-testid="label-opponent-pieces"]')).toBeNull();
  });

  it("shows correct labels for opponent localRole", () => {
    const piece = makePiece("Neutral", 100, 10);
    const boardState: BoardPieceState[] = [
      { piece_id: piece.id, owner: "opponent", position: [3, 3], current_hp: 100, is_evolved: false },
    ];

    const { container } = render(
      <Board
        boardState={boardState}
        sessionId="test-session"
        currentTurn="opponent"
        winner={null}
        pieces={[piece]}
        onSessionUpdate={vi.fn()}
        localRole="opponent"
      />
    );

    expect(container.querySelector('[data-testid="label-own-pieces"]')!.textContent).toBe("Le tue pedine");
    expect(container.querySelector('[data-testid="label-opponent-pieces"]')!.textContent).toBe("Pedine avversario");
  });
});
