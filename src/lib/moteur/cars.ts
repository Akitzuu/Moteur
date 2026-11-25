/** Les voitures de la page Moteur. Chaque fiche décrit le moteur (régimes, couple, ordre d'allumage), la voiture
 *  (masse, aérodynamique, boîte) et le timbre que la synthèse en tire. Les chiffres mécaniques sont ceux des fiches
 *  techniques publiques, arrondis. Le timbre (résonances, bouffées, silencieux) a été réglé le 14/11 par une recherche
 *  automatique qui rapproche la répartition de l'énergie par bande de fréquences, sur quatre phases, de celle mesurée
 *  sur teslasound (ou de la tendance moyenne pour les voitures sans équivalent), puis validé à l'oreille.
 *
 *  Ajouter une voiture : une fiche de plus dans `CARS`, de la même forme. Le test `moteur.test.mjs` vérifie que
 *  chacune est cohérente (allumages dans le cycle, bancs existants, rapports décroissants…). */

export type Sound = {
  /** Aller-retour de l'onde dans chaque ligne d'échappement, en ms. Une entrée par banc. */
  pipeMs: number[]
  /** Part de l'onde renvoyée par le bout du tuyau (0 à 1), et amortissement de ce retour (0 sourd, 1 vif). */
  reflection: number
  damping: number
  /** Résonances de la ligne : fréquence, sélectivité, niveau. */
  formants: { hz: number; q: number; gain: number }[]
  formantDry: number
  /** Durée d'une bouffée d'échappement, au ralenti puis à la zone rouge. */
  pulseMsIdle: number
  pulseMsRedline: number
  /** Souffle de la combustion ajouté à chaque bouffée, et irrégularité d'un allumage à l'autre. */
  noise: number
  jitter: number
  /** Part des allumages qui brûlent mal au ralenti pied levé : ce qui fait « galoper » un ralenti. */
  lope: number
  /** Souffle d'admission. */
  intake: number
  intakeHz: number
  /** Silencieux : coupe-haut fermé (ralenti pied levé) et grand ouvert (plein gaz en haut des tours). Puis la caisse
   *  (bosse grave) et la saturation. */
  mufflerHz: [number, number]
  bodyHz: number
  bodyDb: number
  drive: number
  /** Décélération : crépitements de l'échappement, part de vraies détonations parmi eux, et régime en dessous duquel
   *  il n'y a ni l'un ni l'autre. */
  crackle: number
  pops: number
  popMinRpm: number
  gain: number
}

export type Car = {
  id: string
  /** Marque et modèle dont le moteur reprend les caractéristiques ; la page en tire le logo et le compte-tours. */
  brand: string
  name: string
  tagline: string
  engine: {
    idleRpm: number
    redlineRpm: number
    limiterRpm: number
    peakTorqueNm: number
    peakTorqueRpm: number
    /** Allumages sur un cycle de 720° : angle du vilebrequin et banc d'échappement qui reçoit la bouffée. */
    firing: [number, number][]
  }
  vehicle: {
    massKg: number
    cdA: number
    crr: number
    peakPowerKw: number
    maxAccel: number
    /** Rapports de boîte, du premier au dernier, et pont. */
    ratios: number[]
    /** Coupure d'injection d'une montée de rapport : courte sur une double embrayage, plus longue sur une auto. */
    shiftCutMs: number
    finalDrive: number
    tireCircumferenceM: number
  }
  sound: Sound
}

/** Allumages régulièrement espacés, le banc de chaque allumage donné dans l'ordre. */
const even = (banks: number[]): [number, number][] => banks.map((b, i) => [i * 720 / banks.length, b])

