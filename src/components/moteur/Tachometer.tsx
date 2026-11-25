import { memo } from 'react'
import type { Car } from '../../lib/moteur/cars'
import { gaugeFor, type Gauge } from '../../lib/moteur/looks'
import Badge, { ModelMark, Wordmark } from './Badge'

/** Le compte-tours de la voiture choisie, dans le style de sa marque : un cadran à aiguille ou un anneau de segments
 *  façon écran numérique. Le rapport et la vitesse s'affichent dedans, comme sur un combiné moderne, et une rampe de
 *  témoins s'allume à l'approche de la zone rouge. */

const C = 200
const SWEEP = 270
const START = 135

/** Angle (degrés, sens horaire depuis l'axe des x) d'un régime sur un cadran gradué jusqu'à `max`. */
export const angleOf = (rpm: number, max: number) => START + SWEEP * Math.max(0, Math.min(1, rpm / max))
const polar = (deg: number, r: number) => { const a = deg * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)] as const }
const arc = (a0: number, a1: number, r: number) => {
  const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}
/** Le cadran va jusqu'au millier au-dessus du rupteur. */
export const scaleMax = (car: Car) => Math.ceil(car.engine.limiterRpm / 1000) * 1000

/** Part de la rampe de témoins allumée : rien sous 80 % de la zone rouge, tout à la zone rouge. */
export const shiftLights = (rpm: number, redline: number) => Math.max(0, Math.min(1, (rpm / redline - 0.8) / 0.2))

