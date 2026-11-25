import type { Sound } from './cars'

/** La synthèse du son moteur, échantillon par échantillon. Elle tourne dans l'AudioWorklet (fil audio du
 *  navigateur) et, à l'identique, dans les tests sous Node : rien ici ne touche au DOM ni à Web Audio.
 *
 *  Le principe suit la mécanique plutôt qu'un oscillateur : chaque allumage pousse une bouffée de gaz dans la ligne
 *  d'échappement de son banc. La ligne est un tuyau (une ligne à retard dont le bout renvoie une partie de l'onde),
 *  suivi de ses résonances, du silencieux et de la caisse. Le régime fixe la cadence des bouffées, la charge leur
 *  force et l'ouverture du silencieux. Chaque explosion ajoute aussi son propre souffle de bruit, bref, qui grossit
 *  avec la charge : sans lui, le train de bouffées reste lisse et sonne « numérique ». Au lâcher de pédale, une
 *  intensité de décélération (venue de la voiture virtuelle, qui s'éteint en quelques secondes) fait crépiter
 *  l'échappement par salves irrégulières, avec de temps en temps une vraie détonation. */

export type DspCar = { firing: [number, number][]; idleRpm: number; redlineRpm: number; sound: Sound }
/** La part des réglages de la page qui touche au son (voir `tuning.ts`). */
export type DspTuning = { crackle: number; brightness: number }

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x)
/** Écart fixe de force entre cylindres (pièces jamais identiques). */
const TRIM = 0.06
/** Une détonation : montée d'1 ms (sinon le départ claque comme un clic), décroissance d'une vingtaine. Un
 *  crépitement : plus court et plus aigu. */
const BANG = { attackS: 0.001, decayS: 0.02, crack: 0.8, thump: 2.5 }
const CRACK = { attackS: 0.0003, decayS: 0.004, crack: 1, thump: 0.4 }
/** Bouffées en vol en même temps dans un banc. À haut régime, la suivante part avant que la précédente soit éteinte :
 *  avec une seule bouffée à la fois, la nouvelle coupait l'ancienne net, et cette coupure sonnait « numérique »
 *  (banc A/B contre teslasound du 13/11). */
const MAX_PULSES = 8

/** Générateur pseudo-aléatoire à graine : le même son à chaque essai, et des tests reproductibles. */
class Rng {
  private s: number
  constructor(seed: number) { this.s = (seed >>> 0) || 1 }
  next(): number { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s / 4294967296 }
  white(): number { return this.next() * 2 - 1 }
  gauss(): number { return (this.next() + this.next() + this.next() - 1.5) * 1.41 }
}

type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking'

/** Filtre du second ordre (formules RBJ), forme transposée. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0
  private z1 = 0; private z2 = 0
  set(type: FilterType, hz: number, q: number, sr: number, db = 0) {
    const w = 2 * Math.PI * clamp(hz, 10, sr * 0.45) / sr
    const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q)
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
    if (type === 'peaking') {
      const A = Math.pow(10, db / 40)
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A
    } else {
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
      if (type === 'lowpass') { b1 = 1 - cos; b0 = b1 / 2; b2 = b0 }
      else if (type === 'highpass') { b1 = -(1 + cos); b0 = (1 + cos) / 2; b2 = b0 }
      else { b0 = alpha; b1 = 0; b2 = -alpha }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0
  }
  process(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

/** Passe-bas à variables d'état (forme « TPT ») : contrairement au biquad, il supporte qu'on fasse bouger sa
 *  fréquence en continu. Le silencieux s'ouvre et se ferme avec la charge ; avec un biquad, chaque nouveau réglage
 *  faisait un petit saut du signal, et au lâcher de pédale ces sauts s'entendaient en cliquetis.
 *  Falsification du 09/11 : depuis que la bouffée monte en demi-cosinus, remettre le biquad ne donne plus de clic
 *  mesurable (test « aucun clic »). Le filtre est gardé pour sa robustesse, pas parce qu'un test le tient. */
