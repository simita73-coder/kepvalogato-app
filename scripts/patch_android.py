"""A `npx cap add android` által létrehozott Android-projekt kiegészítése:
- engedélyek a AndroidManifest.xml-ben (minden fájl kezelése),
- a saját fájlkezelő plugin és a MainActivity bemásolása.
A GitHub Actions futtatja, a projekt gyökeréből: python3 scripts/patch_android.py
"""
import json
import pathlib
import sys

cfg = json.loads(pathlib.Path("capacitor.config.json").read_text(encoding="utf-8"))
app_id = cfg["appId"]
root = pathlib.Path("android")
if not root.is_dir():
    sys.exit("Nincs android mappa: előbb futtasd az `npx cap add android` parancsot.")

# 1) engedélyek
manifest = root / "app/src/main/AndroidManifest.xml"
text = manifest.read_text(encoding="utf-8")
perms = [
    "android.permission.MANAGE_EXTERNAL_STORAGE",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
]
add = "".join(f'    <uses-permission android:name="{p}" />\n' for p in perms if p not in text)
if add:
    if "<application" not in text:
        sys.exit("A manifestben nincs <application> elem.")
    text = text.replace("<application", add + "    <application", 1)
    manifest.write_text(text, encoding="utf-8")
print("Manifest rendben:", [p for p in perms if p in manifest.read_text(encoding="utf-8")])

# 2) plugin + MainActivity a csomagnak megfelelő mappába
pkg_dir = root / "app/src/main/java" / pathlib.Path(*app_id.split("."))
pkg_dir.mkdir(parents=True, exist_ok=True)
for name in ("AllFilesPlugin.java", "MainActivity.java"):
    src = pathlib.Path("android-extra") / name
    (pkg_dir / name).write_text(src.read_text(encoding="utf-8").replace("__PACKAGE__", app_id), encoding="utf-8")
    print("Bemásolva:", pkg_dir / name)

# 3) állandó aláírókulcs: így az új verzió ráfrissíthető a régire (a beállítások megmaradnak)
import shutil
shutil.copyfile("android-extra/debug.keystore", root / "app/debug.keystore")
gradle = root / "app/build.gradle"
g = gradle.read_text(encoding="utf-8")
if "debug.keystore" not in g:
    g += """

// Állandó debug aláírás (a patch_android.py adta hozzá)
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
}
"""
    gradle.write_text(g, encoding="utf-8")
print("Aláírókulcs beállítva.")
