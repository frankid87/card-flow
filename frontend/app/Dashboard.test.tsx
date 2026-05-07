// Feature: cardflow-platform, Property 20: API failure shows error without crash

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as fc from "fast-check";

const mockPush = vi.fn();
const mockApiFetch = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../lib/api", () => ({
  getToken: () => "test-token",
  authHeaders: () => ({ "Content-Type": "application/json", Authorization: "Bearer test-token" }),
  apiFetch: mockApiFetch,
}));

import Dashboard from "./page";

// ── helpers ──────────────────────────────────────────────────────────────────

const MOCK_ARTWORK = {
  id: "artwork-abc-123",
  image_url: "https://example.com/art.png",
  prompt: "a dragon",
  seed: null,
  created_at: new Date().toISOString(),
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── generate test cases upfront using fast-check ─────────────────────────────

const ERROR_STATUSES = [400, 404, 422, 500, 503] as const;

const testCases = fc.sample(
  fc.record({
    status: fc.constantFrom(...ERROR_STATUSES),
    errorDetail: fc.string({ minLength: 1, maxLength: 80 }),
  }),
  5
);

// ── test suite ────────────────────────────────────────────────────────────────

describe("Dashboard", () => {
  afterEach(() => {
    cleanup();
    mockApiFetch.mockReset();
    mockPush.mockReset();
  });

  /**
   * **Validates: Requirements 12.4**
   *
   * Property 20: For any API error response (4xx or 5xx) received during a
   * POST /pieces form submission, the Dashboard should:
   *   1. Display a user-visible error message (role="alert" element).
   *   2. Remain interactive — the form and submit button are still present.
   *
   * Uses fast-check to generate random (status, errorDetail) pairs.
   */
  it("P20: API failure shows error without crash and page remains interactive", async () => {
    for (const { status, errorDetail } of testCases) {
      mockApiFetch.mockImplementation(async (path: string, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (path === "/artworks" && method === "GET") {
          return jsonResponse(200, [MOCK_ARTWORK]);
        }
        return jsonResponse(status, { detail: errorDetail });
      });

      render(<Dashboard />);

      // Wait for artworks to load and thumbnail to appear
      const artworkBtn = await waitFor(() => {
        const img = screen.getByAltText("a dragon");
        return img.closest("button")!;
      });

      // Select the artwork to reveal the piece creation form
      fireEvent.click(artworkBtn);

      // Fill in the Name field
      const nameInput = await waitFor(() => screen.getByLabelText(/name/i));
      fireEvent.change(nameInput, { target: { value: "TestPiece" } });

      // Submit the form — triggers POST /pieces which returns an error
      const submitBtn = screen.getByRole("button", { name: /add to/i });
      fireEvent.click(submitBtn);

      // 1. Error message must appear (role="alert")
      await waitFor(() => {
        const alerts = screen.getAllByRole("alert");
        const submissionError = alerts.find(
          (el) => el.textContent && !el.textContent.includes("Failed to load artworks")
        );
        expect(submissionError).toBeTruthy();
      });

      // 2. Page remains interactive — form inputs and submit button still present
      expect(screen.getByLabelText(/name/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: /add to/i })).not.toBeDisabled();

      cleanup();
      mockApiFetch.mockReset();
    }
  });
});
