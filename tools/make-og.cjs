// SNS 用の絵（og.png 1200×630）を作る。題と、店の並んだ通りの絵（日によって変わる中身は入れない）。
// 使い方: node tools/make-og.cjs（qa/ の playwright を使う）
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "qa", "node_modules", "playwright"));
const Y = require(path.join(__dirname, "..", "rules.js"));
const L = ["yasai", "ie", "cafe", "hon", "pan", "ie", "pan", "cafe", "yasai", "hon", "hon", "cafe", "ie", "yasai", "pan", "pan", "yasai", "hon", "cafe", "ie", null, "ie", "pan", null, "hon"];
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const cells = L.map((k, i) => `<div style="border-radius:12px;background:#f6f8f3;display:flex;align-items:center;justify-content:center;font-size:52px;${k ? (i % 3 === 0 ? "box-shadow:inset 0 0 0 6px #0b6e60" : "outline:6px dashed #86306f;outline-offset:-8px") : ""}">${k ? Y.SHOPS[k].e : ""}</div>`).join("");
  await p.setContent(`<body style="margin:0;width:1200px;height:630px;background:#eef1ea;display:flex;align-items:center;gap:56px;padding:0 64px;box-sizing:border-box;font-family:'Hiragino Maru Gothic ProN','Zen Maru Gothic','Noto Sans CJK JP',sans-serif;color:#1d2a2a">
    <div style="flex:1"><div style="font-size:84px;font-weight:900;line-height:1.15">やりくり<br>商店街</div>
    <div style="font-size:34px;margin-top:24px;line-height:1.5">お店を並べて客を呼ぶ<br>2人対戦のボードゲーム</div>
    <div style="font-size:26px;margin-top:18px;color:#4d5b5a">置き場所・取り合い・借りる時期</div></div>
    <div style="display:grid;grid-template-columns:repeat(5,92px);grid-auto-rows:92px;gap:8px;background:#b9c4bd;padding:8px;border-radius:18px">${cells}</div></body>`);
  await p.screenshot({ path: path.join(__dirname, "..", "og.png") });
  await b.close();
})();
