import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Car as CarIcon, Gauge, MapPin, Minus, Plus, Power, RotateCcw, SlidersHorizontal, Volume2 } from 'lucide-react'
import { CARS, carById, type Car } from '../lib/moteur/cars'
import { GEAR_MODES, Vehicle, type Drive, type EngineState, type GearMode } from '../lib/moteur/vehicle'
import { GpsSpeed, type GpsState } from '../lib/moteur/gps'
import { EngineAudio, audioSupported } from '../lib/moteur/audio'
import Tachometer from '../components/moteur/Tachometer'
import Badge from '../components/moteur/Badge'
import { DEFAULT_TUNING, TUNING_SPECS, parseTuning, type Tuning } from '../lib/moteur/tuning'

/** Page Moteur : un son de moteur thermique qui suit la vitesse GPS, joué par le téléphone (et donc par la voiture
 *  quand il y est relié en Bluetooth). Tout se passe dans le navigateur : ni le serveur de Studio ni le brain ne
 *  sont sollicités. Le mode essai remplace le GPS par deux pédales, pour écouter les voitures à l'arrêt. */

type Mode = 'gps' | 'essai'
const CAR_KEY = 'studio_moteur_car'
const MODE_KEY = 'studio_moteur_mode'
const VOLUME_KEY = 'studio_moteur_volume'
const TUNING_KEY = 'studio_moteur_reglages'
const GEAR_MODE_KEY = 'studio_moteur_boite'
/** L'affichage se rafraîchit moins vite que le son : 30 images par seconde, l'aiguille interpole entre deux. */
const VIEW_MS = 33
/** Un démarrage du son qui ne répond pas (appel en cours, système audio occupé) est abandonné au bout de ce délai. */
const START_TIMEOUT_MS = 5000
/** Sans mesure GPS (signal qui démarre, retour depuis l'essai), la vitesse en cours est tenue au plus ce temps. */
const GPS_WAIT_HOLD_MS = 8000

/** La promesse, ou une erreur au bout de `ms` : un démarrage ne doit jamais laisser « Démarrage… » sans fin. */
const withTimeout = <T,>(p: Promise<T>, ms: number, message: string) => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(message)), ms)
  p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
})

const readPref = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const savePref = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* navigation privée */ } }

export const gpsLabel = (state: GpsState, accuracy: number | null): string => ({
  off: 'GPS éteint',
  waiting: 'En attente du signal GPS…',
  ok: accuracy !== null ? `GPS reçu, précision ±${Math.round(accuracy)} m` : 'GPS reçu',
  stale: 'Signal GPS perdu : la dernière vitesse est tenue',
  denied: 'Localisation refusée : autorise-la pour Promea (ou ce navigateur) dans les réglages de l’iPhone, puis redémarre.',
  error: 'Position indisponible pour l’instant : le GPS continue de chercher.',
})[state]

type WakeLockLike = { release(): Promise<void> }

