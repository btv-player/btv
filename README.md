# BTV — lettore IPTV gratuito per Smart TV e Fire TV Stick

App 100% gratuita e open source, senza pubblicità, account o abbonamenti.
Un unico codice web (`www/`) che gira su:

| Dispositivo | Tecnologia | Come si impacchetta |
|---|---|---|
| **Fire TV Stick / Android TV / Google TV** | Capacitor (WebView Android) | APK con Android Studio |
| **Samsung Smart TV** (2017+) | Tizen web app | `.wgt` con Tizen Studio |
| **LG Smart TV** (webOS 3+) | webOS web app | `.ipk` con webOS CLI |
| Browser PC (per lo sviluppo) | — | `npm run dev` |

## Funzioni

- **Nessun contenuto incluso**: l'app è vuota, aggiungi solo le tue playlist e le tue guide
- **Accesso con utente e password** del tuo fornitore (formato Xtream Codes): canali e guida si caricano da soli
- Aggiunta di **playlist M3U/M3U8 personali** tramite URL (anche più di una)
- **Aggiungi dal telefono o dal PC**: la TV mostra un codice QR; sul telefono incolli l'indirizzo della playlist o
  della guida e lo invii. I dati viaggiano cifrati con il codice (cambia ogni volta) tramite ntfy.sh, che vede solo
  testo illeggibile. Pagina di invio: `https://btv-player.github.io/btv/invia/`
- **Icone disegnate dall'app** (niente emoji): si vedono uguali su ogni TV
- Categorie, **ricerca**, **preferiti**, numeri canale (digita il numero col telecomando)
- **Guida TV (EPG)**: programma in onda e successivo su ogni canale, pannello con il palinsesto di oggi e domani
  (quella indicata dalla playlist, più le guide `.xml` / `.xml.gz` che aggiungi tu)
- **Scelta della qualità** (Auto / 1080p / 720p / …) quando il canale la offre; la scelta viene ricordata
- **Pausa e "torna indietro"** sulla diretta (timeshift) con ⏪ 30s / ⏩ 30s / "Torna alla diretta"
- **Multivisione**: fino a 4 canali insieme (2×2), audio dal riquadro selezionato, qualità ridotta automaticamente
  nei riquadri; i canali scelti vengono ricordati
- Navigazione completa con il telecomando (frecce, OK, Indietro, Canale +/−, tasti colorati, Play/Pausa)
- Riproduzione con hls.js e, se non va, con il lettore nativo della TV
- Copia offline dell'ultima playlist e della guida scaricate
- **Riparte dall'ultimo canale** all'avvio (disattivabile), **canale precedente** con un tasto,
  **lista canali sopra il video**, **lingua audio e sottotitoli** quando il canale li offre
- **Canali non funzionanti** segnati in automatico (⚠, attenuati) e, se vuoi, nascosti; dopo 12 ore si riprovano
- Leggera: su TV e Fire TV usa meno memoria (buffer 60 MB, 60 card alla volta); la guida scarica prima quella della
  playlist e salta le altre fonti se copre già il 90% dei canali

### Telecomando

| Tasto | Elenco canali | Durante la visione |
|---|---|---|
| ◀ ▶ ▲ ▼ | muoviti | ▲ ▼ cambia canale · ◀ ▶ apre la barra sui pulsanti ⏪ / ⏩ |
| OK | apri il canale | apre la barra (se sei indietro, già sul pulsante "● Diretta") |
| Blu | — | torna in diretta |
| Indietro | torna alle categorie, poi esci (premi 2 volte) | torna all'elenco canali |
| ⏯ Play/Pausa | guida del canale selezionato | pausa / riprendi |
| ⏪ / ⏩ | — | indietro / avanti 30 s |
| Info / Verde | guida del canale selezionato | guida del canale |
| Menu (Fire TV) | aggiungi/togli preferito | lista canali sopra il video |
| Rosso | aggiungi/togli preferito | aggiungi/togli preferito |
| Giallo | — | torna al canale precedente |
| Lista canali (Samsung) | — | lista canali sopra il video |
| CH+ / CH− | scorri l'elenco | canale successivo / precedente |
| 0–9 | vai al canale numero… | vai al canale numero… |

