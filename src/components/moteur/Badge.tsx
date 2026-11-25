import chevrolet from '../../lib/moteur/logos/chevrolet.svg'
import ferrariWordmark from '../../lib/moteur/logos/ferrari-wordmark.svg'
import porscheWordmark from '../../lib/moteur/logos/porsche-wordmark.svg'
import lamborghiniWordmark from '../../lib/moteur/logos/lamborghini-wordmark.svg'
import huracan from '../../lib/moteur/logos/huracan.svg'
import bmw from '../../lib/moteur/logos/bmw.svg'
import bmwM from '../../lib/moteur/logos/bmw-m.svg'
import subaru from '../../lib/moteur/logos/subaru.svg'

/** Les logos de la page Moteur, pour l'usage personnel de Guillaume. Les logos officiels viennent de Wikimedia
 *  Commons (voir `lib/moteur/logos/SOURCES.md`) ; les emblèmes absents de Commons (cheval cabré, écusson Porsche,
 *  taureau, étoiles Subaru) sont redessinés ici, simplifiés. */

/** Un logo d'une seule couleur, recoloré : le fichier sert de masque, la couleur vient du fond. Sur un cadran
 *  sombre, un logo noir resterait invisible. */
function Masked({ src, ratio, height, color, label }: { src: string; ratio: number; height: number; color: string; label: string }) {
  return <span role="img" aria-label={label} className="logo-mask" style={{
    height, width: height * ratio, background: color,
    WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")`,
  }} />
}

const star = (cx: number, cy: number, r: number) => {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`)
  }
  return pts.join(' ')
}

export default function Badge({ brand, size = 28 }: { brand: string; size?: number }) {
  switch (brand) {
    case 'Chevrolet':
      return <Masked src={chevrolet} ratio={94 / 30} height={size * 0.8} color="linear-gradient(180deg,#f3cf5a,#c08f12 55%,#8a6a0c)" label="Chevrolet" />
    case 'Ferrari':
      return <svg viewBox="0 0 44 56" height={size} aria-label="Ferrari" role="img">
        <path d="M2 2 H42 V36 Q42 50 22 54 Q2 50 2 36 Z" fill="#f6c400" stroke="#111" strokeWidth="2" />
        <rect x="2" y="2" width="13.3" height="6" fill="#009246" /><rect x="15.3" y="2" width="13.4" height="6" fill="#fff" /><rect x="28.7" y="2" width="13.3" height="6" fill="#ce2b37" />
        <path d="M17 44 L19 31 Q15 27 17 21 Q20 15 25 16 L28 13 L28 18 Q31 20 29 24 L24 24 L25 31 L29 36 L26 37 L22 32 L21 44 Z" fill="#111" />
        <text x="22" y="52" textAnchor="middle" fontSize="6" fontWeight="700" fontFamily="Georgia, serif" fill="#111">S F</text>
      </svg>
    case 'Porsche':
      return <svg viewBox="0 0 44 54" height={size} aria-label="Porsche" role="img">
        <path d="M3 6 Q22 0 41 6 V30 Q41 46 22 52 Q3 46 3 30 Z" fill="#c8a45c" stroke="#3b2d14" strokeWidth="1.6" />
        <rect x="6" y="14" width="15" height="14" fill="#111" /><rect x="23" y="30" width="15" height="14" fill="#111" />
        <path d="M6 18 H21 M6 23 H21 M23 34 H38 M23 39 H38" stroke="#c4161c" strokeWidth="2.2" />
        <rect x="16" y="22" width="12" height="13" fill="#e9d38f" stroke="#3b2d14" strokeWidth="0.8" />
        <text x="22" y="11" textAnchor="middle" fontSize="4.6" fontWeight="700" letterSpacing="0.6" fontFamily="Arial, sans-serif" fill="#111">PORSCHE</text>
      </svg>
    case 'Lamborghini':
      return <svg viewBox="0 0 44 54" height={size} aria-label="Lamborghini" role="img">
        <path d="M3 3 H41 V30 Q41 46 22 52 Q3 46 3 30 Z" fill="#111" stroke="#c9a227" strokeWidth="2.4" />
        <path d="M11 37 Q12 28 16 25 Q14 20 19 18 L26 18 Q31 17 32 13 Q34 19 30 22 L33 30 L29 30 L27 26 L20 27 L19 37 Z" fill="#c9a227" />
        <text x="22" y="11" textAnchor="middle" fontSize="4.4" fontWeight="700" letterSpacing="0.3" fontFamily="Arial, sans-serif" fill="#c9a227">LAMBORGHINI</text>
      </svg>
    case 'BMW':
      return <img src={bmw} alt="BMW" height={size} width={size} />
    case 'Subaru':
      return <svg viewBox="0 0 80 46" height={size} aria-label="Subaru" role="img">
        <ellipse cx="40" cy="23" rx="38" ry="21" fill="#013c74" stroke="#9fb3c8" strokeWidth="1.5" />
        <polygon points={star(22, 21, 9)} fill="#fff" />
        {[[44, 12], [55, 18], [64, 26], [50, 30], [40, 25]].map(([x, y]) => <polygon key={`${x}-${y}`} points={star(x, y, 4.2)} fill="#fff" />)}
      </svg>
    case 'Honda':
      // Le « H » évasé vers le haut, dans son cadre arrondi.
      return <svg viewBox="0 0 48 40" height={size} aria-label="Honda" role="img">
        <path d="M3 4 Q24 -1 45 4 L42 33 Q24 41 6 33 Z" fill="none" stroke="#e8eaed" strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M11 8 L17 7.5 L17.8 17.5 L30.2 17.5 L31 7.5 L37 8 L35 32 L29.5 33 L30 23 L18 23 L18.5 33 L13 32 Z" fill="#e8eaed" />
      </svg>
    default:
      return null
  }
}

/** Le nom de la marque (et du modèle quand il a son logo), tel qu'il s'écrit officiellement. `null` : on l'écrit en
 *  texte. */
export function Wordmark({ brand, height = 16 }: { brand: string; height?: number }) {
  switch (brand) {
    case 'Ferrari': return <Masked src={ferrariWordmark} ratio={93.75 / 20.66} height={height * 1.2} color="#f6c400" label="Ferrari" />
    case 'Porsche': return <Masked src={porscheWordmark} ratio={921.26 / 96.38} height={height * 0.75} color="#ececec" label="Porsche" />
    case 'Lamborghini': return <Masked src={lamborghiniWordmark} ratio={665.9 / 163.88} height={height * 1.3} color="#c9a227" label="Lamborghini" />
    case 'Subaru': return <Masked src={subaru} ratio={14791 / 2000} height={height * 0.9} color="#e9edf2" label="Subaru" />
    case 'BMW': return <span className="logo-chip"><img src={bmwM} alt="BMW M" height={height} /></span>
    default: return null
  }
}

/** Le modèle, quand la marque lui a dessiné un logo. */
export function ModelMark({ brand, name, height = 12 }: { brand: string; name: string; height?: number }) {
  if (brand === 'Lamborghini' && name.startsWith('Huracán')) return <Masked src={huracan} ratio={12} height={height} color="#f2f2f2" label={name} />
  return null
}