export class Svf {
  private ic1 = 0; private ic2 = 0
  private a1 = 1; private a2 = 0; private a3 = 0
  set(hz: number, q: number, sr: number) {
    const g = Math.tan(Math.PI * clamp(hz, 10, sr * 0.45) / sr), k = 1 / q
    this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2
  }
  lowpass(x: number): number {
    const v3 = x - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    return v2
  }
}

/** Une ligne d'échappement : la bouffée en cours, le tuyau, ses résonances. */
class Bank {
  private buf: Float32Array
  private pos = 0
  private back = 0
  private age = new Float32Array(MAX_PULSES)
  private len = new Float32Array(MAX_PULSES)
  private amp = new Float32Array(MAX_PULSES)
  private noise = new Float32Array(MAX_PULSES)
  private decay = new Float32Array(MAX_PULSES)
  private slot = 0
  private formants: { f: Biquad; gain: number }[]
  /** Force de la bouffée en cours, lue par l'admission. */
  exc = 0
  constructor(sr: number, pipeMs: number, private s: Sound) {
    this.buf = new Float32Array(Math.max(2, Math.round(pipeMs * sr / 1000)))
    this.formants = s.formants.map(fm => { const f = new Biquad(); f.set('bandpass', fm.hz, fm.q, sr); return { f, gain: fm.gain } })
  }
  /** Une bouffée de plus, dans la case la plus ancienne : celles déjà parties finissent leur course. */
  fire(amp: number, samples: number, noise: number, noiseDecay: number) {
    const k = this.slot
    this.slot = (k + 1) % MAX_PULSES
    this.age[k] = 0; this.len[k] = Math.max(4, samples); this.amp[k] = amp; this.noise[k] = noise; this.decay[k] = noiseDecay
  }
  tick(rng: Rng): number {
    let x = 0
    for (let k = 0; k < MAX_PULSES; k++) {
      const len = this.len[k]
      if (len === 0) continue
      const a = this.age[k]
      if (a < len) {
        // Montée rapide puis décroissance plus lente : la soupape s'ouvre d'un coup, la pression retombe. La montée
        // part à plat (demi-cosinus) : un départ en pente vive fait un angle que la saturation transforme en clic.
        // Mutation témoin (09/11) : l'ancienne montée en sinus ne change la brillance que de 2 à 3 % et ne fait plus
        // de clic mesurable depuis le souffle de combustion ; aucun test ne peut la distinguer, elle doit survivre.
        const ph = a / len
        x += this.amp[k] * (ph < 0.2 ? 0.5 - 0.5 * Math.cos(ph / 0.2 * Math.PI) : (1 - (ph - 0.2) / 0.8) ** 2)
      }
      // Le souffle de la combustion : un bruit qui part avec l'explosion et s'éteint en quelques millisecondes.
      const n = this.noise[k]
      if (n > 1e-5) { x += n * rng.white(); this.noise[k] = n * this.decay[k] }
      this.age[k] = a + 1
      if (a + 1 >= len && n <= 1e-5) this.len[k] = 0
    }
    this.exc = x
    // Le bout ouvert renvoie l'onde inversée ; le retour perd ses aigus à chaque passage.
    const out = this.buf[this.pos]
    this.back += this.s.damping * (out - this.back)
    const y = x - this.s.reflection * this.back
    this.buf[this.pos] = y
    this.pos = this.pos + 1 === this.buf.length ? 0 : this.pos + 1
    let f = y * this.s.formantDry
    for (const fm of this.formants) f += fm.f.process(y) * fm.gain
    return f
  }
}

/** Échos courts de l'habitacle : sans eux, le son reste celui d'un oscillateur sec. */
class Room {
  private lines: { buf: Float32Array; pos: number; lp: number }[]
  constructor(sr: number) { this.lines = [7.1, 11.3, 13.9, 17.7].map(ms => ({ buf: new Float32Array(Math.round(ms * sr / 1000)), pos: 0, lp: 0 })) }
  /** Échos de l'échantillon, rangés dans `l` et `r` : pas de tableau alloué 48 000 fois par seconde. */
  l = 0
  r = 0
  tick(l: number, r: number) {
    let ol = 0, or = 0
    for (let i = 0; i < 4; i++) {
      const d = this.lines[i]
      const o = d.buf[d.pos]
      d.lp += 0.3 * (o - d.lp)
      d.buf[d.pos] = (i & 1 ? r : l) + d.lp * 0.4
      d.pos = d.pos + 1 === d.buf.length ? 0 : d.pos + 1
      if (i < 2) ol += d.lp; else or += d.lp
    }
    this.l = ol
    this.r = or
  }
}

