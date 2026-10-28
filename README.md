# DuraKlash
## Palaist lokāli
1. Nokopē `.env.example` uz `.env` un ievadi savas MySQL datubāzes vērtības.
2. Palaid `npm ci`, `npm run db:generate` un `npm run db:migrate`, lai sagatavotu Prisma klientu un datubāzes tabulas, tostarp sesijas.
3. Atsevišķos termināļos palaid `npm run server` un `npm run dev`.
4. Atver `http://localhost:3000`, izvēlies “Pieslēgties” un izveido kontu.

Autentifikācija izmanto serverī glabātas 7 dienu sesijas un HttpOnly sīkdatni. Reģistrācija automātiski pieslēdz lietotāju; izrakstīšanās anulē pašreizējo sesiju. Viesu spēles ir pieejamas arī bez konta.

Konta lapā pieslēdzies lietotājs var nomainīt lietotājvārdu un paroli, kā arī dzēst savu kontu, ievadot pašreizējo paroli. Dzēšot kontu, draudzības saites un sesijas tiek noņemtas, bet spēļu rezultāti tiek saglabāti anonimizēti; vispirms jāiziet no gaidošām istabām un jāpabeidz aktīvās spēles. Tēmu izvēle atrodas atsevišķā lapā “Tēmas”, kur pieejama klasiskā, gaišā un tumšā tēma.

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
DuraKlash ir kāršu spēles "Durak" digitalizētā versija tīmeklī. Projektā ir 7 lapas: sākumlapa, pieslēgšanās/reģistrācijas lapa, draugu lapa, spēles gaidīšanas istaba, spēles galds, noteikumu lapa un iestatījumu lapa. Ir iespēja spēlēt gan ar anonīmiem lietotājiem, gan ar draugiem.

# Lietotāju lomas 
- viesis;
- reģistrēts lietotājs;
- administrators.

# Izmantotās ārējās tehnoloģijas
- VScode;
- GitHub;
- Trello;
- Agile + Scrum.
- Railway

# Izmantotās iekšējās tehnoloģijas
- Vite – Frontend būvēšanas rīks, kas tika izvēlēts tā ātruma, vienkāršuma un stabilitātes dēļ;
- MySQL datubāze - datubāze nepieciešamo datu glabāšanai, kuras veids izvēlēts pēc iepriekšējās pieredzes;
- node.js - Standarta ietvars mājaslapu izveidei, kas pilnībā atbalsta Typescript, izvēlēts, tāpēc ka tā vienkāršums šķiet atbilstošs projekta mērogam;
- Axios - bibliotēka paredzēta HTTP pieprasījumu sūtīšanai, gluži kā “fetch” komanda bet ar papildus ērtību funkcionalitāti;
- Socket.IO - bibliotēka, kas iespējo lietotāja reāllaika divpusējo saziņu ar serveri. Nepieciešama reāllaika spēlei;
- Prisma ORM - rīks, paredzēts darbam ar node.js un typescript, lai intuitīvi rakstīt datubāzes are OOP API nevis SQL rindām, potenciāli novēršot vairākas bieži pieļaujamās kļūdas ar sintaksi; 
- Zod – Typescript bibliotēka paredzēta datu validācijai un integritātes uzturēšanai;
- Vitest – programmas testēšanas rīks.
# Izmantotās ārējās tehnoloģijas
- GitHub - versiju kontroles sistēma; 
- VScode - kodēšanas vide;
- Trello - kanban metodes darba plānotājs.


## Multiplayer (2–6 spēlētāji)

Spēlē ar 3+ dalībniekiem sākumā piemet tikai galvenais uzbrucējs. **Beigt uzbrukt**
atļauj piemest arī otram aizsarga kaimiņam; pirmais uzbrucējs saglabā piemešanas
tiesības. Pēc katras jaunas kārts iepriekšējie apstiprinājumi tiek atcelti. Kad
kārtis nokautas vai aizsargs izvēlējies paņemt, abi uzbrucēji apstiprina **Beigt piemest**.
Arī sasniedzot limitu (6 kārtis vai aizsarga kāršu skaits izspēles sākumā), pēc
aizsardzības vai paņemšanas izvēles abiem uzbrucējiem jānospiež **Beigt piemest**.
Kārtis paliek uz galda līdz abu apstiprinājumam; automātiskas pauzes un pārejas nav.
Divu spēlētāju spēlē apstiprina vienīgais uzbrucējs. Spēlē pret botu bots apstiprina
savu piemešanas beigšanu pats.


