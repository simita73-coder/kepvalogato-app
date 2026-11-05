# Kép-videó válogató (Android, v3.2)

Telefonon futó kép- és videóválogató: a fájlt egy gombnyomásra közvetlenül a megfelelő mappába helyezi át
(nincs txt, nincs Windowsos szétdobás). A mappagombok a kiválasztott **célmappa almappái**.

## Profilok
Minden munkához külön profil tartozik (pl. „Pinterest képek", „AI képek", „YouTube videók"):
- forrásmappa (in) és célmappa (out), a profil neve alapból a forrásmappa neve (átnevezhető),
- melyik almappák legyenek gombok, az almappákból is olvasson-e,
- videók lejátszási sebessége (alap 1,2×),
- véletlen sorrend (a fájlok összekeverve jönnek; indításonként újra keveri),
- címkézés be/ki (nem kötelező).

Az Android „vissza" gombja egy szinttel visszalép (felugró ablak / címkesáv / gombpanel → válogatás → főmenü);
a főmenüben rákérdez a kilépésre (Igen = kilép). Ehhez a `@capacitor/app` plugin kell.
A mappagombok méretét a főmenüben két számmal lehet megadni: Enter vagy kikattintás után azonnal érvénybe lép.

## Használat
1. Első indításkor: **Engedély megadása** → kapcsold be a „Minden fájl kezelése" engedélyt.
2. **＋ Új profil**: képek mappája, célmappa (a mappaválasztóban új mappa is létrehozható), Mentés.
3. **▶ Indítás**. Koppints a képre → gombok; dupla koppintás = nagyítás (videónál szünet/lejátszás); húzás = lapozás;
   jobbra-vissza húzás = fájlnév; **↩ Vissza** visszamozgatja az utolsó fájlt (újraindítás után is).
4. Videónál alul tekerősáv, a gombpanelen sebességváltó (⏩). Amíg a gombpanel nyitva van, a videó szünetel,
   bezárásakor (újabb koppintás) folytatódik.
   A gombpanel **⇄ Profil** gombjával közvetlenül másik profilra lehet váltani.
5. Címkézésnél a gombpanelen **🏷 Címke**: a címke vesszővel elválasztott tételekből áll (pl. `N6, hajlékony lányok`),
   és a fájl besorolásakor a célmappa `cimkek.txt` fájljába kerül (soronként: fájlnév, tabulátor, címke).
   Az ajánlott tételek egyesével jelennek meg, gyakoriság szerint (görgethető); a tétel első 2 karaktere után csak az
   ezzel kezdődők maradnak. A **Vissza** a címkesort is törli.

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
