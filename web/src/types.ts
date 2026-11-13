export interface User {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  is_demo: boolean;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  source: string;
}

export interface Card {
  id: string;
  folder_id: string | null;
  question: string;
  answer: string;
  wrongs: string[];
}

export interface Review {
  id: string;
  card_id: string;
  correct: boolean;
  mode: 'flip' | 'quiz';
  answered_at: number;
}

export interface CardStats {
  attempts: number;
  correct: number;
  last: string;
  last_at: number;
}

export interface Stats {
  today: string;
  streak: number;
  total_cards: number;
  month: { answers: number; accuracy: number | null };
  heatmap: { day: string; count: number }[];
  folders: { id: string; name: string; color: string; cards: number; attempts: number; accuracy: number | null }[];
  weak: { card_id: string; accuracy: number }[];
  cards: Record<string, CardStats>;
}