Pēc partijas beigām **Turpināt nākamo kārtu** atzīmē gatavību spēlēt vēlreiz.
Ja visi dalībnieki piekrīt revanšam, jaunā kārta sākas automātiski.
Ja kāds izvēlas **Galvenā izvēlne** vai **Iziet**, pārējie atgriežas kopīgā jaunā
istabā (lobby). Tur var uzaicināt citus vai sākt spēli ar atlikušo sastāvu;
viens palicis spēlētājs var uzaicināt draugu vai spēlēt pret botu. Istabas režīms,
laika limits un viesu atļauja saglabājas; iepriekšējās partijas rezultāti paliek
iepriekšējā spēles ierakstā. Kamēr kāds vēl nav atbildējis, revanša balsojums gaida.


Poga **Izveidot istabu** sāk servera pieprasījumu uzreiz un rāda **Veido istabu…**.
Istabas lapa atveras ar servera apstiprinātu dalībnieku sarakstu un iestatījumiem.
Izveides, ātrās pievienošanās un pievienošanās pēc koda atbilde tiek vienreiz nodota
istabas lapai, neveicot atkārtotu izveides/pievienošanās pieprasījumu. Lapas pārlāde
atkal saņem svaigus datus no servera; izveides kļūdas parādās pirms pārejas uz istabu.

Izejot no gaidīšanas istabas, sākumlapa atveras uzreiz un fonā nosūta iziešanas
pieprasījumu. Nepabeigtā darbība saglabājas cilnes `sessionStorage`, lai to varētu
atkārtot pēc pārlādes vai savienojuma atjaunošanas. Kļūdas gadījumā sākumlapā
redzama poga **Mēģināt vēlreiz**; jauna pievienošanās sagaida iepriekšējās iziešanas
pabeigšanu. Pieprasījums ir piesaistīts konkrētajai dalībai, lai aizkavēts atkārtojums
neizņemtu spēlētāju, kas vēlāk pievienojies no jauna. Ja pārlūka krātuve nav pieejama,
saglabājas iziešana ar servera apstiprinājuma gaidīšanu.
Dalībniekam dzēš dalību; izveidotājam istabu atzīmē kā pabeigtu (`FINISHED`).
Aktīvā multiplayer spēlē iziešana ir padošanās.

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
pārstartē API serveri un spēlētāji, tostarp saimnieks, atver atbilstošo atļauto adresi.
Ugunsmūrī jābūt atļautam portam 3000 privātajam tīklam.
Ārpus vietējā tīkla jāpublicē lietotne ar WebSocket atbalstu un jāiestata tās HTTPS
adrese kā viena no `APP_ORIGIN` vērtībām. DB piekļuves datus pārlūkā neievada.

Multiplayer izmanto Socket.IO. Serveris izdala kārtis, pārbauda gājiena kārtību,
kāršu piederību un noteikumus; pretinieku kārtis un kavas secība netiek nosūtīta klientam.
Katrs pieņemtais gājiens tiek saglabāts MySQL ar atomāru versijas pārbaudi.
Spēles pabeigšana un visu dalībnieku rezultāti tiek saglabāti vienā transakcijā.
Lapas pārlāde vai īslaicīgs savienojuma zudums atjauno partiju. Laiks turpina ritēt arī
bez savienojuma un servera pārstartēšanas laikā. Padošanās izslēdz tikai konkrēto
spēlētāju un saglabā viņam DURAK; kamēr paliek vismaz divi aktīvi spēlētāji, partija
turpinās. Viņa rokas kārtis nonāk atmetumos. Ja padodas aizsargs, arī galds nonāk
atmetumos un sāk nākamais aktīvais spēlētājs; ja padodas uzbrucējs, iesākto uzbrukumu
turpina aizsarga jaunais iepriekšējais kaimiņš. Arī laika izbeigšanās izslēdz tikai
konkrēto spēlētāju. Iepriekš izslēgtie spēlētāji gala rezultātos netiek pārrakstīti par WIN.
Neizšķirtā bez padošanās rezultāts paliek tukšs.

