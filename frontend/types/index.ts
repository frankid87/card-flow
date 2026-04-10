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