### Multivisione

Si apre con **⊞ Multivisione** in alto nell'elenco, oppure con **⊞ Multi** nella barra durante la visione
(il canale che stai guardando va nel primo riquadro).

| Tasto | Azione |
|---|---|
| ◀ ▶ ▲ ▼ | scegli il riquadro (l'audio passa a quello selezionato) |
| OK | riquadro vuoto: scegli canale · riquadro pieno: Schermo intero / Cambia canale / Togli |
| CH+ / CH− (⏩ / ⏪) | canale successivo / precedente nel riquadro selezionato |
| 0–9 | metti il canale numero… nel riquadro selezionato |
| Info / Verde | guida del canale del riquadro |
| Indietro | esci dalla multivisione |

Da un riquadro, **Schermo intero** apre il canale a tutto schermo: **Indietro** (o il pulsante "◀ Multivisione")
riporta alla multivisione con gli stessi canali; se a schermo intero hai cambiato canale, il riquadro lo segue.

Quanti riquadri: usa i pulsanti **▯▯ 2 riquadri / ⊞ 4 riquadri** in alto nella multivisione (anche su PC, col mouse
o con ▲ dal riquadro in alto), oppure **Impostazioni → Multivisione** (*Automatico*, *2* o *4*). I canali restano
quando cambi. Automatico = **4** su PC e box
Android TV con almeno 4 GB di RAM, **2** su Fire TV Stick, Samsung e LG (hanno pochi decoder video). Su alcune TV Samsung/LG anche il secondo riquadro può non partire: in quel caso compare
un messaggio nel riquadro. Ogni canale in più consuma banda (4 canali ≈ 4 volte la connessione di uno).

### Guida TV, qualità e timeshift: cosa aspettarsi

- La guida si abbina ai canali per nome: con la lista Italia copre ~115 canali su ~345 (tutti i nazionali Rai, Mediaset,
  La7, Discovery, Pluto TV…); le TV locali di solito non hanno una guida gratuita. Si aggiorna ogni 6 ore.
- La qualità si può scegliere solo se il canale trasmette più versioni (es. Canale 5 HD: 288p → 1080p); molti canali ne hanno una sola.
- Quando non sei in diretta compare sempre, in alto a sinistra, il pulsante rosso **"● Torna in diretta"** (anche con
  la barra chiusa; cliccabile col mouse). Se il ritardo non è voluto (es. rallentamenti della rete) l'app torna in
  diretta da sola; se invece hai messo in pausa o sei tornato indietro tu, aspetta che lo decida tu.
- In multivisione il nome del canale compare solo per 3 secondi quando ti sposti, premi OK o cambi canale; resta sempre
  visibile solo l'icona 🔊 sul riquadro con l'audio. Un riquadro rimasto indietro mostra "● Diretta" e torna in diretta da solo.
- Il "torna indietro" usa la finestra di registrazione del canale (spesso 1–3 minuti) più ciò che l'app tiene in memoria
  (fino a 10 minuti sul PC, 5 minuti su TV e Fire TV Stick per non appesantirle). Non è un registratore: per rivedere
  programmi di ore fa servirebbe un provider con *catch-up*.

## Requisiti

- [Node.js](https://nodejs.org) 20 o superiore (già installato)
- Solo per l'APK: [Android Studio](https://developer.android.com/studio) (include Java e l'Android SDK)
- Solo per Samsung: [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html) con TV Extensions
- Solo per LG: [webOS TV CLI](https://webostv.developer.lge.com/develop/tools/cli-installation)

```bash
npm install
```

## Provare nel browser

```bash
npm run dev
```

Apri http://localhost:8080 e usa le frecce, Invio, Esc (= Indietro), F (= preferito), G (= guida), Spazio (= pausa),
C (= lista canali), P (= canale precedente) e L (= torna in diretta).
Il server di sviluppo include un piccolo proxy (`/proxy?url=`) perché nel browser alcune guide TV sono bloccate da CORS:
sulle TV e su Android non serve.

## Fire TV Stick: la via rapida (script)

Una volta sola, sul PC:

```bash
winget install Microsoft.OpenJDK.21
```

```bash
powershell -ExecutionPolicy Bypass -File .\tools\setup-android.ps1
```

Ogni volta che vuoi un APK nuovo (risultato: `dist\BTV.apk`):

```bash
powershell -ExecutionPolicy Bypass -File .\tools\build-apk.ps1
```

L'APK è **definitivo e firmato con la tua chiave personale**. La prima volta lo script la crea e ti chiede una password,
che non viene mai salvata. La chiave sta in `%USERPROFILE%\.btv\btv-release.p12`, fuori dal progetto:
**fanne una copia di sicurezza**, perché senza di lei non puoi più aggiornare l'app sulla TV senza perdere preferiti e impostazioni.
Per un APK di prova (i dati dell'app restano leggibili via ADB) aggiungi `-Debug`.

Sulla Fire TV: *Impostazioni → La mia Fire TV → Informazioni* → premi 7 volte OK su "Fire TV Stick" finché compare
"Sei uno sviluppatore"; poi *La mia Fire TV → Opzioni sviluppatore → Debug ADB: ON*. L'IP è in
*Informazioni → Rete*. Quindi dal PC (sostituisci l'IP):

```bash
powershell -ExecutionPolicy Bypass -File .\tools\install-firestick.ps1 192.168.1.50
```

La prima volta sulla TV compare "Consentire il debug?": scegli **Consenti** (e "consenti sempre da questo computer").

## Aggiornamenti (sicuri, solo su conferma)

Il codice dell'app è **dentro l'app**: niente viene caricato da internet all'avvio.

- All'avvio e quando torni alla Home (al massimo una volta l'ora) l'app legge `https://btv-player.github.io/btv/version.json`:
  un file statico con il numero dell'ultima versione. Non invia nessun dato (niente cookie, niente referrer).
- Se c'è una versione nuova compare **Aggiornamento x.y.z** accanto a Impostazioni. Non succede altro finché non lo premi.
- Sulla Fire TV, premendolo, l'app scarica l'APK dalle release di GitHub, ne verifica l'impronta SHA-256 e apre
  l'installatore di Android, che chiede conferma e accetta solo un APK firmato **con la tua chiave**.
- Su LG/Samsung segnala la nuova versione: si aggiorna dal PC con lo script di installazione.
- Il controllo si può spegnere in *Impostazioni → Controllo aggiornamenti*.

Per pubblicare una nuova versione: aumenta `APP_VERSION` in `www/js/app.js`, salva le modifiche in git e poi

```bash
powershell -ExecutionPolicy Bypass -File .\tools\publish-release.ps1
```

(compila l'APK firmato, lo carica come release su GitHub e solo dopo pubblica `version.json`).

## Installare BTV su altre Fire TV

Sulla Fire TV: app **Downloader** (store Amazon) → *Opzioni sviluppatore → Installa app sconosciute* per Downloader →
in Downloader scrivi `btv-player.github.io/btv/apk` (porta sempre all'ultima release). Le istruzioni sono anche nella
pagina `https://btv-player.github.io/btv/`.

## Fire TV Stick / Android TV (APK) con Android Studio

Il progetto Android è già stato generato nella cartella `android/` e adattato per la TV (launcher Leanback, banner, nessun touchscreen richiesto, stream HTTP permessi).

1. Dopo ogni modifica a `www/`: `npm run android:sync`
2. Apri il progetto: `npm run android:open` (oppure apri la cartella `android/` con Android Studio)
3. In Android Studio: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**
   L'APK si trova in `android/app/build/outputs/apk/debug/app-debug.apk`

**Installare sulla Fire TV Stick**

1. Sulla Fire TV: *Impostazioni → La mia Fire TV → Opzioni sviluppatore* → attiva **Debug ADB** e **App da fonti sconosciute**
   (se il menu non c'è: *Impostazioni → La mia Fire TV → Informazioni* e premi 7 volte OK sul nome del dispositivo)
2. Annota l'indirizzo IP (*Informazioni → Rete*)
3. Dal PC (adb è incluso in Android Studio, in `%LOCALAPPDATA%\Android\Sdk\platform-tools`):

```bash
adb connect 192.168.1.50:5555
```

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

In alternativa puoi caricare l'APK su un tuo sito/Drive e scaricarlo sulla Fire TV con l'app gratuita **Downloader**.

## Samsung Smart TV (Tizen)

```bash
npm run build:tizen
```

1. Sulla TV: apri *Apps*, digita `12345` col telecomando → attiva **Developer mode** e inserisci l'IP del PC, poi riavvia la TV
2. In Tizen Studio: *Tools → Certificate Manager* → crea un certificato **Samsung** (serve un account Samsung gratuito)
3. *Tools → Device Manager* → connetti la TV tramite IP
4. Impacchetta e installa:

```bash
tizen package -t wgt -s <nome-profilo-certificato> -- dist/tizen
```

```bash
tizen install -n dist/tizen/BTV.wgt -t <nome-tv>
```

## LG Smart TV (webOS)

```bash
npm run build:webos
```

1. Sulla TV installa l'app **Developer Mode** dal LG Content Store e accedi con un account sviluppatore LG (gratuito, su webostv.developer.lge.com)
2. Nell'app attiva *Dev Mode Status* (la TV si riavvia), riaprila e attiva *Key Server*: l'app mostra l'IP della TV e una passphrase
3. Dal PC (sostituisci l'IP; la prima volta installa da solo gli strumenti LG e ti chiede la passphrase):

```bash
powershell -ExecutionPolicy Bypass -File .\tools\install-lg.ps1 192.168.1.60
```

> Nota: la modalità sviluppatore LG scade ogni 50 ore e va rinnovata dall'app Developer Mode. Per una distribuzione stabile bisogna pubblicare sul LG Content Store (gratuito).

## Pubblicazione negli store (opzionale, gratis)

- **Amazon Appstore** (Fire TV): account sviluppatore gratuito, carichi l'APK firmato (*Build → Generate Signed Bundle / APK*)
- **Samsung Seller Office** e **LG Seller Lounge**: registrazione gratuita, revisione dell'app
- **Google Play** (Android TV): costa 25 $ una tantum — l'unico passaggio non gratuito, e del tutto facoltativo

## Struttura

```
www/                 app web (HTML/CSS/JS, nessun build step)
  js/m3u.js          parser playlist M3U
  js/epg.js          parser guida XMLTV e abbinamento ai canali
  js/epg-worker.js   analisi della guida in background (Web Worker)
  js/nav.js          navigazione col telecomando
  js/app.js          logica: elenco, lettore, guida, impostazioni
  vendor/            hls.js e pako (gzip), copiati da node_modules all'installazione
platforms/tizen/     config.xml per Samsung
platforms/webos/     appinfo.json per LG
android/             progetto Android Studio (generato da Capacitor)
tools/               script: server di sviluppo, icone, build TV, patch Android
assets/              icone e banner generati (npm run icons)
```

## Note legali

BTV è **solo un lettore**: non contiene, non ospita e non distribuisce contenuti, playlist o abbonamenti.
L'app parte vuota e ogni utente aggiunge sul proprio dispositivo solo ciò che ha il diritto di usare.
Il sito pubblicato mostra solo una pagina di presentazione.

## Prossimi passi possibili

- Griglia guida TV a tutto schermo (tutti i canali sulla stessa linea temporale)
- Catch-up ("riguarda") per le playlist che lo supportano (attributi `catchup-source`)
- Lettore nativo ExoPlayer su Android per supportare anche flussi `.ts`/MPEG-DASH
- Inserimento dell'URL della playlist dal telefono tramite QR code (scrivere URL col telecomando è scomodo)
