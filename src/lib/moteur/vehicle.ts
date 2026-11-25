import type { Car } from './cars'
import { DEFAULT_TUNING, type Tuning } from './tuning'

/** La voiture virtuelle : de la vitesse (GPS) ou des pédales (mode essai) au régime, au rapport engagé et à la
 *  charge du moteur que la synthèse fait entendre.
 *
 *  Le GPS ne dit rien de la pédale. On la déduit de la physique : l'accélération mesurée, plus ce que l'air et les
 *  pneus retiennent à cette vitesse, rapportée à ce que le moteur peut donner. Accélérer fort en côte ou sur
 *  autoroute charge donc le moteur davantage qu'à basse vitesse, comme dans une vraie voiture. */

const G = 9.81
const RHO = 1.2
const EFFICIENCY = 0.88
/** Démarrage : le démarreur entraîne le moteur, puis il prend et monte au-dessus du ralenti avant de s'y poser. */
const CRANK_S = 0.7
const CATCH_S = 1.1
const SETTLE_S = 2.2
/** Montée de rapport : l'injection coupe le temps propre à la boîte de la voiture (`shiftCutMs`, multiplié par le
 *  réglage « Durée des passages »), le régime tombe sur
 *  le rapport suivant, puis le couple revient d'un coup, en 50 ms : c'est ce qui donne le « coup de pied » d'un
 *  passage sportif. */
const SHIFT_RAMP_S = 0.05
/** Rétrogradage : coup de gaz qui amène le régime sur celui du rapport inférieur avant de l'engager. */
const DOWNSHIFT_S = 0.24
const DOWNSHIFT_ENGAGE = 0.6
const SHIFT_PAUSE_S = 0.6
/** Au freinage, la boîte rétrograde plus tôt (et plus vite) pour garder le moteur dans les tours, comme une boîte
 *  en mode sport : sous le réglage « Rétrograder sous » pied levé, 14 points plus haut en freinant fort. */
const DECEL_PAUSE_S = 0.35
const DECEL_HARD_EXTRA = 0.14
/** Une décélération doit durer avant de faire rétrograder (bien plus longtemps en GPS, où elle est déduite de
 *  mesures bruitées), et en GPS la boîte ne remonte pas juste après un rétrogradage : sinon le bruit la fait monter
 *  et redescendre en boucle à vitesse constante (chasses du 09/11). */
const DECEL_CONFIRM_S = 0.3
const DECEL_CONFIRM_GPS_S = 1.5
const UPSHIFT_AFTER_DOWN_GPS_S = 2
/** Ces deux attentes valent pour une mesure par seconde (téléphone). Elles suivent l'écart entre mesures : à dix par
 *  seconde (navigateur de la Tesla), la pente est aussi sûre en bien moins de temps, et attendre 1,5 s rendait la
 *  boîte paresseuse au lâcher de pied (essai du 12/11 contre teslasound). Pas de plancher : mesuré le 13/11, une
 *  croisière bruitée à 10 mesures par seconde reste stable sans, et `SHIFT_PAUSE_S` (0,6 s) sépare déjà deux passages. */
/** Bande sous le rupteur où l'injection se coupe : la voiture plafonne au lieu de garder les tours collés. */
const LIMIT_BAND_RPM = 60
const LIMITER_HZ = 14
/** Une décélération qui dure s'apaise : l'échappement refroidit, les crépitements s'espacent. */
const OVERRUN_FADE_S = 2.5

/** Programme de la boîte auto. Race est la boîte d'origine : elle tient les rapports d'autant plus haut qu'on
 *  accélère. Chill et Sport passent chaque rapport au régime qui amène la voiture sur son dernier rapport vers 130 et
 *  160 km/h en conduite normale : avec les vrais rapports, c'est le point de passage qui décide, pas l'étagement
 *  (une Tesla accélère fort même tranquillement, et la pédale déduite tenait les rapports jusqu'à 5 800 tr/min). */
