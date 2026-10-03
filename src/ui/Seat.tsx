import type { Player, Winner } from '../engine/types';
import { PlayingCard } from './PlayingCard';

interface Props {
  player: Player;
  label?: string; // "Easy", "Medium", "Hard" for bots
  showCards: boolean;
  toAct: boolean;
  lastAction?: string;
  win?: Winner;
  handDescription?: string; // at showdown
}

export function Seat({ player, label, showCards, toAct, lastAction, win, handDescription }: Props) {
  const out = player.chips === 0 && player.hole.length === 0;
  const classes = ['seat', toAct && 'to-act', player.folded && 'folded', win && 'winner', out && 'out']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <div className="hole">
        {/* Folded bots muck their cards; you keep seeing yours, dimmed. */}
        {(showCards || !player.folded ? player.hole : []).map((c) => (
          <PlayingCard key={c} card={c} faceDown={!showCards} dim={player.folded} />
        ))}
      </div>
      <div className="plate">
        <div className="name">
          {player.name}
          {label && <span className="tag">{label}</span>}
        </div>
        <div className="stack">{out ? 'Out' : player.allIn && player.chips === 0 ? 'All-in' : player.chips.toLocaleString()}</div>
      </div>
      {win ? (
        <div className="bubble win">
          +{win.amount}
          {win.handName && ` · ${win.handName}`}
        </div>
      ) : handDescription ? (
        <div className="bubble muted">{handDescription}</div>
      ) : (
        lastAction && <div className="bubble">{lastAction}</div>
      )}
    </div>
  );
}
