# Moteur — son de moteur thermique piloté par le GPS

Page web autonome (React + Web Audio, tout tourne dans le navigateur) : le son d'un moteur suit la vitesse GPS
de l'appareil. Sept voitures, boîte Chill / Sport / Race, mode Essai (deux pédales, sans GPS).
Extraite de Nexus Studio 0.8.6. Aucun backend.

## Utiliser tout de suite
`dist/` est la version construite : n'importe quel serveur de fichiers statiques fait l'affaire.

    cd dist && python3 -m http.server 8080

Le GPS et l'audio exigent un contexte sécurisé : `http://localhost` marche, sinon il faut du HTTPS
(Tailscale Funnel, Caddy, Cloudflare Tunnel…). Depuis un téléphone ou une voiture, donc en HTTPS.

## Modifier / reconstruire
    npm install
    npm run dev      # développement
    npm run build    # produit dist/

Sources : `src/pages/EnginePage.tsx` (écran), `src/lib/moteur/` (cars, vehicle, gps, audio, dsp, worklet, tuning),
`src/components/moteur/` (compte-tours, badges). Les logos de marques sont dans `src/lib/moteur/logos/`
(sources : `SOURCES.md`) : à retirer ou remplacer avant toute diffusion publique.

## Dans une voiture avec CarPlay / Android Auto (ex. VW Caddy)
CarPlay n'affiche pas les pages web : la page tourne sur le téléphone, posé sur un support en paysage, et le son passe
par la voiture (USB, Bluetooth ou jack). Le téléphone doit rester allumé, page au premier plan.

1. Publier en HTTPS, au choix :
   - GitHub Pages : pousser ce dossier sur GitHub (branche `main`), Réglages > Pages > Source « GitHub Actions ».
   - Netlify Drop (app.netlify.com/drop) ou Cloudflare Pages : y glisser le dossier `dist/`.
2. Ouvrir l'adresse sur le téléphone, accepter la localisation.
   - iPhone (Safari) : Partager > Sur l'écran d'accueil.
   - Android (Chrome) : menu ⋮ > Installer l'application.
3. Lancer depuis l'icône (plein écran), appuyer sur Démarrer.