export type GearMode = 'chill' | 'sport' | 'race'
export const GEAR_MODES: { id: GearMode; letter: string; label: string; topKmh: number | null }[] = [
  { id: 'chill', letter: 'C', label: 'Chill', topKmh: 130 },
  { id: 'sport', letter: 'S', label: 'Sport', topKmh: 160 },
  { id: 'race', letter: 'R', label: 'Race', topKmh: null },
]
/** Pédale d'une conduite normale déduite du GPS (1 à 2 m/s²) : c'est à elle que le dernier rapport tombe à la vitesse
 *  du programme. `spread` : de combien le régime de passage monte avec la pédale. `kick` : pédale du plancher. Au-delà,
 *  la boîte passe sur le programme Race tant que le pied y reste (kickdown, puis montées près de la zone rouge), comme
 *  le kickdown d'une vraie boîte en mode confort. Avec son seul régime de montée, bas, Chill ne rétrogradait jamais
 *  au plancher à la moitié des vitesses (banc du 13/11 : Ferrari à 40, 50, 70, 90 et 110 km/h). */
const NORMAL_THROTTLE = 0.5
const GENTLE = {
  chill: { spread: 1.3, kick: 0.95 },
  sport: { spread: 1.6, kick: 0.85 },
}
/** La pédale doit repasser 15 points sous le plancher pour rendre la main au programme : sans cet écart, une pédale qui
 *  hésite au seuil basculerait d'un programme à l'autre. */
const FLOOR_RELEASE = 0.15
/** Boîte manuelle : elle refuse de monter sous 1,1 fois le ralenti (le moteur cognerait), et redescend seule sous le
 *  ralenti pour ne pas caler. Elle refuse de descendre si le régime passerait la zone rouge. */
const MANUAL_LUG = 1.1

export type Schedule = { upLo: number; upHi: number; kick: number; kickBelow: number; kickTo: number; gentle: boolean }

/** Décélération (m/s²) que donne déjà la régénération d'une Tesla pied levé : la jauge de frein part de là. */
export const REGEN_DECEL = 1.5
/** Décélération d'un freinage appuyé (m/s²) : la jauge de frein est pleine. */
export const FULL_BRAKE_DECEL = 7
/** Le freinage lu dans une décélération mesurée (m/s², positive quand la voiture ralentit). */
export const brakeFromDecel = (decel: number) => clamp((decel - REGEN_DECEL) / (FULL_BRAKE_DECEL - REGEN_DECEL), 0, 1)

/** `fixMs` : écart moyen entre deux mesures GPS (absent ou 0 : une par seconde, le cas d'un téléphone). */
export type Drive = { mode: 'gps'; speed: number; accel: number; fixMs?: number } | { mode: 'essai'; gas: number; brake: number }
/** `overrun` : intensité de la décélération, 1 au lâcher de pédale, qui s'éteint en quelques secondes et avec le
 *  régime. La synthèse en tire les crépitements de l'échappement. */
/** `pedal` : la pédale que joue le son (déduite du GPS, ou celle de l'essai) ; `brake` : le freinage, de 0 à 1. Sans
 *  capteur de la voiture, au GPS le frein se lit dans la décélération, au-delà de ce que donne la régénération. */
export type EngineState = { rpm: number; load: number; overrun: number; gear: number; speedKmh: number; shifting: boolean; running: boolean; limiter: boolean; pedal: number; brake: number }

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Part du chemin vers la cible parcourue en `dt`, pour une constante de temps `tau` : indépendant de la cadence. */
const follow = (dt: number, tau: number) => 1 - Math.exp(-dt / tau)

