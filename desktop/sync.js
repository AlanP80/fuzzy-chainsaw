// Copia l'app web (un unico file HTML) dentro il pacchetto desktop
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'mappe-mentali', 'index.html');
const dest = path.join(__dirname, 'app', 'index.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log('Copiato', path.relative(process.cwd(), src), '→', path.relative(process.cwd(), dest));
