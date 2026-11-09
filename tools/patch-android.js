// Adatta il progetto Android generato da Capacitor a Fire TV / Android TV:
// launcher "leanback", banner, niente touchscreen obbligatorio, traffico HTTP consentito.
// Idempotente: si può rieseguire dopo ogni "cap sync".
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(manifestPath)) {
  console.error('Progetto Android non trovato: esegui prima "npm run android:init".');
  process.exit(1);
}

let m = fs.readFileSync(manifestPath, 'utf8');

const features =
  '    <uses-feature android:name="android.software.leanback" android:required="false" />\n' +
  '    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />\n';
if (!m.includes('android.software.leanback')) m = m.replace(/(<application)/, features + '\n    $1');

if (!m.includes('android:banner=')) m = m.replace(/<application/, '<application\n        android:banner="@drawable/banner"');
if (!m.includes('android:usesCleartextTraffic=')) m = m.replace(/<application/, '<application\n        android:usesCleartextTraffic="true"');

if (!m.includes('LEANBACK_LAUNCHER')) {
  m = m.replace(/(<category android:name="android.intent.category.LAUNCHER"\s*\/>)/,
    '$1\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />');
}
// Il telecomando non ha bisogno della tastiera di sistema all'avvio e lo schermo è sempre orizzontale.
if (!m.includes('android:screenOrientation=')) {
  m = m.replace(/(<activity[^>]*?android:name="[^"]*MainActivity")/, '$1\n            android:screenOrientation="landscape"');
}
// Niente backup automatico dei dati dell'app: conterrebbero gli URL delle playlist (con utente e password).
m = m.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
fs.writeFileSync(manifestPath, m);

// Banner 320x180 richiesto dal launcher di Fire TV / Android TV.
const assets = path.join(root, 'assets');
if (!fs.existsSync(path.join(assets, 'banner-320x180.png'))) require('./make-icons.js');
const drawable = path.join(root, 'android', 'app', 'src', 'main', 'res', 'drawable');
fs.mkdirSync(drawable, { recursive: true });
fs.copyFileSync(path.join(assets, 'banner-320x180.png'), path.join(drawable, 'banner.png'));

// Icona dell'app (lista app di Fire TV / Android): sostituisce quelle predefinite di Capacitor.
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true }); // icona "adattiva" di Capacitor
fs.readdirSync(res).filter(d => d.startsWith('mipmap-')).forEach(d => {
  ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'].forEach(f => {
    if (fs.existsSync(path.join(res, d, f))) fs.copyFileSync(path.join(assets, 'icon-192.png'), path.join(res, d, f));
  });
});

// Plugin nativo "Screen": tiene lo schermo acceso mentre si guarda (niente salvaschermo di Fire TV).
const javaDir = path.join(root, 'android', 'app', 'src', 'main', 'java', 'org', 'liberatv', 'app');
fs.mkdirSync(javaDir, { recursive: true });
fs.writeFileSync(path.join(javaDir, 'ScreenPlugin.java'), `package org.liberatv.app;

import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Generato da tools/patch-android.js: non modificare a mano.
@CapacitorPlugin(name = "Screen")
public class ScreenPlugin extends Plugin {
    @PluginMethod
    public void keepOn(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }
}
`);
fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), `package org.liberatv.app;

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

// build.gradle: numero di versione preso da APP_VERSION (serve per aggiornare l'app senza disinstallarla)
// e firma "release" con la chiave personale, letta solo da variabili d'ambiente impostate da build-apk.ps1.
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
let g = fs.readFileSync(gradlePath, 'utf8');
const appJs = fs.readFileSync(path.join(root, 'www', 'js', 'app.js'), 'utf8');
const ver = (/APP_VERSION\s*=\s*'(\d+)\.(\d+)\.(\d+)'/.exec(appJs) || []).slice(1).map(Number);
// Identificativo e nome dell'app presi da capacitor.config.json (il package Java interno resta org.liberatv.app: invisibile).
const capCfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
g = g.replace(/applicationId "[^"]*"/, 'applicationId "' + capCfg.appId + '"');
const stringsPath = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (fs.existsSync(stringsPath)) {
  fs.writeFileSync(stringsPath, fs.readFileSync(stringsPath, 'utf8')
    .replace(/(name="(?:app_name|title_activity_main)">)[^<]*/g, '$1' + capCfg.appName)
    .replace(/(name="(?:package_name|custom_url_scheme)">)[^<]*/g, '$1' + capCfg.appId));
}
if (ver.length === 3) {
  g = g.replace(/versionCode \d+/, 'versionCode ' + (ver[0] * 10000 + ver[1] * 100 + ver[2]))
       .replace(/versionName "[^"]*"/, 'versionName "' + ver.join('.') + '"');
}
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

console.log('Progetto Android adattato per Fire TV / Android TV.');