export class Vehicle {
  car: Car
  tuning: Tuning = DEFAULT_TUNING
  rpm = 0
  gear = 1
  speed = 0
  accel = 0
  throttle = 0
  /** Freinage affiché, de 0 à 1 (jauge du tableau de bord) : il ne change rien au son. */
  brake = 0
  /** Pédale demandée, avant le lissage de `throttle` : un lâcher se voit tout de suite. */
  private pedal = 0
  running = false
  private age = 0
  private time = 0
  private sinceShift = 10
  private shift: { to: number; t: number; up: boolean } | null = null
  private limiterT = 0
  private overrun = 0
  /** Depuis combien de temps la voiture décélère pied levé : un seul point GPS bruité ne doit pas faire rétrograder. */
  private decelFor = 0
  private lastUp = false
  private noisy = false
  /** Écart entre deux mesures GPS, en secondes (1 sur un téléphone). */
  private fixS = 1
  /** Embrayage encore ouvert depuis le démarrage : il se ferme sur le rapport qui va avec la vitesse. */
  private engage = false
  gearMode: GearMode = 'race'
  /** Boîte passée en manuel par les palettes : elle y reste jusqu'au choix d'un programme. */
  manual = false
  /** Pied au plancher en Chill ou Sport : la boîte suit le programme Race jusqu'au relâchement. */
  private floored = false
  /** Secondes depuis la dernière vraie charge (pédale au-dessus de 30 %) : voir `lifting`. */
  private sinceLoad = 10

  constructor(car: Car) { this.car = car }

  setTuning(t: Tuning) { this.tuning = t }
  /** Choisir un programme rend la main à la boîte auto. */
  setGearMode(m: GearMode) { this.gearMode = m; this.manual = false }

  /** Palette + ou − : passe la boîte en manuel, puis engage le rapport si elle l'accepte. Renvoie faux sur un refus
   *  (moteur coupé ou pas encore embrayé, rapport inexistant, régime trop bas pour monter, zone rouge pour descendre).
   *  Une pression pendant un passage part du rapport visé : deux pressions rapides passent deux rapports. */
  shiftBy(d: 1 | -1): boolean {
    this.manual = true
    if (!this.running || this.engage) return false
    const e = this.car.engine, to = (this.shift?.to ?? this.gear) + d
    if (to < 1 || to > this.car.vehicle.ratios.length) return false
    if (d > 0 && this.gearRpm(to) < e.idleRpm * MANUAL_LUG) return false
    if (d < 0 && this.gearRpm(to) > e.redlineRpm) return false
    this.shift = { to, t: 0, up: d > 0 }
    this.lastUp = d > 0
    return true
  }

  setCar(car: Car) { this.car = car; this.gear = Math.min(this.gear, car.vehicle.ratios.length); this.shift = null }
  /** Un démarrage repart de zéro : sans ça, le son reprenait au régime d'avant la coupure, et en mode essai la
   *  voiture repartait à sa vitesse d'avant. */
  start() {
    this.running = true; this.age = 0
    this.rpm = 0; this.gear = 1; this.speed = 0; this.accel = 0; this.throttle = 0; this.pedal = 0; this.brake = 0
    this.shift = null; this.sinceShift = 10; this.limiterT = 0; this.overrun = 0; this.decelFor = 0; this.engage = true
    this.floored = false; this.sinceLoad = 10
  }
  stop() { this.running = false; this.shift = null }

  /** Régime qu'imposeraient les roues dans le rapport `g` à la vitesse `v` (m/s). */
  gearRpm(g: number, v = this.speed): number {
    const p = this.car.vehicle
    return v / p.tireCircumferenceM * 60 * p.ratios[g - 1] * p.finalDrive
  }

  /** Couple à ce régime : une cloche autour du couple maximal, jamais sous 45 % de lui dans la plage utile. */
  torqueAt(rpm: number): number {
    const e = this.car.engine
    const x = (rpm - e.peakTorqueRpm) / e.redlineRpm
    return e.peakTorqueNm * Math.max(0.45, 1 - 1.6 * x * x)
  }

  /** La pédale déduite d'une vitesse (m/s) et d'une accélération (m/s²) mesurées. */
  estimateThrottle(v: number, a: number): number {
    const p = this.car.vehicle
    if (a < -0.25) return 0
    const resist = 0.5 * RHO * p.cdA * v * v / p.massKg + p.crr * G
    const aMax = Math.min(p.maxAccel, p.peakPowerKw * 1000 * EFFICIENCY / (p.massKg * Math.max(v, 4)))
    // Une conduite normale n'utilise qu'une fraction de l'accélération possible : le réglage « Sensibilité » l'amplifie.
    return clamp((a + resist) / aMax * this.tuning.pedal, 0, 1)
  }

