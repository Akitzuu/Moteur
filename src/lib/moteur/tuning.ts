/** Les réglages de la page Moteur, communs à toutes les voitures : chacun corrige le comportement propre de la
 *  voiture (1 ou sa valeur par défaut = la voiture telle qu'elle est décrite). Gardés sur l'appareil. */

export type Tuning = {
  /** Régime sous lequel la boîte rétrograde pied levé, en part de la zone rouge (en freinant fort : +14 points). En
   *  Chill et Sport, plafonné sous le régime où retombe une montée de rapport (sinon elle redescend aussitôt). */
  downshiftAt: number
  /** Force du coup de gaz à chaque rétrogradage (0 = aucun). */
  blip: number
  /** Durée de la coupure d'une montée de rapport, multipliée (0,5 = deux fois plus sec). */
  shiftCut: number
  /** Crépitements et détonations à la décélération, multipliés. */
  crackle: number
  /** Ouverture du silencieux, multipliée : plus clair au-dessus de 1, plus sourd en dessous. */
  brightness: number
  /** Sensibilité de la pédale déduite du GPS : plus haut, le moteur charge davantage pour la même accélération. */
  pedal: number
}

type Spec = { key: keyof Tuning; label: string; min: number; max: number; step: number; def: number; format: (v: number) => string }

const pct = (v: number) => `${Math.round(v * 100)} %`
const times = (v: number) => `× ${v.toFixed(2).replace('.', ',')}`

export const TUNING_SPECS: Spec[] = [
  { key: 'downshiftAt', label: 'Rétrograder sous', min: 0.2, max: 0.6, step: 0.02, def: 0.36, format: v => `${pct(v)} de la zone rouge` },
  { key: 'blip', label: 'Coup de gaz au rétrogradage', min: 0, max: 1, step: 0.05, def: 0.6, format: pct },
  { key: 'shiftCut', label: 'Durée des passages', min: 0.4, max: 2, step: 0.1, def: 1, format: times },
  { key: 'crackle', label: 'Crépitements', min: 0, max: 1.5, step: 0.05, def: 1, format: pct },
  { key: 'brightness', label: 'Silencieux', min: 0.6, max: 1.6, step: 0.05, def: 1, format: v => (v === 1 ? 'd’origine' : v > 1 ? `plus ouvert, ${times(v)}` : `plus fermé, ${times(v)}`) },
  { key: 'pedal', label: 'Sensibilité de la pédale (GPS)', min: 1, max: 4, step: 0.1, def: 2.2, format: times },
]

export const DEFAULT_TUNING: Tuning = Object.fromEntries(TUNING_SPECS.map(s => [s.key, s.def])) as Tuning

/** Réglages lus d'un JSON quelconque : chaque valeur absente, illisible ou hors bornes reprend son défaut. */
export function parseTuning(raw: string | null): Tuning {
  let obj: Record<string, unknown> = {}
  try { const v = raw ? JSON.parse(raw) : null; if (v && typeof v === 'object' && !Array.isArray(v)) obj = v } catch { /* défauts */ }
  const out = { ...DEFAULT_TUNING }
  for (const s of TUNING_SPECS) {
    const v = obj[s.key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= s.min && v <= s.max) out[s.key] = v
  }
  return out
}
