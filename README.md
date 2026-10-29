# DuraKlash

Kāršu spēle **Durak** tīmeklī ar reāllaika spēli 2–6 dalībniekiem un iespēju spēlēt pret botu.
Pieejami trīs režīmi: klasiskais, padošanas un japāņu duraks.

## Iespējas

- Reģistrācija, pieslēgšanās un spēlēšana viesa režīmā, ja istabas izveidotājs to atļauj.
- Istabu izveide, pievienošanās ar kodu, ātrā pievienošanās un laika limita izvēle.
- Kāršu vilkšana, vairāku kāršu izspēle, padošanās un revanši.
- Profils ar savu bildi, lietotājvārda un paroles maiņu, konta dzēšanu.
- Draugu saraksts un draudzības uzaicinājumi.
- Spēļu vēsture un profila statistika: spēļu, uzvaru un zaudējumu skaits, uzvaru procents.
- Četras tēmas: klasiskā, gaišā, tumšā un modernā.
- Administratora lietotāju pārvaldība un kontu bloķēšana.

Vēsturē un statistikā ieskaita tikai pabeigtās multiplayer kārtas. Katrs revanšs tiek
saglabāts atsevišķi; spēles pret botu un nepabeigtas partijas neieskaitās.

## Tehnoloģijas

| Daļa | Tehnoloģijas |
| --- | --- |
| Lietotāja saskarne | HTML, CSS, JavaScript, Vite |
| Serveris | Node.js, Express, TypeScript / JavaScript |
| Reāllaika saziņa | Socket.IO |
| Datubāze | MySQL, Prisma ORM |
| Profila attēlu apstrāde | Sharp |
| Automātiskie testi | Vitest |

## Lokālā palaišana

Nepieciešams **Node.js 24.x**, npm un piekļuve MySQL datubāzei.
Komandas izpildi projekta saknes mapē.

### 1. Konfigurē vidi

Nokopē [`.env.example`](.env.example) uz `.env`. PowerShell:


Ja `.env` jau ir izveidots, atjaunini vajadzīgās vērtības, nepārrakstot esošo konfigurāciju.

| Mainīgais | Nozīme | Lokālā vērtība |
| --- | --- | --- |
| `DATABASE_URL` | MySQL savienojuma virkne | Saņem no projekta īpašnieka vai izmanto savu DB |
| `APP_ORIGIN` | Atļautā lietotnes izcelsme | `http://localhost:3000` |
| `PORT` | API un Socket.IO servera ports | `3003` |

`.env` un datubāzes piekļuves datus neievieto Git.

### 2. Instalē atkarības un sagatavo datubāzi

```sh
npm ci
npm run db:generate
npm run db:migrate
```

### 3. Palaid lietotni

Pirmajā terminālī — serveri:

```sh
npm run server
```

Otrajā terminālī — lietotāja saskarni:

```sh
npm run dev
```

Atver **http://localhost:3000**. Vite pārsūta API un Socket.IO pieprasījumus serverim.
Ja PowerShell bloķē `npm.ps1`, komandās izmanto `npm.cmd`, piemēram, `npm.cmd run dev`.

### Pēc koda atjaunināšanas

Atkārto `npm ci`, `npm run db:generate` un `npm run db:migrate`, pēc tam pārstartē abus serverus.

## Kā spēlēt kopā

1. Izveido istabu un, ja nepieciešams, ieslēdz viesu atļauju.
2. Nokopē istabas kodu un nodod pārējiem spēlētājiem.
3. Pārējie tajā pašā vietnē pievienojas ar kodu; izveidotājs sāk spēli.
4. Velc kārtis uz galda; aizsardzībai — uz izvēlētās uzbrukuma kārts.
   Vilkšanu var atcelt ar peles labo pogu vai `Escape`.

Ar vienu dalībnieku istabā var sākt spēli pret botu. Spēles noteikumi pieejami vietnes sadaļā **Noteikumi**.

Pārbaudei vienā datorā izmanto dažādus pārlūkus vai parasto un privāto logu.
Viena pārlūka parastās cilnes koplieto lietotāja identitāti.

Spēlei vietējā tīklā visiem jāatver `http://<servera-datora-IP>:3000`.
Pievieno šo izcelsmi `APP_ORIGIN` (vairākas adreses atdala ar komatu),
atļauj portu 3000 privātā tīkla ugunsmūrī un pārstartē serverus.

## Projekta struktūra

| Ceļš | Saturs |
| --- | --- |
| `src/pages + css stylesheet/` | HTML lapas un CSS |
| `src/js/` | Pārlūka loģika |
| `app.js`, `router/` | API un autentifikācija |
| `lib/` | Spēles loģika, reāllaika saziņa un DB pieslēgums |
| `prisma/` | Datu modelis un migrācijas |
| `tests/` | Automātiskās un integrācijas pārbaudes |
| `server.ts` | Servera palaišana |