  update(dt: number, drive: Drive): EngineState {
    dt = clamp(dt, 0, 0.1)
    this.time += dt
    this.age += dt
    this.sinceShift += dt
    const e = this.car.engine
    let target: number
    if (drive.mode === 'gps') {
      // La lecture du GPS est déjà prolongée entre deux mesures : on ne la relisse presque pas. Les 0,25 s et 0,35 s
      // d'avant retardaient la pédale de 0,3 s de plus que teslasound (essai du 12/11). Il reste 80 ms sur la vitesse,
      // pour qu'une mesure qui corrige la prolongation ne fasse pas sauter le régime d'un coup.
      this.speed += (Math.max(0, drive.speed) - this.speed) * follow(dt, 0.08)
      this.accel = drive.accel
      this.fixS = drive.fixMs ? clamp(drive.fixMs / 1000, 0.05, 1) : 1
      target = this.running ? this.estimateThrottle(this.speed, this.accel) : 0
      this.pedal = target
      // Une pédale qui s'enfonce répond plus vite qu'une pédale qui se relève : c'est l'appui qu'on attend à l'oreille.
      this.throttle += (target - this.throttle) * follow(dt, target > this.throttle ? 0.12 : 0.25)
    } else {
      target = this.running ? clamp(drive.gas, 0, 1) : 0
      this.pedal = target
      this.throttle += (target - this.throttle) * follow(dt, 0.05)
      this.physics(dt, clamp(drive.brake, 0, 1))
    }
    const brake = !this.running ? 0 : drive.mode === 'gps' ? brakeFromDecel(-this.accel) : clamp(drive.brake, 0, 1)
    this.brake += (brake - this.brake) * follow(dt, brake > this.brake ? 0.08 : 0.2)
    this.decelFor = this.pedal < 0.05 && this.accel < -0.3 ? this.decelFor + dt : 0
    this.sinceLoad = this.pedal > 0.3 ? 0 : this.sinceLoad + dt
    this.noisy = drive.mode === 'gps'
    if (this.running && this.engage && this.age >= CATCH_S) { this.engage = false; this.gear = this.bestGear() }
    if (this.running) { if (this.manual) this.stallGuard(); else this.autoShift() }

    let cut = 1, blip = 0, blipTo = 0
    const sh = this.shift
    if (sh) {
      sh.t += dt
      if (sh.up) {
        const cutS = this.car.vehicle.shiftCutMs * this.tuning.shiftCut / 1000
        if (sh.t >= cutS && this.gear !== sh.to) this.gear = sh.to
        cut = sh.t < cutS ? 0 : clamp((sh.t - cutS) / SHIFT_RAMP_S, 0, 1)
        if (sh.t >= cutS + SHIFT_RAMP_S) { this.shift = null; this.sinceShift = 0 }
      } else {
        if (sh.t >= DOWNSHIFT_S * DOWNSHIFT_ENGAGE && this.gear !== sh.to) this.gear = sh.to
        blip = this.tuning.blip * Math.sin(Math.PI * Math.min(1, sh.t / DOWNSHIFT_S))
        blipTo = this.gearRpm(sh.to) * 1.04
        if (sh.t >= DOWNSHIFT_S) { this.shift = null; this.sinceShift = 0 }
      }
    }

    // Régime visé : celui des roues, ou embrayage qui patine sous le ralenti (départ arrêté, pédale = montée en régime).
    // Embrayage encore ouvert (démarreur) : les roues n'entraînent pas le moteur, quelle que soit la vitesse.
    const wheel = this.engage ? 0 : this.gearRpm(this.gear)
    let rpmTarget = wheel < e.idleRpm * 1.2 ? Math.max(wheel, e.idleRpm + this.throttle * (0.45 * e.redlineRpm - e.idleRpm)) : wheel
    // Rétrogradage : le coup de gaz amène le régime sur celui du rapport inférieur, un peu au-dessus.
    if (blipTo) rpmTarget = Math.max(rpmTarget, blipTo)
    rpmTarget = Math.max(rpmTarget, e.idleRpm + Math.sin(this.time * 2.3) * 9)

    let limiter = false
    if (rpmTarget >= e.limiterRpm) {
      rpmTarget = e.limiterRpm
      limiter = true
      this.limiterT += dt
      if (Math.floor(this.limiterT * LIMITER_HZ) % 2 === 0) cut = 0
    } else this.limiterT = 0

    if (!this.running) this.rpm = Math.max(0, this.rpm - Math.max(this.rpm * 2.5, 300) * dt)
    else if (this.age < CRANK_S) this.rpm += (e.idleRpm * 0.3 * (1 + 0.25 * Math.sin(this.age * 40)) - this.rpm) * follow(dt, 0.08)
    else if (this.age < CATCH_S) this.rpm += (e.idleRpm * 1.7 - this.rpm) * follow(dt, 0.09)
    else if (this.age < SETTLE_S) this.rpm += (Math.max(rpmTarget, e.idleRpm) - this.rpm) * follow(dt, 0.35)
    else this.rpm += (rpmTarget - this.rpm) * follow(dt, this.shift ? 0.04 : 0.08)

    const starting = this.running && this.age < CATCH_S
    const load = !this.running ? 0 : starting ? (this.age < CRANK_S ? 0.25 : 0.7) : Math.max(this.throttle * cut, blip)
    // Décélération : pied levé moteur entraîné par les roues, ou injection coupée (passage de rapport, rupteur).
    const lifted = this.running && !starting && this.throttle < 0.05 && this.rpm > e.idleRpm * 1.4
    if (cut === 0 && this.running && !starting) this.overrun = Math.max(this.overrun, 0.8)
    else if (!lifted) this.overrun = 0
    else if (this.overrun === 0) this.overrun = 1
    else this.overrun *= Math.exp(-dt / OVERRUN_FADE_S)
    const revs = clamp((this.rpm - e.idleRpm * 1.4) / (0.3 * e.redlineRpm), 0, 1)
    return {
      rpm: this.rpm, load, gear: this.gear, speedKmh: this.speed * 3.6, shifting: this.shift !== null, running: this.running, limiter,
      overrun: this.overrun * (cut === 0 ? 1 : revs), pedal: this.running ? this.throttle : 0, brake: this.brake,
    }
  }

