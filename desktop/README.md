# Mappe Mentali per Mac

Questa cartella trasforma l'app web (`../mappe-mentali/index.html`) in una vera app per macOS, con Electron.

## Scaricare l'app
L'app viene costruita in automatico da GitHub Actions (flusso **App per Mac**) a ogni modifica.

1. Apri la scheda **Actions** del repository, poi l'ultima esecuzione di **App per Mac** riuscita.
2. In fondo alla pagina scarica **MappeMentali-mac** (è uno .zip con due file):
   - `MappeMentali-AppleSilicon.dmg` → Mac con chip M1, M2, M3, M4…
   - `MappeMentali-Intel.dmg` → Mac con processore Intel
3. Apri il `.dmg` e trascina **Mappe Mentali** nella cartella **Applicazioni**.

Se crei un tag `v1.0.0` (o simile), i `.dmg` vengono pubblicati anche in una **Release**, scaricabile senza accedere ad Actions.

## Primo avvio (app non firmata da Apple)
L'app non ha un certificato sviluppatore Apple (costa 99 $/anno), quindi la prima volta macOS la blocca:

1. Fai doppio clic su **Mappe Mentali** e chiudi l'avviso.
2. Apri **Impostazioni di Sistema → Privacy e sicurezza**.
3. In basso trovi «Mappe Mentali è stata bloccata»: clicca **Apri comunque** e conferma.

In alternativa, da Terminale:
```
xattr -dr com.apple.quarantine "/Applications/Mappe Mentali.app"
```
Dalla seconda volta si apre normalmente.

## Sviluppo
```
cd desktop
npm install
npm start          # apre l'app
npm run dist:mac   # costruisce l'app (solo su un Mac)
```
`npm start` e `npm run dist:mac` copiano prima l'ultima versione di `mappe-mentali/index.html`: basta modificare quel file.
