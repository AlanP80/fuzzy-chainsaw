const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

app.setName('Mappe Mentali');

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 720,
    minHeight: 500,
    title: 'Mappe Mentali',
    backgroundColor: '#f5f6fb',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  // I link esterni si aprono nel browser; la finestra resta sempre sull'app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  // PNG, PDF e mappe salvate: chiede sempre dove salvare
  win.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: 'Salva',
      defaultPath: path.join(app.getPath('documents'), item.getFilename())
    });
  });
}

function buildMenu() {
  // Annulla/Ripeti, Salva, Apri e Stampa (⌘Z, ⌘S, ⌘O, ⌘P) li gestisce direttamente l'app
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'Informazioni su Mappe Mentali' },
        { type: 'separator' },
        { role: 'hide', label: 'Nascondi Mappe Mentali' },
        { role: 'hideOthers', label: 'Nascondi altre' },
        { role: 'unhide', label: 'Mostra tutte' },
        { type: 'separator' },
        { role: 'quit', label: 'Esci da Mappe Mentali' }
      ]
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'cut', label: 'Taglia' },
        { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'selectAll', label: 'Seleziona tutto' }
      ]
    },
    {
      label: 'Vista',
      submenu: [
        { role: 'togglefullscreen', label: 'Schermo intero' },
        { role: 'reload', label: 'Ricarica' }
      ]
    },
    {
      label: 'Finestra',
      submenu: [
        { role: 'minimize', label: 'Riduci a icona' },
        { role: 'zoom', label: 'Ingrandisci' },
        { role: 'close', label: 'Chiudi' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
