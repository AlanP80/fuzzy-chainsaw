// Prova automatica dell'app impacchettata su macOS (usata da GitHub Actions).
// Uso: node test/mac-smoke.js "<eseguibile dell'app>" "<cartella di foto>" "<cartella risultati>"
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [exe, photos, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const say = (...a) => console.log('[test]', ...a);

(async () => {
  const cfgDir = path.join(os.homedir(), 'Library', 'Application Support', 'AP PhotoViewer');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'settings.json'), JSON.stringify({ lastDir: photos, confirmTrash: true }));

  const app = await electron.launch({ executablePath: exe, env: { ...process.env, APV_LOG_STDOUT: '1' }, timeout: 60000 });
  app.process().stdout.on('data', d => process.stdout.write('[main] ' + d));
  app.process().stderr.on('data', d => process.stdout.write('[main-err] ' + d));
  const win = await app.firstWindow();
  win.on('console', m => say('console', m.type(), m.text()));
  win.on('pageerror', e => say('PAGEERROR', e.message));

  await win.waitForTimeout(4000);
  say('cartella:', await win.textContent('#crumbs'));
  say('conteggio:', await win.textContent('#count'));
  say('vuoto:', await win.$eval('#empty', e => (e.hidden ? '-' : e.textContent)));
  await win.waitForTimeout(8000);
  const tiles = await win.$$eval('.tile.img', ts => ts.map(t => ({
    name: t.querySelector('.name').textContent,
    ok: t.querySelector('img').classList.contains('ok'),
    src: (t.querySelector('img').getAttribute('src') || '').slice(0, 140),
    w: t.querySelector('img').naturalWidth
  })));
  say('miniature:', JSON.stringify(tiles, null, 1));
  await win.screenshot({ path: path.join(outDir, '1-griglia.png') });

  const problems = [];
  if (!tiles.length || tiles.some(t => !t.ok)) problems.push('miniature mancanti: ' + tiles.filter(t => !t.ok).map(t => t.name).join(', '));
  // Prove dirette delle funzioni interne
  const files = fs.readdirSync(photos).filter(f => !f.startsWith('.')).map(f => path.join(photos, f)).filter(f => fs.statSync(f).isFile());
  for (const f of files) {
    const r = await win.evaluate(async p => {
      const out = { p };
      try { out.thumb = await window.api.thumb(p); } catch (e) { out.thumbErr = String(e); }
      if (out.thumb) {
        out.thumbImg = await new Promise(res => {
          const im = new Image();
          im.onload = () => res(`ok ${im.naturalWidth}x${im.naturalHeight}`);
          im.onerror = () => res('ERRORE caricamento');
          im.src = window.api.fileUrl(out.thumb);
        });
      }
      try { out.preview = await window.api.preview(p, true); } catch (e) { out.previewErr = String(e); }
      try {
        out.img = await new Promise(res => {
          const im = new Image();
          im.onload = () => res(`ok ${im.naturalWidth}x${im.naturalHeight}`);
          im.onerror = () => res('ERRORE caricamento');
          im.src = window.api.fileUrl(out.preview || p);
        });
      } catch (e) { out.imgErr = String(e); }
      return out;
    }, f);
    say('file:', JSON.stringify(r));
    if (!r.thumb || (r.thumbImg || '').startsWith('ERRORE')) problems.push('miniatura: ' + path.basename(f));
    if ((r.img || '').startsWith('ERRORE')) problems.push('anteprima: ' + path.basename(f));
  }

  // Clic sulla prima miniatura → viewer
  const first = await win.$('.tile.img');
  if (first) {
    await first.click();
    await win.waitForTimeout(4000);
    say('viewer visibile:', await win.$eval('#viewer', v => !v.hidden));
    say('viewer:', await win.textContent('#v-name'), '|', await win.textContent('#v-pos'), '| zoom', await win.textContent('#v-zoom'));
    say('immagine viewer:', await win.$eval('#vimg', i => `${i.naturalWidth}x${i.naturalHeight} ${(i.getAttribute('src') || '').slice(0, 120)}`));
    say('avviso:', await win.$eval('#toast', t => (t.hidden ? '-' : t.textContent)));
    await win.screenshot({ path: path.join(outDir, '2-viewer.png') });
    for (let i = 0; i < tiles.length - 1; i++) {
      await win.keyboard.press('ArrowRight');
      await win.waitForTimeout(i === 0 ? 1500 : 6000);
      say('→', await win.textContent('#v-name'), '|', await win.$eval('#vimg', im => `${im.naturalWidth}x${im.naturalHeight}`), '| zoom', await win.textContent('#v-zoom'), '| avviso', await win.$eval('#toast', t => (t.hidden ? '-' : t.textContent)));
    }
    await win.screenshot({ path: path.join(outDir, '3-ultima.png') });
  }
  await app.close();
  if (problems.length) { say('PROBLEMI:', problems.join(' | ')); process.exit(1); }
  say('FINE: tutto ok');
})().catch(e => { console.error('[test] ERRORE', e); process.exit(1); });
