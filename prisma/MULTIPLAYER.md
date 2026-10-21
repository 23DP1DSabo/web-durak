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
Izstāšanās vai laika beigas noslēdz visu partiju ar vienu DURAK un pārējiem WIN.

Palaist: `npm run db:generate`, `npm run db:migrate`, pārstartēt serveri.
Pārbaudīt: `npm test`, `npm run test:multiplayer:db`. Pēdējais tests izveido un
izdzēš tikai savu pagaidu istabu; esošos kontus un pārējās spēles tas nemaina.
Ar `DURAK_AUTH_BENCHMARK=1` tas papildus izveido un pēc pārbaudes izdzēš divus
pagaidu kontus, pārbaudot arī sesijas atsaukšanu.

Katrai aktīvai partijai serveris uztur nākamā termiņa taimeri. DB termiņus atjauno
startējot un ik pēc 30 sekundēm, tāpēc nav vajadzīga visu aktīvo spēļu atlase ik sekundi.
Saistītos datus apvieno Prisma `relationJoins`; pēc koda atjaunināšanas obligāti
ģenerē Prisma klientu. Šīs veiktspējas izmaiņas nepievieno DB laukus.