export class EngineDsp {
  private car: DspCar | null = null
  private tuning: DspTuning = { crackle: 1, brightness: 1 }
  private rng: Rng
  private banks: Bank[] = []
  private pan: [number, number][] = []
  private events: number[] = []
  private eventBank: number[] = []
  private trim: number[] = []
  private next = 0
  private phase = 0
  private rpm = 0
  private load = 0
  private targetRpm = 0
  private targetLoad = 0
  private overrun = 0
  private kSmooth: number
  private intakeEnv = 0
  private popEnv = 0
  private popPeak = 0
  private popAttack = 0
  private popAttackLen = 1
  private popDecay = 0
  private popMix = BANG
  /** Les crépitements viennent par salves : allumé quelques dizaines de ms, éteint quelques centaines. */
  /** Une coupure franche (montée de rapport, lâcher à haut régime) appelle une détonation à l'allumage suivant. */
  private bangDue = false
  private crackleOn = false
  private crackleTimer = 0
  private sinceBlock = 0
  private hpL = new Biquad(); private hpR = new Biquad()
  private mufL = new Svf(); private mufR = new Svf()
  /** Second étage du silencieux : un seul passe-bas du second ordre laissait un souffle dans l'aigu. */
  private muf2L = new Svf(); private muf2R = new Svf()
  /** Saturation du moment : forte en charge, légère en croisière et pied levé (voir `updateBlock`). */
  private drive = 1
  private driveNorm = 1
  private bodyL = new Biquad(); private bodyR = new Biquad()
  private intakeBp = new Biquad()
  private popBp = new Biquad()
  private popLow = new Biquad()
  private room: Room

  constructor(private sr: number, seed = 1) {
    this.rng = new Rng(seed)
    this.kSmooth = 1 - Math.exp(-1 / (0.02 * sr))
    this.room = new Room(sr)
    this.popBp.set('bandpass', 1400, 0.9, sr)
    this.popLow.set('lowpass', 220, 0.7, sr)
  }

  configure(car: DspCar) {
    const s = car.sound, sr = this.sr
    this.car = car
    this.banks = s.pipeMs.map(ms => new Bank(sr, ms, s))
    const n = this.banks.length
    // Deux bancs : chacun d'un côté, sans couper l'autre oreille. Un seul : au centre.
    this.pan = this.banks.map((_, i) => (n === 1 ? [0.7, 0.7] : i === 0 ? [0.85, 0.45] : [0.45, 0.85]))
    const order = car.firing.map(([deg, bank], i) => ({ pos: (deg % 720) / 720, bank: Math.min(bank, n - 1), i })).sort((a, b) => a.pos - b.pos)
    this.events = order.map(o => o.pos)
    this.eventBank = order.map(o => o.bank)
    const trimRng = new Rng(car.firing.length * 7919 + 13)
    this.trim = order.map(() => 1 + TRIM * trimRng.white())
    this.next = 0
    this.phase = 0
    for (const f of [this.hpL, this.hpR]) f.set('highpass', 28, 0.7, sr)
    for (const f of [this.bodyL, this.bodyR]) f.set('peaking', s.bodyHz, 1.1, sr, s.bodyDb)
    this.intakeBp.set('bandpass', s.intakeHz, 1.2, sr)
    this.updateBlock(0)
  }

  setTuning(t: DspTuning) { this.tuning = { crackle: Math.max(0, t.crackle), brightness: Math.max(0.1, t.brightness) } }

  /** Cible envoyée par la page (une trentaine de fois par seconde) ; le lissage se fait ici, à l'échantillon. */
  setTarget(rpm: number, load: number, overrun: number) {
    this.targetRpm = Math.max(0, rpm)
    this.targetLoad = clamp(load, 0, 1)
    overrun = clamp(overrun, 0, 1)
    if (overrun >= 0.5 && this.overrun < 0.2) this.bangDue = true
    else if (overrun === 0) this.bangDue = false
    this.overrun = overrun
  }

