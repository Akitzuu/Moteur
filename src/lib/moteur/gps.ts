/** Vitesse et accélération tirées du GPS du navigateur.
 *
 *  Le GPS ne donne qu'environ une mesure par seconde, et le son doit bouger en continu. On garde donc les mesures
 *  des deux dernières secondes, on en tire la pente (l'accélération, par moindres carrés pour qu'une mesure bruitée
 *  ne fasse pas sauter le régime), et entre deux mesures on prolonge cette pente, au plus `EXTRAPOLATE_MAX_S`.
 *
 *  Les temps viennent du moment où la mesure ARRIVE (horloge monotone de la page), pas de `timestamp` : un
 *  navigateur peut renvoyer une mesure en cache avec un horodatage répété ou décalé. */

export type Fix = { speed: number | null; lat: number; lon: number; accuracy: number; stamp: number }
export type GpsState = 'off' | 'waiting' | 'ok' | 'stale' | 'denied' | 'error'
export type Reading = { speed: number; accel: number; fresh: boolean }

const WINDOW_MIN_MS = 800
const WINDOW_MAX_MS = 2000
const FIXES_PER_WINDOW = 6
const EXTRAPOLATE_MAX_S = 1.2
const STALE_MS = 5000
/** En dessous, c'est l'arrêt : le GPS d'un téléphone immobile dérive de quelques dizaines de cm/s. */
export const STANDSTILL_MPS = 0.5
/** Deux mesures plus rapprochées que ça n'en font qu'une (rafale) : une pente sur 20 ms ne veut rien dire. */
const MERGE_MS = 60
const MAX_POSITION_SPEED = 90
const DOPPLER_HOLD_MS = 3000
/** Sans vitesse fournie, rester ce temps dans l'incertitude de position, c'est être à l'arrêt. */
const STILL_AFTER_S = 3

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180, R = 6371000
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export class GpsSpeed {
  state: GpsState = 'off'
  accuracy: number | null = null
  private samples: { t: number; first: number; v: number }[] = []
  private last: { lat: number; lon: number; t: number; stamp: number; accuracy: number } | null = null
  private lastRaw: Fix | null = null
  private interval = 0
  private lastArrival = 0
  private fixV = 0
  private fixA = 0
  private fixAt = 0
  /** Dernière mesure qui portait une vitesse : une mesure isolée sans vitesse au milieu d'elles est ignorée. */
  private dopplerAt = -Infinity

  reset() { this.samples = []; this.last = null; this.lastRaw = null; this.interval = 0; this.lastArrival = 0; this.fixV = 0; this.fixA = 0; this.fixAt = 0; this.accuracy = null; this.dopplerAt = -Infinity }

  /** Une mesure du GPS, arrivée à `now` (ms, horloge monotone). */
  push(fix: Fix, now: number) {
    const prev = this.lastRaw
    this.lastRaw = fix
    // En mouvement, chaque vraie mesure a une position nouvelle : même vitesse au même endroit, c'est une mesure
    // en cache renvoyée telle quelle. La compter ferait croire à un palier.
    if (prev && fix.speed !== null && fix.speed > 0 && fix.speed === prev.speed && fix.lat === prev.lat && fix.lon === prev.lon) return
    if (this.lastArrival) { const gap = now - this.lastArrival; this.interval = this.interval ? this.interval + (gap - this.interval) * 0.2 : gap }
    this.lastArrival = now
    const window = Math.min(WINDOW_MAX_MS, Math.max(WINDOW_MIN_MS, FIXES_PER_WINDOW * (this.interval || 1000)))

    let v: number | null = null
    if (fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= 0) { v = fix.speed; this.dopplerAt = now }
    else if (now - this.dopplerAt < DOPPLER_HOLD_MS) {
      // Une mesure sans vitesse au milieu de mesures qui en ont : on garde la vitesse en cours plutôt que d'en tirer
      // une des positions (pics à 122 km/h, ou chute à l'arrêt, selon le bruit de position).
      this.last = { lat: fix.lat, lon: fix.lon, t: now, stamp: fix.stamp, accuracy: fix.accuracy }
      this.accuracy = fix.accuracy
      return
    } else if (this.last) {
      const ds = fix.stamp - this.last.stamp
      const dt = (ds > 0 ? ds : now - this.last.t) / 1000
      if (dt >= 0.4) {
        const d = haversine(this.last.lat, this.last.lon, fix.lat, fix.lon)
        if (d >= Math.max(fix.accuracy, this.last.accuracy)) {
          v = d / dt
          // Plus de 90 m/s (324 km/h) entre deux positions : une position d'antenne remplacée par le GPS, pas un
          // déplacement. On repart de la nouvelle position sans en tirer de vitesse.
          if (v > MAX_POSITION_SPEED) { this.last = { lat: fix.lat, lon: fix.lon, t: now, stamp: fix.stamp, accuracy: fix.accuracy }; this.accuracy = fix.accuracy; return }
        } else if (dt < STILL_AFTER_S) {
          // Déplacement encore dans l'incertitude des deux positions : rien à conclure. La vitesse en cours est
          // gardée, et la position de référence aussi, pour qu'une conduite lente finisse par la dépasser. Le jeter
          // faisait rouler un téléphone posé (Wi-Fi ±30 m qui tremble : 22 km/h), le compter à zéro faisait alterner
          // une vraie conduite lente entre l'arrêt et sa vitesse (chasses du 09/11).
          this.accuracy = fix.accuracy
          return
        } else v = 0
      }
    }
    if (!this.last || now - this.last.t >= 400) this.last = { lat: fix.lat, lon: fix.lon, t: now, stamp: fix.stamp, accuracy: fix.accuracy }
    this.accuracy = fix.accuracy
    if (v === null) {
      // Pas de vitesse et une seule position : à l'arrêt jusqu'à la suivante (qui peut ne jamais venir, garé).
      if (this.samples.length) return
      v = 0
    }
    if (v < STANDSTILL_MPS) v = 0
    v = Math.min(v, 120)

    const last = this.samples[this.samples.length - 1]
    if (last && now - last.first < MERGE_MS) { last.v = v; last.t = now }
    else this.samples.push({ t: now, first: now, v })
    while (this.samples.length > 2 && now - this.samples[0].t > window) this.samples.shift()

    this.fixA = this.slope(window)
    this.fixV = v
    this.fixAt = now
    this.state = 'ok'
  }

  /** Pente vitesse/temps sur la fenêtre, en m/s². Zéro tant que la fenêtre est trop courte pour en dire quelque chose. */
  private slope(window: number): number {
    const s = this.samples, n = s.length
    if (n < 2 || s[n - 1].t - s[0].t < window * 0.4) return 0
    const t0 = s[0].t
    let mt = 0, mv = 0
    for (const p of s) { mt += (p.t - t0) / 1000; mv += p.v }
    mt /= n; mv /= n
    let num = 0, den = 0
    for (const p of s) { const dt = (p.t - t0) / 1000 - mt; num += dt * (p.v - mv); den += dt * dt }
    if (den < 1e-6) return 0
    return Math.max(-10, Math.min(8, num / den))
  }

  /** Écart moyen entre deux mesures (ms), 0 tant qu'il n'est pas connu : 1 000 sur un téléphone, une centaine dans
   *  le navigateur d'une Tesla. La boîte en tire combien de temps confirmer une décélération. */
  get fixInterval(): number { return this.interval }

  /** Meilleure estimation à `now` : la dernière vitesse prolongée par la pente, tenue telle quelle si le GPS se tait. */
  read(now: number): Reading {
    if (this.state !== 'ok' && this.state !== 'stale') return { speed: 0, accel: 0, fresh: false }
    const age = (now - this.fixAt) / 1000
    if (age * 1000 > STALE_MS) { this.state = 'stale'; return { speed: this.fixV, accel: 0, fresh: false } }
    let v = this.fixV + this.fixA * Math.min(age, EXTRAPOLATE_MAX_S)
    if (this.fixV === 0 && this.fixA <= 0) v = 0
    return { speed: Math.max(0, v), accel: this.fixA, fresh: true }
  }
}