  /** Mode essai : la vitesse vient du couple, de l'air, des pneus et du frein. */
  private physics(dt: number, brake: number) {
    const p = this.car.vehicle, e = this.car.engine
    const ratio = p.ratios[this.gear - 1] * p.finalDrive
    const rWheel = p.tireCircumferenceM / (2 * Math.PI)
    const v = this.speed
    let force = 0
    if (this.running && this.age >= SETTLE_S) {
      const fuel = clamp((e.limiterRpm - this.gearRpm(this.gear)) / LIMIT_BAND_RPM, 0, 1)
      force = this.torqueAt(this.rpm) * this.throttle * fuel * ratio * EFFICIENCY / rWheel * (this.shift?.up && this.gear !== this.shift.to ? 0 : 1)
      if (this.throttle < 0.05 && v > 0.5) force -= 0.15 * e.peakTorqueNm * ratio / rWheel * clamp(this.rpm / e.redlineRpm, 0.2, 1)
    }
    if (v > 0.05) force -= 0.5 * RHO * p.cdA * v * v + p.crr * p.massKg * G
    force -= brake * p.massKg * 9
    let a = Math.min(force / p.massKg, p.maxAccel)
    let next = v + a * dt
    if (next <= 0) { next = 0; a = Math.max(a, 0) }
    this.speed = next
    this.accel = a
  }

