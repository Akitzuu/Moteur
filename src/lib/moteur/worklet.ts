/// <reference lib="webworker" />
// Le processeur AudioWorklet de la page Moteur : il ne fait que relayer les messages de la page vers EngineDsp.
// Vite le compile à part (`?worker&url`) ; tout ce qu'il importe est inclus dans son fichier.
import { EngineDsp, type DspCar, type DspTuning } from './dsp'

declare const sampleRate: number
declare class AudioWorkletProcessor { readonly port: MessagePort; constructor() }
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

export type WorkletMessage = { type: 'car'; car: DspCar } | { type: 'tuning'; tuning: DspTuning } | { type: 'params'; rpm: number; load: number; overrun: number }

class MoteurProcessor extends AudioWorkletProcessor {
  private dsp = new EngineDsp(sampleRate, 1)
  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
      const m = e.data
      if (m.type === 'car') this.dsp.configure(m.car)
      else if (m.type === 'tuning') this.dsp.setTuning(m.tuning)
      else this.dsp.setTarget(m.rpm, m.load, m.overrun)
    }
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    if (out && out.length) this.dsp.process(out[0], out[1] ?? out[0])
    return true
  }
}

registerProcessor('moteur', MoteurProcessor)
