// Logs into the app (localhost:3000) and leaves an authenticated session
// in a persistent Chrome profile, then navigates to the dashboard.
// Usage: node scripts/login-for-audit.mjs <userDataDir> <email> <password>
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const [profile, email, password, url] = process.argv.slice(2);
if (!profile || !email || !password) {
  console.error('usage: node scripts/login-for-audit.mjs <userDataDir> <email> <password> [url]');
  process.exit(1);
}
const APP_URL = url || 'http://localhost:3000/';

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!existsSync(CHROME)) {
  console.error('Chrome introuvable:', CHROME);
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir: profile,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  console.log('→ ouverture de la page de connexion…');
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  await page.waitForSelector('input[placeholder="name@mamathera.org"]', { timeout: 15000 });
  await page.type('input[placeholder="name@mamathera.org"]', email);
  await page.type('input[type="password"]', password);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').toLowerCase().includes('se connecter')
    );
    if (btn) btn.click();
  });
  console.log('→ connexion envoyée, attente du shell de l’app…');
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('Gestion des Élèves') ||
      document.body.innerText.includes('Tableau de bord'),
    { timeout: 25000 }
  );
  console.log('→ connecté. Navigation vers le tableau de bord…');
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.nav-item, button, a')].find((e) => {
      const t = (e.textContent || '').trim().toLowerCase();
      return t.includes('tableau de bord') || t.includes('dashboard');
    });
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.nav-item, button, a')].find((e) => {
      const t = (e.textContent || '').trim().toLowerCase();
      return t.includes('tableau de bord') || t.includes('dashboard');
    });
    if (el) el.click();
  });
  // Let lazy chunks + data settle
  await new Promise((r) => setTimeout(r, 6000));
  console.log('→ session sauvegardée dans le profil. URL:', page.url());
} finally {
  await browser.close();
}
