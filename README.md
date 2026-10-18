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

Komandas biedram jāsaņem šīs izmaiņas no Git un privāti jāsaņem projekta `DATABASE_URL` no īpašnieka. To ievieto savā `.env`, kas izveidots pēc `.env.example`, saglabājot `APP_ORIGIN=http://localhost:3000` un `PORT=3002`. Tad palaiž `npm ci`, `npm run db:generate`, `npm run db:migrate` un atsevišķos termināļos `npm run server` un `npm run dev`. Lokāls XAMPP vai Docker šim pieslēgumam nav vajadzīgs.

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
