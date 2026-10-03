import type { GameState, LogEntry } from '../engine/types';

export const nameOf = (s: GameState, id: string) => s.players.find((p) => p.id === id)?.name ?? id;

/** "bets 40" when nobody had bet yet this street, "raises to 40" otherwise. */
function raiseVerb(s: GameState, entry: LogEntry): string {
  const i = s.log.indexOf(entry);
  const earlier = s.log.slice(0, i).filter((e) => e.street === entry.street);
  const opened = entry.street === 'preflop' || earlier.some((e) => e.action.type === 'raise');
  return opened ? 'raises to' : 'bets';
}

/** Full sentence for the log panel: "Peanut raises to 40". */
export function describe(s: GameState, entry: LogEntry): string {
  const who = nameOf(s, entry.playerId);
  const a = entry.action;
  const verb = a.type === 'raise' ? raiseVerb(s, entry) : `${a.type}s`;
  // "You raise", "Peanut raises"
  const conjugated = who === 'You' ? verb.replace(/^(\w+?)s\b/, '$1') : verb;
  return a.type === 'raise' ? `${who} ${conjugated} ${a.to}` : `${who} ${conjugated}`;
}

/** Short label for the bubble on a seat: "Raise 40". */
export function shortLabel(s: GameState, entry: LogEntry): string {
  const a = entry.action;
  if (a.type === 'raise') return `${raiseVerb(s, entry) === 'bets' ? 'Bet' : 'Raise'} ${a.to}`;
  return a.type[0].toUpperCase() + a.type.slice(1);
}
