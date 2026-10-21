# DuraKlash
## Palaist lokāli
1. Nokopē `.env.example` uz `.env` un ievadi savas MySQL datubāzes vērtības.
2. Palaid `npm ci`, `npm run db:generate` un `npm run db:migrate`, lai sagatavotu Prisma klientu un datubāzes tabulas, tostarp sesijas.
3. Atsevišķos termināļos palaid `npm run server` un `npm run dev`.
4. Atver `http://localhost:3000`, izvēlies “Pieslēgties” un izveido kontu.

Autentifikācija izmanto serverī glabātas 7 dienu sesijas un HttpOnly sīkdatni. Reģistrācija automātiski pieslēdz lietotāju; izrakstīšanās anulē pašreizējo sesiju. Viesu spēles ir pieejamas arī bez konta.

Iestatījumu lapā pieslēdzies lietotājs var nomainīt lietotājvārdu, paroli un tēmu. Paroles maiņai jāievada pašreizējā parole un jaunā parole divreiz.

Pārbaudes: `npm test` un `npm run build`. API testi izmanto atmiņas datubāzes aizvietotāju; reālai MySQL pārbaudei nepieciešams konfigurēts `.env` un palaistas migrācijas.

Publicēšanai palaid `npm run build` un `npm run server`, iestati `NODE_ENV=production` un `APP_ORIGIN` uz vietnes HTTPS izcelsmi (bez beigu slīpsvītras). Serveris apkalpo arī `dist` failus. Mēģinājumu ierobežojums darbojas viena servera procesa ietvaros; vairākiem procesiem nepieciešama kopīga ierobežojumu krātuve.

