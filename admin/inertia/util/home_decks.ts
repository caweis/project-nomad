/**
 * Home scenario-deck taxonomy + grouping.
 *
 * The Command Center home groups its pinned apps into ordered "scenario decks"
 * instead of one flat grid. This module is the single source of truth for:
 *   - the ordered deck list (DECKS),
 *   - which app maps to which deck (DECK_BY_KEY + deckForKey),
 *   - the pinned rule (isPinned — display_order <= 8, the "first on login" band),
 *   - the pure grouping (groupIntoDecks).
 *
 * Pure + dependency-free on purpose: it imports no React and no .tsx so the
 * standalone gate (tests/standalone/home_decks.standalone.ts) can strip-run it
 * under `node --experimental-strip-types` without a bundler. The `icon` field is
 * a Tabler icon name string consumed by <DynamicIcon> on the page; each value
 * below is verified to exist in @tabler/icons-react.
 */

export type DeckKey =
  | 'secure-ai'
  | 'communicate'
  | 'knowledge-maps'
  | 'health-supplies'
  | 'tools-workshop'

export interface Deck {
  key: DeckKey
  label: string
  /** A Tabler icon name (a valid DynamicIconName), rendered via <DynamicIcon>. */
  icon: string
}

/**
 * Decks in display order. Secure & AI first (Chris, 2026-06-24); the rest follow
 * the approved mock order. Icons verified present in @tabler/icons-react.
 */
export const DECKS: readonly Deck[] = [
  { key: 'secure-ai', label: 'Secure & AI', icon: 'IconShieldLock' },
  { key: 'communicate', label: 'Communicate', icon: 'IconAntenna' },
  { key: 'knowledge-maps', label: 'Knowledge & maps', icon: 'IconBook2' },
  { key: 'health-supplies', label: 'Health & supplies', icon: 'IconHeart' },
  { key: 'tools-workshop', label: 'Tools & workshop', icon: 'IconTool' },
]

/**
 * App key -> deck. Keys are the real service_name values (read from
 * admin/constants/service_names.ts + the seeder) for installed services, plus
 * the hardcoded fork feature keys (ai-assistant, maps, workshop, drug-reference,
 * preparedness). Anything not listed falls back to 'tools-workshop' via deckForKey.
 */
export const DECK_BY_KEY: Record<string, DeckKey> = {
  // Secure & AI
  nomad_vaultwarden: 'secure-ai', // Password Vault
  'ai-assistant': 'secure-ai', // AI Assistant (Ollama) — hardcoded feature tile

  // Communicate
  nomad_meshtastic_web: 'communicate', // Meshtastic Web
  nomad_meshcore_web: 'communicate', // MeshCore Web
  nomad_mesh: 'communicate', // Mesh Bridge

  // Knowledge & maps
  nomad_kiwix_server: 'knowledge-maps', // Information Library (Kiwix)
  nomad_kolibri: 'knowledge-maps', // Education Platform
  maps: 'knowledge-maps', // Maps — hardcoded feature tile

  // Health & supplies
  'drug-reference': 'health-supplies', // Drug Reference — hardcoded feature tile
  preparedness: 'health-supplies', // Preparedness — hardcoded feature tile
  nomad_grocy: 'health-supplies', // Grocy

  // Tools & workshop
  workshop: 'tools-workshop', // Workshop — hardcoded feature tile
  nomad_stirling_pdf: 'tools-workshop', // PDF Tools
  nomad_it_tools: 'tools-workshop', // IT Tools
  nomad_cyberchef: 'tools-workshop', // Data Tools
  nomad_excalidraw: 'tools-workshop', // Whiteboard
  nomad_flatnotes: 'tools-workshop', // Notes
  nomad_calibre_web: 'tools-workshop', // eBook Library
}

/** Resolve an app key to its deck, defaulting unknown keys to 'tools-workshop'. */
export function deckForKey(key: string): DeckKey {
  return DECK_BY_KEY[key] ?? 'tools-workshop'
}

/** Minimal shape both the test stub and the real DashboardItem satisfy. */
export interface DeckGroupable {
  deckKey: string
  displayOrder: number
}

/**
 * Per-app pin overrides: a map of deckKey -> explicit pinned state. An entry
 * wins over the display_order rule (true force-pins, false force-unpins); a
 * deckKey with no entry falls back to the rule. Persisted as the `home.pins`
 * KV value (issue #44).
 */
export type PinOverrides = Record<string, boolean>

/**
 * "Pinned" = in the core band the user sees first on login. The default rule is
 * display_order <= 8 (the utilities at 9–12 start unpinned, behind "Browse all
 * apps"). A user override for this item's deckKey takes precedence: an explicit
 * `false` unpins a default-pinned app and an explicit `true` pins one past the
 * band. Backward compatible — with no overrides (or no entry for this item) the
 * old display_order rule applies unchanged.
 */
export function isPinned(item: DeckGroupable, overrides?: PinOverrides): boolean {
  return overrides?.[item.deckKey] ?? item.displayOrder <= 8
}

export interface GroupedDeck<T extends DeckGroupable> {
  deck: Deck
  items: T[]
}

/**
 * Group pinned items into decks, in DECKS order, omitting decks with no pinned
 * items. Non-pinned items are dropped (they live behind "Browse all apps").
 * `overrides` (the user's `home.pins`) is threaded to isPinned; absent, the
 * legacy display_order <= 8 rule applies.
 */
export function groupIntoDecks<T extends DeckGroupable>(
  items: T[],
  overrides?: PinOverrides
): GroupedDeck<T>[] {
  const buckets = new Map<DeckKey, T[]>()
  for (const item of items) {
    if (!isPinned(item, overrides)) continue
    const key = deckForKey(item.deckKey)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }

  const result: GroupedDeck<T>[] = []
  for (const deck of DECKS) {
    const deckItems = buckets.get(deck.key)
    if (deckItems && deckItems.length > 0) {
      result.push({ deck, items: deckItems })
    }
  }
  return result
}
