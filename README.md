# Képválogató (Android, v2.0)

Telefonon futó képválogató: a képet egy gombnyomásra közvetlenül a megfelelő mappába helyezi át
(nincs txt, nincs Windowsos szétdobás). A mappagombok a kiválasztott **célmappa almappái**.

## Használat
1. Első indításkor: **Engedély megadása** → kapcsold be a „Minden fájl kezelése" engedélyt.
2. **Képek mappája**: ahonnan válogat (opcionálisan az almappákkal együtt).
3. **Célmappa**: a gyökér, amelynek almappái a kategóriák. A mappaválasztóban új mappát is lehet létrehozni.
4. **Indítás**. Koppints a képre → gombok; dupla koppintás = nagyítás; húzás = lapozás;
   jobbra-vissza húzás = fájlnév; **↩ Vissza** visszamozgatja az utolsó képet (újraindítás után is).

## Az APK készítése
Minden feltöltésnél (push a `main` ágra) a `.github/workflows/build-apk.yml` lefut, és a **Releases** oldalra kiteszi:
`https://github.com/<felhasznalonev>/<projekt>/releases/latest/download/kepvalogato-proba.apk`

Az APK állandó aláírókulccsal készül (`android-extra/debug.keystore`), ezért az új verzió
a régire közvetlenül ráfrissíthető, a beállítások megmaradnak.

## Fájlok
- `www/index.html`, `src/main.js` – a képválogató
- `www/proba.html`, `src/proba.js` – fájlmozgatási diagnosztika (az appból a beállítások alján érhető el)
- `android-extra/AllFilesPlugin.java` – fájlkezelő plugin (java.io.File, „minden fájl kezelése" engedéllyel)
- `android-extra/MainActivity.java` – a plugin regisztrálása
- `android-extra/debug.keystore` – állandó debug aláírókulcs
- `scripts/patch_android.py` – a generált Android-projekt kiegészítése (engedélyek, plugin, aláírás)
