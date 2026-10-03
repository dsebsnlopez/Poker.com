import type { Card } from '../engine/types';

const SUITS = { s: '♠', h: '♥', d: '♦', c: '♣' } as const;
const SUIT_NAMES = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' } as const;

interface Props {
  card?: Card; // omitted = empty slot on the board
  faceDown?: boolean;
  dim?: boolean;
}

export function PlayingCard({ card, faceDown, dim }: Props) {
  if (!card) return <div className="card slot" aria-hidden />;
  if (faceDown) return <div className="card back" aria-label="face-down card" />;

  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = card[1] as keyof typeof SUITS;
  const red = suit === 'h' || suit === 'd';
  return (
    <div className={`card face${red ? ' red' : ''}${dim ? ' dim' : ''}`} aria-label={`${rank} of ${SUIT_NAMES[suit]}`}>
      <span className="rank">{rank}</span>
      <span className="suit">{SUITS[suit]}</span>
    </div>
  );
}
