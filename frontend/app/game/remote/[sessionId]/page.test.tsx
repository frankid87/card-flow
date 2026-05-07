/**
 * Tests for RemoteGamePage — task 9.6
 *
 * Requirements covered:
 *   7.1 — role_assigned message stores the Player_Role for the session duration
 *   7.4 — interaction is disabled when current_turn !== localRole
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ sessionId: "test-session-123" }),
}));

const mockApiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/api", () => ({
  getToken: () => "mock-jwt-token",
  authHeaders: () => ({
    "Content-Type": "application/json",
    Authorization: "Bearer mock-jwt-token",
  }),
  apiFetch: mockApiFetch,
}));

// ─── WebSocket mock ───────────────────────────────────────────────────────────

type WsEventType = "open" | "message" | "error" | "close";

interface MockWsInstance {
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  /** Helper: simulate an incoming server message */
  simulateMessage: (data: unknown) => void;
  /** Helper: simulate the connection opening */
  simulateOpen: () => void;
}

let mockWsInstance: MockWsInstance;

const MockWebSocket = vi.fn().mockImplementation(() => {
  mockWsInstance = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1, // OPEN
    simulateMessage(data: unknown) {
      this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
    },
    simulateOpen() {
      this.onopen?.(new Event("open"));
    },
  };
  return mockWsInstance;
});

vi.stubGlobal("WebSocket", MockWebSocket);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_BOARD_STATE = [
  { piece_id: "p1", owner: "player" as const, position: [6, 0] as [number, number], current_hp: 100, is_evolved: false },
  { piece_id: "p2", owner: "opponent" as const, position: [1, 0] as [number, number], current_hp: 100, is_evolved: false },
];

const MOCK_SESSION = {
  session_id: "test-session-123",
  game_mode: "pvp_remote" as const,
  current_turn: "player" as const,
  winner: null,
  board_state: MOCK_BOARD_STATE,
  status: "ready",
  player_user_id: "user-1",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Import component (after mocks are set up) ────────────────────────────────

import RemoteGamePage from "./page";

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("RemoteGamePage", () => {
  beforeEach(() => {
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === `/game/test-session-123`) {
        return jsonResponse(200, MOCK_SESSION);
      }
      return jsonResponse(404, { detail: "Not found" });
    });

    // Provide empty sessionStorage pieces so the board renders without artwork
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── Requirement 7.1 ──────────────────────────────────────────────────────

  describe("Requirement 7.1 — role_assigned stores the Player_Role", () => {
    it("displays 'Sei Giocatore 1' badge when role_assigned sends player", async () => {
      render(<RemoteGamePage />);

      // Wait for session to load
      await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());

      // Simulate WS open then role_assigned
      await act(async () => {
        mockWsInstance.simulateOpen();
        mockWsInstance.simulateMessage({ type: "role_assigned", role: "player" });
      });

      await waitFor(() => {
        expect(screen.getByText(/Sei Giocatore 1/i)).toBeInTheDocument();
      });
    });

    it("displays 'Sei Giocatore 2' badge when role_assigned sends opponent", async () => {
      render(<RemoteGamePage />);

      await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());

      await act(async () => {
        mockWsInstance.simulateOpen();
        mockWsInstance.simulateMessage({ type: "role_assigned", role: "opponent" });
      });

      await waitFor(() => {
        expect(screen.getByText(/Sei Giocatore 2/i)).toBeInTheDocument();
      });
    });

    it("retains the role after a subsequent board_update message", async () => {
      render(<RemoteGamePage />);

      await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());

      await act(async () => {
        mockWsInstance.simulateOpen();
        mockWsInstance.simulateMessage({ type: "role_assigned", role: "player" });
        // Simulate a board update arriving after role assignment
        mockWsInstance.simulateMessage({
          type: "board_update",
          board_state: MOCK_BOARD_STATE,
          current_turn: "opponent",
          winner: null,
          game_mode: "pvp_remote",
        });
      });

      // Role badge must still be present after the board update
      await waitFor(() => {
        expect(screen.getByText(/Sei Giocatore 1/i)).toBeInTheDocument();
      });
    });
  });

  // ── Requirement 7.4 ──────────────────────────────────────────────────────

  describe("Requirement 7.4 — interaction disabled when not local turn", () => {
    it("shows 'In attesa della mossa avversaria' when it is not the local player's turn", async () => {
      render(<RemoteGamePage />);

      await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());

      await act(async () => {
        mockWsInstance.simulateOpen();
        // Local role is "player", but current_turn is "opponent" → not our turn
        mockWsInstance.simulateMessage({ type: "role_assigned", role: "player" });
        mockWsInstance.simulateMessage({
          type: "board_update",
          board_state: MOCK_BOARD_STATE,
          current_turn: "opponent",
          winner: null,
          game_mode: "pvp_remote",
        });
      });

      await waitFor(() => {
        expect(
          screen.getByText(/In attesa della mossa avversaria/i)
        ).toBeInTheDocument();
      });
    });

    it("does NOT show the waiting banner when it IS the local player's turn", async () => {
      render(<RemoteGamePage />);

      await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());

      await act(async () => {
        mockWsInstance.simulateOpen();
        // Local role is "player" and current_turn is also "player" → our turn
        mockWsInstance.simulateMessage({ type: "role_assigned", role: "player" });
        mockWsInstance.simulateMessage({
          type: "board_update",
          board_state: MOCK_BOARD_STATE,
          current_turn: "player",
          winner: null,
          game_mode: "pvp_remote",
        });
      });

      await waitFor(() => {
        expect(
          screen.queryByText(/In attesa della mossa avversaria/i)
        ).not.toBeInTheDocument();
      });
    });

    it("board grid has pointer-events:none when it is not the local player's turn", async () => {
      render(<RemoteGamePage />);

      await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());

      await act(async () => {
        mockWsInstance.simulateOpen();
        mockWsInstance.simulateMessage({ type: "role_assigned", role: "player" });
        mockWsInstance.simulateMessage({
          type: "board_update",
          board_state: MOCK_BOARD_STATE,
          current_turn: "opponent", // not our turn
          winner: null,
          game_mode: "pvp_remote",
        });
      });

      // The board grid renders squares with data-testid="square-{row}-{col}"
      // The grid wrapper has pointerEvents:none when interactionDisabled
      await waitFor(() => {
        const square = screen.getByTestId("square-0-0");
        const grid = square.parentElement!;
        expect(grid.style.pointerEvents).toBe("none");
      });
    });

    it("board grid is interactive when it IS the local player's turn", async () => {
      render(<RemoteGamePage />);

      await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());

      await act(async () => {
        mockWsInstance.simulateOpen();
        mockWsInstance.simulateMessage({ type: "role_assigned", role: "player" });
        mockWsInstance.simulateMessage({
          type: "board_update",
          board_state: MOCK_BOARD_STATE,
          current_turn: "player", // our turn
          winner: null,
          game_mode: "pvp_remote",
        });
      });

      await waitFor(() => {
        const square = screen.getByTestId("square-0-0");
        const grid = square.parentElement!;
        expect(grid.style.pointerEvents).not.toBe("none");
      });
    });
  });
});
