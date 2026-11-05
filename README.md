# Kép-videó válogató (Android, v3.0)

Telefonon futó kép- és videóválogató: a fájlt egy gombnyomásra közvetlenül a megfelelő mappába helyezi át
(nincs txt, nincs Windowsos szétdobás). A mappagombok a kiválasztott **célmappa almappái**.

## Profilok
Minden munkához külön profil tartozik (pl. „Pinterest képek", „AI képek", „YouTube videók"):
- forrásmappa (in) és célmappa (out), a profil neve alapból a forrásmappa neve (átnevezhető),
- melyik almappák legyenek gombok, az almappákból is olvasson-e,
- videók lejátszási sebessége (alap 1,2×),
- címkézés be/ki (nem kötelező).

Az Android „vissza" gombja egy szinttel visszalép (munkafelület → profillista).

## Használat
1. Első indításkor: **Engedély megadása** → kapcsold be a „Minden fájl kezelése" engedélyt.
2. **＋ Új profil**: képek mappája, célmappa (a mappaválasztóban új mappa is létrehozható), Mentés.
3. **▶ Indítás**. Koppints a képre → gombok; dupla koppintás = nagyítás (videónál szünet/lejátszás); húzás = lapozás;
   jobbra-vissza húzás = fájlnév; **↩ Vissza** visszamozgatja az utolsó fájlt (újraindítás után is).
4. Videónál alul tekerősáv, a gombpanelen sebességváltó (⏩).
5. Címkézésnél a gombpanelen **🏷 Címke**: a beírt címke a fájl besorolásakor a célmappa `cimkek.txt` fájljába kerül
   (soronként: fájlnév, tabulátor, címke). A **Vissza** a címkesort is törli.

## Az APK készítése
Minden feltöltésnél (push a `main` ágra) a `.github/workflows/build-apk.yml` lefut, és a **Releases** oldalra kiteszi:
`https://github.com/<felhasznalonev>/<projekt>/releases/latest/download/kepvalogato-proba.apk`

Az APK állandó aláírókulccsal készül (`android-extra/debug.keystore`), ezért az új verzió
a régire közvetlenül ráfrissíthető, a beállítások megmaradnak.

## Fájlok
- `www/index.html`, `src/main.js` – az alkalmazás
- `www/proba.html`, `src/proba.js` – fájlmozgatási diagnosztika (a főképernyő alján érhető el)
- `android-extra/AllFilesPlugin.java` – fájlkezelő plugin (java.io.File, „minden fájl kezelése" engedéllyel; listázás, mozgatás, szövegfájl olvasás/írás)
- `android-extra/MainActivity.java` – a plugin regisztrálása
- `android-extra/debug.keystore` – állandó debug aláírókulcs
- `scripts/patch_android.py` – a generált Android-projekt kiegészítése (engedélyek, plugin, aláírás)