Kārti velk no rokas uz galda brīvo vietu, bet aizsardzībai — uz konkrētas
nenokautas uzbrukuma kārts. Vilkšanu var atcelt ar peles labo pogu vai Escape;
kārts paliek rokā. Var nokaut kārtis jebkurā secībā. Vairākas kārtis var
atlasīt ar klikšķi/pieskārienu un vilkt kopā; pirmā uzbrukuma kārtīm jābūt vienādas
vērtības. Ar tastatūru var atlasīt kārti un aktivizēt galda mērķi ar Enter.

Gājieni virzās sēdvietu secībā, izlaižot izstājušos. Piemest drīkst tikai aizsarga
abi aktīvie kaimiņi: vispirms galvenais uzbrucējs pirms aizsarga, pēc viņa pogas
**Beigt uzbrukumu** — spēlētājs pēc aizsarga. Pārējie šajā izspēlē nepiedalās.
Piemest drīkst arī aizsardzības laikā — uz galda jau esošas vērtības,
līdz sešām uzbrukuma kārtīm un ne vairāk par aizsarga kāršu skaitu izspēles sākumā.
Padošanas režīmā tādas pašas vērtības kārti velk uz atsevišķo **Padot →** vietu
blakus uzbrukumam, pirms sākta aizsardzība un ievērojot nākamā aizsarga ietilpību.

**Paņemt kārtis** paziņo par paņemšanu, bet galdu uzreiz neiztukšo. Abi aizsarga
kaimiņi tajā pašā secībā var pabeigt piemest; jau pabeigušajam apstiprinājums nav
jāatkārto un viņš vairs nepiemet. Kad abi pabeiguši, aizsargs paņem galdu un izlaiž
nākamo uzbrukumu. Ja viss nokauts un abi kaimiņi pabeiguši, uzbrūk iepriekšējais
aizsargs. Padošanas režīmā pēc padošanas kaimiņus un secību nosaka jaunajam aizsargam.
Arī spēle pret botu izmanto šos pašus noteikumus un kāršu vilkšanu; tās stāvoklis
paliek konkrētā pārlūka cilnē. Multiplayer stāvokli joprojām saglabā serveris MySQL.

Spēlētāji bez kārtīm pēc kavas iztukšošanās izstājas kā uzvarētāji; pēdējais ar kārtīm
ir duraks. Japāņu režīmā saglabātas esošās mastu atšķirības. Jaunas istabas atļautas
klasiskajā, padošanas un japāņu režīmā.

