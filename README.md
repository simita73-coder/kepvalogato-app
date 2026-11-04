# Képválogató – Android fájlmozgatás próba

Kis Android-alkalmazás, amely azt próbálja ki, hogy a telefon engedi-e a képek beolvasását és
áthelyezését mappák között. A GitHub Actions automatikusan felépíti belőle az APK-t.

## Hogyan készül az APK
Minden feltöltésnél (push a `main` ágra) a `.github/workflows/build-apk.yml` lefut:
1. felépíti a weboldalt (`src/main.js` → `www/app.js`),
2. létrehozza az Android-projektet (`npx cap add android`),
3. hozzáadja az engedélyeket és a saját plugint (`scripts/patch_android.py`, `android-extra/`),
4. megépíti az APK-t, és kiteszi a **Releases** oldalra `kepvalogato-proba.apk` néven.

Letöltési hivatkozás (a saját felhasználónévvel és projektnévvel):
`https://github.com/<felhasznalonev>/<projekt>/releases/latest/download/kepvalogato-proba.apk`

## Fájlok
- `src/main.js` – a próba oldal logikája
- `www/index.html` – a próba oldal
- `android-extra/AllFilesPlugin.java` – kis fájlkezelő plugin (java.io.File, "minden fájl kezelése" engedéllyel)
- `android-extra/MainActivity.java` – a plugin regisztrálása
- `scripts/patch_android.py` – a generált Android-projekt kiegészítése
