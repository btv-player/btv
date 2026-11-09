# Installare BTV

BTV è un lettore: dopo l'installazione è vuoto e si aggiunge la propria playlist (o l'accesso con utente e
password del proprio fornitore). Funziona solo come app su TV e chiavette: non esiste una versione web o per telefono.

| Dispositivo | Come si installa | Aggiornamenti |
|---|---|---|
| **Fire TV Stick / Fire TV** | app Downloader, 5 minuti | dall'app, su conferma |
| **Android TV / Google TV** (Sony, Philips, TCL, Xiaomi, Chromecast con Google TV, box Android) | app Downloader, 5 minuti | dall'app, su conferma |
| **LG (webOS)** | modalità sviluppatore + PC | dal PC, con lo stesso comando |
| **Samsung (Tizen)** | modalità sviluppatore + PC (più laborioso) | dal PC |
| Altre TV (Hisense VIDAA, Panasonic, Toshiba non Android…) | non supportate | consigliata una Fire TV Stick |

---

## Fire TV Stick / Fire TV

1. Sulla Fire TV, nella ricerca, cerca e installa l'app gratuita **Downloader** (di AFTVnews).
2. Vai su **Impostazioni → La mia Fire TV → Opzioni sviluppatore**.
   - Se non vedi "Opzioni sviluppatore": *La mia Fire TV → Informazioni* e premi **7 volte OK** su "Fire TV Stick".
3. Apri **Installa app sconosciute** e attiva **Downloader**.
4. Apri Downloader, nel campo dell'indirizzo scrivi **`btv-player.github.io/btv/apk`** e premi *Vai*.
5. Al termine del download premi **Installa**, poi **Fine** (o *Apri*).
6. Facoltativo ma consigliato: torna in *Installa app sconosciute* e **disattiva** Downloader.

BTV la trovi in **App** (tieni premuto il tasto Home → App) e puoi spostarla nella barra principale.

**Aggiornamenti:** quando esce una versione nuova, nella Home di BTV, accanto a Impostazioni, compare
**"Aggiornamento x.y.z"**. Premendolo l'app scarica e verifica la nuova versione e Android chiede conferma.
La prima volta Android chiede anche di consentire a BTV di installare app: si apre l'impostazione, la attivi e premi di nuovo.

## Android TV / Google TV

Stessa procedura della Fire TV:

1. Dal **Google Play Store** della TV installa **Downloader** (di AFTVnews).
2. *Impostazioni → Privacy / Sicurezza e restrizioni → App sconosciute* (il nome cambia un po' da marca a marca):
   attiva **Downloader**.
   - Su Google TV prima abilita le opzioni sviluppatore: *Impostazioni → Sistema → Informazioni → Build del sistema
     operativo Android TV*, premi OK 7 volte.
3. In Downloader scrivi **`btv-player.github.io/btv/apk`**, poi **Installa**.

Aggiornamenti come sulla Fire TV.

## LG (webOS)

Serve un PC Windows con il progetto BTV e una TV LG sulla stessa rete Wi-Fi.

1. Dal PC crea un account gratuito su **webostv.developer.lge.com** (*Sign In*).
2. Sulla TV, dal **LG Content Store** installa l'app **Developer Mode** e accedi con quell'account.
3. Attiva **Dev Mode Status** (la TV si riavvia), riapri l'app e attiva **Key Server**.
   L'app mostra l'indirizzo IP della TV e una passphrase.
4. Dal PC, nella cartella del progetto:

   ```
   powershell -ExecutionPolicy Bypass -File .\tools\install-lg.ps1 192.168.1.XX
   ```

   (al posto di `192.168.1.XX` l'IP della TV). La prima volta chiede la passphrase mostrata sulla TV.
5. **Spegni Key Server** nell'app Developer Mode: serviva solo per collegare il PC.

**Limiti di LG:** la modalità sviluppatore dura **50 ore**; per rinnovarla apri Developer Mode e premi
**Extend Session**, altrimenti BTV smette di aprirsi. Gli aggiornamenti si fanno rilanciando lo stesso comando dal PC
(BTV segnala quando c'è una versione nuova). Per un'installazione senza scadenze bisogna pubblicare BTV sul
LG Content Store (gratuito, con revisione di LG).

## Samsung (Tizen)

È la più laboriosa: Samsung richiede un certificato personale.

1. Sul PC installa **Tizen Studio** con il *Certificate Manager* e le estensioni *Samsung TV*.
2. Sulla TV: *App* → digita **12345** con il telecomando → attiva **Developer mode** e inserisci l'IP del PC → riavvia la TV.
3. In Certificate Manager crea un certificato **Samsung** (serve un account Samsung) che includa la TV.
4. Dal PC: `npm run build:tizen`, poi crea il pacchetto e installalo (comandi nel README, sezione *Samsung Smart TV*).

Anche qui, per un'installazione stabile bisogna pubblicare l'app sul Samsung Seller Office (gratuito, con revisione).

## Altre TV

Hisense (VIDAA), Panasonic, Toshiba e altre TV con sistemi proprietari non permettono di installare app esterne.
La soluzione più semplice ed economica è una **Fire TV Stick** collegata alla presa HDMI.

---

## Sicurezza: cosa fare dopo l'installazione

- Fire TV / Android TV: disattiva *Installa app sconosciute* per Downloader; disattiva *Debug ADB* se lo avevi acceso.
- LG: spegni *Key Server* nell'app Developer Mode.
- Installa BTV solo dall'indirizzo ufficiale `btv-player.github.io/btv/apk`: gli aggiornamenti vengono accettati
  solo se firmati con la stessa chiave dell'app installata.
