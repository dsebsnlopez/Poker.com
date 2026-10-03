import { useEffect, useRef, useState } from 'react';
import { type Bot, createHardBot, easyBot, mediumBot, runBot } from './engine/bots';
import { applyAction, createGame, currentPlayer, startHand } from './engine/engine';
import { rankHand } from './engine/evaluator';
import type { Action, GameState } from './engine/types';
import { ActionBar } from './ui/ActionBar';
import { describe, nameOf, shortLabel } from './ui/format';
import { PlayingCard } from './ui/PlayingCard';
import { Seat } from './ui/Seat';
import './App.css';

const HUMAN = 'you';
const SEATS = [
  { id: HUMAN, name: 'You', isBot: false },
  { id: 'potato', name: 'Potato', isBot: true },
  { id: 'peanut', name: 'Peanut', isBot: true },
  { id: 'onion', name: 'Onion', isBot: true },
];
const LABELS: Record<string, string> = { potato: 'Easy', peanut: 'Medium', onion: 'Hard' };

function newBots(): Record<string, Bot> {
  return { potato: easyBot, peanut: mediumBot, onion: createHardBot() };
}

const newGame = () => startHand(createGame(SEATS));

/** Seat position around the oval, with the human at the bottom and play going clockwise. */
function place(index: number, humanIndex: number, n: number, rx: number, ry: number, nudge = 0) {
  const angle = Math.PI / 2 + ((index - humanIndex + n) % n) * ((2 * Math.PI) / n) + nudge;
  return { left: `${50 + rx * Math.cos(angle)}%`, top: `${50 + ry * Math.sin(angle)}%` };
}

export default function App() {
  const [state, setState] = useState<GameState>(newGame);
  const bots = useRef(newBots());
  const logPanel = useRef<HTMLElement>(null);

  const human = state.players.find((p) => p.id === HUMAN)!;
  const humanIndex = state.players.indexOf(human);
  const toAct = state.handOver ? undefined : currentPlayer(state);
  const humansTurn = toAct?.id === HUMAN;
  const gameOver = state.handOver && (human.chips === 0 || state.players.filter((p) => p.chips > 0).length < 2);
  const reachedShowdown = state.handOver && state.winners.some((w) => w.handName);

  // Bots act on their own after a short pause (quicker once you're out of the hand).
  useEffect(() => {
    if (!toAct?.isBot) return;
    const delay = human.folded || human.allIn ? 350 : 800;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const action = await runBot(bots.current[toAct.id], state, toAct.id);
      if (!cancelled) setState(applyAction(state, toAct.id, action));
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, toAct, human]);

  // Keep the newest action in view (scrolls the log panel only, not the page).
  useEffect(() => {
    if (logPanel.current) logPanel.current.scrollTop = logPanel.current.scrollHeight;
  }, [state.log.length, state.handOver]);

  const nextHand = () => setState(startHand(state));
  const restart = () => {
    bots.current = newBots();
    setState(newGame());
  };
  const onAction = (action: Action) => setState(applyAction(state, HUMAN, action));

  useEffect(() => {
    if (!state.handOver) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (gameOver) restart();
        else nextHand();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const n = state.players.length;
  const lastActionOf = (id: string) => {
    const entry = state.log.findLast((e) => e.playerId === id && e.street === state.street);
    return entry && shortLabel(state, entry);
  };

  return (
    <div className="app">
      <header>
        <h1>
          <span className="spade">♠</span> Poker.com
        </h1>
        <div className="blinds">
          Hand {state.handNumber} · Blinds {state.smallBlind}/{state.bigBlind}
        </div>
      </header>

      <main>
        <section className="table-wrap" aria-label="Poker table">
          <div className="table">
            <div className="felt" />

            <div className="center">
              <div className="board">
                {Array.from({ length: 5 }, (_, i) => (
                  <PlayingCard key={state.community[i] ?? `slot${i}`} card={state.community[i]} />
                ))}
              </div>
              <div className="pot">
                {state.handOver ? 'Hand over' : `Pot ${state.pot.toLocaleString()}`}
              </div>
            </div>

            {state.players.map((p, i) => (
              <div key={p.id} className="seat-pos" style={place(i, humanIndex, n, 43, 41)}>
                <Seat
                  player={p}
                  label={LABELS[p.id]}
                  showCards={p.id === HUMAN || (reachedShowdown && !p.folded)}
                  toAct={toAct?.id === p.id}
                  lastAction={state.handOver ? undefined : lastActionOf(p.id)}
                  win={state.winners.find((w) => w.playerId === p.id)}
                  handDescription={
                    reachedShowdown && !p.folded && p.hole.length ? rankHand(p, state.community).description : undefined
                  }
                />
              </div>
            ))}

            {state.players.map(
              (p, i) =>
                p.bet > 0 &&
                !state.handOver && (
                  <div key={p.id} className="bet" style={place(i, humanIndex, n, 25, 23)}>
                    <span className="chip" /> {p.bet}
                  </div>
                ),
            )}
            <div className="dealer-button" style={place(state.dealer, humanIndex, n, 30, 30, -0.45)} title="Dealer">
              D
            </div>
          </div>
        </section>

        <aside ref={logPanel} className="log" aria-label="Hand history">
          <h2>Hand {state.handNumber}</h2>
          <ol>
            {state.log.map((entry, i) => {
              const newStreet = i === 0 || state.log[i - 1].street !== entry.street;
              return (
                <li key={i} className={entry.playerId === HUMAN ? 'mine' : undefined}>
                  {newStreet && <div className="street">{entry.street}</div>}
                  {describe(state, entry)}
                </li>
              );
            })}
            {state.handOver &&
              state.winners.map((w) => (
                <li key={w.playerId} className="result">
                  {nameOf(state, w.playerId)} wins {w.amount}
                  {w.handName && ` with ${w.handName}`}
                </li>
              ))}
          </ol>
        </aside>
      </main>

      <footer className="controls">
        {gameOver ? (
          <div className="banner">
            <span>{human.chips > 0 ? 'You won the game! 🏆' : 'You’re out of chips.'}</span>
            <button className="btn primary" onClick={restart}>
              New game <kbd>Enter</kbd>
            </button>
          </div>
        ) : state.handOver ? (
          <div className="banner">
            <span>
              {state.winners.map((w) => `${nameOf(state, w.playerId)} wins ${w.amount}`).join(' · ')}
            </span>
            <button className="btn primary" onClick={nextHand}>
              Next hand <kbd>Enter</kbd>
            </button>
          </div>
        ) : humansTurn ? (
          <ActionBar key={`${state.handNumber}-${state.log.length}`} state={state} onAction={onAction} />
        ) : (
          <div className="waiting">
            {human.folded ? 'You folded. ' : human.allIn ? 'You’re all-in. ' : ''}
            {toAct && `${toAct.name} is thinking…`}
          </div>
        )}
      </footer>
    </div>
  );
}
