# Webstart

En startsida som samlar och öppnar mina egna verktyg på GitHub.

**→ <https://timpan8.github.io/Webstart/>**

Startsidan visar ett kort per verktyg med en kort beskrivning av vad det gör. Ett klick
öppnar verktyget; GitHub-ikonen i kortets hörn går till källkoden. Sök med `/`, bläddra
med piltangenterna, öppna med Enter. Ljust och mörkt tema, och valet sparas.

## Lägga till och ta bort verktyg

Gå till **[Hantera](https://timpan8.github.io/Webstart/admin.html)**.

Vänsterspalten listar alla mina publika repon, hämtade direkt från GitHub, med en
markering för vilka som har Pages påslaget — alltså vilka som faktiskt går att öppna
som ett verktyg. Klicka på ett repo för att lägga till eller ta bort det.

Högerspalten är listan som visas på startsidan. Där går det att

- skriva namn, beskrivning, ikon, taggar och kategori,
- **dölja** en post utan att radera den (ögat),
- **flytta** poster genom att dra i handtaget — eller med piltangenterna när handtaget
  har fokus.

### Spara

Två vägar, båda alltid tillgängliga:

- **Spara till GitHub** — klistra in en token en gång, sedan räcker ett klick.
  Sidan bygger om på ungefär en minut.
- **Kopiera JSON / Ladda ner** — kräver ingen token. Lägg filen i `data/tools.json`
  och committa den själv.

Utan token är "Spara till GitHub" utgråad. Hanteringssidan ligger öppet, men allt
skrivande går genom GitHubs egen behörighetskontroll.

### Token

Skapa en **fine-grained** personal access token under
[Developer settings](https://github.com/settings/personal-access-tokens/new):

- **Repository access:** bara `timpan8/Webstart`
- **Permissions:** `Contents: Read and write` — inget annat
- **Expiration:** sätt ett datum

Så snävt satt kan en läckt token ändra den här sidan och ingenting annat. Alla
`*.github.io`-sidor delar samma lagring i webbläsaren, så välj *Bara den här fliken*
om du sitter vid en dator du inte äger. Vill du ha noll exponering: kör hanteringssidan
lokalt i stället (se nedan).

## Kör lokalt

```sh
python3 -m http.server 8000
```

- <http://localhost:8000/> — startsidan
- <http://localhost:8000/admin.html> — hanteringssidan

En server behövs; `fetch()` av en lokal JSON-fil fungerar inte över `file://`.

## Så är det byggt

Ren HTML, CSS och JavaScript. Inget byggsteg, inga beroenden, ingen npm.

```
index.html          startsidan
admin.html          hanteringssidan
assets/
  theme.css         designtokens, ljust och mörkt
  app.css/js        startsidan
  admin.css/js      hanteringssidan
  dom.js            delade DOM-hjälpare
  github.js         GitHub-API-klient (bara admin använder den)
data/
  tools.json        listan som visas — sanningen
  tools.schema.json schema för validering och autocomplete
  repos.json        nattlig ögonblicksbild av mina repon (reserv och driftkontroll)
scripts/
  validate.mjs      fäller en trasig tools.json
  refresh-repos.mjs skriver data/repos.json
```

Startsidan läser bara `data/tools.json` och anropar aldrig GitHubs API — den laddar
direkt och kan inte gå sönder av en anropsgräns.

`node scripts/validate.mjs` kontrollerar listan. Samma kontroll körs i CI vid varje push.

## GitHub Pages

Byggs från grenen `main`, mappen `/` (root). Det är ett medvetet val framför en
Actions-baserad deploy: commits gjorda av `GITHUB_TOKEN` triggar inte andra workflows,
så en Actions-deploy skulle inte byggas om när nattjobbet uppdaterar `data/repos.json`.

`CLAUDE.md` beskriver kontraktet för en AI som ska uppdatera beskrivningar.
