# Webstart

Startsida som samlar och öppnar Tims egna verktyg på GitHub. Ligger på GitHub Pages:
<https://timpan8.github.io/Webstart/>

Sidan är skriven på svenska. Skriv beskrivningar, gränssnittstext, kodkommentarer och
commit-meddelanden på svenska.

## Det enda som egentligen betyder något

`data/tools.json` är sanningen. Den bestämmer vilka verktyg som visas, i vilken ordning,
med vilken text och vart de länkar. Startsidan läser den filen och ingenting annat.

Ordningen i `tools`-arrayen **är** visningsordningen. Det finns inget `order`-fält.

| Fält | Krävs | Innebörd |
| --- | --- | --- |
| `id` | ja | Stabil nyckel, gemener och bindestreck. **Byt aldrig ett `id`.** |
| `name` | ja | Rubriken på kortet. |
| `description` | nej | Vad verktyget gör, 1–2 meningar. Cirka 120 tecken syns innan texten klipps. |
| `repo` | nej | `ägare/namn`. Ger källkodslänken i kortets hörn. |
| `url` | nej | Länken kortet öppnar. Saknas den används repots GitHub-sida. |
| `icon` | nej | En emoji. Tom = första bokstaven i namnet. |
| `tags` | nej | Korta ord, syns som etiketter och är sökbara. |
| `category` | nej | Grupprubrik. Har någon post en kategori grupperas hela sidan i sektioner. |
| `hidden` | nej | `true` döljer posten utan att radera den. |
| `lock` | nej | Fält du inte får skriva om, t.ex. `["description"]`. |

Varje post måste ha antingen `url` eller `repo`, annars blir kortet en död länk och
valideringen fäller bygget.

## Regler

1. **Respektera `lock`.** Står `"lock": ["description"]` är beskrivningen handskriven.
   Låt den vara, även om du tycker att din är bättre.
2. **Byt aldrig ett `id`.** Allt annat får ändras. Ett `id` är nyckeln som gör att en post
   överlever en omdöpning.
3. **Hitta inte på vad ett verktyg gör.** Läs repots README innan du skriver en
   beskrivning. Är repot tomt eller oklart — skriv att det är en platshållare, eller
   fråga. En trovärdig men felaktig beskrivning är sämre än ingen.
4. **Dölj hellre än radera.** Sätt `hidden: true`. Att ta bort en post är Tims beslut.
5. **Kasta inte fält du inte känner igen.** Läser du filen och skriver tillbaka den ska
   okända fält följa med.
6. **Kör valideringen innan du committar:** `node scripts/validate.mjs`

## Kör lokalt

`fetch()` av en lokal JSON-fil fungerar inte över `file://`, så det behövs en server:

```sh
python3 -m http.server 8000
# http://localhost:8000/            startsidan
# http://localhost:8000/admin.html  hanteringssidan
```

## Så hänger det ihop

```
index.html   -> assets/app.js    -> data/tools.json          (läser bara)
admin.html   -> assets/admin.js  -> data/tools.json          (läser och skriver)
                                 -> GitHub API               (hämtar repolistan)
                 assets/dom.js      delade DOM-hjälpare
                 assets/github.js   API-klient, bara admin använder den
                 assets/theme.css   designtokens, ljust och mörkt
```

`data/repos.json` skrivs av `.github/workflows/refresh-repos.yml` varje natt. Den är
**inte** en källa för vad som visas — hanteringssidan använder den som reserv när
GitHubs anropsgräns är slut, och för att märka att ett repo bytt namn. Redigera den
aldrig för hand.

## Saker som lätt går sönder

- **Rör inte `encodeBase64`/`decodeBase64` i `assets/github.js`.** Ett rakt `btoa()`
  ser ut att fungera men korrumperar å, ä och ö tyst (`H�ller`) och kastar på
  tankstreck och emoji. Kommentaren i filen förklarar varför.
- **Inget byggsteg, inga beroenden, ingen npm.** Sidan ska gå att öppna direkt.
  Lägg inte till ett ramverk.
- **Pages deployar från grenen `main`, inte via Actions.** Det är medvetet: commits
  som `GITHUB_TOKEN` gör triggar inte andra workflows, så en Actions-baserad deploy
  skulle inte byggas om när nattjobbet skriver `data/repos.json`.
- **Startsidan får aldrig anropa GitHubs API.** Den ska ladda direkt och inte kunna
  gå sönder av en anropsgräns.
