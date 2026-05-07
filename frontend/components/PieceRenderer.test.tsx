// Feature: cardflow-platform, Property 15: PieceRenderer renders circular token with correct overlays

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as fc from "fast-check";
import PieceRenderer from "./PieceRenderer";
import { GamePieceResponse, ElementEnum } from "../types";

const ELEMENTS: ElementEnum[] = [
  "Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral",
];

function makeArtwork(imageUrl: string) {
  return {
    id: "art-" + Math.random().toString(36).slice(2),
    image_url: imageUrl,
    prompt: null,
    seed: null,
    created_at: new Date().toISOString(),
  };
}

function makePiece(element: ElementEnum, baseHp: number, baseAtk: number, imageUrl: string): GamePieceResponse {
  return {
    id: "piece-" + Math.random().toString(36).slice(2),
    artwork_id: "art-1",
    name: "TestPiece",
    element,
    base_hp: baseHp,
    base_atk: baseAtk,
    artwork: makeArtwork(imageUrl),
  };
}

// Arbitraries
const elementArb = fc.constantFrom(...ELEMENTS);
const positiveIntArb = fc.integer({ min: 1, max: 10000 });
const imageUrlArb = fc.constant("https://example.com/img.png");

/**
 * **Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.6**
 *
 * Property 15: For any GamePieceResponse and GameState, PieceRenderer should:
 * - render the artwork as a circular element (rounded-full + object-cover)
 * - display current_hp in the HP_Bar overlay
 * - display the element in the Element_Icon overlay
 * - render Evolved_Crown iff is_evolved is true
 */
describe("PieceRenderer", () => {
  it("P15: renders circular token with correct overlays for any valid piece/state", () => {
    fc.assert(
      fc.property(
        elementArb,
        positiveIntArb,
        positiveIntArb,
        fc.integer({ min: 0, max: 10000 }),
        fc.boolean(),
        imageUrlArb,
        (element, baseHp, baseAtk, currentHp, isEvolved, imageUrl) => {
          const piece = makePiece(element, baseHp, baseAtk, imageUrl);
          const state = { current_hp: currentHp, is_evolved: isEvolved };

          const { container, unmount } = render(
            <PieceRenderer data={piece} state={state} />
          );

          // 1. Image must have rounded-full and object-cover classes
          const img = container.querySelector("img");
          expect(img).not.toBeNull();
          expect(img!.className).toContain("rounded-full");
          expect(img!.className).toContain("object-cover");

          // 2. HP_Bar must show current_hp value
          expect(screen.getByText(String(currentHp))).toBeTruthy();

          // 3. Element_Icon must show the element
          const elementText = container.textContent ?? "";
          expect(elementText).toContain(element);

          // 4. Evolved_Crown present iff is_evolved
          const crown = screen.queryByRole("img", { name: "Evolved" });
          if (isEvolved) {
            expect(crown).not.toBeNull();
          } else {
            expect(crown).toBeNull();
          }

          unmount();
        }
      ),
      { numRuns: 20 }
    );
  });
});
