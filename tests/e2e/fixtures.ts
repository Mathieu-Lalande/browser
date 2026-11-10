import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from "@playwright/test";

export type { ElectronApplication };

/** What the local server saw: favicon requests (with their headers), in order. */
export interface ServerLog {
  icons: { url: string; cookie?: string; gpc?: string }[];
  /** Texts the fake LibreTranslate server was asked to translate (ADR-036). */
  translations: { q: string[]; source: string; target: string; cookie?: string }[];
  /** `Range` headers of the requests for /files/resumable.bin (ADR-054); "" for a full request. */
  ranges: string[];
}

/** /files/resumable.bin: 40 chunks of 64 KB, each byte its offset modulo 251 (a resumed file must match). */
export const RESUMABLE_SIZE = 40 * 64 * 1024;
export const resumableBytes = (start: number, end: number): Buffer => Buffer.from(Array.from({ length: end - start }, (_, i) => (start + i) % 251));

type Fixtures = {
  /** Fresh profile directory, removed after the test. */
  profile: string;
  app: ElectronApplication;
  chrome: Page;
  server: { url: (path: string) => string; log: ServerLog };
};

/** Tiny filter list replacing the downloaded ones (BROWSER_TEST_FILTERS), so the blocker stays offline. */
const TEST_FILTERS = fileURLToPath(new URL("./filters.txt", import.meta.url));

/** Body of the files served under /files/ (except the slow one). */
export const DOWNLOAD_CONTENT = "%PDF-1.4 test download\n";

/** A 1×1 PNG, served as a favicon. */
export const ICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

/** 30 s of silence (8 kHz, 8-bit mono WAV), generated: no media file in the repository. */
const SILENT_WAV = (() => {
  const samples = 8000 * 30;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 128)]);
})();

/** A one-page PDF ("Bonjour PDF"), built with a correct cross-reference table. */
export const TINY_PDF = (() => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 44 >>\nstream\nBT /F1 24 Tf 40 100 Td (Bonjour PDF) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
})();

const query = (path: string, name: string) => new URL(path, "http://x").searchParams.get(name);

/**
 * A fake LibreTranslate (`POST /translate`): uppercases each text and reports English. It logs
 * what it was sent, so tests can check what left the page (and that no cookie came along).
 */
function fakeLibreTranslate(req: IncomingMessage, res: ServerResponse, log: ServerLog): void {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}") as { q?: string[] | string; source?: string; target?: string };
    const q = Array.isArray(body.q) ? body.q : [String(body.q ?? "")];
    log.translations.push({ q, source: body.source ?? "", target: body.target ?? "", cookie: req.headers.cookie });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ translatedText: q.map((text) => text.toUpperCase()), detectedLanguage: q.map(() => ({ confidence: 90, language: "en" })) }));
  });
}