Vadības paraugs: [R-Soft Durak Online noteikumi](https://static.rstgames.com/durak/public/en/help.html).
Šeit pēc projekta prasības jau pirmajā izspēlē limits ir sešas uzbrukuma kārtis.
Pēc atjaunināšanas izpildi `npm run db:generate` un `npm run db:migrate`, pārstartē API
un pārlādē spēles lapas. Jaunās migrācijas pievieno pēdējās pieslēgšanās laiku un
konta bloķēšanas termiņu; spēles noteikumu izmaiņas izmanto esošo JSON lauku.

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
saglabāšanas; konta statusu un sesijas derīgumu pārbauda tajā pašā nosacītajā DB
ierakstā. Pretinieku sesiju pārbaudes notiek paralēli saglabāšanai; rezultātu
nosūta tikai pēc veiksmīga ieraksta un saņēmēja pārbaudes. Saistītos datus Prisma ielādē kopā
(`relationJoins`), tāpēc pēc atjauninājuma jāpalaiž `npm run db:generate` un
jāpārstartē API. Šim paātrinājumam papildu DB migrācija nav vajadzīga.
Laika beigas apstrādā katras partijas taimeris; termiņus atjauno servera startā un
pārbauda ik pēc 30 sekundēm. Savienojuma noildzes un atkārtota izmantošana ir
pielāgotas attālinātai DB; noklusējumus skatīt `lib/prisma.ts`.

Lokālam salīdzinājumam PowerShell: `$env:DURAK_BENCHMARK="1"; npm run test:multiplayer:db`.
Tas izvada darbību laikus; tie ir atkarīgi no tīkla un DB atrašanās vietas.


### Profila bilde

Konta lapā var izvēlēties JPG, PNG vai WebP attēlu (līdz 5 MB un 20 megapikseļiem),
apskatīt priekšskatījumu un nospiest **Saglabāt bildi**. Izvēli var atcelt, bet saglabāto
bildi — noņemt. Attēls tiek apgriezts kvadrātā no centra un saglabāts 512 × 512 WebP
formātā bez sākotnējā faila metadatiem. Animēti attēli netiek pieņemti.

Bildes glabājas kopīgās MySQL datubāzes tabulā `Profilu_atteli`; lietotāja `avatars`
lauks satur tikai attēla API adresi. Tās nav atkarīgas no servera lokālajiem failiem.
Bildes redzamas profilā, draugu sarakstā, istabā un multiplayer spēlē. Konta dzēšana
izdzēš arī tā bildi. Pēc šī atjauninājuma palaid `npm ci`, `npm run db:generate` un
`npm run db:migrate`, pēc tam pārstartē serveri.


### Tēmas un navigācijas ielāde

Izvēlētā tēma uzreiz saglabājas `localStorage` un tiek piemērota pirms lapas satura
attēlošanas. Pieslēgta lietotāja izvēle fonā saglabājas arī DB, lai darbotos citās
ierīcēs. Nepabeigtu saglabāšanu pārņem nākamā lapa; `temas_versija` pasargā jaunāko
izvēli no novēlotiem vecās lapas pieprasījumiem. Viesu izvēle paliek pārlūkā.

Navigācija izmanto līdz piecām minūtēm derīgu `sessionStorage` priekšskatījumu
(tikai ID, lietotājvārds un loma), kamēr fonā pārbauda sesiju. Tas nepiešķir
piekļuves tiesības: serveris joprojām pārbauda katru aizsargāto API pieprasījumu.
Izrakstīšanās un nederīga sesija šo priekšskatījumu notīra.

Pēc atjauninājuma palaid `npm run db:generate`, `npm run db:migrate` un pārstartē serveri.


Profila lapai ir atsevišķs, līdz piecām minūtēm derīgs `sessionStorage`
priekšskatījums: lietotājvārds, vārds, e-pasts, bildes adrese un konta tēmas dati.
To atjauno sekmīga konta pārbaude un profila izmaiņas. Tas ļauj uzreiz parādīt
profilu, kamēr sesiju pārbauda fonā. Līdz pārbaudei rediģēšana ir atspējota.
Izrakstoties, dzēšot kontu vai saņemot 401, abi konta priekšskatījumi tiek notīrīti.
Paroles un sesijas atslēgas pārlūka glabātuvē netiek saglabātas.


### Modernā tēma

Sadaļā **Tēmas → Modernā** pieejams tumši zaļš noformējums ar noapaļotiem paneļiem
un zeltainām pogām, balstīts uz sākotnējo atjaunotā profila izskatu. Tas darbojas
sākumlapā, profilā, draugu un iestatījumu sadaļās, istabā un spēlē.
Izvēle tūlīt saglabājas pārlūkā, bet pieslēgtam lietotājam — arī kontā (`MODERN`).
Pēc atjauninājuma palaid `npm run db:generate`, `npm run db:migrate` un pārstartē serveri.


### Spēļu vēsture un profila statistika

Pieslēgtam lietotājam sākumlapā pieejama **Spēļu vēsture**, bet profilā — spēļu,
uzvaru, zaudējumu skaits un uzvaru procentuālā daļa no visām kārtām.
Uzskaita tikai servera pabeigtās multiplayer kārtas; revanšs ir jauna kārta.
Spēles pret botu, nepabeigtas spēles un aizvērtas gaidīšanas istabas neieskaitās.
Vēsture ielādējas pa 20 ierakstiem, bet statistiku DB apkopo atsevišķi no profila.

Pēc koda atjaunināšanas palaid `npm run db:generate`, `npm run db:migrate` un
pārstartē serveri. Migrācija `20261028030000_match_history` izveido kārtu un to
dalībnieku tabulas, kā arī pārnes saglabātos pabeigto multiplayer spēļu rezultātus.
Iepriekš ar revanšu pārrakstītas kārtas atjaunot nav iespējams.
Jaunas kārtas rezultāts un vēsture saglabājas vienā transakcijā; atkārtots
pabeigšanas pieprasījums nerada dublikātu. Konta dzēšana atsaista vēstures
dalībnieku no lietotāja, saglabājot anonīmu rezultātu.

API `GET /api/me/history?before=<cursor>` un `GET /api/me/statistics` atgriež tikai
sesijas lietotāja datus. Vēsturē netiek izpausti e-pasti, sesijas vai kārtis.
