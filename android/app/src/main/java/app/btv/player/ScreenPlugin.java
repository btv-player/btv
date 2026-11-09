package app.btv.player;

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
