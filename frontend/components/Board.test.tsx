// Feature: cardflow-platform, Property 16: Board movement highlights correct diagonal squares
// Feature: cardflow-platform, Property 17: Attack reduces target HP by calculate_damage result
// Feature: cardflow-platform, Property 18: Piece removal and survival based on HP after attack

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import * as fc from "fast-check";
import Board from "./Board";
import { GamePieceResponse, GameState, ElementEnum } from "../types";

const ELEMENTS: ElementEnum[] = [
  "Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral",
];

let pieceCounter = 0;

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

function makeState(currentHp: number, isEvolved: boolean): GameState {
  return {
    id: `state-${pieceCounter}`,
    piece_id: `piece-${pieceCounter}`,
    current_hp: currentHp,
    is_evolved: isEvolved,
  };
}

/**
 * Compute expected valid moves for a piece at [row, col] with given owner and evolved status.
 * Mirrors the Board's getValidMoves logic.
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
    const occupant = allPositions.find(
      (p) => p.pos[0] === r && p.pos[1] === c
    );
    if (occupant && occupant.owner === owner) return false;
    return true;
  });
}

/**
 * **Validates: Requirements 11.3, 11.4**
 *
 * Property 16: For any piece position on the board, the highlighted valid move squares
 * should be exactly the diagonal-forward squares (plus diagonal-backward if evolved).
 */
