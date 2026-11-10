# WisselApp

Een speeltijd- en wisselplanner voor jeugdvoetbal. Volledig **offline** PWA, draait vanaf GitHub Pages, alle data **lokaal** op de telefoon (IndexedDB) — niets in de cloud.

## Wat de app doet

- **Spelersgroep** (alleen voornamen — privacy-vriendelijk).
- **Wedstrijden per datum**: speelvorm, totale tijd, helften × kwarten, wisselinterval.
- **Aanwezige spelers** per wedstrijd selecteren.
- **Keepers per kwart** kiezen (met voorstel op basis van wie de minste keepertijd heeft over alle wedstrijden).
- **Wisselschema** dat:
  - eerlijk verdeelt binnen 1 wedstrijd,
  - rekening houdt met geschiedenis (wie minder speelde, krijgt voorrang),
  - bankbeurten zo veel mogelijk op volgorde en verspreid over de wedstrijd plant,
  - de keeper een héél kwart laat keepen (niet tussentijds wisselen),
  - keepertijd over wedstrijden verdeelt.
- **Live wedstrijdscherm** met grote klok, huidig veld/bank/keeper, countdown tot volgende wissel, **alarm** (geluid + trillen + grote banner) 30 sec vóór en op het moment van wisselen.
- **Lock-screen-proof**: de klok werkt op timestamps, dus iPhone vergrendelen of de app op de achtergrond zetten reset de wedstrijd niet.
- **Speeltijd-statistieken** over alle wedstrijden.
- **Backup**: exporteer/importeer alle data als één JSON-bestand.
- **Wedstrijden delen**: selecteer één of meerdere wedstrijden om te exporteren of te importeren, zonder andere wedstrijden of instellingen te wissen.

## Verdeling van bankbeurten

De planner verdeelt eerst de totale speeltijd en houdt daarbij rekening met de historische gemiddelde speeltijd. Daarna herschikt hij de bestaande speelblokken om lange bankperiodes, een tweede bankbeurt terwijl anderen nog geen beurt hadden, en lange ononderbroken speelperiodes zoveel mogelijk te voorkomen.

Het ingestelde wisselinterval blijft behouden: er komen geen extra wisselmomenten of korte inhaalminuten bij. Bij een verschil in speeltijd blijft het doel maximaal één speelblok (normaal vijf minuten). De herschikking verandert de geplande minuten per speler niet; wie op basis van geschiedenis een extra blok krijgt, behoudt dat blok.

Keepers blijven hun toegewezen kwart keepen en het ingestelde aantal wissels blijft gelijk. Daardoor is een perfecte verdeling niet altijd mogelijk, bijvoorbeeld bij een vaste keeper of weinig wissels per keer. Bij live wijzigingen worden alleen nog niet begonnen speelblokken herschikt; de huidige handmatige wissel en de gespeelde periodes blijven vastliggen. Een lopende of afgeronde wedstrijd wordt niet automatisch bij het openen herschreven: de verbetering geldt bij het maken of herberekenen van een schema en bij live aanpassingen.

## Wedstrijden exporteren en importeren

1. Kies **Wedstrijden exporteren** bij **Wedstrijden** of **Instellingen**.
2. Vink één of meerdere wedstrijden aan, of gebruik **Alles selecteren**, en kies **Selectie exporteren**.
3. Op het andere toestel: kies **Wedstrijden importeren** en open het JSON-bestand. Ook een bestaande volledige WisselApp-backup wordt ondersteund.
4. Vink de gewenste wedstrijden aan. Bestaande wedstrijden worden op ID herkend en gemarkeerd. Kies **Overslaan** (standaard) of **Vervangen**; vervangen vraagt om bevestiging.
5. Kies **Selectie importeren**. Het resultaat toont hoeveel wedstrijden en spelers zijn toegevoegd, vervangen of overgeslagen.

De export bevat alleen de gekozen wedstrijden en hun bijbehorende spelers, inclusief wisselschema's, aanwezigheid, blessures, doelpunten en speeltijden. Ontbrekende spelers worden toegevoegd; bestaande spelers met dezelfde ID behouden hun lokale naam en gegevens. Spelers met gelijke namen maar verschillende IDs worden niet automatisch samengevoegd. Spelers die eerder uit de spelersgroep zijn verwijderd, blijven onbekend (`?`) als hun gegevens niet meer beschikbaar zijn.

De overige wedstrijden en instellingen blijven ongewijzigd. Geïmporteerde lopende wedstrijden met opgeslagen speeltijd hervatten vanaf die tijd via **Hervat**. Alleen de opgeslagen momentopname wordt overgedragen, niet een doorlopende klok van het andere toestel.