  /** Le rapport qui va avec la vitesse quand l'embrayage se ferme : le plus long qui garde le moteur au-dessus de
   *  1,5 fois le ralenti et de 30 % de la zone rouge. Un démarrage en roulant ne doit pas repartir de la première
   *  (chasse de régression du 09/11 : de la 1re à la 5e en 12 s, dont 2 s au rupteur). */
  bestGear(): number {
    const e = this.car.engine, n = this.car.vehicle.ratios.length
    const floor = Math.max(1.5 * e.idleRpm, 0.3 * e.redlineRpm)
    for (let g = n; g > 1; g--) if (this.gearRpm(g) >= floor) return g
    return 1
  }

  /** Points de passage du programme en cours, pour cette voiture. En Chill et Sport, pas de kickdown dans le programme
   *  lui-même : pied au plancher, c'est le programme Race qui s'applique (`floored`). */
  schedule(): Schedule {
    const e = this.car.engine, R = e.redlineRpm, n = this.car.vehicle.ratios.length
    const mode = GEAR_MODES.find(m => m.id === this.gearMode)
    if (!mode?.topKmh || n < 2 || this.gearMode === 'race' || this.floored) return { upLo: 0.36 * R, upHi: R - 200, kick: 0.75, kickBelow: 0.55 * R, kickTo: 0.68 * R, gentle: false }
    const g = GENTLE[this.gearMode]
    // Régime de l'avant-dernier rapport à la vitesse du programme : passé à la pédale normale, il fait monter au dernier.
    // 5 % de marge : pile au seuil, une croisière à cette vitesse restait sur l'avant-dernier (STI en Sport à 160).
    const target = 0.95 * this.gearRpm(n - 1, mode.topKmh / 3.6)
    const upLo = clamp(target / (1 + (g.spread - 1) * Math.pow(NORMAL_THROTTLE, 1.3)), Math.max(2 * e.idleRpm, 0.25 * R), 0.7 * R)
    const upHi = Math.min(R - 200, upLo * g.spread)
    return { upLo, upHi, kick: g.kick, kickBelow: 0, kickTo: 0, gentle: true }
  }

  /** Boîte manuelle : seul l'anti-calage redescend, sur le plus long rapport qui garde le moteur au-dessus du ralenti
   *  (à l'arrêt, la première). Au rupteur, elle ne monte pas : c'est au conducteur de passer. */
  private stallGuard() {
    if (this.shift || this.engage || this.age < SETTLE_S || this.gear === 1) return
    const idle = this.car.engine.idleRpm
    if (this.gearRpm(this.gear) >= idle) return
    let g = this.gear - 1
    while (g > 1 && this.gearRpm(g) < idle * MANUAL_LUG) g--
    this.startShift(g)
  }

