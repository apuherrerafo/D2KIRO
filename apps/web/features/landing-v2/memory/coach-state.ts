import type { CoachState } from './types';

/** The Coach reads with its eyes, never with a beam; this only gates the soft attention field. `uncertain` NEVER points. */
export function beamAllowed(state: CoachState): boolean {
  return state === 'analyzing' || state === 'pointing' || state === 'confirming';
}
