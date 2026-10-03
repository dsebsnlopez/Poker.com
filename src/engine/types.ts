// Cards are 2-char strings in pokersolver's format: rank + suit, e.g. "As", "Td", "7h".
export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Card = `${Rank}${Suit}`;

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  chips: number; // stack behind (not including chips already bet)
  hole: Card[];
  bet: number; // chips put in on the CURRENT street
  totalBet: number; // chips put in over the whole hand (needed for side pots later)
  folded: boolean;
  allIn: boolean;
  hasActed: boolean; // has acted since the last bet/raise on this street
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }; // "raise TO this total bet for the street", not "raise BY"

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number; // chips the player would add
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number; // all-in
}

export interface LogEntry {
  playerId: string;
  street: Street;
  action: Action;
  amount: number; // chips this action put in
}

export interface Winner {
  playerId: string;
  amount: number;
  handName?: string; // e.g. "Two Pair" (absent when everyone else folded)
}

export interface GameState {
  players: Player[];
  deck: Card[];
  community: Card[];
  pot: number;
  currentBet: number; // highest bet on this street
  minRaise: number; // size of the last raise (min increment for the next one)
  street: Street;
  dealer: number; // index into players
  toAct: number; // index into players
  smallBlind: number;
  bigBlind: number;
  handOver: boolean;
  winners: Winner[];
  handNumber: number;
  log: LogEntry[]; // actions taken this hand, in order
}
