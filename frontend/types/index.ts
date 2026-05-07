export type ElementEnum =
  | "Fire"
  | "Grass"
  | "Water"
  | "Electric"
  | "Air"
  | "Earth"
  | "Neutral";

export interface ArtworkResponse {
  id: string; // UUID
  image_url: string;
  prompt: string | null;
  seed: number | null;
  created_at: string; // ISO datetime
}

export interface GamePieceResponse {
  id: string; // UUID
  artwork_id: string;
  name: string;
  element: ElementEnum;
  base_hp: number;
  base_atk: number;
  artwork: ArtworkResponse;
}

export interface GameState {
  id: string;
  piece_id: string;
  current_hp: number;
  is_evolved: boolean;
}

export interface BoardPieceState {
  piece_id: string;
  owner: "player" | "opponent";
  position: [number, number];
  current_hp: number;
  is_evolved: boolean;
}

export interface BreachTarget {
  piece_id: string;
  damage: number;
  current_hp_after: number;
  was_removed: boolean;
}

export interface BreachActivation {
  piece_id: string;
  element: string;
  targets: BreachTarget[];
  affected_squares: [number, number][];
}

export interface SessionResponse {
  session_id: string;
  game_mode: "pvp" | "pvc" | "pvp_remote";
  current_turn: "player" | "opponent";
  winner: string | null;
  board_state: BoardPieceState[];
  breach_activations?: BreachActivation[];  // NEW
  status?: string;
  player_user_id?: string;
  opponent_user_id?: string;
  difficulty?: "easy" | "medium" | "hard";
}

export interface SessionCreateRequest {
  player_piece_ids: string[];
  opponent_piece_ids: string[];
  game_mode: "pvp" | "pvc" | "pvp_remote";
  ai_depth?: number;
  difficulty?: "easy" | "medium" | "hard";
}

// WebSocket message types for remote multiplayer
export interface WsRoleAssigned {
  type: "role_assigned";
  role: "player" | "opponent";
}

export interface WsBoardUpdate {
  type: "board_update";
  board_state: BoardPieceState[];
  current_turn: "player" | "opponent";
  winner: string | null;
  game_mode: "pvp" | "pvc" | "pvp_remote";
  breach_activations?: BreachActivation[];  // NEW
}

export interface WsError {
  type: "error";
  code: string;
  detail?: string;
}

export interface WsOpponentJoined {
  type: "opponent_joined";
}

export interface WsOpponentDisconnected {
  type: "opponent_disconnected";
}
export interface WsMoveMessage {
  type: "move";
  piece_id: string;
  to_position: [number, number];
}

export type WsIncomingMessage =
  | WsRoleAssigned
  | WsBoardUpdate
  | WsError
  | WsOpponentJoined
  | WsOpponentDisconnected;
export interface MoveRequest {
  piece_id: string;
  to_position: [number, number];
}

export interface ValidMovesResponse {
  piece_id: string;
  moves: [number, number][];
}