  private autoShift() {
    if (this.shift || this.age < SETTLE_S) return
    const e = this.car.engine, ratios = this.car.vehicle.ratios, n = ratios.length, thr = this.throttle
    const gentle = this.gearMode === 'race' ? null : GENTLE[this.gearMode]
    if (!gentle) this.floored = false
    else if (this.pedal > gentle.kick) this.floored = true
    else if (thr < gentle.kick - FLOOR_RELEASE) this.floored = false
    const s = this.schedule()
    const rpm = this.gearRpm(this.gear)
    // La pédale demandée (pas encore lissée) déclenche le plancher et le kickdown dès qu'elle s'enfonce. La montée, elle,
    // reste sur la pédale lissée : la passer sur la pédale demandée n'a rien changé de mesurable (mutation du 13/11).
    const lead = Math.max(thr, this.pedal)
    const up = lerp(s.upLo, s.upHi, Math.pow(thr, 1.3))
    const lower = this.gear > 1 ? this.gearRpm(this.gear - 1) : Infinity
    // Programme doux : le moteur retombe bas après une montée (`step` = ce rapport sur le précédent). Pied levé, rien ne
    // doit faire rétrograder au-dessus de ce régime d'arrivée, sinon la boîte redescend dès qu'on lève le pied.
    const step = this.gear > 1 ? ratios[this.gear - 1] / ratios[this.gear - 2] : 1
    const soft = s.gentle && this.gear > 1
    // En GPS, l'accélération est DÉDUITE de mesures bruitées : une seule mesure de travers suffisait à rétrograder
    // en roue libre, puis à remonter, en boucle à vitesse constante (chasse du 09/11). La décélération doit donc durer,
    // et une montée attend un peu après un rétrogradage. Le kickdown et les montées, eux, restent immédiats : une
    // confirmation générale rendait la boîte paresseuse et perdait la moitié des kickdowns (chasse de régression).
    const confirm = this.noisy ? DECEL_CONFIRM_GPS_S * this.fixS : DECEL_CONFIRM_S
    const coasting = thr < 0.05 && this.decelFor >= confirm
    if (coasting && this.gear > 1 && this.sinceShift >= DECEL_PAUSE_S) {
      const hard = clamp(-this.accel / 4, 0, 1)
      const at = soft ? Math.min(this.tuning.downshiftAt, 0.85 * s.upLo * step / e.redlineRpm) : this.tuning.downshiftAt
      const floor = Math.max(1.6 * e.idleRpm, lerp(at, Math.min(0.75, at + DECEL_HARD_EXTRA), hard) * e.redlineRpm)
      if (rpm < floor && lower < 0.75 * e.redlineRpm) return this.startShift(this.gear - 1)
    }
    if (this.sinceShift < SHIFT_PAUSE_S) return
    // Pied levé, on garde le rapport (le moteur reste dans les tours et crépite) ; seule la zone rouge fait monter.
    // Pied levé : pédale nulle juste après une vraie charge, ou voiture qui ralentit. Au GPS, une croisière stable donne
    // aussi une pédale déduite sous 5 % : comptée comme un pied levé, elle empêchait la boîte de monter à vitesse
    // constante. Une charge récente distingue le lâcher, dont la décélération n'est pas encore lue, de la croisière.
    const lifting = this.pedal < 0.05 && (this.accel < -0.2 || this.sinceLoad < 2) && rpm < e.redlineRpm - 300
    const upWait = UPSHIFT_AFTER_DOWN_GPS_S * this.fixS
    const justDown = this.noisy && !this.lastUp && this.sinceShift < upWait && rpm < e.redlineRpm - 300
    if (this.gear < n && !lifting && !justDown && this.accel > -0.2 && rpm > up && this.gearRpm(this.gear + 1) > e.idleRpm * 1.3) return this.startShift(this.gear + 1)
    if (this.gear === 1) return
    // Pied au plancher à bas régime : on descend d'autant de rapports que le permet la zone rouge.
    // Le kickdown ne vise jamais un régime au-dessus du point de montée pied au plancher (`kickTo` < `upHi`) : après une
    // montée, le rapport inférieur est donc hors d'atteinte, et la boîte ne peut pas boucler kickdown, montée, kickdown.
    // En Chill et Sport, `kickBelow` vaut 0 : seul le programme Race du plancher rétrograde ainsi.
    // Le kickdown part sur la pédale demandée, comme la montée : sur la pédale lissée, la règle de charge plus bas
    // rétrogradait d'abord d'un rapport pendant qu'elle montait, et le kickdown d'un autre 0,8 s plus tard (banc du
    // 13/11, Ferrari de 80 à 98 km/h). Il descend d'un coup jusqu'au plus bas rapport sous `kickTo`.
    if (lead > s.kick && rpm < s.kickBelow) {
      let g = this.gear
      while (g > 1 && this.gearRpm(g - 1) < s.kickTo) g--
      if (g < this.gear) return this.startShift(g)
    }
    if (coasting) return
    // En charge, `lower < up - 300` suffit à ne pas redescendre juste après une montée : le rapport inférieur est alors
    // au régime de montée.
    const down = lerp(1.35 * e.idleRpm, 0.45 * e.redlineRpm, thr)
    if (rpm < down && lower < up - 300) this.startShift(this.gear - 1)
  }

  private startShift(to: number) { this.lastUp = to > this.gear; this.shift = { to, t: 0, up: this.lastUp } }
}