  private get rpmN() { const c = this.car!; return clamp((this.rpm - c.idleRpm) / (c.redlineRpm - c.idleRpm), 0, 1) }

  private updateBlock(samples: number) {
    const s = this.car!.sound
    // Le silencieux s'ouvre avec la charge et le régime, entre ses deux bornes (en échelle de fréquences).
    const open = clamp(0.15 + 0.75 * this.load + 0.25 * this.rpmN, 0, 1)
    const hz = s.mufflerHz[0] * Math.pow(s.mufflerHz[1] / s.mufflerHz[0], open) * this.tuning.brightness
    this.mufL.set(hz, 0.75, this.sr)
    this.mufR.set(hz, 0.75, this.sr)
    this.muf2L.set(hz * 1.15, 0.6, this.sr)
    this.muf2R.set(hz * 1.15, 0.6, this.sr)
    // La saturation suit la charge. Fixe, elle écrasait tout au même niveau : la croisière sonnait presque aussi fort
    // que la pleine charge, et le lâcher de pied ne laissait pas ressortir les pétarades (banc A/B du 13/11 : écart
    // crête sur moyenne de 2,3 en croisière contre 3,1 chez teslasound). Le gain des petits signaux suit `drive`.
    this.drive = 1 + (s.drive - 1) * (0.25 + 0.75 * this.load)
    this.driveNorm = 0.6 / Math.tanh(this.drive * 0.6)
    this.crackleTimer -= samples
    if (this.crackleTimer <= 0) {
      this.crackleOn = !this.crackleOn
      this.crackleTimer = this.sr * (this.crackleOn ? 0.04 + 0.16 * this.rng.next() : 0.08 + 0.45 * this.rng.next())
    }
  }

  private fire(i: number) {
    const s = this.car!.sound, rng = this.rng, load = this.load, rpmN = this.rpmN
    // Plus irrégulier au ralenti qu'en haut des tours, et quelques allumages faibles au hasard pied levé :
    // c'est ce qui fait « galoper » un ralenti.
    const jitter = s.jitter * (1 + 1.5 * (1 - rpmN))
    // Plus fort en haut des tours : une croisière à bas régime reste en retrait d'une montée en régime.
    let amp = (0.28 + 0.72 * Math.pow(load, 0.8)) * (0.8 + 0.35 * rpmN) * this.trim[i] * (1 + jitter * rng.gauss())
    if (rng.next() < s.lope * (1 - clamp(rpmN * 5, 0, 1)) * (1 - load)) amp *= 0.35 + 0.3 * rng.next()
    if (amp < 0) amp = 0
    const ms = (s.pulseMsIdle + (s.pulseMsRedline - s.pulseMsIdle) * Math.sqrt(rpmN)) * (1.12 - 0.3 * load) * (0.85 + 0.3 * rng.next())
    const noiseDecay = Math.exp(-1 / (this.sr * (0.0045 + (0.0012 - 0.0045) * rpmN)))
    this.banks[this.eventBank[i]].fire(amp, ms * this.sr / 1000, amp * s.noise * (0.3 + 0.7 * load), noiseDecay)
    // Décélération : crépitements par salves, et de temps en temps une détonation. Jamais un par-dessus l'autre.
    if (this.bangDue && this.rpm > s.popMinRpm) {
      this.bangDue = false
      if (rng.next() < s.pops * Math.min(1, this.tuning.crackle)) { this.pop(BANG, 0.7 + 0.3 * rng.next(), this.eventBank[i]); return }
    }
    if (this.overrun > 0 && this.rpm > s.popMinRpm && this.popEnv < 0.3) {
      const p = s.crackle * this.tuning.crackle * this.overrun * (this.crackleOn ? 0.3 : 0.02)
      if (rng.next() < p) this.pop(rng.next() < s.pops * 0.15 ? BANG : CRACK, 0.25 + 0.75 * rng.next(), this.eventBank[i])
    }
  }

