import workletUrl from './worklet.ts?worker&url'
import type { Car } from './cars'
import { EngineDsp, type DspCar } from './dsp'
import type { Tuning } from './tuning'
import type { WorkletMessage } from './worklet'

/** Le bout Web Audio de la page Moteur : contexte, processeur, volume. */

const dspCar = (c: Car): DspCar => ({ firing: c.engine.firing, idleRpm: c.engine.idleRpm, redlineRpm: c.engine.redlineRpm, sound: c.sound })

/** AudioWorklet de préférence (le son calculé à part, sans à-coups) ; sinon, l'ancien ScriptProcessor, qui calcule
 *  sur la page elle-même. Le secours vise le navigateur de la Tesla, dont la version n'est pas connue d'avance. */
export const audioSupported = () => typeof window !== 'undefined' && 'AudioContext' in window
  && ('audioWorklet' in AudioContext.prototype || 'createScriptProcessor' in AudioContext.prototype)
/** Taille d'un bloc du secours : 2 048 échantillons, 46 ms à 44,1 kHz. Plus petit, la page n'a pas le temps entre deux
 *  blocs quand elle dessine le compte-tours ; plus grand, le son traînerait derrière la pédale. */
const FALLBACK_BLOCK = 2048

/** Gain de sortie pour le curseur de volume (0 à 1). En puissance 1,6, parce que l'oreille entend en décibels, et
 *  jusqu'à ×2 (+6 dB) à fond : à ×1, il fallait monter les haut-parleurs de la Tesla à 50 % pour bien entendre (essai
 *  du 14/11). Les crêtes que ce gain fait passer au-dessus de la pleine échelle, l'écrêteur doux les arrondit. */
export const VOLUME_MAX_GAIN = 2
export const volumeGain = (v: number) => Math.pow(Math.min(1, Math.max(0, v)), 1.6) * VOLUME_MAX_GAIN

/** Écrêteur de sécurité, en dernier : transparent jusqu'à 90 % de la pleine échelle, puis il courbe le signal vers 98 %
 *  au lieu de le couper net (une coupure nette s'entend comme un craquement). Une courbe de WaveShaper ne lit que des
 *  entrées entre −1 et 1 : on y entre divisé par `CLIP_RANGE`, et la courbe couvre ±`CLIP_RANGE`. */
export const CLIP_KNEE = 0.9
export const CLIP_CEIL = 0.98
export const CLIP_RANGE = 4
export function softClip(x: number): number {
  const a = Math.abs(x), k = CLIP_CEIL - CLIP_KNEE
  const y = a <= CLIP_KNEE ? a : CLIP_KNEE + k * Math.tanh((a - CLIP_KNEE) / k)
  return x < 0 ? -y : y
}
export function clipCurve(points = 4097): Float32Array {
  const curve = new Float32Array(points)
  for (let i = 0; i < points; i++) curve[i] = softClip((i / (points - 1) * 2 - 1) * CLIP_RANGE)
  return curve
}

export class EngineAudio {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  /** Secours sans AudioWorklet : la synthèse tourne ici, et les messages lui arrivent directement. */
  private dsp: EngineDsp | null = null
  private script: ScriptProcessorNode | null = null
  private gain: GainNode | null = null

  get state(): AudioContextState | 'off' { return this.ctx?.state ?? 'off' }

  /** À appeler DANS le geste de l'utilisateur : iOS ne laisse démarrer le son que pendant un toucher. */
  async start(car: Car, volume: number, tuning: Tuning, onState?: (state: AudioContextState | 'interrupted') => void) {
    // Sur iPhone, sans ça, le son de la page suit le bouton silencieux et se tait téléphone en mode vibreur.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session) try { session.type = 'playback' } catch { /* navigateur qui ne le permet pas */ }
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    // iOS passe le contexte à « interrupted » pendant un appel ou Siri ; Safari ajoute cet état au type standard.
    if (onState) ctx.onstatechange = () => { if (this.ctx === ctx) onState(ctx.state as AudioContextState | 'interrupted') }
    const resumed = ctx.resume()
    let source: AudioNode
    if (ctx.audioWorklet) {
      await ctx.audioWorklet.addModule(workletUrl)
      if (this.ctx !== ctx) return
      source = this.node = new AudioWorkletNode(ctx, 'moteur', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
    } else {
      const dsp = this.dsp = new EngineDsp(ctx.sampleRate, 1)
      const script = this.script = ctx.createScriptProcessor(FALLBACK_BLOCK, 0, 2)
      script.onaudioprocess = e => { const out = e.outputBuffer; dsp.process(out.getChannelData(0), out.getChannelData(1)) }
      source = script
    }
    // Un compresseur doux : les pétarades et le rupteur ne doivent pas saturer les haut-parleurs de la voiture.
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15
    const gain = ctx.createGain()
    gain.gain.value = volumeGain(volume)
    const clipIn = ctx.createGain()
    clipIn.gain.value = 1 / CLIP_RANGE
    const clip = ctx.createWaveShaper()
    clip.curve = clipCurve()
    // Sans suréchantillonnage : ses filtres feraient sonner les aigus au-delà du plafond.
    clip.oversample = 'none'
    source.connect(comp).connect(gain).connect(clipIn).connect(clip).connect(ctx.destination)
    this.gain = gain
    this.setCar(car)
    this.setTuning(tuning)
    await resumed
  }

  setCar(car: Car) { this.post({ type: 'car', car: dspCar(car) }) }
  setTuning(t: Tuning) { this.post({ type: 'tuning', tuning: { crackle: t.crackle, brightness: t.brightness } }) }
  setParams(rpm: number, load: number, overrun: number) { this.post({ type: 'params', rpm, load, overrun }) }
  setVolume(v: number) { if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(volumeGain(v), this.ctx.currentTime, 0.05) }
  /** Après un passage en arrière-plan, iOS laisse le contexte « interrompu » : on le relance au retour. */
  resume() { if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {}) }

  /** Le son s'éteint en une centaine de millisecondes avant la fermeture du contexte : couper net claquerait. */
  stop() {
    const ctx = this.ctx, gain = this.gain
    const script = this.script
    this.ctx = null; this.node = null; this.gain = null; this.dsp = null; this.script = null
    if (!ctx) return
    // Le secours calcule sur la page : sans ça, il continuerait de tourner jusqu'à la fermeture du contexte.
    if (script) setTimeout(() => { script.onaudioprocess = null }, 150)
    ctx.onstatechange = null
    if (gain && ctx.state === 'running') {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03)
      setTimeout(() => { ctx.close().catch(() => {}) }, 150)
    } else ctx.close().catch(() => {})
  }

  private post(m: WorkletMessage) {
    if (this.node) { this.node.port.postMessage(m); return }
    const d = this.dsp
    if (!d) return
    if (m.type === 'car') d.configure(m.car)
    else if (m.type === 'tuning') d.setTuning(m.tuning)
    else d.setTarget(m.rpm, m.load, m.overrun)
  }
}
