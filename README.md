# DuraKlash
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