Serveris un Prisma migrācijas izmanto vienu `DATABASE_URL`. Railway MySQL pieslēgumam no izstrādātāja datora jāizmanto ārēji sasniedzams savienojums; Railway MySQL servisa `MYSQL_PUBLIC_URL` ir pieejams pēc publiskas TCP piekļuves ieslēgšanas. Railway iekšējā `MYSQL_URL` ir paredzēta pakalpojumiem tā privātajā tīklā. Skatīt [Railway MySQL dokumentāciju](https://docs.railway.com/databases/mysql). Savienojuma virkni glabā tikai lokālajā `.env` vai hostinga noslēpumos, nevis Git. Pirms migrācijām pārbaudi, ka izvēlēta komandas izstrādes datubāze. Migrācijas izveido tabulas; esošie lokālie konti automātiski netiek pārnesti.

## Komandas datubāze Railway

Izveidots [DuraKlash projekts](https://railway.com/project/20e15867-31df-42e5-b36f-8c37a8d8de96) ar MySQL servisu. Railway datubāzes nosaukums ir `railway`; tā paredzēta kopīgai projekta izstrādei. Savienojums no komandas datoriem izmanto publisko TCP adresi un `duraklash_app` lietotāju, kura tiesības ierobežotas ar šo datubāzi. Railway vides sākotnējais nosaukums `production` pats par sevi nenozīmē, ka lietotne ir publicēta.

Komandas biedram jāsaņem šīs izmaiņas no Git un privāti jāsaņem projekta `DATABASE_URL` no īpašnieka. To ievieto savā `.env`, kas izveidots pēc `.env.example`, saglabājot `APP_ORIGIN=http://localhost:3000` un `PORT=3003`. Tad palaiž `npm ci`, `npm run db:generate`, `npm run db:migrate` un atsevišķos termināļos `npm run server` un `npm run dev`. Lokāls XAMPP vai Docker šim pieslēgumam nav vajadzīgs.

Visi šajā datubāzē redz kopīgus lietotāju datus. Migrācijas jākoordinē komandā; nelieto `prisma migrate reset` kopīgajā datubāzē. Piekļuves dati nav jāiekļauj Git, sarakstes ekrānattēlos vai publiskajā README. Vecās lokālās datubāzes konti nav pārnesti. Šajā datorā iepriekšējā konfigurācija saglabāta Git ignorētā `.env.local-backup-20261016` failā.

## Kurss: DP4-1
## Dalībnieki
- Daniels Šabovičs (izstrādātājs, frontend, spēles loģika, testētājs);
- Lukass Vidriks (izstrādātājs, backend, datubāze);
- Anna Laima Orbidāne (izstrādātāja, backend, frontend).

# Projekta apraksts
DuraKlash ir kāršu spēles "Durak" digitalizētā versija tīmeklī. Projekts sastāv no 5 lapām: sākumlapa, pieslēgšanās/reģistrācijas lapa, profila/konta lapa, spēles galds un iestatījumi. Ir iespēja spēlēt gan ar anonīmiem lietotājiem, gan ar draugiem. 

# Lietotāju lomas 
- viesis;
- administrators;
- reģistrēts lietotājs.

# Izmantotās ārējās tehnoloģijas
- VScode;
- GitHub;
- Trello;
- Agile + Scrum.

# Izmantotās iekšējās tehnoloģijas
- React + Vite – Frontend būvēšanas rīki, kas tika izvēlēti to ātruma, vienkāršuma un stabilitātes dēļ;
- Typescript - uz JS būvēta programmēšanas valoda, kas šķietami atvieglo spēles loģikas noteikšanu un programmas uzturēšanu ilgtermiņā;
- MySQL datubāze - datubāze nepieciešamo datu glabāšanai, kuras veids izvēlēts pēc iepriekšējās pieredzes;
- node.js - Standarta ietvars mājaslapu izveidei, kas pilnībā atbalsta Typescript, izvēlēts, tāpēc ka tā vienkāršums šķiet atbilstošs projekta mērogam;
- Axios - bibliotēka paredzēta HTTP pieprasījumu sūtīšanai, gluži kā “fetch” komanda bet ar papildus ērtību funkcionalitāti;
- Socket.IO - bibliotēka, kas iespējo lietotāja reāllaika divpusējo saziņu ar serveri. Nepieciešama reāllaika spēlei;
- Prisma ORM - rīks, paredzēts darbam ar node.js un typescript, lai intuitīvi rakstīt datubāzes are OOP API nevis SQL rindām, potenciāli novēršot vairākas bieži pieļaujamās kļūdas ar sintaksi; 
- Railway hosting – pakalpojums projekta pārnešanai uz ārējo serveri, kas izvēlēts pēc iesācējiem draudzīgas reputācijas; 
- Zod – Typescript bibliotēka paredzēta datu validācijai un integritātes uzturēšanai;
- Vitest – programmas testēšanas rīks.
# Izmantotās ārējās tehnoloģijas
- GitHub - versiju kontroles sistēma; 
- VScode - kodēšanas vide;
- Trello - kanban metodes darba plānotājs.

Datubāzes struktūra ir pielāgota DuraKlash.docx ER modelim: lietotāji, draudzības, spēles un spēļu dalībnieki, kā arī tehniskā sesiju tabula. Lauki, saites, migrācijas un pārbaudes aprakstītas [prisma/DATABASE.md](prisma/DATABASE.md). Pēc šo izmaiņu saņemšanas palaid `npm run db:generate`, `npm run db:migrate` un pārstartē `npm run server`. Reģistrācijā tagad jānorāda arī unikāls lietotājvārds.

## Multiplayer (2–6 spēlētāji)

Pēc atjauninājuma palaid `npm ci`, `npm run db:generate` un `npm run db:migrate`,
pēc tam pārstartē `npm run server` un `npm run dev`. Migrācija pievieno spēles
stāvokļa JSON un versiju; esošie konti netiek dzēsti.

1. Atver sākumlapu un izveido istabu. Ieslēdz viesu atļauju, ja draugi spēlēs bez konta.
2. Pārējie atver to pašu vietni un pievienojas ar istabas kodu.
3. Ar 2–6 dalībniekiem izveidotājs nospiež **Sākt multiplayer**. Ar vienu dalībnieku
   poga **Spēlēt pret botu** saglabā iepriekšējo vietējo spēli.
4. Katrs redz savas kārtis, citu kāršu skaitu, kopīgo galdu un servera noteikto gājienu.

Pārbaude vienā datorā: izmanto divus dažādus pārlūkus vai parasto un privāto logu.
Viena pārlūka parastās cilnes koplieto konta/viesa identitāti un nav divi spēlētāji.
Viesu identitāte tagad ir HttpOnly sīkdatnē; vecajām viesu istabām jāizveido jauna istaba.

Visiem spēlētājiem jāpieslēdzas **vienam lietotnes serverim**. Kopīga Railway DB pati
par sevi nav publicēta spēles vietne. Vietējā tīklā vienā datorā palaiž abus serverus,
`.env` iestata `APP_ORIGIN=http://<datora-LAN-IP>:3000`, pārstartē serveri un visi,
arī saimnieks, atver šo adresi. Ugunsmūrī jābūt atļautam portam 3000 privātajam tīklam.
Ārpus vietējā tīkla jāpublicē lietotne ar WebSocket atbalstu un jāiestata tās HTTPS
adrese kā `APP_ORIGIN`. DB piekļuves datus pārlūkā neievada.

Multiplayer izmanto Socket.IO. Serveris izdala kārtis, pārbauda gājiena kārtību,
kāršu piederību un noteikumus; pretinieku kārtis un kavas secība netiek nosūtīta klientam.
Katrs pieņemtais gājiens tiek saglabāts MySQL ar atomāru versijas pārbaudi.
Spēles pabeigšana un visu dalībnieku rezultāti tiek saglabāti vienā transakcijā.
Lapas pārlāde vai īslaicīgs savienojuma zudums atjauno partiju. Laiks turpina ritēt arī
bez savienojuma un servera pārstartēšanas laikā. Laika izbeigšanās vai padošanās
noslēdz partiju: šis spēlētājs saņem DURAK, pārējie WIN. Neizšķirtā rezultāts paliek tukšs.

Gājieni notiek pa apli. Vienā izspēlē kārtis pievieno pašreizējais uzbrucējs;
pārējie gaida savu kārtu. Padošanas režīmā uzbrukums pāriet nākamajam dalībniekam.
Spēlētāji bez kārtīm pēc kavas iztukšošanās izstājas kā uzvarētāji; pēdējais ar kārtīm
ir duraks. Japāņu režīmā saglabātas esošās mastu atšķirības. DuraKlash izvēle pagaidām
izmanto klasiskos noteikumus; īpašās spējas vēl nav ieviestas.

Spēļu serverim paredzēts viens Node process. Vairākām instancēm jāievieš kopīgs
Socket.IO adapteris un slodzes sadales konfigurācija. `npm test` aptver pilnas 2, 3 un
6 spēlētāju partijas, privātās kārtis, Socket.IO klientus, atkārtotu pieslēgšanos,
autorizāciju un vienlaicīgus gājienus. `npm run test:multiplayer:db` izveido pagaidu
istabu konfigurētajā MySQL, pārbauda spēli un izdzēš tikai šīs pārbaudes istabu.
Papildu informācija: [multiplayer datubāzes lauki](prisma/MULTIPLAYER.md).


Ja Vite rāda `socket hang up` vai 502, pārbaudi API serveri un porta konfliktus.
API noklusējuma ports ir 3003; Vite HTTP un Socket.IO starpniekserveris nolasa to no
`.env` lauka `PORT`. Mainot portu, pārstartē gan `npm run server`, gan `npm run dev`.
DB savienojuma pārbaude: `http://localhost:3000/api/health/db`.

Veiktspēja: serveris atkārtoti izmanto pēdējo saglabāto spēles stāvokli, un parastam
viesa gājienam vajadzīgs viens nosacīts DB ieraksts. Gājienu apstiprina tikai pēc
saglabāšanas; konta sesiju joprojām pārbauda DB. Saistītos datus Prisma ielādē kopā
(`relationJoins`), tāpēc pēc atjauninājuma jāpalaiž `npm run db:generate` un
jāpārstartē API. Šim paātrinājumam papildu DB migrācija nav vajadzīga.
Laika beigas apstrādā katras partijas taimeris; termiņus atjauno servera startā un
pārbauda ik pēc 30 sekundēm. Savienojuma noildzes un atkārtota izmantošana ir
pielāgotas attālinātai DB; noklusējumus skatīt `lib/prisma.ts`.

Lokālam salīdzinājumam PowerShell: `$env:DURAK_BENCHMARK="1"; npm run test:multiplayer:db`.
Tas izvada darbību laikus; tie ir atkarīgi no tīkla un DB atrašanās vietas.
