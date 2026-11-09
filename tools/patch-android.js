// Adatta il progetto Android generato da Capacitor (8) a Fire TV / Android TV e aggiunge le parti native di BTV.
// Idempotente: si può rieseguire dopo ogni "cap sync" o dopo aver rigenerato la cartella android/.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = path.join(root, 'android', 'app');
const main = path.join(app, 'src', 'main');
const manifestPath = path.join(main, 'AndroidManifest.xml');
if (!fs.existsSync(manifestPath)) {
  console.error('Progetto Android non trovato: esegui prima "npx cap add android".');
  process.exit(1);
}
const capCfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const appId = capCfg.appId;

// ---------------------------------------------------------------- AndroidManifest.xml
let m = fs.readFileSync(manifestPath, 'utf8');
const features =
  '    <uses-feature android:name="android.software.leanback" android:required="false" />\n' +
  '    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />\n';
if (!m.includes('android.software.leanback')) m = m.replace(/(<application)/, features + '\n    $1');
if (!m.includes('android:banner=')) m = m.replace(/<application/, '<application\n        android:banner="@drawable/banner"');
// I flussi IPTV sono quasi sempre http: senza questo non partirebbero.
if (!m.includes('android:usesCleartextTraffic=')) m = m.replace(/<application/, '<application\n        android:usesCleartextTraffic="true"');
if (!m.includes('LEANBACK_LAUNCHER')) {
  m = m.replace(/(<category android:name="android.intent.category.LAUNCHER"\s*\/>)/,
    '$1\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />');
}
if (!m.includes('android:screenOrientation=')) {
  m = m.replace(/(android:name="\.MainActivity")/, '$1\n            android:screenOrientation="landscape"');
}
// Niente backup automatico dei dati: conterrebbero gli indirizzi delle playlist (con utente e password).
m = m.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
// Aggiornamento su conferma: l'app può aprire l'installatore di Android (che chiede sempre conferma all'utente).
if (!m.includes('REQUEST_INSTALL_PACKAGES')) {
  m = m.replace(/(<uses-permission android:name="android.permission.INTERNET" \/>)/,
    '$1\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />');
}
fs.writeFileSync(manifestPath, m);

// FileProvider: espone solo la cartella degli aggiornamenti scaricati (Capacitor di serie espone tutta la memoria esterna).
fs.writeFileSync(path.join(main, 'res', 'xml', 'file_paths.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '    <cache-path name="updates" path="updates/" />\n</paths>\n');

// ---------------------------------------------------------------- Icone e banner
const assets = path.join(root, 'assets');
const res = path.join(main, 'res');
fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
fs.copyFileSync(path.join(assets, 'banner-320x180.png'), path.join(res, 'drawable', 'banner.png'));
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true }); // icona "adattiva" di Capacitor
fs.readdirSync(res).filter(d => d.startsWith('mipmap-')).forEach(d => {
  ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'].forEach(f => {
    if (fs.existsSync(path.join(res, d, f))) fs.copyFileSync(path.join(assets, 'icon-192.png'), path.join(res, d, f));
  });
});
const stringsPath = path.join(res, 'values', 'strings.xml');
fs.writeFileSync(stringsPath, fs.readFileSync(stringsPath, 'utf8')
  .replace(/(name="(?:app_name|title_activity_main)">)[^<]*/g, '$1' + capCfg.appName)
  .replace(/(name="(?:package_name|custom_url_scheme)">)[^<]*/g, '$1' + appId));

// ---------------------------------------------------------------- Codice nativo
const javaRoot = path.join(main, 'java');
const javaDir = path.join(javaRoot, ...appId.split('.'));
fs.mkdirSync(javaDir, { recursive: true });
// via eventuali cartelle di identificativi precedenti
(function clean(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (!e.isDirectory()) return;
    if (!javaDir.startsWith(p)) fs.rmSync(p, { recursive: true, force: true });
    else if (p !== javaDir) clean(p);
  });
})(javaRoot);

fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), `package ${appId};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Generato da tools/patch-android.js: non modificare a mano.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScreenPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);

fs.writeFileSync(path.join(javaDir, 'ScreenPlugin.java'), `package ${appId};

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.WindowManager;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

