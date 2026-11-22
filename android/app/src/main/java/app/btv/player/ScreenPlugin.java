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
import com.getcapacitor.JSObject;

// Generato da tools/patch-android.js: non modificare a mano.
@CapacitorPlugin(name = "Screen")
public class ScreenPlugin extends Plugin {
    // Unica fonte accettata per gli aggiornamenti (le release del progetto su GitHub).
    private static final String UPDATE_PREFIX = "https://github.com/btv-player/btv/releases/download/";
    private static final long MAX_APK = 100L * 1024 * 1024;

    // Download di playlist e guida direttamente su file (nella cache dell'app): i byte non passano dalla pagina
    // (prima arrivavano come testo base64, più del doppio della memoria) e c'è un tempo limite.
    // Se si passano etag/lastModified della volta prima e il server risponde "non cambiato" (304), il file resta quello.
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url", "");
        final String name = call.getString("name", "");
        final long max = call.getLong("max", 60L * 1024 * 1024);
        final int timeout = call.getInt("timeout", 90000);
        final String etag = call.getString("etag", "");
        final String lastMod = call.getString("lastModified", "");
        if (!(url.startsWith("http://") || url.startsWith("https://")) || !name.matches("[a-z0-9-]{1,40}")) { call.reject("richiesta non valida"); return; }
        new Thread(() -> {
            File tmp = null;
            HttpURLConnection c = null;
            try {
                File dir = new File(getContext().getCacheDir(), "dl");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("cartella");
                File out = new File(dir, name);
                tmp = new File(dir, name + ".part");
                final long deadline = System.currentTimeMillis() + timeout;
                URL u = new URL(url);
                int redirects = 0, code;
                while (true) {
                    c = (HttpURLConnection) u.openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    c.setRequestProperty("Accept-Encoding", "identity");
                    if (out.exists() && !etag.isEmpty()) c.setRequestProperty("If-None-Match", etag);
                    if (out.exists() && !lastMod.isEmpty()) c.setRequestProperty("If-Modified-Since", lastMod);
                    code = c.getResponseCode();
                    if (code >= 300 && code < 400 && code != 304) {
                        String loc = c.getHeaderField("Location");
                        c.disconnect();
                        if (loc == null || ++redirects > 5) throw new IOException("troppi reindirizzamenti");
                        u = new URL(u, loc);
                        if (!"http".equals(u.getProtocol()) && !"https".equals(u.getProtocol())) throw new IOException("reindirizzamento non valido");
                        continue;
                    }
                    break;
                }
                JSObject res = new JSObject();
                if (code == 304 && out.exists()) {
                    res.put("path", out.getAbsolutePath()); res.put("status", 304); res.put("size", out.length());
                    res.put("etag", etag); res.put("lastModified", lastMod);
                    call.resolve(res);
                    return;
                }
                if (code != 200) throw new IOException("HTTP " + code);
                long len = c.getContentLengthLong();
                if (len > max) throw new IOException("file troppo grande");
                long total = 0;
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                        if (total > max) throw new IOException("file troppo grande");
                        if (System.currentTimeMillis() > deadline) throw new IOException("tempo scaduto");
                        fo.write(buf, 0, n);
                    }
                }
                if (out.exists() && !out.delete()) throw new IOException("file occupato");
                if (!tmp.renameTo(out)) throw new IOException("salvataggio");
                res.put("path", out.getAbsolutePath()); res.put("status", 200); res.put("size", total);
                String et = c.getHeaderField("ETag"), lm = c.getHeaderField("Last-Modified");
                res.put("etag", et != null ? et : ""); res.put("lastModified", lm != null ? lm : "");
                call.resolve(res);
            } catch (Exception e) {
                if (tmp != null) tmp.delete();
                call.reject(e.getMessage() != null ? e.getMessage() : "errore");
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

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