/** Tiny local site so tests never touch the network. */
function startServer(): Promise<{ server: Server; origin: string; log: ServerLog }> {
  const log: ServerLog = { icons: [], translations: [], ranges: [] };
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    if (req.method === "POST" && path === "/translate") return fakeLibreTranslate(req, res, log);
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (path.startsWith("/icon")) {
      log.icons.push({ url: path, cookie: req.headers.cookie, gpc: req.headers["sec-gpc"] as string | undefined });
      if (path.startsWith("/icon.svg")) {
        res.setHeader("content-type", "image/svg+xml");
        return res.end(`<svg xmlns="http://www.w3.org/2000/svg"/>`);
      }
      if (path.startsWith("/icon-html")) return res.end("<h1>not an image</h1>");
      if (path.startsWith("/icon-huge")) {
        res.setHeader("content-type", "image/png");
        return res.end(Buffer.alloc(200 * 1024, 1));
      }
      res.setHeader("content-type", "image/png");
      res.setHeader("cache-control", "max-age=3600");
      res.end(ICON_PNG);
    } else if (path.startsWith("/favicon-page")) {
      // A page that sets a cookie and declares a favicon (the tab's session must fetch it).
      res.setHeader("set-cookie", `tabcookie=${query(path, "cookie") ?? "normal"}; path=/`);
      res.end(`<title>Favicon</title><link rel="icon" href="${query(path, "icon") ?? "/icon.png"}"><p>icon</p>`);
    } else if (path.startsWith("/theme-color")) {
      // Dynamic theme (ADR-037): a page declaring its color.
      res.end(`<title>Themed</title><meta name="theme-color" content="${query(path, "color") ?? "#e11d48"}"><p>themed</p>`);
    } else if (path.startsWith("/auto-popup")) {
      // Opens a popup as soon as it loads: no user gesture at all.
      res.end(`<title>Auto popup</title><script>window.open(${JSON.stringify(query(path, "to") ?? "/popped")});</script>`);
    } else if (path.startsWith("/auto-mailto")) {
      res.end(`<title>Auto mailto</title><script>location.href = "mailto:spam@example.com";</script>`);
    } else if (path.startsWith("/opener")) {
      res.end(
        `<title>Opener</title><style>button,a{display:block;width:200px;height:40px;margin:8px}</style>` +
          `<button id="two" onclick="window.open('/popped?a'); window.open('/popped?b')">two</button>` +
          `<button id="data" onclick="window.open('data:text/html,<title>phish</title>')">data</button>` +
          `<button id="app" onclick="window.open('app://browser/index.html')">app</button>` +
          `<a id="mail" href="mailto:hello@example.com">mail</a>`,
      );
    } else if (path.startsWith("/sso-start")) {
      // An SSO sign-in (Okta…): a named popup set up empty then sent to the login page, or opened
      // on it directly; the popup answers its opener, which names itself after the answer.
      res.end(
        `<title>Site</title><style>button{display:block;width:200px;height:40px;margin:8px}</style>` +
          `<button id="named" onclick="const w = window.open('', 'sso', 'width=500,height=600'); w.location = '/sso-login'">named</button>` +
          `<button id="direct" onclick="window.open('/sso-login', 'sso2', 'width=500,height=600')">direct</button>` +
          `<script>addEventListener("message", (e) => { document.title = "Signed in: " + e.data; });</script>`,
      );
    } else if (path.startsWith("/sso-login")) {
      res.end(`<title>SSO login</title><script>window.opener.postMessage("ok", "*"); setTimeout(() => window.close(), 1000);</script>`);
    } else if (path.startsWith("/push-storm")) {
      res.end(`<title>Storm</title><script>for (let i = 0; i < 200; i++) history.pushState(null, "", "/push-storm/" + i);</script>`);
    } else if (path.startsWith("/embedder")) {
      // A page embedding a frame of another origin (localhost vs 127.0.0.1) that asks for a permission.
      res.end(`<title>Embedder</title><iframe id="frame" src="${query(path, "frame") ?? ""}" allow="geolocation"></iframe>`);
    } else if (path.startsWith("/ads/")) {
      // Matches the test filter list: only reachable when shields are off.
      res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : "image/svg+xml");
      res.end(path.endsWith(".js") ? "window.adLoaded = true;" : `<svg xmlns="http://www.w3.org/2000/svg"/>`);
    } else if (path.startsWith("/shields")) {
      res.end(
        `<title>Shields</title><img src="/ads/banner.svg"><script src="/ads/banner.js"></script>` +
          `<div class="ad-box">ad</div><div class="site-ad">ad</div><p id="content">content</p>`,
      );
    } else if (path.startsWith("/cmp-onetrust")) {
      // A OneTrust-like consent banner (ADR-046): the page records which button was clicked.
      res.end(
        `<title>CMP OneTrust</title><p>article</p><div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;padding:20px;background:#eee">` +
          `<p>Nous utilisons des cookies.</p>` +
          `<button id="onetrust-accept-btn-handler" onclick="window.consent='accepted';this.closest('#onetrust-banner-sdk').remove()">Tout accepter</button>` +
          `<button id="onetrust-reject-all-handler" onclick="window.consent='rejected';this.closest('#onetrust-banner-sdk').remove()">Tout refuser</button>` +
          `</div></div>`,
      );
    } else if (path.startsWith("/cmp-late")) {
      // A Didomi-like banner that only shows up after a while (a CMP script loading late).
      res.end(
        `<title>CMP late</title><p>article</p><script>setTimeout(() => { document.body.insertAdjacentHTML("beforeend", ` +
          `'<div id="didomi-host"><div id="didomi-notice" style="position:fixed;bottom:0;padding:20px;background:#eee">` +
          `<button id="didomi-notice-agree-button" onclick="window.consent=\\'accepted\\';document.getElementById(\\'didomi-notice\\').remove()">Accepter</button>` +
          `<button id="didomi-notice-disagree-button" onclick="window.consent=\\'rejected\\';document.getElementById(\\'didomi-notice\\').remove()">Continuer sans accepter</button>` +
          `</div></div>'); }, 800);</script>`,
      );
    } else if (path.startsWith("/cmp-noreject")) {
      // A Cookiebot-like dialog without any refusal: hidden, never accepted.
      res.end(
        `<title>CMP no reject</title><p>article</p><div id="CybotCookiebotDialog" style="position:fixed;top:0;padding:20px;background:#eee">` +
          `<button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll" onclick="window.consent='accepted'">Autoriser tous les cookies</button></div>`,
      );
    } else if (path.startsWith("/js-check")) {
      // Whether scripts run on the page (per-site JavaScript switch, ADR-046).
      res.end(`<title>JS check</title><p id="out">static</p><script>document.title = "JS ran";</script>`);
    } else if (path.startsWith("/permission")) {
      res.end(`<title>Permission</title><p>asks for permissions</p>`);
    } else if (path.startsWith("/popup")) {
      res.end(`<title>Opener</title><a id="open" href="/second" target="_blank">open</a>`);
    } else if (path.startsWith("/internal-link")) {
      res.end(`<title>Internal link</title><a id="link" href="browser://settings">link</a><a id="popup" href="browser://settings" target="_blank">popup</a>`);
    } else if (path.startsWith("/doc.pdf") || path.startsWith("/attachment.pdf")) {
      // ADR-039: a PDF shown inline by the built-in viewer, and the same one sent as an attachment.
      res.setHeader("content-type", "application/pdf");
      if (path.startsWith("/attachment")) res.setHeader("content-disposition", 'attachment; filename="attachment.pdf"');
      res.end(TINY_PDF);
    } else if (path.startsWith("/files/")) {
      // Download targets: a document, an executable, and a slow one (to watch the progress).
      const name = path.slice("/files/".length);
      res.setHeader("content-type", name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
      if (name === "resumable.bin") {
        // ADR-054: validators and ranges; slow when downloaded from the start, fast when continued.
        const range = req.headers.range ?? "";
        log.ranges.push(range);
        res.setHeader("etag", '"resumable-v1"');
        res.setHeader("accept-ranges", "bytes");
        const start = Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0);
        if (start > 0) {
          res.statusCode = 206;
          res.setHeader("content-range", `bytes ${start}-${RESUMABLE_SIZE - 1}/${RESUMABLE_SIZE}`);
          res.setHeader("content-length", String(RESUMABLE_SIZE - start));
          return res.end(resumableBytes(start, RESUMABLE_SIZE));
        }
        res.setHeader("content-length", String(RESUMABLE_SIZE));
        let sent = 0;
        const timer = setInterval(() => {
          if (res.destroyed || sent >= RESUMABLE_SIZE) return clearInterval(timer), res.end();
          res.write(resumableBytes(sent, sent + 64 * 1024));
          sent += 64 * 1024;
        }, 250);
        return;
      }
      if (name === "slow.zip") {
        const chunk = Buffer.alloc(64 * 1024, 7);
        const chunks = 40;
        res.setHeader("content-length", String(chunk.length * chunks));
        let sent = 0;
        const timer = setInterval(() => {
          if (res.destroyed || sent === chunks) return clearInterval(timer), res.end();
          res.write(chunk);
          sent++;
        }, 250);
        return;
      }
      res.end(DOWNLOAD_CONTENT);
    } else if (path.startsWith("/downloads")) {
      res.end(
        `<title>Downloads</title><a id="pdf" href="/files/report.pdf" download>pdf</a>` +
          `<a id="exe" href="/files/setup.exe" download>exe</a><a id="slow" href="/files/slow.zip" download>slow</a>`,
      );
    } else if (path.startsWith("/find")) {
      res.end(
        `<title>Find</title><p>Le renard brun saute. Un renard, deux renards.</p>` +
          `<p>RENARD en majuscules, et encore un renard ici.</p><p style="margin-top:2000px">Dernier renard.</p>`,
      );
    } else if (path.startsWith("/embedded-video")) {
      // ADR-056: a small playing preview in the page, a larger player in a frame of another origin.
      res.end(
        `<title>Embedded video</title><canvas id="c" width="64" height="36"></canvas><video id="small" muted autoplay width="96" height="54"></video>` +
          `<iframe id="frame" src="${query(path, "frame") ?? ""}" width="520" height="320"></iframe>` +
          `<script>const c = document.getElementById("c"), g = c.getContext("2d"); let t = 0;` +
          `setInterval(() => { g.fillStyle = "hsl(" + (t++ * 9) % 360 + " 70% 50%)"; g.fillRect(0, 0, 64, 36); }, 40);` +
          `document.getElementById("small").srcObject = c.captureStream(25);</script>`,
      );
    } else if (path.startsWith("/video")) {
      // A playing video without any media file: a canvas stream.
      res.end(
        `<title>Video</title><canvas id="c" width="160" height="90"></canvas><video id="v" muted autoplay width="320" height="180"></video>` +
          `<script>const c = document.getElementById("c"), g = c.getContext("2d"); let t = 0;` +
          `setInterval(() => { g.fillStyle = "hsl(" + (t++ * 9) % 360 + " 70% 50%)"; g.fillRect(0, 0, 160, 90); }, 40);` +
          `document.getElementById("v").srcObject = c.captureStream(25);</script>`,
      );
    } else if (path.startsWith("/silence.wav")) {
      res.setHeader("content-type", "audio/wav");
      res.end(SILENT_WAV);
    } else if (path.startsWith("/media")) {
      // Media hub (ADR-035): a looping silent track with media session metadata.
      const title = query(path, "title") ?? "Morceau de test";
      res.end(
        `<title>Media</title><audio id="a" src="/silence.wav" loop autoplay></audio>` +
          `<script>navigator.mediaSession.metadata = new MediaMetadata(${JSON.stringify({
            title,
            artist: "Testeur",
            artwork: [{ src: "/icon.png", sizes: "96x96", type: "image/png" }],
          })});</script>`,
      );
    } else if (path.startsWith("/file-link")) {
      res.end(`<title>File link</title><a id="file" href="file:///etc/hostname">file</a>`);
    } else if (path.startsWith("/hints")) {
      // Asks for the full version list, like Google's sign-in pages (ADR-040).
      res.setHeader("accept-ch", "Sec-CH-UA-Full-Version-List");
      res.end(`<title>Page hints</title><h1>hints</h1>`);
    } else if (path.startsWith("/headers")) {
      // What the browser sent (user agent, client hints, languages…), as JSON.
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.headers));
    } else if (path.startsWith("/article")) {
      // A long article (reader mode, ADR-026) with hostile bits the reader must not carry over.
      const paragraph = (n: number) =>
        `<p>Paragraphe ${n} : la lecture sans distraction garde le texte, les liens et les images de l'article, ` +
        `et laisse de côté les menus, les publicités et les scripts. Ce paragraphe est assez long pour que ` +
        `Readability le compte comme du contenu, avec plusieurs phrases complètes et ponctuées.</p>`;
      res.end(
        `<!doctype html><html lang="fr"><head><title>Un article de test</title></head><body>` +
          `<nav><a href="/">Accueil</a> <a href="/about">À propos</a></nav>` +
          `<article><h1>Un article de test</h1><p class="byline">Par Ada Lovelace</p>` +
          [1, 2, 3].map(paragraph).join("") +
          `<p>Un <a href="/second">lien sûr</a> et un <a href="javascript:globalThis.__pwned=1">lien piégé</a>.</p>` +
          `<img src="/icon.png" alt="Icône de test" width="64" height="64" onerror="globalThis.__pwned=1">` +
          `<script>globalThis.__pwned = 1; document.body.dataset.ran = "1";</script>` +
          `<img src="data:," onerror="globalThis.__pwned=1">` +
          [4, 5, 6].map(paragraph).join("") +
          `<p id="last">Phrase finale du test.</p></article>` +
          `<footer>Pied de page</footer></body></html>`,
      );
    } else if (path.startsWith("/translate-page")) {
      // Page translation (ADR-036): text to translate, and text that must stay as it is.
      res.end(
        `<!doctype html><html lang="${query(path, "lang") ?? "en"}"><head><title>Translate me</title></head><body>` +
          `<h1 id="title">Hello world</h1><p id="text">The quick brown fox <b id="bold">jumps</b> over the dog.</p>` +
          `<pre id="pre">keep this pre</pre><p>Inline <code id="code">keep.this.code()</code> here.</p>` +
          `<script>globalThis.marker = "keep this script";</script><style>#title { color: #333 }</style>` +
          `<input id="field" value="keep this input"><textarea id="area">keep this area</textarea>` +
          `<div id="edit" contenteditable="true">keep this editable</div><p id="hidden" aria-hidden="true">keep this hidden</p>` +
          `<p id="no" translate="no">keep this brand</p><div id="late"></div></body></html>`,
      );
    } else if (path.startsWith("/annotate")) {
      // Highlights (ADR-037): a quote split by inline elements, repeated words, and a script.
      res.end(
        `<!doctype html><html><head><title>Annotate</title></head><body>` +
          `<h1>Notes de lecture</h1><p id="text">Le renard <b>brun</b> saute par-dessus le chien. Le renard dort.</p>` +
          `<script>document.body.dataset.ready = "1";</script><p id="other">Un autre paragraphe.</p></body></html>`,
      );
    } else if (path.startsWith("/boost")) {
      // A page to customize (boosts, ADR-029): an element to zap and some text.
      res.end(
        `<title>Boost</title><div class="promo"><div id="ad" style="width:240px;height:90px;background:#c33">Publicité</div></div>` +
          `<p id="text">Le contenu reste.</p>`,
      );
    } else if (path.startsWith("/address-form")) {
      // A French checkout form without autocomplete attributes (ADR-041); the POST lands on a welcome page.
      res.end(
        `<title>Adresse</title><form method="post" action="/welcome">` +
          `<label for="prenom">Prénom</label><input id="prenom" name="prenom">` +
          `<label for="nom">Nom</label><input id="nom" name="nom">` +
          `<label for="adresse">Adresse</label><input id="adresse" name="adresse">` +
          `<label for="cp">Code postal</label><input id="cp" name="cp">` +
          `<label for="ville">Ville</label><input id="ville" name="ville">` +
          `<label for="pays">Pays</label><select id="pays" name="pays"><option value="">—</option><option value="FR">France</option><option value="BE">Belgique</option></select>` +
          `<button id="submit">Valider</button></form>`,
      );
    } else if (path.startsWith("/login")) {
      // A plain login form (ADR-025); the POST lands on a welcome page.
      res.end(
        `<title>Login</title><form method="post" action="/welcome">` +
          `<input id="user" name="user" autocomplete="username"><input id="pass" name="pass" type="password">` +
          `<button id="submit">Se connecter</button></form>`,
      );
    } else if (path.startsWith("/context")) {
      // Right-click targets for the page context menu (ADR-021); sets a first-party cookie too.
      res.setHeader("set-cookie", "ctx=1; path=/");
      res.end(
        `<title>Context</title><style>a,img,p,input{display:block;margin:12px;width:200px;height:40px}</style>` +
          `<a id="link" href="/second">Second</a><a id="file" href="file:///etc/hostname">file</a>` +
          `<img id="img" src="/icon.png"><p id="text">un renard brun</p><input id="field" value="bonjour">`,
      );
    } else if (path.startsWith("/tp-cookie")) {
      // An image that sets a cookie: third-party when embedded by another site.
      // SameSite=None (Secure, allowed on localhost): otherwise Chromium refuses it cross-site anyway.
      res.setHeader("set-cookie", "tp=1; Path=/; SameSite=None; Secure");
      res.setHeader("content-type", "image/png");
      res.end(ICON_PNG);
    } else if (path.startsWith("/embeds-third-party")) {
      res.end(`<title>Third party</title><img id="tp" src="${query(path, "src") ?? ""}">`);
    } else if (path.startsWith("/long")) {
      // Captures (ADR-031): a page much taller than the window, with a box of known size.
      res.end(
        `<title>Long</title><body style="margin:0"><div id="box" style="width:240px;height:120px;margin:40px;background:#2b8a3e">box</div>` +
          `<div style="height:4000px;background:linear-gradient(#fff,#36c)">long</div></body>`,
      );
    } else if (path.startsWith("/panel-app")) {
      // A web app for a panel (ADR-047): its unread count in the title.
      res.end(`<title>(3) Discussions</title><h1>Messagerie</h1><p>Trois messages non lus.</p>`);
    } else if (path.startsWith("/nopip-video")) {
      // A playing video whose site refuses picture-in-picture (ADR-047).
      res.end(
        `<title>No PiP</title><canvas id="c" width="160" height="90"></canvas><video id="v" muted autoplay disablepictureinpicture width="320" height="180"></video>` +
          `<script>const c = document.getElementById("c"), g = c.getContext("2d"); let t = 0;` +
          `setInterval(() => { g.fillStyle = "hsl(" + (t++ * 9) % 360 + " 70% 50%)"; g.fillRect(0, 0, 160, 90); }, 40);` +
          `document.getElementById("v").srcObject = c.captureStream(25);</script>`,
      );
    } else if (path.startsWith("/form")) {
      res.end(`<title>Form</title><form><input id="field" name="field" value=""><textarea id="notes"></textarea></form>`);
    } else {
      const name = path.slice(1) || "home";
      res.end(`<title>Page ${name}</title><h1>${name}</h1><a id="next" href="/next">next</a>`);
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, origin: `http://127.0.0.1:${port}`, log });
    }),
  );
}

