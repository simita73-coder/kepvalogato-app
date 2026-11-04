package __PACKAGE__;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Egyszerű fájlkezelő plugin a "minden fájl kezelése" engedéllyel.
 * Az útvonalak a belső tárhely gyökeréhez viszonyítottak (pl. "Download/PINT_01/kep.jpg").
 */
@CapacitorPlugin(name = "AllFiles")
public class AllFilesPlugin extends Plugin {

    private File root() {
        return Environment.getExternalStorageDirectory();
    }

    private boolean granted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return true; // régebbi Androidon a manifestben kért hagyományos engedély számít
    }

    /** A gyökérhez viszonyított útvonalat fájllá alakítja, és a gyökéren kívüli útvonalat elutasítja. */
    private File resolve(String rel) throws IOException {
        if (rel == null) {
            throw new IOException("hiányzó útvonal");
        }
        File f = new File(root(), rel);
        String rootPath = root().getCanonicalPath();
        String p = f.getCanonicalPath();
        if (!p.equals(rootPath) && !p.startsWith(rootPath + File.separator)) {
            throw new IOException("az útvonal a tárhelyen kívülre mutat");
        }
        return f;
    }

    private static String msg(Exception e) {
        return e.getMessage() == null ? e.toString() : e.getMessage();
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        r.put("root", root().getAbsolutePath());
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("granted", granted());
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            String pkg = getContext().getPackageName();
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + pkg));
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        try {
            File dir = resolve(call.getString("path", ""));
            File[] items = dir.listFiles();
            if (items == null) {
                call.reject("A mappa nem olvasható (nincs engedély, vagy nem létezik): " + dir.getPath());
                return;
            }
            JSArray arr = new JSArray();
            for (File f : items) {
                JSObject o = new JSObject();
                o.put("name", f.getName());
                o.put("dir", f.isDirectory());
                o.put("size", f.length());
                arr.put(o);
            }
            JSObject r = new JSObject();
            r.put("files", arr);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    @PluginMethod
    public void mkdirs(PluginCall call) {
        try {
            File d = resolve(call.getString("path"));
            if (d.isDirectory() || d.mkdirs()) {
                call.resolve();
            } else {
                call.reject("A mappa nem hozható létre: " + d.getPath());
            }
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    @PluginMethod
    public void writeBase64(PluginCall call) {
        try {
            File f = resolve(call.getString("path"));
            String data = call.getString("data");
            if (data == null) {
                call.reject("hiányzó adat");
                return;
            }
            File parent = f.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                call.reject("A mappa nem hozható létre: " + parent.getPath());
                return;
            }
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            OutputStream out = new FileOutputStream(f);
            try {
                out.write(bytes);
            } finally {
                out.close();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    @PluginMethod
    public void move(PluginCall call) {
        try {
            File from = resolve(call.getString("from"));
            File to = resolve(call.getString("to"));
            if (!from.exists()) {
                call.reject("A forrás nem létezik: " + from.getPath());
                return;
            }
            if (to.exists()) {
                call.reject("A cél már létezik: " + to.getPath());
                return;
            }
            File parent = to.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                call.reject("A célmappa nem hozható létre: " + parent.getPath());
                return;
            }
            if (!from.renameTo(to)) {
                copy(from, to);
                if (!from.delete()) {
                    call.reject("Átmásolva, de a forrás nem törölhető: " + from.getPath());
                    return;
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    /** Törlés: biztonsági okból csak a Download/KV_proba mappa alatt engedélyezett (próbafájlok takarítása). */
    @PluginMethod
    public void removeTest(PluginCall call) {
        try {
            String rel = call.getString("path");
            if (rel == null || !rel.startsWith("Download/KV_proba")) {
                call.reject("Csak a Download/KV_proba alatti útvonal törölhető");
                return;
            }
            File f = resolve(rel);
            if (f.exists() && !deleteRec(f)) {
                call.reject("Nem sikerült mindent törölni: " + f.getPath());
                return;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    private boolean deleteRec(File f) {
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File c : children) {
                    deleteRec(c);
                }
            }
        }
        return f.delete();
    }

    private void copy(File from, File to) throws IOException {
        InputStream in = new FileInputStream(from);
        try {
            OutputStream out = new FileOutputStream(to);
            try {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
            } finally {
                out.close();
            }
        } finally {
            in.close();
        }
    }
}