// Generato da tools/patch-android.js: non modificare a mano.
@CapacitorPlugin(name = "Screen")
public class ScreenPlugin extends Plugin {
    // Unica fonte accettata per gli aggiornamenti (le release del progetto su GitHub).
    private static final String UPDATE_PREFIX = "https://github.com/btv-player/btv/releases/download/";
    private static final long MAX_APK = 100L * 1024 * 1024;

    // Schermo sempre acceso mentre si guarda (niente salvaschermo).
    @PluginMethod
    public void keepOn(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    // Aggiornamento su richiesta dell'utente: scarica l'APK, ne verifica l'impronta SHA-256 e apre l'installatore
    // di Android, che chiede conferma e accetta solo un APK firmato con la stessa chiave dell'app installata.
    @PluginMethod
    public void installUpdate(PluginCall call) {
        final String url = call.getString("url", "");
        final String sha = call.getString("sha256", "").toLowerCase(Locale.ROOT);
        if (!url.startsWith(UPDATE_PREFIX) || !sha.matches("[0-9a-f]{64}")) { call.reject("Aggiornamento non valido"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(i);
            } catch (Exception e) { /* alcune Fire TV gestiscono il permesso solo dalle Impostazioni */ }
            call.reject("PERMESSO");
            return;
        }
        new Thread(() -> {
            File out = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("cartella");
                out = new File(dir, "btv-update.apk");
                URL u = new URL(url);
                HttpURLConnection c;
                int redirects = 0;
                while (true) {
                    c = (HttpURLConnection) u.openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String loc = c.getHeaderField("Location");
                        c.disconnect();
                        u = new URL(u, loc);
                        if (!"https".equals(u.getProtocol()) || ++redirects > 5) throw new IOException("reindirizzamento non sicuro");
                        continue;
                    }
                    if (code != 200) throw new IOException("HTTP " + code);
                    break;
                }
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                long total = 0;
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                        if (total > MAX_APK) throw new IOException("file troppo grande");
                        md.update(buf, 0, n);
                        fo.write(buf, 0, n);
                    }
                } finally {
                    c.disconnect();
                }
                StringBuilder hex = new StringBuilder();
                for (byte b : md.digest()) hex.append(String.format("%02x", b));
                if (!hex.toString().equals(sha)) throw new IOException("impronta non corrispondente");
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                if (out != null) out.delete();
                call.reject(e.getMessage() != null ? e.getMessage() : "errore");
            }
        }).start();
    }
}
`);

// ---------------------------------------------------------------- build.gradle
// Numero di versione da APP_VERSION (Android aggiorna solo se sale) e firma "release" con la chiave personale,
// letta solo da variabili d'ambiente impostate da build-apk.ps1.
const gradlePath = path.join(app, 'build.gradle');
let g = fs.readFileSync(gradlePath, 'utf8');
const appJs = fs.readFileSync(path.join(root, 'www', 'js', 'app.js'), 'utf8');
const ver = (/APP_VERSION\s*=\s*'(\d+)\.(\d+)\.(\d+)'/.exec(appJs) || []).slice(1).map(Number);
if (ver.length === 3) {
  g = g.replace(/versionCode \d+/, 'versionCode ' + (ver[0] * 10000 + ver[1] * 100 + ver[2]))
       .replace(/versionName "[^"]*"/, 'versionName "' + ver.join('.') + '"');
}
g = g.replace(/applicationId "[^"]*"/, 'applicationId "' + appId + '"');
if (!g.includes('BTV_STORE_FILE')) {
  g = g.replace(/(\n    buildTypes \{)/, `
    signingConfigs {
        release {
            if (project.hasProperty('BTV_STORE_FILE')) {
                storeFile file(project.property('BTV_STORE_FILE'))
                storePassword project.property('BTV_STORE_PASSWORD')
                keyAlias 'btv'
                keyPassword project.property('BTV_STORE_PASSWORD')
            }
        }
    }$1`);
  g = g.replace(/release \{(\s*)minifyEnabled false/, 'release {$1signingConfig signingConfigs.release$1minifyEnabled false');
}
fs.writeFileSync(gradlePath, g);

console.log('Progetto Android adattato per Fire TV / Android TV (' + appId + ', versione ' + ver.join('.') + ').');
