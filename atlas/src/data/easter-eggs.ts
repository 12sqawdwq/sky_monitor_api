import type { Observer } from '../core/coords';

/**
 * Hidden search entries. They live in `easter-eggs.local.json` next to this file, which is
 * git-ignored so personal details never reach the public repository; without it there are none.
 * See `easter-eggs.example.json` for the format.
 */
export interface EasterEgg {
  /** Unique id, also matched by the search box. */
  id: string;
  /** Names the search matches (and shows as the result title). */
  zh: string;
  en?: string;
  /** Extra text the search also matches, shown as the result's subtitle. */
  des?: string;
  /** Observer location to switch to when the entry is chosen. */
  observer?: Pick<Observer, 'lat' | 'lon' | 'label'>;
  /** Catalogue object to fly to, e.g. "earth". */
  target: string;
  /** Title and description shown in the archive card instead of the target's own. */
  title: { zh: string; en: string };
  desc?: { zh: string; en: string };
}

const files = import.meta.glob<{ default: EasterEgg[] }>('./easter-eggs.local.json', { eager: true });

export const EASTER_EGGS: EasterEgg[] = Object.values(files).flatMap(module => module.default ?? []);