export const CARS: Car[] = [
  {
    id: 'v8-muscle',
    brand: 'Chevrolet',
    name: 'Camaro SS',
    tagline: 'V8 atmosphérique 6,2 L à vilebrequin croisé · 455 ch',
    // Ordre 1-8-4-3-6-5-7-2, cylindres 1 à 4 à gauche : chaque banc reçoit ses bouffées à intervalles inégaux,
    // d'où le grondement irrégulier du V8 américain.
    engine: { idleRpm: 750, redlineRpm: 6500, limiterRpm: 6700, peakTorqueNm: 610, peakTorqueRpm: 4600, firing: even([0, 1, 0, 0, 1, 1, 1, 0]) },
    vehicle: { massKg: 1750, cdA: 0.75, crr: 0.012, peakPowerKw: 340, maxAccel: 6.5, ratios: [4.06, 2.37, 1.55, 1.16, 0.85, 0.67], shiftCutMs: 130, finalDrive: 3.55, tireCircumferenceM: 2.1 },
    sound: {
      pipeMs: [6.2, 7.1], reflection: 0.52, damping: 0.78,
      formants: [{ hz: 120, q: 0.87, gain: 0.99 }, { hz: 400, q: 2.11, gain: 0.51 }, { hz: 1370, q: 3.39, gain: 0 }], formantDry: 0.33,
      pulseMsIdle: 4.2, pulseMsRedline: 1.37, noise: 0.45, jitter: 0.06, lope: 0.2,
      intake: 0.1, intakeHz: 600, mufflerHz: [680, 4470], bodyHz: 82, bodyDb: 5.3, drive: 2.8, crackle: 0.9, pops: 0.6, popMinRpm: 1800, gain: 0.75,
    },
  },
  {
    id: 'v12-italien',
    brand: 'Ferrari',
    name: '812 Superfast',
    tagline: 'V12 atmosphérique 6,5 L à 65° · 800 ch · 8 900 tr/min',
    engine: { idleRpm: 1000, redlineRpm: 8750, limiterRpm: 8900, peakTorqueNm: 718, peakTorqueRpm: 7000, firing: even([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]) },
    vehicle: { massKg: 1600, cdA: 0.65, crr: 0.012, peakPowerKw: 588, maxAccel: 8, ratios: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], shiftCutMs: 70, finalDrive: 4.1, tireCircumferenceM: 2.05 },
    sound: {
      pipeMs: [4.4, 4.8], reflection: 0.4, damping: 0.85,
      formants: [{ hz: 600, q: 4, gain: 0.7 }, { hz: 920, q: 3.92, gain: 0.16 }, { hz: 2350, q: 3.39, gain: 0 }], formantDry: 0.58,
      pulseMsIdle: 3.05, pulseMsRedline: 0.43, noise: 0.34, jitter: 0.04, lope: 0.05,
      intake: 0.3, intakeHz: 1500, mufflerHz: [780, 8570], bodyHz: 140, bodyDb: 7, drive: 2.2, crackle: 0.4, pops: 0.3, popMinRpm: 3000, gain: 0.7,
    },
  },
  {
    id: 'flat6-gt3',
    brand: 'Porsche',
    name: '911 GT3',
    tagline: 'Flat-six atmosphérique 4,0 L · 510 ch · 9 000 tr/min',
    engine: { idleRpm: 900, redlineRpm: 9000, limiterRpm: 9100, peakTorqueNm: 470, peakTorqueRpm: 6100, firing: even([0, 1, 0, 1, 0, 1]) },
    vehicle: { massKg: 1450, cdA: 0.68, crr: 0.012, peakPowerKw: 375, maxAccel: 7.5, ratios: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], shiftCutMs: 60, finalDrive: 4.1, tireCircumferenceM: 2.03 },
    sound: {
      pipeMs: [5, 5.2], reflection: 0.45, damping: 0.64,
      formants: [{ hz: 210, q: 0.6, gain: 0.54 }, { hz: 610, q: 3.29, gain: 1.12 }, { hz: 4000, q: 2.18, gain: 0 }], formantDry: 0.3,
      pulseMsIdle: 5.39, pulseMsRedline: 0.4, noise: 0.33, jitter: 0.05, lope: 0.08,
      intake: 0.35, intakeHz: 1800, mufflerHz: [710, 4730], bodyHz: 120, bodyDb: 4.94, drive: 2.8, crackle: 0.6, pops: 0.4, popMinRpm: 2500, gain: 0.7,
    },
  },
  {
    id: 'v10-supercar',
    brand: 'Lamborghini',
    name: 'Huracán EVO',
    tagline: 'V10 atmosphérique 5,2 L · 640 ch · 8 500 tr/min',
    engine: { idleRpm: 950, redlineRpm: 8500, limiterRpm: 8700, peakTorqueNm: 600, peakTorqueRpm: 6500, firing: even([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]) },
    vehicle: { massKg: 1550, cdA: 0.7, crr: 0.012, peakPowerKw: 470, maxAccel: 8, ratios: [3.13, 2.24, 1.69, 1.32, 1.07, 0.88, 0.72], shiftCutMs: 70, finalDrive: 4.0, tireCircumferenceM: 2.05 },
    sound: {
      pipeMs: [4.8, 5.6], reflection: 0.42, damping: 0.42,
      formants: [{ hz: 230, q: 1.01, gain: 0.79 }, { hz: 650, q: 0.92, gain: 0.31 }, { hz: 2780, q: 3.77, gain: 0.15 }], formantDry: 0.51,
      pulseMsIdle: 3.77, pulseMsRedline: 0.75, noise: 0.29, jitter: 0.05, lope: 0.06,
      intake: 0.3, intakeHz: 1400, mufflerHz: [670, 4570], bodyHz: 110, bodyDb: 5.09, drive: 2.5, crackle: 1, pops: 0.7, popMinRpm: 2500, gain: 0.72,
    },
  },
  {
    id: 'i6-biturbo',
    brand: 'BMW',
    name: 'M3 Competition',
    tagline: '6 cylindres en ligne 3,0 L biturbo · 510 ch',
    engine: { idleRpm: 800, redlineRpm: 7200, limiterRpm: 7300, peakTorqueNm: 650, peakTorqueRpm: 2750, firing: even([0, 0, 0, 0, 0, 0]) },
    vehicle: { massKg: 1725, cdA: 0.68, crr: 0.012, peakPowerKw: 375, maxAccel: 7, ratios: [5.0, 3.2, 2.14, 1.72, 1.31, 1.0, 0.82, 0.64], shiftCutMs: 90, finalDrive: 3.15, tireCircumferenceM: 2.1 },
    sound: {
      pipeMs: [5.8], reflection: 0.4, damping: 0.73,
      formants: [{ hz: 220, q: 1.52, gain: 1.6 }, { hz: 920, q: 3.07, gain: 1.34 }, { hz: 910, q: 4, gain: 0.71 }], formantDry: 0.15,
      pulseMsIdle: 3.78, pulseMsRedline: 2.5, noise: 0.31, jitter: 0.04, lope: 0.05,
      intake: 0.45, intakeHz: 2200, mufflerHz: [450, 1500], bodyHz: 100, bodyDb: 5.87, drive: 2.2, crackle: 0.7, pops: 0.5, popMinRpm: 2000, gain: 0.75,
    },
  },
  {
    id: 'boxer4-rallye',
    brand: 'Subaru',
    name: 'Impreza WRX STI',
    tagline: '4 cylindres à plat 2,5 L turbo, collecteurs inégaux · 300 ch',
    // Ordre 1-3-2-4 avec 1 et 3 du même côté : deux bouffées rapprochées par banc, puis un trou. Les deux lignes
    // de longueurs différentes font le reste du « glou-glou ».
    engine: { idleRpm: 850, redlineRpm: 6700, limiterRpm: 6900, peakTorqueNm: 410, peakTorqueRpm: 4000, firing: even([0, 0, 1, 1]) },
    vehicle: { massKg: 1500, cdA: 0.7, crr: 0.013, peakPowerKw: 221, maxAccel: 6, ratios: [3.64, 2.24, 1.52, 1.13, 0.92, 0.75], shiftCutMs: 110, finalDrive: 3.9, tireCircumferenceM: 2.0 },
    sound: {
      pipeMs: [5.4, 7.6], reflection: 0.61, damping: 0.36,
      formants: [{ hz: 120, q: 1.91, gain: 0.95 }, { hz: 470, q: 2.38, gain: 1.05 }, { hz: 2430, q: 2.45, gain: 0.26 }], formantDry: 0.25,
      pulseMsIdle: 5.41, pulseMsRedline: 1.48, noise: 0.42, jitter: 0.08, lope: 0.15,
      intake: 0.4, intakeHz: 1800, mufflerHz: [730, 1500], bodyHz: 90, bodyDb: 4.35, drive: 2.6, crackle: 1, pops: 0.8, popMinRpm: 2000, gain: 0.75,
    },
  },
  {
    id: 'v6-nsx',
    brand: 'Honda',
    name: 'NSX (2020)',
    tagline: 'V6 3,5 L biturbo à 75° et trois moteurs électriques · 581 ch · 7 500 tr/min',
    // V6 à 75°, ordre 1-4-2-5-3-6 : les bancs alternent, un allumage tous les 120°. Les moteurs électriques comblent
    // le creux des turbos : la voiture pousse fort dès les bas régimes (maxAccel), le V6 n'en a que sa part.
    engine: { idleRpm: 900, redlineRpm: 7500, limiterRpm: 7600, peakTorqueNm: 550, peakTorqueRpm: 4000, firing: even([0, 1, 0, 1, 0, 1]) },
    vehicle: { massKg: 1725, cdA: 0.72, crr: 0.012, peakPowerKw: 427, maxAccel: 9.5, ratios: [3.838, 2.433, 1.777, 1.427, 1.166, 0.973, 0.833, 0.733, 0.647], shiftCutMs: 60, finalDrive: 3.583, tireCircumferenceM: 2.17 },
    sound: {
      pipeMs: [5.2, 5.6], reflection: 0.43, damping: 0.54,
      formants: [{ hz: 210, q: 0.8, gain: 0.8 }, { hz: 830, q: 0.73, gain: 0.49 }, { hz: 4000, q: 3.16, gain: 0.67 }], formantDry: 0.67,
      // La NSX ramène le son de l'admission dans l'habitacle par un conduit : un souffle marqué qui monte avec la pédale.
      pulseMsIdle: 3.44, pulseMsRedline: 0.66, noise: 0.31, jitter: 0.04, lope: 0.04,
      intake: 0.55, intakeHz: 1700, mufflerHz: [840, 2260], bodyHz: 105, bodyDb: 3.93, drive: 2.3, crackle: 0.5, pops: 0.4, popMinRpm: 2500, gain: 0.75,
    },
  },
]

export const carById = (id: string | null | undefined): Car => CARS.find(c => c.id === id) ?? CARS[0]
