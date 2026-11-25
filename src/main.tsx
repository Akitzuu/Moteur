import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import EnginePage from './pages/EnginePage'
import './index.css'

/** La page Moteur seule, pour le navigateur de la Tesla (NB-595) : aucune API de Studio, aucun thème du serveur
 *  (celui par défaut, écrit dans index.css), rien d'autre que la page. Elle est servie à part, par Tailscale Funnel,
 *  depuis `dist-moteur/` : le reste de Studio, qui n'a pas d'authentification, n'est jamais exposé. */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="moteur-standalone"><EnginePage /></main>
  </StrictMode>,
)