/**
 * Launches the app on `profile`; tests that restart the app call it directly. `env`: extra test
 * hooks (e.g. `BROWSER_TEST_SLEEP_MS`).
 */
export function launch(
  profile: string,
  env: Record<string, string> = {},
  extraArgs: string[] = [],
  options: { sandboxed?: boolean } = {},
): Promise<ElectronApplication> {
  return electron.launch({
    // `sandboxed`: the OS sandbox on (see `sandboxAvailable`), through a wrapper that drops root.
    ...(options.sandboxed ? { executablePath: SANDBOX_WRAPPER } : {}),
    // `*.test` hosts resolve to the local server, to exercise HTTPS-Only on a "public" hostname.
    // `extraArgs`: what the OS would hand over (a link, a file to open: ADR-039).
    // `--disable-component-update`: no Widevine download per test profile, no startup wait (ADR-040).
    args: [...(options.sandboxed ? [] : ["--no-sandbox"]), "--disable-gpu", "--disable-component-update", "--host-resolver-rules=MAP insecure.test 127.0.0.1,MAP *.test 127.0.0.1", ".", ...(extraArgs.length ? ["--", ...extraArgs] : [])],
    // `BROWSER_TEST_SKIP_WELCOME`: a fresh profile would open on browser://welcome (ADR-043); the
    // onboarding test turns it back on with an empty value. `BROWSER_TEST_LOCALE`: the suite runs
    // in French whatever the machine's language (ADR-052); the i18n spec switches to English.
    env: {
      ...process.env,
      NO_PROXY: `${process.env.NO_PROXY ?? ""},.test,insecure.test`,
      no_proxy: `${process.env.no_proxy ?? ""},.test,insecure.test`,
      BROWSER_PROFILE_DIR: profile,
      BROWSER_TEST_FILTERS: TEST_FILTERS,
      BROWSER_TEST_SKIP_WELCOME: "1",
      BROWSER_TEST_LOCALE: "fr",
      ...(options.sandboxed ? { SANDBOXED_ELECTRON: electronBinary } : {}),
      ...env,
    },
  });
}

