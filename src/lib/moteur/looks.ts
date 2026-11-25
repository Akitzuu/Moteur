/** L'habillage de chaque voiture : couleurs et dessin de son compte-tours, inspirés du tableau de bord de la marque.
 *  Usage personnel de Guillaume ; les logos sont redessinés, pas des fichiers officiels. */

export type Gauge = {
  /** Aiguille sur cadran (`analog`), ou anneau de segments façon écran numérique (`digital`). */
  style: 'analog' | 'digital'
  page: string
  face: string
  faceEdge: string
  bezel: [string, string]
  tick: string
  numeral: string
  needle: string
  redline: string
  accent: string
  text: string
  font: string
  italic?: boolean
  /** Inscription sous les chiffres, comme sur le vrai cadran. */
  caption: string
}

export const GAUGES: Record<string, Gauge> = {
  // Cadran noir, chiffres blancs, aiguille orange, lunette chromée : le combiné des Camaro.
  'v8-muscle': {
    style: 'analog', page: '#0b0c0f', face: '#121418', faceEdge: '#050506', bezel: ['#d9dde3', '#5d636c'],
    tick: '#e8ecf1', numeral: '#f2f4f7', needle: '#ff5a1f', redline: '#e3262b', accent: '#d4a017', text: '#c9ced6',
    font: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif', caption: 'RPM x1000',
  },
  // Le compte-tours jaune au centre du combiné Ferrari, chiffres noirs, aiguille rouge.
  'v12-italien': {
    style: 'analog', page: '#0d0d0d', face: '#f6c400', faceEdge: '#c99a00', bezel: ['#3a3a3a', '#0c0c0c'],
    tick: '#111111', numeral: '#111111', needle: '#d10000', redline: '#d10000', accent: '#d10000', text: '#111111',
    font: '"Helvetica Neue", Arial, sans-serif', italic: true, caption: 'GIRI/MIN x1000',
  },
  // Grand cadran central noir, chiffres blancs, vitesse en chiffres en bas du cadran : le combiné 911.
  'flat6-gt3': {
    style: 'analog', page: '#08090a', face: '#0e0f11', faceEdge: '#000000', bezel: ['#2a2c30', '#0a0b0c'],
    tick: '#f4f4f4', numeral: '#f4f4f4', needle: '#ff3b1f', redline: '#e2231a', accent: '#c8a45c', text: '#d8d8d8',
    font: '"Helvetica Neue", Arial, sans-serif', caption: '1/min x1000',
  },
  // Écran numérique à facettes, segments jaunes, rapport géant au centre : le combiné Huracán.
  'v10-supercar': {
    style: 'digital', page: '#050505', face: '#0b0b0c', faceEdge: '#2a2a2a', bezel: ['#3b3b3b', '#111111'],
    tick: '#5a5a5a', numeral: '#e9e9e9', needle: '#ffb400', redline: '#ff2d1a', accent: '#ffb400', text: '#f2f2f2',
    font: '"DIN Alternate", "Arial Narrow", Arial, sans-serif', caption: 'RPM x1000',
  },
  // Cadran noir aux chiffres blancs et aiguille orangée, liseré aux trois couleurs M.
  'i6-biturbo': {
    style: 'analog', page: '#0a0b0d', face: '#101215', faceEdge: '#000000', bezel: ['#3a3d42', '#0d0e10'],
    tick: '#e9edf2', numeral: '#f1f3f6', needle: '#ff6a13', redline: '#e7222e', accent: '#0066b1', text: '#cdd3db',
    font: '"Helvetica Neue", Arial, sans-serif', caption: '1/min x1000',
  },
  // Cadran noir, aiguille rouge, rouge cerise STI.
  'boxer4-rallye': {
    style: 'analog', page: '#090a0c', face: '#121316', faceEdge: '#000000', bezel: ['#7b8088', '#202226'],
    tick: '#f0f0f0', numeral: '#f5f5f5', needle: '#ff1e2d', redline: '#e60012', accent: '#e60012', text: '#d5d7db',
    font: '"Arial Narrow", Arial, sans-serif', caption: 'r/min x1000',
  },
  // Le compte-tours rond de l'écran de la NSX, cerclé de rouge en mode Sport+.
  'v6-nsx': {
    style: 'analog', page: '#07080a', face: '#0c0d10', faceEdge: '#000000', bezel: ['#ff2a2a', '#5a0508'],
    tick: '#eef1f5', numeral: '#f5f7fa', needle: '#ff2626', redline: '#ff2626', accent: '#ff2626', text: '#d6dae0',
    font: '"Helvetica Neue", Arial, sans-serif', caption: 'x1000 r/min',
  },
}

export const gaugeFor = (id: string): Gauge => GAUGES[id] ?? GAUGES['v8-muscle']