describe("Board", () => {
  it("P16: highlights exactly the correct diagonal squares on piece selection", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 0, max: 7 }),
        fc.boolean(),
        (row, col, isEvolved) => {
          const piece = makePiece("Neutral", 100, 10);
          const state = makeState(100, isEvolved);

          const { container, unmount } = render(
            <Board
              pieces={[
                {
                  piece,
                  state,
                  position: [row, col],
                  owner: "player",
                },
              ]}
            />
          );

          const board = within(container);

          // Click the square to select the piece
          const square = board.getByTestId(`square-${row}-${col}`);
          fireEvent.click(square);

          // Compute expected highlighted squares
          const expected = expectedMoves(row, col, "player", isEvolved, [
            { pos: [row, col], owner: "player" },
          ]);

          // Check all 64 squares for highlight status
          for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
              const sq = board.getByTestId(`square-${r}-${c}`);
              const isExpected = expected.some(([er, ec]) => er === r && ec === c);
              const isHighlighted = sq.className.includes("bg-green-400");

              expect(isHighlighted).toBe(isExpected);
            }
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 11.6, 11.7**
   *
   * Property 17: Attack reduces target HP by exactly calculate_damage result.
   * Uses all element pairs (including advantaged 2x, disadvantaged 0.5x, and neutral 1x)
   * and verifies the target's current_hp decreases by the correct amount.
   */
  it("P17: attack reduces target HP by calculate_damage result", () => {
    const ELEMENTAL_MATRIX: Record<string, number> = {
      "Fire-Grass": 2.0,
      "Grass-Fire": 0.5,
      "Grass-Water": 2.0,
      "Water-Grass": 0.5,
      "Water-Fire": 2.0,
      "Fire-Water": 0.5,
      "Electric-Air": 2.0,
      "Air-Electric": 0.5,
      "Air-Earth": 2.0,
      "Earth-Air": 0.5,
      "Earth-Electric": 2.0,
      "Electric-Earth": 0.5,
    };

    function expectedDamage(attackerEl: ElementEnum, targetEl: ElementEnum, baseAtk: number): number {
      return baseAtk * (ELEMENTAL_MATRIX[`${attackerEl}-${targetEl}`] ?? 1.0);
    }

    const elementArb = fc.constantFrom<ElementEnum>(
      "Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral"
    );

    fc.assert(
      fc.property(
        elementArb,
        elementArb,
        // base_atk: keep small enough that target always survives (targetHp > damage)
        fc.integer({ min: 1, max: 10 }),
        (attackerEl, targetEl, baseAtk) => {
          const damage = expectedDamage(attackerEl, targetEl, baseAtk);
          // Ensure target survives so we can read its updated HP
          const targetHp = Math.ceil(damage) + 50;

          const attacker = makePiece(attackerEl, 200, baseAtk);
          const target = makePiece(targetEl, targetHp, 1);
          const attackerState = makeState(200, false);
          const targetState = makeState(targetHp, false);

          const { container, unmount } = render(
            <Board
              pieces={[
                { piece: attacker, state: attackerState, position: [3, 3], owner: "player" },
                { piece: target, state: targetState, position: [2, 4], owner: "opponent" },
              ]}
            />
          );

          const board = within(container);

          // Select attacker then click target square to trigger attack
          fireEvent.click(board.getByTestId("square-3-3"));
          fireEvent.click(board.getByTestId("square-2-4"));

          // After attack, attacker occupies [2,4]. Move attacker away to expose target's HP bar.
          // Select attacker at [2,4] and move to [1,3].
          fireEvent.click(board.getByTestId("square-2-4"));
          fireEvent.click(board.getByTestId("square-1-3"));

          // Target should still be on the board (it survived)
          const targetImg = container.querySelector(`img[alt="${target.name}"]`);
          expect(targetImg).not.toBeNull();

          // Verify the HP bar shows the reduced HP value
          const expectedHp = targetHp - damage;
          const hpText = container.querySelector(`[data-testid="hp-current-${target.id}"]`);
          expect(hpText).not.toBeNull();
          expect(Number(hpText!.textContent)).toBeCloseTo(expectedHp, 5);

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 11.8, 11.9**
   *
   * Property 18: Piece removal and survival based on HP after attack.
   * Sub-property A: target removed when resulting HP <= 0
   * Sub-property B: target survives when resulting HP > 0
   */
  it("P18a: target is removed from board when HP reaches 0 after attack", () => {
    // Use Neutral vs Neutral (1x multiplier) so damage = baseAtk exactly.
    // Ensure baseAtk >= targetHp so target is always killed.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }).chain((targetHp) =>
          fc.record({
            targetHp: fc.constant(targetHp),
            baseAtk: fc.integer({ min: targetHp, max: targetHp + 100 }),
          })
        ),
        ({ targetHp, baseAtk }) => {
          const attacker = makePiece("Neutral", 200, baseAtk);
          const target = makePiece("Neutral", targetHp, 10);
          const attackerState = makeState(200, false);
          const targetState = makeState(targetHp, false);

          const { container, unmount } = render(
            <Board
              pieces={[
                { piece: attacker, state: attackerState, position: [3, 3], owner: "player" },
                { piece: target, state: targetState, position: [2, 4], owner: "opponent" },
              ]}
            />
          );

          const board = within(container);

          // Select attacker and attack target
          fireEvent.click(board.getByTestId("square-3-3"));
          fireEvent.click(board.getByTestId("square-2-4"));

          // Target should be removed: its alt text should not appear in the DOM
          const targetImg = container.querySelector(`img[alt="${target.name}"]`);
          expect(targetImg).toBeNull();

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("P18b: target remains on board when HP stays above 0 after attack", () => {
    // Use Neutral vs Neutral (1x multiplier) so damage = baseAtk exactly.
    // Ensure targetHp > baseAtk so target always survives.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }).chain((baseAtk) =>
          fc.record({
            baseAtk: fc.constant(baseAtk),
            // targetHp must be strictly greater than baseAtk to survive
            targetHp: fc.integer({ min: baseAtk + 1, max: baseAtk + 200 }),
          })
        ),
        ({ baseAtk, targetHp }) => {
          const attacker = makePiece("Neutral", 200, baseAtk);
          const target = makePiece("Neutral", targetHp, 10);
          const attackerState = makeState(200, false);
          const targetState = makeState(targetHp, false);

          const { container, unmount } = render(
            <Board
              pieces={[
                { piece: attacker, state: attackerState, position: [3, 3], owner: "player" },
                { piece: target, state: targetState, position: [2, 4], owner: "opponent" },
              ]}
            />
          );

          const board = within(container);

          // Select attacker and attack target (attacker moves to [2,4])
          fireEvent.click(board.getByTestId("square-3-3"));
          fireEvent.click(board.getByTestId("square-2-4"));

          // Attacker is now at [2,4]. Move attacker away to [1,3] to reveal target.
          // Click [2,4] to select attacker, then click [1,3] to move it.
          fireEvent.click(board.getByTestId("square-2-4"));
          fireEvent.click(board.getByTestId("square-1-3"));

          // Now [2,4] should have only the target (survived)
          const targetImg = container.querySelector(`img[alt="${target.name}"]`);
          expect(targetImg).not.toBeNull();

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});