/** The chrome UI and the overlay are served from the app's own privileged scheme (ADR-018). */
const SANDBOX_WRAPPER = fileURLToPath(new URL("./sandboxed-electron.sh", import.meta.url));
const electronBinary = createRequire(import.meta.url)("electron") as unknown as string;

/**
 * Whether Electron can run with its OS sandbox here (ADR-053: the extension service-worker preload
 * needs sandboxed renderers): Linux user namespaces for an unprivileged user — as root (containers),
 * the wrapper runs it as "nobody" through `setpriv`. CI runners usually cannot (AppArmor).
 */
export const sandboxAvailable = (() => {
  if (process.platform !== "linux") return false;
  const asRoot = process.getuid?.() === 0;
  const probe = asRoot
    ? spawnSync("setpriv", ["--reuid=65534", "--regid=65534", "--clear-groups", "--", "unshare", "-Ur", "true"])
    : spawnSync("unshare", ["-Ur", "true"]);
  return probe.status === 0;
})();

export const CHROME_URL = "app://browser/index.html";
export const OVERLAY_URL = "app://browser/overlay.html";

export const isChrome = (page: Page) => page.url() === CHROME_URL;

/**
 * The chrome UI page of a launched app, once the sidebar is rendered. Not simply `firstWindow()`:
 * a restored tab's page is created right after the window and may be reported first.
 */
