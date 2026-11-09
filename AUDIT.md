# Audit BTV — sicurezza e ottimizzazione (10/11/2026)

Punto di ripristino prima dell'audit: tag git `pre-audit-2026-11-10` (commit `91b0932`).
Ogni gruppo di correzioni ha un commit separato, annullabile con `git revert <commit>`.

## Fase 0 — Architettura e flusso dei dati

- **Stack:** JavaScript ES5 senza framework né bundler (per funzionare sui browser delle TV dal 2017), HTML/CSS.
  Librerie: hls.js 1.7.4 (lettore HLS), pako 2.2 (gzip della guida), qrcode-generator, TweetNaCl (firme).
- **Piattaforme:** Fire TV / Android TV (APK con Capacitor 8, WebView), LG webOS e Samsung Tizen (pacchetti web).
  Nessuna versione web o per telefono: il lettore non è pubblicato e nel browser parte solo in locale.
- **Backend:** nessuno. Le richieste ai provider partono dal dispositivo (su Android via HTTP nativo di Capacitor,
  senza CORS; su TV via `fetch`). Unico server: `tools/serve.js`, solo sviluppo, solo `127.0.0.1`.
  Servizi esterni: GitHub Pages (presentazione, numero di versione, aggiornamenti firmati), ntfy.sh (solo durante
  "Aggiungi dal telefono", dati cifrati).
- **Flusso:** playlist da URL, dal telefono (cifrata) o da login Xtream (server+utente+password → URL `get.php`) →
  download (limite 60 MB) → parsing M3U sul thread principale → copia in `localStorage` (`cache:<id>`) →
  guida XMLTV (dalla playlist e/o aggiunte) scaricata, decompressa e analizzata in un Web Worker → abbinamento ai
  canali → copia compatta 6 ore (`epg:<id>`) → riproduzione con hls.js (o lettore nativo) con timeshift.

---

## 1. Corretto

| Sev. | Cosa | Perché | File | Commit |
|---|---|---|---|---|
| Media | La lista canali sopra il video creava fino a 3000 righe insieme | Con playlist grandi l'apertura bloccava la TV per secondi | `www/js/app.js` | `196bff1` |
| Bassa | `channelByUrl` scorreva tutti i canali a ogni chiamata (la Home la usa per ogni riga ogni 30 s) | Con 10.000+ canali spreco di CPU continuo | `www/js/app.js` | `196bff1` |

Verifica dopo il gruppo (playlist reale, 258 canali): caricamento playlist OK, guida 258/258, lista canali OK,
riproduzione Rai 1 (hls.js) OK, cambio canale OK, lista sopra il video OK (righe create man mano), ritorno alla Home OK.

### Aree verificate e già a posto (nessuna correzione necessaria)
- **XSS:** tutti i testi da playlist/guida (nomi, gruppi, programmi, descrizioni) sono inseriti come testo
  (`textContent`); gli unici `innerHTML` contengono testo fisso o icone dell'app. Loghi solo `http(s)`/`data:image`.
- **XML della guida:** analizzatore proprio, non interpreta DTD/entità esterne (niente XXE né "billion laughs");
  scansione lineare; limiti: 60 MB scaricati, 160 MB decompressi (gzip bomb fermata), Worker fermato dopo 90 s.
- **Segreti:** nessuna chiave, token o file `.env` nel repository; chiavi di firma fuori dal progetto
  (`%USERPROFILE%\.btv`), escluse da git; scansione segreti e blocco attivi su GitHub.
- **Log:** l'unico messaggio di diagnostica maschera l'URL (mostra solo l'host); in Impostazioni gli URL personali
  sono mascherati.
- **Dipendenze:** `npm audit` = 0 vulnerabilità; hls.js all'ultima versione; Capacitor 8 (attuale).
- **Piattaforma:** CSP senza script esterni, frame o plugin; debug WebView spento; backup Android disattivato;
  FileProvider limitato agli aggiornamenti; solo l'attività principale è esportata.
- **Aggiornamenti:** Android installa solo APK con impronta SHA-256 corretta e firmati con la stessa chiave;
  TV accettano solo codice con firma Ed25519 valida, più nuovo, con ritorno automatico se non parte.
- **Proxy di sviluppo:** ascolta solo `127.0.0.1`, controlla l'host, blocca IP privati (anche dopo DNS e redirect).
- **Docker/deploy:** non presenti. GitHub Actions con versioni bloccate su SHA e permessi minimi.
- **Player:** al cambio canale hls.js viene distrutto (annulla le richieste in corso); listener aggiunti una sola volta;
  riavvio automatico se il video si blocca (fino a 3 volte).

### Modifiche fatte prima di questo audit che possono bloccare qualcosa (per trasparenza, annullabili)
- **Indirizzi della rete di casa bloccati** se la playlist non è anch'essa in casa (protegge router e NAS da
  playlist ostili). Effetto: un server IPTV locale funziona solo se anche la playlist sta in rete locale.