**Volledige backup** blijft beschikbaar onder **Instellingen** en vervangt bij import alle lokale data na bevestiging. Een wedstrijdexport kan daar niet per ongeluk als volledige backup worden geladen.

### Tests

Serveer de app via een lokale HTTP-server:

- Open `tests/scheduler.html` voor bankvolgorde, spreiding, vaste wisselintervallen, geschiedenis, keepers en live aanpassingen. Deze tests gebruiken alleen fictieve wedstrijden.
- Open `tests/match-transfer.html` voor selectie, spelerskoppelingen, overslaan/vervangen, ongeldige bestanden, terugdraaien bij schrijffouten, volledige backups en klokherstel. Deze tests gebruiken een tijdelijke, aparte IndexedDB-database.

Er zijn geen testafhankelijkheden nodig.

## Hosten op GitHub Pages

1. Maak een nieuwe (publieke of private) GitHub-repo, bijv. `wisselapp`.
2. Kopieer de inhoud van de `WisselApp code/` map naar de root van die repo (zodat `index.html` direct in de root staat).
3. Push naar `main`.
4. In GitHub: **Settings → Pages → Source: Deploy from branch → main / (root)**.
5. Wacht ~1 minuut. De app staat dan op `https://<gebruikersnaam>.github.io/wisselapp/`.

GitHub Pages serveert altijd over HTTPS — vereist voor service workers, audio en wake lock.

## Installeren op de telefoon

**iPhone (Safari)**: open de URL → Deel-knop → *Zet op beginscherm*.
**Android (Chrome)**: menu → *App installeren*.

Eenmaal geïnstalleerd:
- werkt offline (alle bestanden zitten in de service-worker-cache),
- start fullscreen (geen browserbalk),
- houdt het scherm aan tijdens een wedstrijd via de Wake Lock API.

## Notificaties — uitleg

Op iOS kan een web-app **geen** echte push-notificaties versturen wanneer de app gesloten is, **tenzij** je een eigen back-end opzet (Web Push + VAPID). De WisselApp werkt daarom met **in-app notificaties**: zolang het live-wedstrijdscherm open is (en het scherm dankzij Wake Lock aan blijft) krijg je:

- een grote banner op het scherm,
- een geluidsalarm (3 piepjes),
- trillen (Android — iOS staat trillen vanuit een PWA niet toe).

Bij elke wissel krijg je een **voorwaarschuwing 30 seconden van tevoren** plus het signaal op het wisselmoment zelf, met de namen van wie eraf en erin moet en wie er gekeept gaat worden.

Wil je later toch echte push als de telefoon op slot is? Dan is de eenvoudigste route een gratis Cloudflare Worker met VAPID; daar kan ik op basis van deze codebase een uitbreiding voor maken.

## Privacy

- Alle data (spelers, wedstrijden, speeltijd) staat in **IndexedDB** op het toestel.
- Er is geen netwerkverkeer behalve het downloaden van de app-bestanden zelf van GitHub Pages.
- Een back-up maken doe je handmatig naar een `.json`-bestand dat alleen jij krijgt.

## Bekende beperkingen / aandachtspunten

- iOS Safari laat `navigator.vibrate` niet toe — daar krijg je alleen geluid + visueel alarm.
- Geluid werkt op iOS pas nadat de gebruiker minstens één keer een knop heeft ingedrukt (Apple-policy). De app doet dit automatisch bij **Start wedstrijd** en **Hervat**.
- Houd de telefoon op het wedstrijdscherm — Wake Lock voorkomt dat het scherm dimt zolang de wedstrijd loopt.

## Bestandenstructuur

```
index.html                 PWA shell
manifest.webmanifest       PWA-manifest
sw.js                      Service worker (offline cache)
icon.svg                   App-icoon
css/styles.css
js/app.js                  Routing + UI-koppeling
js/db.js                   IndexedDB
js/scheduler.js            Wissel- en keeperalgoritme
js/timer.js                Timestamp-gebaseerde klok (lock-screen-proof)
js/notify.js               Geluid + trillen + banner
js/views.js                HTML-templates (Nederlands)
```

## App-iconen (PNG)

De manifest verwijst naar `icon-192.png` en `icon-512.png`. De SVG werkt al voor moderne browsers, maar voor de allerbeste iOS-installatie kun je de SVG omzetten naar PNG en in de root plaatsen. Snelle manier:

```bash
# vereist ImageMagick of inkscape
magick icon.svg -resize 192x192 icon-192.png
magick icon.svg -resize 512x512 icon-512.png
```
