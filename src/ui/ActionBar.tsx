import { useEffect, useState } from 'react';
import { legalActions } from '../engine/engine';
import type { Action, GameState } from '../engine/types';

interface Props {
  state: GameState;
  onAction: (action: Action) => void;
}

/** Fold / Check-or-Call / Raise controls for the human. Keys: F, C, R. */
export function ActionBar({ state, onAction }: Props) {
  const legal = legalActions(state);
  const [raiseTo, setRaiseTo] = useState(legal.minRaiseTo);
  const clamp = (n: number) => Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(n)));

  // A "pot-sized" raise: call, then raise by the size of the pot after calling.
  const potRaise = (fraction: number) => clamp(state.currentBet + (state.pot + legal.callAmount) * fraction);
  const isBet = state.currentBet === 0;
  const allIn = raiseTo === legal.maxRaiseTo;

  const fold = () => onAction({ type: 'fold' });
  const checkOrCall = () => onAction(legal.canCheck ? { type: 'check' } : { type: 'call' });
  const raise = () => onAction({ type: 'raise', to: clamp(raiseTo) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type === 'number') return;
      const key = e.key.toLowerCase();
      if (key === 'f') fold();
      else if (key === 'c') checkOrCall();
      else if (key === 'r' && legal.canRaise) raise();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="action-bar">
      <div className="buttons">
        <button className="btn fold" onClick={fold}>
          Fold <kbd>F</kbd>
        </button>
        <button className="btn call" onClick={checkOrCall}>
          {legal.canCheck ? 'Check' : `Call ${legal.callAmount}`} <kbd>C</kbd>
        </button>
        {legal.canRaise && (
          <button className="btn raise" onClick={raise}>
            {allIn ? `All-in ${raiseTo}` : `${isBet ? 'Bet' : 'Raise to'} ${raiseTo}`} <kbd>R</kbd>
          </button>
        )}
      </div>

      {legal.canRaise && legal.minRaiseTo < legal.maxRaiseTo && (
        <div className="sizing">
          <div className="presets">
            <button onClick={() => setRaiseTo(legal.minRaiseTo)}>Min</button>
            <button onClick={() => setRaiseTo(potRaise(0.5))}>½ Pot</button>
            <button onClick={() => setRaiseTo(potRaise(1))}>Pot</button>
            <button onClick={() => setRaiseTo(legal.maxRaiseTo)}>All-in</button>
          </div>
          <input
            type="range"
            aria-label="Raise amount"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            value={raiseTo}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
          />
          <input
            type="number"
            aria-label="Raise to"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            value={raiseTo}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
            onBlur={() => setRaiseTo(clamp(raiseTo))}
          />
        </div>
      )}
    </div>
  );
}
