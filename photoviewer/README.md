# AP PhotoViewer

Visualizzatore di immagini per Mac: semplice, veloce, senza funzioni di modifica.

- **Naviga** tra le cartelle del Mac, i dischi esterni e le cartelle cloud del Finder (iCloud Drive, Dropbox, Google Drive, OneDrive).
- **Tutti i formati**: JPG, PNG, HEIC, TIFF, PSD, GIF, WebP e RAW (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2…). I RAW vengono sviluppati dal motore di macOS, come in Anteprima.
- **Miniature** con grandezza regolabile; un clic apre il viewer.
- **Viewer** con zoom (pizzica, ⌘ + rotella, rotella del mouse, doppio clic), spostamento trascinando e frecce ← → per passare da una foto all'altra.
- **Info EXIF** (tasto `I`): fotocamera, obiettivo, tempo, diaframma, ISO, focale, data.
- **Coppie RAW + JPG** unite in una sola miniatura (tasto `R` nel viewer per passare dall'una all'altra).
- **Filtra e ordina** per nome, data, tipo o dimensione; cerca per nome.
- **Presentazione** (Spazio) e **schermo intero** (F).
- **Apri in Pixelmator Pro** (⌘E), con un'altra app o **Mostra nel Finder**.
- **Sposta nel Cestino** (⌘⌫), recuperabile dal Cestino del Mac.

Premi `?` nell'app per vedere tutte le scorciatoie.

## Scaricare l'app
L'app viene costruita in automatico da GitHub Actions (flusso **AP PhotoViewer per Mac**) a ogni modifica della cartella `photoviewer/`.

1. Apri la scheda **Actions** del repository, poi l'ultima esecuzione riuscita di **AP PhotoViewer per Mac**.
2. In fondo alla pagina scarica **APPhotoViewer-mac** (uno .zip con due file):
   - `APPhotoViewer-AppleSilicon.dmg` → Mac con chip M1, M2, M3, M4…
   - `APPhotoViewer-Intel.dmg` → Mac con processore Intel
3. Apri il `.dmg` e trascina **AP PhotoViewer** nella cartella **Applicazioni**.

Quando le modifiche arrivano su `main`, i `.dmg` vengono pubblicati anche in una **Release** (`photoviewer-v` + versione di `photoviewer/package.json`), scaricabile senza login dalla pagina **Releases**.

## Primo avvio (app non firmata da Apple)
1. Fai doppio clic su **AP PhotoViewer** e chiudi l'avviso.
2. Apri **Impostazioni di Sistema → Privacy e sicurezza**.
3. In basso trovi «AP PhotoViewer è stata bloccata»: clicca **Apri comunque** e conferma.

In alternativa, da Terminale:
```
xattr -dr com.apple.quarantine "/Applications/AP PhotoViewer.app"
```
La prima volta che apri Scrivania, Documenti, Download o un disco esterno, macOS chiede il permesso: rispondi **Consenti**.

## Da sapere
- I RAW vengono mostrati come li sviluppa macOS: le modifiche fatte in Lightroom/Camera Raw (file `.xmp`) non sono visibili.
- Il primo sviluppo di un RAW richiede un attimo; poi resta in cache e l'app prepara in anticipo le foto vicine. La cache si svuota dal menu **AP PhotoViewer → Svuota la cache delle anteprime**.
- Con iCloud «Ottimizza spazio» le foto non ancora scaricate vengono prima scaricate da macOS.

## Sviluppo
```
cd photoviewer
npm install
npm start          # apre l'app
npm run dist:mac   # costruisce l'app (solo su un Mac)
```