export default function EnginePage() {
  const [carId, setCarId] = useState(() => carById(readPref(CAR_KEY)).id)
  const car = carById(carId)
  const [mode, setMode] = useState<Mode>(() => (readPref(MODE_KEY) === 'essai' ? 'essai' : 'gps'))
  const [volume, setVolume] = useState(() => { const v = Number(readPref(VOLUME_KEY)); return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.8 })
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gps, setGps] = useState<{ state: GpsState; accuracy: number | null }>({ state: 'off', accuracy: null })
  // `none` : le navigateur n'a pas de verrou d'écran ; `denied` : il en a un mais l'a refusé.
  const [wake, setWake] = useState<'on' | 'off' | 'pending' | 'none' | 'denied'>('off')
  // Le système a coupé le son (appel, Siri, autre app) alors que le moteur tourne.
  const [interrupted, setInterrupted] = useState(false)
  const [view, setView] = useState<EngineState | null>(null)
  const [tuning, setTuning] = useState<Tuning>(() => parseTuning(readPref(TUNING_KEY)))
  // Programme de la boîte auto (Chill par défaut : on roule sur route, pas sur circuit), et boîte passée en manuel
  // par les palettes. Le manuel n'est pas gardé d'une visite à l'autre : la page s'ouvre toujours en auto.
  const [gearMode, setGearModeState] = useState<GearMode>(() => GEAR_MODES.find(m => m.id === readPref(GEAR_MODE_KEY))?.id ?? 'chill')
  const [manual, setManual] = useState(false)

  const audio = useRef(new EngineAudio())
  const vehicle = useRef(new Vehicle(car))
  if (vehicle.current.tuning !== tuning) vehicle.current.setTuning(tuning)
  if (vehicle.current.gearMode !== gearMode) vehicle.current.setGearMode(gearMode)
  // Les choix du moment, lus après les attentes : une voiture, un réglage ou un volume changés pendant
  // « Démarrage… » doivent arriver au son, pas ceux du moment du toucher.
  const carRef = useRef(car)
  const tuningRef = useRef(tuning)
  const volumeRef = useRef(volume)
  /** Numéro du démarrage en cours : couper ou quitter la page l'incrémente, et tout ce qui revient d'une attente
   *  avec un ancien numéro est abandonné (sinon un son, un GPS ou un verrou d'écran survivent sans écran pour les
   *  arrêter). */
  const session = useRef(0)
  const holdSince = useRef<number | null>(null)
  const tracker = useRef(new GpsSpeed())
  const pedals = useRef({ gas: 0, brake: 0 })
  const modeRef = useRef(mode)
  const frame = useRef(0)
  const watch = useRef<number | null>(null)
  const lock = useRef<WakeLockLike | null>(null)
  const runningRef = useRef(false)

  const stopGps = () => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current)
    watch.current = null
    setGps({ state: 'off', accuracy: null })
  }
  const startGps = () => {
    if (watch.current !== null) return
    if (!('geolocation' in navigator)) { setGps({ state: 'error', accuracy: null }); return }
    const t = tracker.current
    t.reset()
    t.state = 'waiting'
    setGps({ state: 'waiting', accuracy: null })
    watch.current = navigator.geolocation.watchPosition(
      pos => {
        const c = pos.coords
        t.push({ speed: c.speed, lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, stamp: pos.timestamp }, performance.now())
        setGps({ state: t.state, accuracy: t.accuracy })
      },
      err => {
        if (err.code === err.PERMISSION_DENIED) {
          if (watch.current !== null) navigator.geolocation.clearWatch(watch.current)
          watch.current = null
          t.state = 'denied'
          setGps({ state: 'denied', accuracy: null })
        } else if (t.state !== 'ok' && t.state !== 'stale') {
          // Un délai dépassé ou une panne passagère : watchPosition continue d'essayer de lui-même. Une fois la
          // vitesse connue, une erreur (tunnel) ne la remet pas à zéro : la dernière reste tenue.
          t.state = err.code === err.TIMEOUT ? 'waiting' : 'error'
          setGps({ state: t.state, accuracy: null })
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
  }

  const requestWake = async () => {
    const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } }).wakeLock
    if (!wl) { setWake('none'); return }
    const mine = session.current
    setWake(w => (w === 'on' ? w : 'pending'))
    try {
      const got = await wl.request('screen')
      // Moteur coupé (ou page quittée) pendant que le système répondait : on rend le verrou aussitôt.
      if (session.current !== mine || !runningRef.current) { got.release().catch(() => {}); return }
      lock.current?.release().catch(() => {})
      lock.current = got
      setWake('on')
    } catch { if (session.current === mine) setWake('denied') }
  }
  const releaseWake = () => { lock.current?.release().catch(() => {}); lock.current = null; setWake('off') }

  const loop = () => {
    let last = performance.now(), shown = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      let drive: Drive
      if (modeRef.current === 'gps') {
        const r = tracker.current.read(now), st = tracker.current.state
        // Pas encore de mesure (GPS qui démarre, retour depuis l'essai) : la voiture garde sa vitesse au lieu de
        // retomber à l'arrêt puis de repartir en première. Au plus `GPS_WAIT_HOLD_MS`, et jamais si la localisation est
        // refusée : une vitesse d'essai tenue indéfiniment sous « En attente du signal » serait un mensonge.
        if (r.fresh || st === 'stale') { holdSince.current = null; drive = { mode: 'gps', ...r, fixMs: tracker.current.fixInterval } }
        else {
          holdSince.current ??= now
          const hold = st !== 'denied' && now - holdSince.current < GPS_WAIT_HOLD_MS
          drive = { mode: 'gps', speed: hold ? vehicle.current.speed : 0, accel: 0 }
        }
      } else drive = { mode: 'essai', gas: pedals.current.gas, brake: pedals.current.brake }
      const st = vehicle.current.update(dt, drive)
      audio.current.setParams(st.rpm, st.load, st.overrun)
      if (modeRef.current === 'gps' && tracker.current.state === 'stale') setGps(g => (g.state === 'stale' ? g : { ...g, state: 'stale' }))
      if (now - shown >= VIEW_MS) { shown = now; setView(st) }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  /** Tout rendre : son, GPS, verrou d'écran, boucle. Appelé à la coupure, au démontage et sur un échec. */
  const teardown = () => {
    runningRef.current = false
    cancelAnimationFrame(frame.current)
    vehicle.current.stop()
    audio.current.stop()
    releaseWake()
    setRunning(false)
    setBusy(false)
    setInterrupted(false)
    setView(null)
  }

  const start = async () => {
    setError(null)
    if (!audioSupported()) { setError('Ce navigateur ne sait pas jouer un son calculé en direct (ni AudioWorklet ni ScriptProcessor).'); return }
    const mine = ++session.current
    setBusy(true)
    vehicle.current.setCar(carRef.current)
    vehicle.current.start()
    try {
      await withTimeout(audio.current.start(carRef.current, volumeRef.current, tuningRef.current, setInterruptedFrom),
        START_TIMEOUT_MS, 'le système audio ne répond pas (un appel est peut-être en cours)')
    } catch (e) {
      if (session.current !== mine) return
      teardown()
      setError(`Le son n’a pas pu démarrer : ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    // Coupé ou page quittée pendant l'attente : celui qui a incrémenté la session a déjà tout rendu.
    if (session.current !== mine) return
    audio.current.setCar(carRef.current)
    audio.current.setTuning(tuningRef.current)
    audio.current.setVolume(volumeRef.current)
    vehicle.current.setCar(carRef.current)
    setBusy(false)
    runningRef.current = true
    setRunning(true)
    if (modeRef.current === 'gps') startGps()
    void requestWake()
    loop()
  }

  const stop = () => { session.current++; teardown() }

  /** Palette + ou − : la boîte passe en manuel, même si elle refuse le rapport (moteur pas encore embrayé, zone rouge). */
  const shift = (d: 1 | -1) => { vehicle.current.shiftBy(d); setManual(true) }
  /** Un programme touché, y compris celui en cours, rend la main à la boîte auto dans ce programme. */
  const pickGearMode = (m: GearMode) => {
    setGearModeState(m)
    savePref(GEAR_MODE_KEY, m)
    vehicle.current.setGearMode(m)
    setManual(false)
  }

  // Le contexte audio suspendu ou interrompu par le système alors que le moteur tourne : on le dit, avec de quoi le
  // relancer (iOS ne le relance pas toujours seul après un appel).
  function setInterruptedFrom(state: AudioContextState | 'interrupted') {
    setInterrupted(runningRef.current && state !== 'running' && state !== 'closed')
  }

  const pickCar = (c: Car) => {
    carRef.current = c
    setCarId(c.id)
    savePref(CAR_KEY, c.id)
    vehicle.current.setCar(c)
    audio.current.setCar(c)
  }

  const pickMode = (m: Mode) => {
    setMode(m)
    modeRef.current = m
    savePref(MODE_KEY, m)
    pedals.current = { gas: 0, brake: 0 }
    holdSince.current = null
    // Le GPS suit la page, pas le moteur : allumé dès qu'on est en mode GPS, la vitesse est connue à l'embrayage.
    if (m === 'gps') startGps(); else stopGps()
  }

  const changeTuning = (next: Tuning) => {
    tuningRef.current = next
    setTuning(next)
    savePref(TUNING_KEY, JSON.stringify(next))
    vehicle.current.setTuning(next)
    audio.current.setTuning(next)
  }

  const changeVolume = (v: number) => { volumeRef.current = v; setVolume(v); savePref(VOLUME_KEY, String(v)); audio.current.setVolume(v) }

  // Retour au premier plan : iOS a pu suspendre le son et relâcher le maintien de l'écran.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && runningRef.current) { audio.current.resume(); void requestWake() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Clavier en mode essai (sur ordinateur) : flèche haut = accélérateur, flèche bas = frein.
  useEffect(() => {
    if (mode !== 'essai') return
    const set = (e: KeyboardEvent, v: number) => {
      if (e.key === 'ArrowUp') { pedals.current.gas = v; e.preventDefault() }
      else if (e.key === 'ArrowDown') { pedals.current.brake = v; e.preventDefault() }
    }
    const down = (e: KeyboardEvent) => set(e, 1), up = (e: KeyboardEvent) => set(e, 0)
    // La fenêtre qui perd le focus ne reçoit pas le relâchement : sans ça, l'accélérateur resterait collé.
    const blur = () => { pedals.current = { gas: 0, brake: 0 } }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [mode])

  // Palettes au clavier (sur ordinateur) : flèche droite ou + pour monter, flèche gauche ou − pour descendre. Pas
  // quand un curseur a le focus : les flèches y règlent sa valeur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!runningRef.current || (e.target as HTMLElement | null)?.tagName === 'INPUT') return
      const d = e.key === 'ArrowRight' || e.key === '+' ? 1 : e.key === 'ArrowLeft' || e.key === '-' ? -1 : 0
      if (d) { e.preventDefault(); shift(d) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Ouvrir la page en mode GPS allume le GPS : la question d'iOS arrive tout de suite, et la vitesse est déjà connue
  // quand on démarre (avant, « GPS éteint » jusqu'au démarrage laissait croire à une autorisation manquante).
  // Quitter la page coupe le moteur et le GPS : un son qui continue sans écran pour l'arrêter serait un piège.
  // Y compris pendant « Démarrage… » : le démarrage en cours revient avec un ancien numéro et s'abandonne.
  useEffect(() => {
    if (modeRef.current === 'gps') startGps()
    return () => { stop(); stopGps() }
  }, [])

  const pedal = (k: 'gas' | 'brake') => ({
    onPointerDown: (e: PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); pedals.current[k] = 1 },
    onPointerUp: () => { pedals.current[k] = 0 },
    onPointerCancel: () => { pedals.current[k] = 0 },
    onLostPointerCapture: () => { pedals.current[k] = 0 },
  })

  return <div className="engine-page">
    <section className="cm-panel">
      <div className="cm-panel-head"><Gauge size={14} /><h2>Tableau de bord</h2><span className="cm-meta">{car.brand} {car.name}</span></div>
      <div className="engine-dash">
        <Tachometer car={car} rpm={view?.rpm ?? 0} gear={view?.running ? view.gear : null} speedKmh={view?.speedKmh ?? 0} running={!!view?.running} limiter={!!view?.limiter} pedal={view?.pedal ?? 0} brake={view?.brake ?? 0} />
        <div className="engine-controls">
          <button className={`button engine-power ${running ? 'on' : 'primary'}`} onClick={running ? stop : start} disabled={busy}>
            <Power size={18} />{busy ? 'Démarrage…' : running ? 'Couper le moteur' : 'Démarrer'}
          </button>
          <div className="engine-paddles">
            <button className="button engine-paddle" aria-label="Rapport inférieur" onClick={() => shift(-1)} disabled={!running}><Minus size={22} /></button>
            <button className="button engine-paddle" aria-label="Rapport supérieur" onClick={() => shift(1)} disabled={!running}><Plus size={22} /></button>
          </div>
          <div className="engine-box" role="radiogroup" aria-label="Boîte de vitesses">
            {GEAR_MODES.map(m => <button key={m.id} role="radio" aria-checked={m.id === gearMode} aria-label={`${m.label}${m.id === gearMode && manual ? ', en manuel' : ''}`}
              className={`engine-box-mode ${m.id === gearMode ? 'selected' : ''}`} onClick={() => pickGearMode(m.id)}>
              <b>{m.letter}</b><span>{m.label}</span>
              {m.id === gearMode && manual && <i className="engine-box-manual" data-testid="engine-manual">M</i>}
            </button>)}
          </div>
          <div className="engine-source">
          <div className="engine-modes" role="radiogroup" aria-label="Source de la vitesse">
            <button role="radio" aria-checked={mode === 'gps'} className={`chip ${mode === 'gps' ? 'selected' : ''}`} onClick={() => pickMode('gps')}><MapPin size={13} />GPS</button>
            <button role="radio" aria-checked={mode === 'essai'} className={`chip ${mode === 'essai' ? 'selected' : ''}`} onClick={() => pickMode('essai')}><CarIcon size={13} />Essai</button>
          </div>
          <label className="engine-volume"><Volume2 size={15} /><span className="sr-only">Volume</span>
            <input type="range" min={0.05} max={1} step={0.05} value={volume} onChange={ev => changeVolume(Number(ev.target.value))} aria-label="Volume" />
          </label>
          </div>
        </div>
        {mode === 'essai' && <div className="engine-pedals">
          <button className="button engine-pedal brake" {...pedal('brake')}>Frein</button>
          <button className="button engine-pedal gas" {...pedal('gas')}>Accélérateur</button>
        </div>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="engine-status">
          {mode === 'gps' && <p className={gps.state === 'denied' ? 'inline-error' : 'muted'}>{gpsLabel(gps.state, gps.accuracy)}</p>}
          {mode === 'essai' && <p className="muted">Garde les pédales appuyées (ou les flèches haut et bas du clavier) : la vitesse est simulée.</p>}
          {manual && <p className="muted">Boîte en manuel : passe les rapports avec − et + (ou les flèches gauche et droite). Touche C, S ou R pour revenir en auto.</p>}
          {running && (wake === 'none' || wake === 'denied') && <p className="muted">{wake === 'none' ? 'Ce navigateur ne peut pas garder l’écran allumé' : 'Le système a refusé de garder l’écran allumé'} : désactive le verrouillage auto le temps du trajet, sinon le son s’arrête avec l’écran.</p>}
          {running && interrupted && <p className="inline-error" role="alert">Le son a été coupé par le système (appel, Siri, autre app). <button className="text-button" onClick={() => audio.current.resume()}>Relancer le son</button></p>}
        </div>
      </div>
    </section>
    <section className="cm-panel">
      <div className="cm-panel-head"><CarIcon size={14} /><h2>Voiture</h2><span className="cm-meta">{CARS.length} moteurs</span></div>
      <div className="engine-cars" role="radiogroup" aria-label="Voiture">
        {CARS.map(c => <button key={c.id} role="radio" aria-checked={c.id === car.id} className={`engine-car ${c.id === car.id ? 'selected' : ''}`} onClick={() => pickCar(c)}>
          <span className="engine-car-badge"><Badge brand={c.brand} size={26} /></span>
          <span className="engine-car-text"><strong>{c.brand} {c.name}</strong><span>{c.tagline}</span></span>
        </button>)}
      </div>
    </section>
    <section className="cm-panel">
      <div className="cm-panel-head"><SlidersHorizontal size={14} /><h2>Réglages</h2><span className="cm-meta">Pour toutes les voitures, gardés sur cet appareil</span>
        <div className="cm-panel-tools"><button className="button cm-small-button" onClick={() => changeTuning(DEFAULT_TUNING)} disabled={TUNING_SPECS.every(sp => tuning[sp.key] === sp.def)}><RotateCcw size={12} />Rétablir</button></div>
      </div>
      <div className="engine-tuning">
        {TUNING_SPECS.map(sp => <label key={sp.key} className="engine-tune">
          <span className="field-label">{sp.label} <b>{sp.format(tuning[sp.key])}</b></span>
          <input type="range" min={sp.min} max={sp.max} step={sp.step} value={tuning[sp.key]} aria-label={sp.label}
            onChange={ev => changeTuning({ ...tuning, [sp.key]: Number(ev.target.value) })} />
        </label>)}
      </div>
    </section>
    <p className="cm-note">Le son sort comme ta musique : par le haut-parleur du téléphone, ou par la voiture quand il y est relié en Bluetooth. Garde l’écran allumé pendant le trajet.</p>
  </div>
}