- **Solo flussi `http`/`https`:** link `rtmp://`, `rtsp://`, `udp://` vengono rifiutati (hls.js non li riproduce comunque;
  il lettore nativo di qualche TV forse sì).

---

## 2. Da approvare

| Sev. | Rischio concreto | Fix proposto | Cosa cambierebbe per te |
|---|---|---|---|
| **Alta** | L'app **"Auto Dev Token Refresh"** (webOS Homebrew, autore "LucifersCircle") invia il token della modalità sviluppatore della TV a un **server di terzi** (`lg.pirate.vodka`), che poi lo usa da solo. Chi gestisce quel server ottiene una credenziale della tua TV ed è un punto unico di guasto. | Non renderla obbligatoria. Alternativa: rinnovo automatico fatto da **un'attività GitHub nostra** (una volta al giorno chiama direttamente LG, il token sta in un segreto cifrato di GitHub; nessun terzo). | Una configurazione iniziale con la TV accesa (leggo il token dalla TV una volta); poi niente da ricordare. |
| Media | Pubblicare chiede ogni volta la password delle chiavi di firma (scomodo). | Password **casuale generata dal PC** e salvata cifrata con il tuo account Windows (DPAPI): la pubblicazione non chiede più nulla. Più una copia di sicurezza esportabile. | Non digiti più password per pubblicare. Le chiavi restano protette dal tuo account Windows; se cambi PC serve la copia di sicurezza. |
| Media | Download di playlist e guida **senza timeout**: un server che non risponde lascia l'app in attesa (la guida resta "in caricamento"). | Timeout di 90 s per la playlist e 180 s per la guida. | Un download lentissimo (oltre quei tempi) verrebbe interrotto e riprovato dopo; oggi aspetterebbe all'infinito. |
| Bassa | Credenziali (URL playlist, utente/password Xtream) salvate **in chiaro** nella memoria dell'app. Su Fire TV la memoria è privata dell'app (backup disattivato, APK release non ispezionabile); su LG in modalità sviluppatore è raggiungibile da chi ha la chiave SSH della TV. | Nessun fix efficace senza password all'avvio (una cifratura con chiave dentro l'app non protegge davvero). | Servirebbe un PIN all'avvio: un passaggio in più. Consiglio di **non** farlo. |
| Bassa | `pako` 3 (nuova major) | Non aggiornare: la 3 non funziona sui browser delle TV vecchie; la 2.2 non ha vulnerabilità note. | Nessuno (resta così). |

---

## 3. Non risolto / solo sospetto

| Sev. | Problema | Stato |
|---|---|---|
| Media | **Redirect verso la rete di casa:** il blocco degli IP locali controlla l'indirizzo iniziale; se un server esterno reindirizza verso `192.168.x.x`, il browser della TV lo segue. | Non risolvibile lato web (il browser non espone i redirect). Effetto limitato: richieste "alla cieca", senza poter leggere risposte da altri siti. |
| Media | **Browser della LG (Chromium 68, 2020)** con vulnerabilità note non aggiornabili. | Mitigato: nessun codice esterno, CSP, solo codice firmato. Dipende da LG. |
| Bassa | **CSP con `'unsafe-inline'`** per gli script: richiesto da Capacitor e dall'avvio firmato delle TV. | Accettato: non c'è HTML costruito da dati esterni, quindi nessun punto d'iniezione noto. |
| Bassa | **TV molto vecchie senza Web Worker:** la guida si analizza sul thread principale, senza il limite dei 90 s. | Non verificato su TV reali (tutte le TV supportate dal 2017 hanno i Worker). |
| Bassa | **hls.js sulle TV:** l'aggiornamento firmato delle TV aggiorna il codice dell'app, non le librerie (hls.js, qrcode, nacl). | Si aggiornano con un'installazione dal PC; raramente necessario. |
| Bassa | **ntfy.sh** (servizio di terzi) per "Aggiungi dal telefono": vede l'IP e dati cifrati, solo nei 15 minuti in cui la finestra è aperta. | Accettato. |
| Info | **Playlist enormi (50.000+ canali):** parsing M3U sul thread principale, tutto in memoria; griglia, Home e lista già a blocchi. | Non misurato su TV con playlist così grandi: possibile pausa di qualche secondo al caricamento. |
| Info | **Prestazioni sulla LG** dopo le ottimizzazioni 1.8.8: misurate solo sul PC. | Da misurare sulla TV (fotogrammi persi) quando è libera. |