  /** Une pétarade : un coup sec dans le tuyau de ce banc, qui lui donne le corps grave de l'échappement (énergie sous
   *  400 Hz multipliée par 1,76 au lâcher, contre 1,02 sans), plus le claquement à côté du silencieux. Tirer la hauteur
   *  du claquement au hasard, comme teslasound, n'a rien changé de mesurable (13/11) : pas repris. */
  private pop(kind: typeof BANG, size: number, bank = 0) {
    const sr = this.sr, rng = this.rng
    this.banks[Math.min(bank, this.banks.length - 1)]?.fire(size * 1.2, sr * 0.0012, size * 0.9, Math.exp(-1 / (sr * (0.002 + 0.004 * rng.next()))))
    this.popMix = kind
    this.popPeak = size
    this.popAttack = 0
    this.popAttackLen = Math.max(1, kind.attackS * this.sr)
    this.popDecay = Math.exp(-1 / (kind.decayS * this.sr))
    this.popEnv = 0
  }

  /** Remplit un bloc stéréo. `right` peut être le même tableau que `left` (sortie mono). */
  process(left: Float32Array, right: Float32Array) {
    const car = this.car
    if (!car) { left.fill(0); if (right !== left) right.fill(0); return }
    const s = car.sound, k = this.kSmooth, rng = this.rng
    const cyclesPerSample = 1 / (120 * this.sr)
    const kIntake = 1 - Math.exp(-1 / (0.01 * this.sr))
    const nEv = this.events.length
    for (let j = 0; j < left.length; j++) {
      this.rpm += (this.targetRpm - this.rpm) * k
      this.load += (this.targetLoad - this.load) * k
      if (++this.sinceBlock >= 16) { this.sinceBlock = 0; this.updateBlock(16) }

      // Avance du vilebrequin : un cycle = deux tours. Chaque position d'allumage franchie déclenche sa bouffée.
      this.phase += this.rpm * cyclesPerSample
      for (;;) {
        if (this.next === nEv) { if (this.phase < 1) break; this.phase -= 1; this.next = 0; continue }
        if (this.phase < this.events[this.next]) break
        this.fire(this.next++)
      }

      let l = 0, r = 0, exc = 0
      for (let b = 0; b < this.banks.length; b++) {
        const y = this.banks[b].tick(rng)
        l += y * this.pan[b][0]; r += y * this.pan[b][1]
        exc += Math.abs(this.banks[b].exc)
      }
      this.intakeEnv += (exc - this.intakeEnv) * kIntake
      const intake = this.intakeBp.process(rng.white() * s.intake * this.load * (0.3 + 2 * this.intakeEnv))
      l += intake; r += intake

      l = this.bodyL.process(this.muf2L.lowpass(this.mufL.lowpass(this.hpL.process(l))))
      r = this.bodyR.process(this.muf2R.lowpass(this.mufR.lowpass(this.hpR.process(r))))
      l = Math.tanh(l * this.drive) * this.driveNorm
      r = Math.tanh(r * this.drive) * this.driveNorm
      this.room.tick(l, r)
      l += this.room.l * 0.25; r += this.room.r * 0.25

      // La pétarade passe à côté du silencieux : elle doit claquer.
      if (this.popPeak > 0) {
        if (this.popAttack < this.popAttackLen) this.popEnv = this.popPeak * ++this.popAttack / this.popAttackLen
        else { this.popEnv *= this.popDecay; if (this.popEnv < 1e-4) { this.popPeak = 0; this.popEnv = 0 } }
        const n = rng.white(), mix = this.popMix
        const pop = (this.popBp.process(n) * mix.crack + this.popLow.process(n) * mix.thump) * this.popEnv * 1.2
        l += pop; r += pop
      }

      // Moteur coupé : le son s'éteint avec le régime au lieu de couper net.
      const fade = clamp(this.rpm / 150, 0, 1)
      const out = s.gain * fade
      const ol = Math.tanh(l * out), or = Math.tanh(r * out)
      if (right === left) left[j] = (ol + or) / 2
      else { left[j] = ol; right[j] = or }
    }
  }
}