/** Tout ce qui ne bouge pas : cadran, graduations, chiffres, zone rouge, logo. Ne se redessine qu'au changement de voiture. */
const Dial = memo(function Dial({ car, g }: { car: Car; g: Gauge }) {
  const max = scaleMax(car), red = car.engine.redlineRpm
  const ticks = []
  for (let r = 0; r <= max; r += 250) {
    const major = r % 1000 === 0, half = r % 500 === 0
    const len = major ? 20 : half ? 12 : 7
    const [x0, y0] = polar(angleOf(r, max), 168), [x1, y1] = polar(angleOf(r, max), 168 - len)
    ticks.push(<line key={r} x1={x0} y1={y0} x2={x1} y2={y1} stroke={r >= red ? g.redline : g.tick} strokeWidth={major ? 4 : half ? 2.5 : 1.5} strokeLinecap="butt" />)
  }
  const nums = []
  for (let r = 0; r <= max; r += 1000) {
    const [x, y] = polar(angleOf(r, max), 124)
    nums.push(<text key={r} x={x} y={y} textAnchor="middle" dominantBaseline="central" fill={r >= red ? g.redline : g.numeral}
      fontSize={max > 9000 ? 26 : 30} fontWeight={700} fontFamily={g.font} fontStyle={g.italic ? 'italic' : undefined}>{r / 1000}</text>)
  }
  return <g>
    <defs>
      <linearGradient id={`bezel-${car.id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={g.bezel[0]} /><stop offset="1" stopColor={g.bezel[1]} /></linearGradient>
      <radialGradient id={`face-${car.id}`} cx="0.5" cy="0.45" r="0.6"><stop offset="0.7" stopColor={g.face} /><stop offset="1" stopColor={g.faceEdge} /></radialGradient>
    </defs>
    <circle cx={C} cy={C} r={196} fill={`url(#bezel-${car.id})`} />
    <circle cx={C} cy={C} r={186} fill={`url(#face-${car.id})`} />
    <path d={arc(angleOf(red, max), angleOf(max, max), 172)} stroke={g.redline} strokeWidth={10} fill="none" opacity={0.9} />
    {ticks}
    {nums}
    <text x={C} y={C - 28} textAnchor="middle" fill={g.text} fontSize={13} letterSpacing={1.5} fontFamily={g.font} opacity={0.75}>{g.caption}</text>
  </g>
})

const Needle = ({ angle, g }: { angle: number; g: Gauge }) =>
  <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${C}px ${C}px`, transition: 'transform 60ms linear' }}>
    <path d={`M${C - 26} ${C - 4} L${C + 158} ${C - 1.5} L${C + 158} ${C + 1.5} L${C - 26} ${C + 4} Z`} fill={g.needle} />
  </g>

/** Anneau de 60 segments à facettes, allumés jusqu'au régime : la zone rouge s'allume en rouge. */
function Segments({ car, rpm, g }: { car: Car; rpm: number; g: Gauge }) {
  const max = scaleMax(car), red = car.engine.redlineRpm, n = 60
  const lit = Math.round(n * Math.min(1, rpm / max))
  const segs = []
  for (let i = 0; i < n; i++) {
    const a0 = START + SWEEP * i / n + 0.8, a1 = START + SWEEP * (i + 1) / n - 0.8
    const [x0, y0] = polar(a0, 176), [x1, y1] = polar(a1, 176), [x2, y2] = polar(a1, 146), [x3, y3] = polar(a0, 146)
    const r = max * (i + 0.5) / n
    const on = i < lit
    segs.push(<polygon key={i} points={`${x0},${y0} ${x1},${y1} ${x2},${y2} ${x3},${y3}`}
      fill={on ? (r >= red ? g.redline : g.accent) : g.tick} opacity={on ? 1 : 0.25} />)
  }
  return <g>{segs}</g>
}

const DigitalFrame = memo(function DigitalFrame({ car, g }: { car: Car; g: Gauge }) {
  const max = scaleMax(car)
  const hex = [0, 1, 2, 3, 4, 5].map(i => polar(-90 + i * 60 + 30, 198).join(',')).join(' ')
  const nums = []
  for (let r = 0; r <= max; r += 1000) {
    const [x, y] = polar(angleOf(r, max), 124)
    nums.push(<text key={r} x={x} y={y} textAnchor="middle" dominantBaseline="central" fill={r >= car.engine.redlineRpm ? g.redline : g.numeral}
      fontSize={24} fontWeight={700} fontFamily={g.font}>{r / 1000}</text>)
  }
  return <g>
    <polygon points={hex} fill={g.face} stroke={g.accent} strokeWidth={3} />
    <polygon points={[0, 1, 2, 3, 4, 5].map(i => polar(-90 + i * 60 + 30, 188).join(',')).join(' ')} fill="none" stroke={g.faceEdge} strokeWidth={2} />
    {nums}
    <text x={C} y={C - 78} textAnchor="middle" fill={g.text} fontSize={12} letterSpacing={2} fontFamily={g.font} opacity={0.7}>{g.caption}</text>
  </g>
})

/** Jauge verticale d'une pédale, de part et d'autre du cadran : l'accélérateur à gauche, le frein à droite. */
function PedalBar({ kind, value }: { kind: 'gas' | 'brake'; value: number }) {
  const v = Math.max(0, Math.min(1, value))
  const label = kind === 'gas' ? 'Accélérateur' : 'Frein'
  return <div className={`tacho-pedal ${kind}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
    <div className="tacho-pedal-track"><i style={{ transform: `scaleY(${v.toFixed(3)})` }} /></div>
    <span aria-hidden="true">{kind === 'gas' ? 'ACCÉL.' : 'FREIN'}</span>
  </div>
}

export default function Tachometer({ car, rpm, gear, speedKmh, running, limiter, pedal = 0, brake = 0 }: {
  car: Car; rpm: number; gear: number | null; speedKmh: number; running: boolean; limiter: boolean; pedal?: number; brake?: number
}) {
  const g = gaugeFor(car.id)
  const max = scaleMax(car)
  const lights = shiftLights(rpm, car.engine.redlineRpm)
  const nLights = 9
  // Au rupteur, la rampe clignote : le signal de passer le rapport.
  const blink = limiter && Math.floor(performance.now() / 90) % 2 === 0
  return <div className="tacho" style={{ background: g.page }} data-brand={car.brand}>
    <div className="tacho-lights" aria-hidden="true">
      {Array.from({ length: nLights }, (_, i) => {
        const on = !blink && i < Math.round(lights * nLights)
        const color = i < 3 ? '#38d430' : i < 6 ? '#ffc400' : '#ff2020'
        return <i key={i} style={{ background: on ? color : '#1d1f24', boxShadow: on ? `0 0 10px ${color}` : 'none' }} />
      })}
    </div>
    <div className="tacho-cluster">
    <PedalBar kind="gas" value={pedal} />
    <svg viewBox="0 0 400 400" className="tacho-dial" role="meter" aria-label="Compte-tours" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(rpm)}>
      {g.style === 'analog' ? <Dial car={car} g={g} /> : <DigitalFrame car={car} g={g} />}
      {g.style === 'digital' && <Segments car={car} rpm={rpm} g={g} />}
      <text x={C} y={g.style === 'digital' ? C - 4 : C - 70} textAnchor="middle" dominantBaseline="central" fill={g.style === 'digital' ? g.accent : g.text}
        fontSize={g.style === 'digital' ? 92 : 58} fontWeight={800} fontFamily={g.font} data-testid="engine-gear">{running && gear ? gear : 'N'}</text>
      <text x={C} y={C + 92} textAnchor="middle" fill={g.text} fontSize={34} fontWeight={700} fontFamily={g.font} data-testid="engine-speed">{Math.round(speedKmh)}</text>
      <text x={C} y={C + 114} textAnchor="middle" fill={g.text} fontSize={11} letterSpacing={2} fontFamily={g.font} opacity={0.7}>KM/H</text>
      {g.style === 'analog' && <>
        <Needle angle={angleOf(rpm, max)} g={g} />
        <circle cx={C} cy={C} r={18} fill={g.faceEdge} stroke={g.needle} strokeWidth={3} />
      </>}
    </svg>
    <PedalBar kind="brake" value={brake} />
    </div>
    <div className="tacho-brand">
      <Badge brand={car.brand} size={34} />
      <div>
        {Wordmark({ brand: car.brand }) ?? <strong>{car.brand}</strong>}
        {ModelMark({ brand: car.brand, name: car.name }) ? <span className="tacho-model">{ModelMark({ brand: car.brand, name: car.name })}</span> : <span>{car.name}</span>}
      </div>
      <b className="tacho-rpm" data-testid="engine-rpm">{Math.round(rpm).toLocaleString('fr-FR')}<small>tr/min</small></b>
    </div>
  </div>
}