export async function chromeOf(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some(isChrome)).toBe(true);
  const page = app.windows().find(isChrome)!;
  await page.waitForSelector(".sidebar");
  return page;
}

const isOverlay = (page: Page) => page.url() === OVERLAY_URL;

/**
 * The overlay layer's page (palette, popovers). It is pre-warmed shortly after the window shows,
 * and its page only gets its URL once loaded: wait for it rather than looking it up once.
 */
export async function overlayOf(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some(isOverlay)).toBe(true);
  return app.windows().find(isOverlay)!;
}

export const test = base.extend<Fixtures>({
  server: async ({}, use) => {
    const { server, origin, log } = await startServer();
    await use({ url: (path) => `${origin}${path}`, log });
    server.close();
  },
  profile: async ({}, use) => {
    const profile = mkdtempSync(join(tmpdir(), "browser-e2e-"));
    await use(profile);
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        rmSync(profile, { recursive: true, force: true });
        break;
      } catch (error) {
        if (process.platform !== "win32" || attempt === 49) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  },
  app: async ({ profile }, use) => {
    const app = await launch(profile);
    await use(app);
    await app.close();
  },
  chrome: async ({ app }, use) => {
    await use(await chromeOf(app));
  },
});

export { expect } from "@playwright/test";

/** URLs of every tab view, read from the main process (tab pages are not Playwright windows). */
export async function tabUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const chromeIds = new Set(BrowserWindow.getAllWindows().map((window) => window.webContents.id));
    // Skips the chrome UI, the overlay layer (browser UI too) and DevTools.
    return webContents
      .getAllWebContents()
      .map((contents) => ({ id: contents.id, url: contents.getURL() }))
      .filter(({ id, url }) => !chromeIds.has(id) && !url.startsWith("devtools:") && !url.startsWith("app://browser/"))
      .map(({ url }) => url);
  });
}

