# yacin — Yet Another Cyber Incident News

PWA serverless che aggrega notizie su incidenti informatici nel mondo, le normalizza in un modello unico, ne stima la gravità (1–5) e le mostra in lista, su mappa e su globo 3D, con alert per ogni nuovo incidente.

Licenza: GNU GPL v3 o successiva (`GPL-3.0-or-later`), vedi `LICENSE`.

## Fonti

| Fonte | Contenuto | Accesso dal browser |
|---|---|---|
| ransomware.live API v2 `/recentvictims` | rivendicazioni sui leak site (vittima, gruppo, paese, settore) | nessun CORS → passa da un proxy configurabile (predefinito `api.allorigins.win`) |
| Have I Been Pwned `/api/v3/breaches` | violazioni di dati catalogate (account, tipi di dati) | CORS nativo, senza chiave |
| GDELT DOC 2.0 | stampa mondiale (EN + IT), ultimi 3 giorni | JSONP (nessun CORS); max 1 richiesta ogni 5 s |
| Feed RSS (BleepingComputer, The Hacker News, The Record, DataBreaches.net, Security Affairs, Red Hot Cyber; altri aggiungibili) | notizie specializzate | via `api.rss2json.com` (CORS) |

Gli articoli che non descrivono un incidente (offerte, guide, recensioni…) vengono scartati. La stessa notizia da più testate viene unita in un solo incidente con più fonti (somiglianza dei titoli), e conta come conferma nella gravità.

## Modello unificato

`id, source, title, summary, url, date, attackDate, country (ISO2), countryHow, sector, actor, victim, type, severity, reasons[], sources[]`

Tipi: ransomware/estorsione, violazione di dati, DDoS/interruzione, spionaggio/APT, supply chain, wiper/sabotaggio, sfruttamento vulnerabilità, malware/phishing, altro.

## Gravità

Base per tipo (wiper 4; ransomware, spionaggio, supply chain 3; gli altri 2), poi +1 per ciascuno: settore critico o pubblico, segnali di larga scala o fermo dei servizi, zero-day o attore statale, dati sensibili, 3+ fonti; per HIBP +1/+2 in base agli account. −1 se la vittima non è identificata. Ogni scheda mostra le regole applicate.

## Viste

Lista, Mappa (Leaflet; basemap libere senza chiave: OpenStreetMap, anche in versione scura via filtro CSS, OSM Humanitarian, OpenTopoMap), Globo 3D (globe.gl), Fonti/impostazioni. I filtri (gravità, testo, tipo, fonte, periodo, paese) e la scheda di dettaglio sono gli stessi in tutte le viste; cliccando un paese su mappa o globo si apre l'elenco dei suoi incidenti e si può filtrare l'intera app su quel paese.

## Alert

- App aperta (anche in secondo piano): controllo ogni N minuti (predefinito 10), notifica per ogni nuovo incidente sopra la soglia scelta, vibrazione per Alto/Critico, badge sull'icona.
- App chiusa: solo con PWA installata su Chrome/Edge (Android o desktop) tramite Periodic Background Sync; la frequenza la decide il browser (tipicamente ore) e GDELT non viene interrogato in background.
- iOS e Firefox non supportano l'aggiornamento periodico in background.
- Notifiche push istantanee ad app chiusa richiedono un server che interroghi le fonti e invii Web Push: fuori dal vincolo serverless.

Al primo avvio lo storico non genera notifiche.

## Pubblicazione (GitHub Pages)

1. Crea un repository e carica tutti i file di questa cartella nella radice.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Apri l'URL `https://<utente>.github.io/<repo>/` dal telefono → menu → *Installa app* / *Aggiungi a schermata Home*.
4. Tocca **Alert** e concedi il permesso per le notifiche.

Serve HTTPS (service worker e notifiche); in locale basta `python3 -m http.server`.

## Dipendenze dei servizi terzi

Il proxy CORS e il convertitore RSS sono servizi pubblici gratuiti di terzi: vedono quali URL vengono richiesti e possono avere limiti o interruzioni. Entrambi sono sostituibili in Impostazioni con un endpoint proprio (es. un Cloudflare Worker di poche righe) usando `{url}` come segnaposto. I dati di ransomware.live sono rivendicazioni dei gruppi criminali, non verificate.

## File

`index.html`, `style.css`, `app.js` (interfaccia), `core.js` (sorgenti, normalizzazione, gravità, IndexedDB; condiviso con il service worker), `sw.js`, `manifest.webmanifest`, `countries.json` (centroidi e nomi IT/EN da `world-countries`, ODbL), `icons/`.
