# Multiplayer glabāšana

Migrācija `20261021000000_multiplayer_state` pievieno `Speles` divus laukus:

- `speles_stavoklis` (`Json?`): servera partijas kārtis, kava, gājiens, atlikušie laiki un rezultāts.
- `versija` (`Int`, sākotnēji 0): stāvokļa versija vienlaicīgu gājienu aizsardzībai.

Parasts gājiens izmanto vienu atomāru `UPDATE ... WHERE versija = iepriekšējā_versija`
un pārbauda aktīvas spēles statusu. Serveris var izmantot pēdējo saglabāto stāvokli,
bet versijas pārbaude DB nepieļauj novecojušu stāvokļa pārrakstīšanu.
Gala rezultāti `Speles_speletaji.result` un spēles beigas tiek saglabāti vienā transakcijā.
Atbilde un paziņojumi spēlētājiem tiek nosūtīti tikai pēc veiksmīgas saglabāšanas.
JSON ar svešajām kārtīm nekad netiek atdots publiskajā API.
Viesu `speletaja_atslega` ir HttpOnly sīkdatnes SHA-256 jaucējvērtība;
publiskais dalībnieka ID nenodrošina piekļuvi viņa kārtīm vai darbībām.

Laiks glabājas milisekundēs kopā ar servera atjauninājuma laiku. Aktīvā spēlētāja
atlikušais laiks tiek aprēķināts arī pēc atvienošanās un servera pārstartēšanas.
Padošanās atzīmē spēlētāju JSON ar `out: true`, `exitReason: "resign"` un vienā
transakcijā saglabā viņa DURAK. Partija paliek ACTIVE, kamēr aktīvi vismaz divi
spēlētāji. Gala `result.losers` satur gan iepriekš padevušos, gan pēdējo zaudētāju;
viņiem visiem paliek DURAK. `result.loser` saglabāts savietojamībai. Laika beigas
joprojām noslēdz visu partiju. Šīm izmaiņām nav vajadzīga DB migrācija.

Palaist: `npm run db:generate`, `npm run db:migrate`, pārstartēt serveri.
Pārbaudīt: `npm test`, `npm run test:multiplayer:db`. Pēdējais tests izveido un
izdzēš tikai savu pagaidu istabu; esošos kontus un pārējās spēles tas nemaina.
Ar `DURAK_AUTH_BENCHMARK=1` tas papildus izveido un pēc pārbaudes izdzēš divus
pagaidu kontus, pārbaudot arī sesijas atsaukšanu.

Katrai aktīvai partijai serveris uztur nākamā termiņa taimeri. DB termiņus atjauno
startējot un ik pēc 30 sekundēm, tāpēc nav vajadzīga visu aktīvo spēļu atlase ik sekundi.
Saistītos datus apvieno Prisma `relationJoins`; pēc koda atjaunināšanas obligāti
ģenerē Prisma klientu. Šīs veiktspējas izmaiņas nepievieno DB laukus.

Izspēles JSON satur `bout` (izspēles numuru) un `finishedAttackers` (piemešanu
pabeigušos spēlētājus). Piemet tikai abi aktīvie aizsarga kaimiņi: galvenais
uzbrucējs vispirms, otrais kaimiņš pēc viņa apstiprinājuma. Jauna kārts vai nokaušana
neatceļ apstiprinājumu. `taking` fāze gaida abu kaimiņu apstiprinājumu pirms
kāršu paņemšanas; padošana sāk secību no jauna ap jauno aizsargu. Aizsardzības darbība norāda uzbrukuma kārts `targetId`, uzbrukums
var saturēt `cardIds` masīvu. Vienlaicīgas kāršu darbības var atkārtoti pārbaudīt
pret svaigu DB stāvokli tikai tajā pašā izspēlē; nosacītais ieraksts saglabājas,
un atkārtota izspēle ar jau izlietotu kārti vai pabeigtas izspēles numuru tiek noraidīta.
Neskaidra tīkla vai DB kļūda nerada automātisku atkārtotu gājienu.

Gājiena saglabāšanas nosacījums reģistrētam lietotājam pārbauda arī dalību,
aktīva konta statusu un neizbeigušos sesiju. Socket savienojumā saglabātā identitāte
neapiet DB autorizāciju. Saņēmēju sesiju pārbaudes sāk reizē ar saglabāšanu un
izmanto tikai konkrētā paziņojuma nosūtīšanai; tās nav ilgstoša sesiju kešatmiņa.
`DURAK_AUTH_BENCHMARK=1` DB tests pārbauda arī jau pievienotas sesijas atsaukšanu,
termiņa izbeigšanos, konta bloķēšanu un paziņojumu aizturēšanu bloķētam saņēmējam.
