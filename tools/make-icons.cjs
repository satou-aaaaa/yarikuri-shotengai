// アプリのアイコン（icon-192.png・icon-512.png・icon-maskable-512.png）を作る。2色の日よけのお店。
// 使い方: node tools/make-icons.cjs（qa/ の playwright を使う）
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "qa", "node_modules", "playwright"));
const shop = (s) => `<g transform="translate(50 50) scale(${s}) translate(-50 -50)">
  <rect x="18" y="44" width="64" height="38" fill="#fbfcf8" stroke="#1d2a2a" stroke-width="3"/>
  <path d="M14 30h72l-4 16H18z" fill="#fbfcf8" stroke="#1d2a2a" stroke-width="3"/>
  <path d="M18 30h12l-1 16h-11zM42 30h12v16H42zM66 30h12l4 16h-11z" fill="#0b6e60"/>
  <path d="M30 30h12v16H30zM54 30h12v16H54z" fill="#86306f"/>
  <rect x="28" y="56" width="18" height="26" fill="#1d2a2a"/><rect x="54" y="56" width="20" height="14" fill="#b4471a"/></g>`;
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const [name, s, scale] of [["icon-192.png", 192, 1], ["icon-512.png", 512, 1], ["icon-maskable-512.png", 512, 0.72]]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<body style="margin:0"><svg width="${s}" height="${s}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#eef1ea"/>${shop(scale)}</svg></body>`);
    await p.screenshot({ path: path.join(__dirname, "..", name), clip: { x: 0, y: 0, width: s, height: s } });
  }
  await b.close();
})();