/** Run a script in the tab page whose URL starts with `urlPrefix` (with a user gesture). */
export async function evalInTab<T>(app: ElectronApplication, urlPrefix: string, script: string): Promise<T> {
  return app.evaluate(
    ({ webContents }, [prefix, code]) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix));
      if (!page) throw new Error(`no tab at ${prefix}`);
      return page.executeJavaScript(code, true);
    },
    [urlPrefix, script] as const,
  ) as Promise<T>;
}

/**
 * A real click (trusted mouse input through the main process, as a user would) on `selector` in
 * the tab page whose URL starts with `urlPrefix`. Unlike `evalInTab`'s scripted click, it counts as
 * a user gesture for the popup blocker.
 */
export async function clickInTab(app: ElectronApplication, urlPrefix: string, selector: string): Promise<void> {
  await app.evaluate(
    async ({ webContents }, [prefix, target]) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix));
      if (!page) throw new Error(`no tab at ${prefix}`);
      const point: { x: number; y: number } = await page.executeJavaScript(
        `(() => { const r = document.querySelector(${JSON.stringify(target)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      page.sendInputEvent({ type: "mouseMove", x, y });
      page.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
      page.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
    },
    [urlPrefix, selector] as const,
  );
}

/** Opens a private window by running the registry command from `chrome`; resolves to its chrome UI. */
export async function openPrivateWindow(app: ElectronApplication, chrome: Page): Promise<Page> {
  type Api = { browser: { commands: { run(id: string): void }; getState(): Promise<{ isPrivate?: boolean }> } };
  const chromes = () => app.windows().filter(isChrome);
  const before = chromes().length;
  await chrome.evaluate(() => (globalThis as unknown as Api).browser.commands.run("new-private-window"));
  await expect.poll(() => chromes().length).toBe(before + 1);
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const page of chromes()) if ((await page.evaluate(() => (globalThis as unknown as Api).browser.getState()).catch(() => null))?.isPrivate) found = page;
      return !!found;
    })
    .toBe(true);
  await found!.waitForSelector(".sidebar");
  return found!;
}

/**
 * Opens the page options popover ("…" of the address bar, ADR-045: copy, reader, translation,
 * passwords…) and returns it.
 */
export async function pageOptions(app: ElectronApplication, chrome: Page): Promise<Locator> {
  await chrome.locator(".address").hover();
  await chrome.getByRole("button", { name: "Options de la page" }).click();
  const panel = (await overlayOf(app)).getByRole("dialog", { name: "Options de la page" });
  await expect(panel).toBeVisible();
  return panel;
}

/** Types `url` in the address bar of `chrome` and waits for the active tab's title. */
export async function visit(chrome: Page, url: string, title: string): Promise<void> {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

/** Tab page views attached to the window, with their bounds (the overlay layer excluded). */
export function attachedViews(app: ElectronApplication): Promise<{ url: string; x: number; y: number; width: number; height: number }[]> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) =>
    BrowserWindow.getAllWindows()[0]
      .contentView.children.filter((view) => view instanceof WebContentsView)
      .map((view) => ({ url: (view as InstanceType<typeof WebContentsView>).webContents.getURL(), ...view.getBounds() }))
      .filter((view) => view.url !== "app://browser/overlay.html"),
  );
}
