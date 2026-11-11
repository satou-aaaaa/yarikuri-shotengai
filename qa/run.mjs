// やりくり商店街の検査。きまり（1000局の対局・3年分の今日の盤・作り直し）・2人対戦と1人用を通しで遊ぶ・続きから・古いタブ・
// 今日の盤は1日1回・あとから・記録と実績・遊び方・保存できないときの帯・印刷の7枚・スマホ幅・PWA・引き継ぎ・見やすさ を確かめる。
// 使い方: node qa/run.mjs   失敗があれば終了コード 1。結果は qa-report/report.md。
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { checkTransfer } from "./transfer-check.mjs";
import { checkSwStall } from "./sw-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(path.join(root, "index.html")).href;
const printUrl = pathToFileURL(path.join(root, "print.html")).href;
const liteUrl = pathToFileURL(path.join(root, "print-lite.html")).href;
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: String(detail).slice(0, 600) });
const Y = createRequire(import.meta.url)(path.join(root, "rules.js"));
const KEY = "yrk-v1";

// ===== 1. きまり（ブラウザを使わない） =====
{
  const deck = Y.deckOf(1);
  check("店札は5種類×6枚＝30枚で、10日×3枚をちょうど使い切る", deck.length === 30 && Y.KINDS.every((k) => deck.filter((d) => d === k).length === 6) && Y.DAYS * Y.MARKET === deck.length);
  // 第1回（2026-11-11）の今日の盤の並びを固定する（店の種類・並び・乱数を変えると過去の日の盤が変わる）
  const PIN = "ie,cafe,ie,pan,yasai,cafe,pan,hon,pan";
  const got = Y.deckOf(Y.seedOfDate("2026-11-11")).slice(0, 9).join(",");
  check("第1回（2026-11-11）の今日の盤の店札の順が変わっていない", got === PIN, got);
  let okDays = true, same = true, diff = 0, prev = "";
  for (let i = 0; i < 365 * 3; i++) {
    const d = new Date(Date.parse("2026-11-11") + i * 864e5).toISOString().slice(0, 10);
    const a = Y.deckOf(Y.seedOfDate(d)).join(",");
    if (a !== Y.deckOf(Y.seedOfDate(d)).join(",")) same = false;
    if (a.split(",").length !== 30) okDays = false;
    if (a !== prev) diff++; prev = a;
  }
  check("今日の盤（3年分）：同じ日はいつ作っても同じ・どの日も30枚・毎日ちがう並び", okDays && same && diff === 365 * 3);

  // 客の数のきまり
  const B = () => new Array(25).fill(null);
  let b = B(); b[12] = { t: "pan", o: "a" }; b[13] = { t: "cafe", o: "b" }; b[7] = { t: "hon", o: "b" };
  check("パン屋はとなりの喫茶1軒で +1（相手の店でも）", Y.cust(b, 12) === 3);
  check("喫茶はとなりのパン屋・本屋で +1ずつ（ななめは数えない）", Y.cust(b, 13) === 2 && Y.cust(b, 7) === 3);
  b = B(); b[0] = { t: "yasai", o: "a" }; b[1] = { t: "ie", o: "b" }; b[5] = { t: "ie", o: "a" };
  check("八百屋はとなりの住宅1軒につき +2（住宅の +1 と八百屋の +1）・住宅の客は0", Y.cust(b, 0) === 5 && Y.cust(b, 1) === 0 && Y.income(b, "b") === 0);
  b = B(); b[0] = { t: "hon", o: "a" }; b[1] = { t: "hon", o: "b" }; b[2] = { t: "hon", o: "b" };
  check("同じ種類の店が相手の店ととなり合うと −1（自分の店どうしは減らない）", Y.cust(b, 0) === 2 && Y.cust(b, 1) === 2 && Y.cust(b, 2) === 3);
  b = B(); b[0] = { t: "cafe", o: "a" }; b[1] = { t: "cafe", o: "b" }; b[5] = { t: "cafe", o: "b" };
  check("客は0で止めない（紙の客メーターは、置いたときの増減を足すだけで合う）", Y.cust(b, 0) === -1);
  {
    // 客メーター：置くたびに delta（自分・相手）と増築の UP_ADD を足していくと、いつでも income と同じ（基本・上級とも200局）
    let ok = true, why = "";
    for (const adv of [false, true]) for (let s = 1; s <= 200 && ok; s++) {
      const g = Y.newGame(s * 31, { adv }), mt = { a: 0, b: 0 };
      while (!g.over) { const mv = Y.aiMove(g, "normal");
        if (mv.a === "pick") { const d = Y.delta(g.board, g.market[mv.m], mv.i, g.turn, adv); mt[g.turn] += d.me; mt[Y.other(g.turn)] += d.op; }
        if (mv.a === "up") mt[g.turn] += Y.UP_ADD;
        Y.apply(g, mv);
        for (const o of ["a", "b"]) if (mt[o] !== Y.income(g.board, o, adv)) { ok = false; why = `${adv ? "上級" : "基本"} 種${s * 31} ${o} メーター${mt[o]}・客${Y.income(g.board, o, adv)}`; } }
    }
    check("客メーター：置いたときの増減を足していくと、いつでも客の合計と同じ（400局）", ok, why);
  }
  {
    // 陣取り：商店会（つながった自分の店のいちばん大きいかたまり）と通り（横・たて10列で多いほう）
    const t = B(); for (const i of [0, 1, 2, 7]) t[i] = { t: "ie", o: "a" }; t[4] = { t: "hon", o: "a" }; t[3] = { t: "pan", o: "b" }; t[8] = { t: "pan", o: "b" }; t[13] = { t: "pan", o: "b" };
    check("陣取り：商店会はつながった自分の店のいちばん大きいかたまりの軒数（ななめはつながらない）", Y.groupOf(t, "a") === 4 && Y.groupOf(t, "b") === 3, `${Y.groupOf(t, "a")}/${Y.groupOf(t, "b")}`);
    // 横1列目 a4・b1 → a。横2列目 a1・b1 → なし。横3列目 b1 → b。たて：0,1,2列 a、3列 b（3,8,13）、4列 a1(4)
    check("陣取り：通りは横5列・たて5列で店の多いほうに " + Y.LINE_PT + "点（同じならなし）", Y.linesOf(t, "a") === 5 && Y.linesOf(t, "b") === 2 && Y.terr(t, "a") === 4 + 5 * Y.LINE_PT, `${Y.linesOf(t, "a")}/${Y.linesOf(t, "b")}`);
    const u = B(); u[0] = { t: "pan", o: "a", up: true }; u[1] = { t: "pan", o: "b" }; u[2] = { t: "pan", o: "b" }; u[5] = { t: "hon", o: "a" };
    check("陣取り：2階建ての店は2軒と数える", Y.groupOf(u, "a") === 3 && Y.linesOf(u, "a") === 2 && Y.linesOf(u, "b") === 2, `${Y.groupOf(u, "a")}/${Y.linesOf(u, "a")}/${Y.linesOf(u, "b")}`);
    const g = Y.newGame(77); g.board = t;
    check("おわりの点＝お金−借り×5＋陣取り＋コミ（はじめに優先札を持った人に " + Y.KOMI + "点）", ["a", "b"].every((o) => Y.score(g, o) === g.p[o].money - Y.LOAN * g.p[o].loans + Y.terr(t, o) + (o === Y.tok0(77) ? Y.KOMI : 0)) && Y.komiOf(g, Y.tok0(77)) === Y.KOMI && Y.komiOf(g, Y.other(Y.tok0(77))) === 0);
  }
  b = B(); b[6] = { t: "pan", o: "a" };
  const d = Y.delta(b, "cafe", 7, "b");
  check("置いたときの増え方（delta）は、自分と相手の客メーターの差", d.me === 2 && d.op === 1, JSON.stringify(d));

  // 朝のせりを2人とも0で済ませ、優先札の1Pから札を取る形にする（きまりの検査用）
  const toPlay = (g) => { g.tok = "a"; Y.apply(g, { a: "bid", v: 0 }); Y.apply(g, { a: "bid", v: 0 }); return g; };
  // 借りる・返す・利息・おわり
  const g = Y.newGame(123);
  const ok1 = Y.apply(g, { a: "borrow" }) && Y.apply(g, { a: "borrow" }) && Y.apply(g, { a: "borrow" });
  const no4 = !Y.apply(g, { a: "borrow" });
  check("借りるのは3枚まで・1枚で5💰", ok1 && no4 && g.p.a.money === Y.START + 15 && g.p.a.loans === 3);
  Y.apply(g, { a: "repay" });
  check("返すと5💰減って借りが1枚へる", g.p.a.money === Y.START + 10 && g.p.a.loans === 2);
  toPlay(g); Y.apply(g, { a: "pass" }); const m0 = g.p.a.money; Y.apply(g, { a: "pass" });
  check("日のおわりに、借り1枚につき利息1💰（客0なら）・次の日は朝のせりから", g.p.a.money === m0 - 2 && g.day === 2 && g.phase === "bid" && g.turn === "a" && g.p.a.interest === 2);
  // 朝のせり（2026-11-11 satouさん「先攻後攻の有利不利が出ないように」）
  { const h = Y.newGame(9); h.tok = "b";
    const pre = !Y.legal(h, { a: "pick", m: 0, i: 0 }) && !Y.legal(h, { a: "pass" }) && !Y.legal(h, { a: "bid", v: Y.START + 1 }) && !Y.legal(h, { a: "bid", v: -1 }) && !Y.legal(h, { a: "bid", v: 1.5 }) && Y.legal(h, { a: "borrow" });
    Y.apply(h, { a: "bid", v: 2 }); Y.apply(h, { a: "bid", v: 1 });
    check("朝のせり：せりの間は札を取れない・額はお金の中の整数・多く出した人が先でその額だけ払う（もう一方は払わない）", pre && h.phase === "play" && h.turn === "a" && h.p.a.money === Y.START - 2 && h.p.b.money === Y.START && h.tok === "a");
    const k = Y.newGame(9); k.tok = "b"; Y.apply(k, { a: "bid", v: 3 }); Y.apply(k, { a: "bid", v: 3 });
    check("朝のせり：同じ額ならどちらも払わず、優先札を持つ人が先。優先札は毎朝となりへ回る", k.turn === "b" && k.p.a.money === Y.START && k.p.b.money === Y.START && k.tok === "a");
    let indep = true; for (let s = 1; s <= 200 && indep; s++) { const x = Y.newGame(s * 11); Y.apply(x, { a: "bid", v: 0 }); const v0 = Y.aiMove(x, "normal").v; x.bid.a = x.p.a.money; if (Y.aiMove(x, "normal").v !== v0) indep = false; }
    check("朝のせり：店主の額は、相手が入れた額を見ないで決める（200局）", indep);
    let ta = 0; for (let s = 1; s <= 1000; s++) if (Y.newGame(s * 7919).tok === "a") ta++;
    check("朝のせり：はじめに優先札を持つ人は種で決まり、1Pと2Pでかたよらない（1000局で45〜55%）", ta >= 450 && ta <= 550, `1P ${ta}`); }
  check("お金の足りない店札・埋まったマスには置けない", !Y.legal(toPlay(Y.newGame(5)), { a: "pick", m: 0, i: -1 }) && (() => { const h = toPlay(Y.newGame(5)); h.p.a.money = 0; return !Y.legal(h, { a: "pick", m: 0, i: 0 }); })() && (() => { const h = toPlay(Y.newGame(5)); h.p.a.money = 99; h.board[0] = { t: "ie", o: "b" }; return !Y.legal(h, { a: "pick", m: 0, i: 0 }) && Y.legal(h, { a: "pick", m: 0, i: 1 }); })());

  // 1000局：AI どうし・強さ・先手の有利・作り直し
  const greedy = (x) => { if (x.phase === "bid") return { a: "bid", v: 0 }; const me = x.turn, p = x.p[me]; let best = null; for (let m = 0; m < 3; m++) { const t = x.market[m]; if (!t || Y.SHOPS[t].c > p.money) continue; for (let i = 0; i < 25; i++) { if (x.board[i]) continue; const v = Y.delta(x.board, t, i, me).me * Y.daysLeft(x) - Y.SHOPS[t].c; if (!best || v > best.v) best = { v, m, i }; } } return best && best.v > 0 ? { a: "pick", m: best.m, i: best.i } : { a: "pass" }; };
  const play = (fa, fb, seed) => { const x = Y.newGame(seed), mv = []; let n = 0; while (!x.over && n++ < 300) { const m = (x.turn === "a" ? fa : fb)(x); if (!Y.apply(x, m)) return { bad: JSON.stringify(m) }; mv.push(m); } return { x, mv, n }; };
  let bad = "", loop = 0, rep = true, an = 0, bn = 0, nWin = 0, eBorrow = 0, nBorrow = 0;
  for (let s = 1; s <= 1000; s++) {
    const r = play((x) => Y.aiMove(x, "normal"), (x) => Y.aiMove(x, "normal"), s * 7919);
    if (r.bad) { bad = r.bad; break; }
    if (!r.x.over) loop++;
    if (s <= 100 && JSON.stringify(Y.replay(s * 7919, r.mv).p) !== JSON.stringify(r.x.p)) rep = false;
    const w = Y.winner(r.x); if (w === "a") an++; else if (w === "b") bn++;
    nBorrow += r.x.p.a.borrowed;
    const e = play((x) => Y.aiMove(x, "easy"), (x) => Y.aiMove(x, "normal"), s * 104729);
    if (e.bad || !e.x.over) { bad = bad || "easy"; break; }
    if (Y.winner(e.x) === "b") nWin++;
    eBorrow += e.x.p.a.borrowed;
  }
  check("店主どうしの1000局：できない手を出さず、どれも10日で終わる（借りる⇔返すをくり返さない）", !bad && loop === 0, bad || `${loop}局が終わらない`);
  check("種と手の並びから作り直すと同じ結果（続きから・古いタブの照らし合わせ）", rep);
  check("1Pと2Pの勝ちはどちらも45〜55%（朝のせりで先に取る人を決める）", an >= 450 && an <= 550 && bn >= 450 && bn <= 550, `1P ${an}・2P ${bn}`);
  check("借りることが得になる場面がある（ふつうの店主は借り、借りない店主に8割以上勝つ）", nBorrow > 300 && eBorrow === 0 && nWin >= 800, `ふつうの借り ${nBorrow}・やさしいの借り ${eBorrow}・ふつうの勝ち ${nWin}`);
  let gw = 0; for (let s = 1; s <= 300; s++) { const r = play(greedy, (x) => Y.aiMove(x, "easy"), s * 31); if (Y.winner(r.x) === "a") gw++; }
  check("やさしい店主は、目の前の得だけを見る遊び方と五分くらい（30〜70%）", gw >= 90 && gw <= 210, `${gw}/300`);
}

// ===== 1b. 上級ルール（opts.adv） =====
{
  const A = { adv: true };
  check("上級：何も渡さなければ基本ルール（行事の札・目標なし）", Y.newGame(9).adv === false && Y.newGame(9).events === null && JSON.stringify(Y.newGame(9).deck) === JSON.stringify(Y.newGame(9, A).deck));
  const ev = Y.eventsOf(Y.seedOfDate("2026-11-11"));
  check("上級：行事の札は12種から10日分・重なりなし・日付の種で同じ", ev.length === Y.DAYS && new Set(ev).size === Y.DAYS && ev.every((k) => Y.EV_KEYS.includes(k)) && Y.EV_KEYS.length === 12 && JSON.stringify(ev) === JSON.stringify(Y.eventsOf(Y.seedOfDate("2026-11-11"))));
  const gs = Y.goalsOf(77);
  check("上級：秘密の目標は8枚から2枚ずつ・4枚とも別", gs.a.length === 2 && gs.b.length === 2 && new Set([...gs.a, ...gs.b]).size === 4 && Y.GOAL_KEYS.length === 8);
  { const b = Array(25).fill(null); b[12] = { t: "pan", o: "a" }; b[0] = { t: "pan", o: "a" };
    check("上級：大通りの店は客+1・置く値段+1（基本ルールではふつう）", Y.cust(b, 12, true) === Y.SHOPS.pan.base + 1 && Y.cust(b, 12) === Y.SHOPS.pan.base && Y.costAt("pan", 12, true) === Y.SHOPS.pan.c + 1 && Y.costAt("pan", 0, true) === Y.SHOPS.pan.c && Y.costAt("pan", 12, false) === Y.SHOPS.pan.c); }
  const toPlay = (g) => { g.tok = "a"; Y.apply(g, { a: "bid", v: 0 }); Y.apply(g, { a: "bid", v: 0 }); return g; };
  { const g = toPlay(Y.newGame(5, A)); g.p.a.money = 99; g.board[1] = { t: "cafe", o: "a" }; g.board[2] = { t: "ie", o: "a" }; g.board[3] = { t: "hon", o: "b" };
    const c0 = Y.cust(g.board, 1, true), base = toPlay(Y.newGame(5)); base.p.a.money = 99; base.board[1] = { t: "cafe", o: "a" };
    check("上級：増築は自分の店だけ（住宅・相手の店・基本ルールではできない）", Y.legal(g, { a: "up", i: 1 }) && !Y.legal(g, { a: "up", i: 2 }) && !Y.legal(g, { a: "up", i: 3 }) && !Y.legal(g, { a: "up", i: 0 }) && !Y.legal(base, { a: "up", i: 1 }));
    const m0 = g.p.a.money; Y.apply(g, { a: "up", i: 1 });
    check("上級：増築するとその店の値段を払い、客+" + Y.UP_ADD + "・番が替わる・2回はできない", g.p.a.money === m0 - Y.SHOPS.cafe.c && Y.cust(g.board, 1, true) === c0 + Y.UP_ADD && g.turn === "b" && (g.turn = "a", !Y.legal(g, { a: "up", i: 1 }))); }
  { const b = Array(25).fill(null); b[11] = { t: "yasai", o: "a" }; b[0] = { t: "cafe", o: "a" };
    const base = Y.dayIncome(b, "a", true, null);
    check("上級：行事の札（大売り出し🥕1軒 +2・雨☕+1・お祭りは大通り+2・税は店1軒1💰）", Y.dayIncome(b, "a", true, "sale") === base + 2 && Y.dayIncome(b, "a", true, "rain") === base + 1 && Y.dayIncome(b, "a", true, "festival") === base + 2 && Y.dayIncome(b, "a", true, "tax") === base - 2 && Y.dayIncome(b, "a", false, "tax") === Y.income(b, "a")); }
  { const g = Y.newGame(3, A); g.events = g.events.map(() => "rateup"); Y.apply(g, { a: "borrow" }); toPlay(g); Y.apply(g, { a: "pass" }); const m0 = g.p.a.money; Y.apply(g, { a: "pass" });
    check("上級：金利が上がる日は利息2倍", g.p.a.interest === 2 && g.p.a.money === m0 + Y.dayIncome(g.board, "a", true, "rateup") - 2); }
  { const g = Y.newGame(3, A); g.goals.a = ["homes", "noloan"]; for (const i of [0, 1, 2]) g.board[i] = { t: "ie", o: "a" };
    check("上級：満たした目標の点がおわりの数に入る", Y.goalPts(g, "a") === Y.GOALS.homes.pt + Y.GOALS.noloan.pt && Y.score(g, "a") === g.p.a.money + Y.GOALS.homes.pt + Y.GOALS.noloan.pt + Y.terr(g.board, "a") + Y.komiOf(g, "a") && Y.score(Y.newGame(3), "a") === Y.START + Y.komiOf(Y.newGame(3), "a")); }
  const play = (fa, fb, seed) => { const x = Y.newGame(seed, A), mv = []; let n = 0; while (!x.over && n++ < 300) { const m = (x.turn === "a" ? fa : fb)(x); if (!Y.apply(x, m)) return { bad: JSON.stringify(m) }; mv.push(m); } return { x, mv }; };
  const N = (x) => Y.aiMove(x, "normal"), noUp = (x) => { const m = Y.aiMove(x, "normal"); return m.a === "up" ? { a: "pass" } : m; }, noB = (x) => { const m = Y.aiMove(x, "normal"); return m.a === "borrow" ? { a: "pass" } : m; };
  let bad = "", loop = 0, rep = true, an = 0, bn = 0, ups = 0, goals = new Set(), upW = 0, bW = 0;
  for (let s = 1; s <= 1000; s++) {
    const r = play(N, N, s * 7919);
    if (r.bad) { bad = r.bad; break; }
    if (!r.x.over) loop++;
    if (s <= 100) { const y = Y.replay(s * 7919, r.mv, A), pick = (g) => JSON.stringify([g.p, g.board, g.events, g.goals, Y.score(g, "a"), Y.score(g, "b")]); if (pick(y) !== pick(r.x)) rep = false; }
    const w = Y.winner(r.x); if (w === "a") an++; else if (w === "b") bn++;
    ups += r.mv.filter((m) => m.a === "up").length;
    for (const o of ["a", "b"]) for (const k of r.x.goals[o]) { const [h, n] = Y.goalProg(r.x, o, k); if (h >= n) goals.add(k); }
    if (s <= 500) { const u = s % 2 ? play(noUp, N, s * 131) : play(N, noUp, s * 131); if (Y.winner(u.x) === (s % 2 ? "b" : "a")) upW++;
      const b = s % 2 ? play(noB, N, s * 137) : play(N, noB, s * 137); if (Y.winner(b.x) === (s % 2 ? "b" : "a")) bW++; }
  }
  check("上級：店主どうしの1000局で、できない手を出さず10日で終わり、作り直すと同じ", !bad && loop === 0 && rep, bad || `${loop}局が終わらない`);
  check("上級：1Pと2Pの勝ちはどちらも45〜55%", an >= 450 && an <= 550 && bn >= 450 && bn <= 550, `1P ${an}・2P ${bn}`);
  check("上級：増築に意味がある（増築する店主が、しない店主に52%以上・80%以下で勝つ。強すぎない）", upW >= 260 && upW <= 400, `${upW}/500`);
  check("上級：借りることにも意味がある（借りる店主が8割以上勝つ）", bW >= 400, `${bW}/500`);
  check("上級：増築が使われ、8つの目標はどれも満たされることがある", ups > 500 && goals.size === 8, `増築 ${ups}・目標 ${[...goals].join(",")}`);
}

// ===== 2. ファイル =====
const html = readFileSync(path.join(root, "index.html"), "utf8");
const print = readFileSync(path.join(root, "print.html"), "utf8"), lite = readFileSync(path.join(root, "print-lite.html"), "utf8");
{
  const ext = [...(html + print + lite).matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https:\/\/fonts\.googleapis\.com(\/|$)/.test(u));
  check("外から読むのは文字（Google Fonts）だけ。スクリプト・広告・解析を入れない", ext.length === 0, ext.join(","));
  check("CSP で通信先を自分だけにしている（画面・印刷とも）", [html, print, lite].every((h) => /connect-src 'self'/.test(h) && !/connect-src[^;"]*https/.test(h)));
  check("Math.random は練習・2人対戦の種と回の id だけ（今日の盤・あとからは日付の種）", (html.match(/Math\.random/g) || []).length === 2 && !/Math\.random/.test(readFileSync(path.join(root, "rules.js"), "utf8")));
  {
    // 説明書（印刷・画面）の細かいところが rules.js の計算と同じか（2026-11-11 CodeRabbit #4：住宅・2倍の順・同点・マイナス）
    const B = Array(Y.N * Y.N).fill(null), m = Y.MAIN[0]; B[m] = { t: "ie", o: "a" }; B[0] = { t: "yasai", o: "a", up: true };

    check("上級：大通りの住宅は値段だけ +1・客は0（説明書と画面の文も同じ）", Y.cust(B, m, true) === 0 && Y.costAt("ie", m, true) === Y.SHOPS.ie.c + 1 && print.includes("🏠住宅は値段だけ +1。客は0のまま") && html.includes("住宅は値段だけ"));
    check("上級：行事の札はどれも「1軒につき」で、となりを見ない（2倍は無い。客メーターに足すだけ）", Y.custEv(B, 0, "sale") === Y.cust(B, 0, true) + 2 && Y.EV_KEYS.every((k) => !/2倍/.test(Y.EVENTS[k].txt) || k === "rateup") && !/となりの店/.test(Y.EVENTS.holiday.txt) && !print.includes("足してから2倍") && !html.includes("足してから2倍"));
    { const h = Array(Y.N * Y.N).fill(null); h[0] = { t: "ie", o: "a" }; h[1] = { t: "ie", o: "a" }; h[12] = { t: "hon", o: "a" }; h[2] = { t: "cafe", o: "a" };
      check("上級：連休は自分の🏠1軒 +1・道路工事は大通りの店1軒 −1・税は店1軒 −1（住宅のぞく）", Y.dayIncome(h, "a", true, "holiday") === Y.income(h, "a", true) + 2 && Y.dayIncome(h, "a", true, "work") === Y.income(h, "a", true) - 1 && Y.dayIncome(h, "a", true, "tax") === Y.income(h, "a", true) - 2); }
  { const g = Y.newGame(7); g.p.a.money = -2;
    check("朝のせり：お金がマイナスでも0は出せる（借りきって返せなくても次の日へ進める）。1以上は出せない", Y.legal(g, { a: "bid", v: 0 }) && !Y.legal(g, { a: "bid", v: 1 }));
    const ok = Y.replay(7, [{ a: "bid", v: 0 }, { a: "bid", v: 0 }]), old = Y.replay(7, [{ a: "pass" }, { a: "pass" }]);
    check("当てられない手（朝のせりの前の古い記録）で止まると bad にその番号が残る", ok.bad === undefined && old.bad === 0); }
    check("上級：同点のときは行事の札を入れない客で比べる（説明書と画面に書く）", /function winner[^}]*income\(g\.board, "a", g\.adv\)/.test(readFileSync(path.join(root, "rules.js"), "utf8")) && print.includes("客メーター（行事の札は入れない）") && html.includes("行事の札は入れない"));
    check("上級：お金が足りないときはマイナスのまま続く（説明書に書く）", print.includes("マイナスのまま続けます"));
  }
  check("チケット・回数制限・🔒で開くモードを入れない", !/🎫|チケット|ライフ|スタミナ|で開く|解放/.test(html));
  check("画面にお笑いの言葉を入れない", !/お笑い|ギャグ|ボケ|ツッコミ|なんでやねん/.test(html + print + lite));
  check("Ko-fi は結果の画面の1行（今日の盤で初めて勝ったとき）と下のリンクだけ", /const KOFI = "https:\/\/ko-fi\.com\/satouaaaaa";/.test(html) && /showKofi = MODE === "d" && w === "a" && !s\.kofi\[RUN\.date\]/.test(html));
  const og = (k) => (html.match(new RegExp(`<meta (?:property|name)="${k}" content="([^"]+)"`)) || [])[1] || "";
  const png = readFileSync(path.join(root, "og.png"));
  check("SNS で貼ると絵と題が出る（OGP・1200×630・絶対URL）", og("og:title") && og("og:description") && og("og:image") === "https://satou-aaaaa.github.io/yarikuri-shotengai/og.png" && og("twitter:card") === "summary_large_image" && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630);
  const fy = readFileSync(path.join(root, ".github/ISSUE_TEMPLATE/feedback.yml"), "utf8");
  check("感想フォームの name が3字以上で、名前・メールを聞かない", [...((fy.match(/^name:\s*(.+)$/m) || [])[1] || "").trim()].length >= 3 && !/id: (name|email|mail)/.test(fy));
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  check("README の URL のすぐ後ろに全角の字を続けない（Link check が URL の一部と読む）", !/https?:\/\/[\x21-\x7e]*[^\x00-\x7f]/.test(readme.replace(/\]\(https?:\/\/[^)\s]+\)/g, "").replace(/<https?:\/\/[^>\s]+>/g, "")));
  const sw = readFileSync(path.join(root, "sw.js"), "utf8"), mf = JSON.parse(readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  { const st = await checkSwStall(sw); check("PWA：本文の途中で通信が止まっても4秒で保存したものを返す・ふつうはネットの返事", st.ok, JSON.stringify(st)); }
  const shell = JSON.parse(sw.match(/SHELL = (\[[^\]]+\])/)[1]);
  const need = ["./index.html", "./rules.js", "./print.html", "./print-lite.html", "./transfer.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];
  check("PWA：画面のファイルを全部 SHELL に入れている（電波が無くても遊べる・印刷できる）", need.every((f) => shell.includes(f)), need.filter((f) => !shell.includes(f)).join(","));
  check("PWA：manifest のアイコン（maskable は別の絵）", mf.icons.some((i) => i.purpose === "maskable" && i.src === "icon-maskable-512.png") && mf.icons.filter((i) => !i.purpose).length === 2 && mf.start_url === "./");
  check("記録のキーは yrk-v1 だけ（引き継ぎの data-keys と同じ）", /const KEY = "yrk-v1";/.test(html) && /data-keys="yrk-v1"/.test(html));
  check("遊び方の「見た」は、わかった・Esc（cancel）・close のどれでも残す", /\$\("howto"\)\.addEventListener\("cancel"/.test(html) && /\$\("howto"\)\.addEventListener\("close"/.test(html) && /\$\("howto-ok"\)\.onclick = \(\) => \{ save\(/.test(html));
  check("店主の手は、画面が替わっていたら何もしない（setTimeout の中で gen を確かめる）", /if \(g !== gen \|\| !aiTurn\(\)\) return;/.test(html));
}

// ===== 3. 画面 =====
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const watch = (p) => { p.on("pageerror", (e) => errors.push(String(e))); return p; };
// at：日付を決めて開く（はじめの日のすぐ後は「あとから」の日が無く、検査が空回りするため）
const fresh = async (ctx, at) => { const p = watch(await ctx.newPage()); if (at) await p.clock.setFixedTime(new Date(at)); await p.goto(url); await p.evaluate((k) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify({ v: 1, tut: true })); }, KEY); await p.reload(); return p; };
// 上級では大通りの値段が高く、選べる札でも置ける所が無いことがある。そのときは選びなおさず店番
// 画面に出ている「次へ」（日のおわり・せりの結果・2Pに渡す）を押す。押したら true
const panel = async (p) => { for (const id of ["#nextday", "#bid-ok", "#hand-ok"]) { const b = await p.$(id); if (b) { await b.click(); return true; } } return false; };
const step1 = async (p) => { if (await panel(p)) return; const bg = await p.$("#bid-go"); if (bg) return bg.click(); const c = await p.$(".card[data-m]:not([disabled])"); if (c) { await c.click(); const cell = await p.$(".cell.can[data-i]"); if (cell) return cell.click(); } await p.click("#pass"); };
// 人が札を選べるところまで進める（せり・結果・日のおわりを押し、店主の番は待つ）。買える札が無ければ店番で進める
// （種は毎回ちがい、約5%の種ではじめの3枚が全部4💰より高い。2026-11-11 PR #4 の CI で時間切れになった）。待つ回は数えず、30秒で止める
const toPick = async (p) => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (await p.$(".card[data-m]:not([disabled])")) return true; if (await panel(p)) continue; if (await p.$("#bid-go")) { await p.click("#bid-go"); continue; } if (await p.$("#pass:not([disabled])")) { await p.click("#pass"); continue; } await p.waitForTimeout(120); } return false; };
// 手数が k 以上になり、人の番で止まるまで進める（待つ回は数えず、60秒で止める）
const stepTo = async (p, k) => { const t0 = Date.now(); while (Date.now() - t0 < 60000) { const st = await p.evaluate(() => ({ n: __yk.RUN.moves.length, t: __yk.G.turn })); const pend = await p.$("#nextday, #bid-ok, #hand-ok"); if (st.n >= k && st.t === "a" && !pend) return true; if (st.t !== "a" && !pend) { await p.waitForTimeout(150); continue; } await step1(p); } return false; };
// 人の番を、置ける店札のうち最初の1枚を最初の空き地に置いて進める（店主の番は待つ）
// 店主の番を待つ回は数えない（遅い CI で回数が尽きないように）。人の手を limit 回か、120秒で止める
const playOut = async (p, limit = 400) => {
  const t0 = Date.now();
  for (let k = 0; k < limit && Date.now() - t0 < 120000; ) {
    const st = await p.evaluate(() => ({ o: __yk.G ? __yk.G.over : true, t: __yk.G && __yk.G.turn, v: __yk.MODE === "v" }));
    if (await panel(p)) continue;
    if (st.o) return true;
    if (!st.v && st.t !== "a") { await p.waitForTimeout(120); continue; }
    await step1(p); k++;
  }
  return false;
};
let STEP = "";
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  STEP = "遊び方";
  // 遊び方
  { const p = watch(await ctx.newPage()); await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload();
    const shown = await p.evaluate(() => document.getElementById("howto").open);
    await p.click("#howto-ok"); const saved = await p.evaluate((k) => JSON.parse(localStorage.getItem(k)).tut === true, KEY);
    let esc = true; for (let i = 0; i < 10; i++) { await p.evaluate(() => localStorage.clear()); await p.reload(); await p.keyboard.press("Escape"); await p.reload(); if (await p.evaluate(() => document.getElementById("howto").open)) esc = false; }
    check("遊び方ははじめてだけ出て、「わかった」でも Esc で閉じても次から出ない（10回）", shown && saved && esc);
    await p.close(); }

  STEP = "2人対戦を通しで遊ぶ";
  // 2人対戦を通しで遊ぶ
  { const p = await fresh(ctx); await p.click("#go-v");
    const two = await p.evaluate(() => [...document.querySelectorAll(".who b")].map((b) => b.textContent).join("|"));
    await toPick(p); await p.click(".card[data-m]:not([disabled])");
    const pv = await p.$$eval(".cell.can .pv", (a) => a.length);
    await p.click(".cell.can");
    const done = await playOut(p);
    const res = await p.textContent(".res"), s = await p.evaluate(() => __yk.load());
    check("2人対戦：1P・2Pの名前で、店札を選ぶと空き地全部に増え方が出る", /●1P/.test(two) && /◆2P/.test(two) && pv === 25, `${two} ${pv}`);
    check("2人対戦：10日まで通しで遊べ、勝ち負けが出て、回数（two）を記録する・今日の盤の記録には入れない", done && /2Pの勝ち|1Pの勝ち|引き分け/.test(res) && s.st.two === 1 && Object.keys(s.days).length === 0, res);
    check("おわったら結果の見出しにフォーカスが移る", await p.evaluate(() => document.activeElement && document.activeElement.id === "h-end"));
    await p.close(); }

  STEP = "1人で今日の盤";
  // 1人で今日の盤
  { const p = await fresh(ctx); await p.click("#go-d");
    const firstMarket = await p.evaluate(() => __yk.G.market.join(","));
    const want = Y.deckOf(Y.seedOfDate(await p.evaluate(() => __yk.todayKey()))).slice(0, 3).join(",");
    const done = await playOut(p);
    const s = await p.evaluate(() => __yk.load()), t = await p.evaluate(() => __yk.todayKey());
    check("今日の盤：市場はだれでも同じ日付の並び・10日まで遊べて、今日の記録に残る", firstMarket === want && done && !!s.days[t] && s.st.games === 1, `${firstMarket} / ${want}`);
    await p.click("#home2");
    check("今日の盤を終えたら、ホームに結果が出て、今日はもう始められない", !(await p.$("#go-d")) && /今日の盤：/.test(await p.textContent("main")));
    { const m = (await p.textContent("main")).match(/今日の盤：[^（]*（(?:上級・)?(-?\d+)点 対 (-?\d+)点）/);
      check("ホームの今日の結果は、おわりの点（お金でなく点）で、記録の点と同じ", !!m && Number(m[1]) === s.days[t].s && Number(m[2]) === s.days[t].o, m ? m[0] : ""); }
    { const r = await p.evaluate(() => { const Y = __yk.Y, out = { basic: 0, same: 0, adv: 0, diff: 0 };
        for (let sd = 1; sd <= 20; sd++) for (const adv of [false, true]) { const g = Y.newGame(sd, { adv }), moves = []; let k = 0; while (!g.over && k++ < 400) { const mv = Y.aiMove(g, "normal"); moves.push(mv); Y.apply(g, mv); }
          const mm = __yk.maxMeter({ seed: sd, adv, moves }, "a"), mi = Math.max(...g.p.a.inc);
          if (adv) { out.adv++; if (mm !== mi) out.diff++; } else { out.basic++; if (mm === mi) out.same++; } }
        return out; });
      check("実績「大にぎわい」は日のおわりの客メーターの最大で数える（基本は収入と同じ・上級は行事の増減を入れないので収入とちがう局がある）", r.basic === 20 && r.same === 20 && r.diff > 0, JSON.stringify(r)); }
    check("カレンダーに今日の印（★か○）が出る", await p.evaluate(() => /[★○]/.test(document.querySelector(".cal .d.today").textContent)));
    const w = s.days[t].w;
    const kofiHtml = await p.evaluate(() => JSON.stringify(__yk.load().kofi));
    check("Ko-fi の1行は、今日の盤で勝ったときだけ1回", w ? /1/.test(kofiHtml) : kofiHtml === "{}", kofiHtml);
    // 別のタブで今日の盤を終えていたら、古いホームから始めない
    check("今日の盤を終えたあと、古い画面から今日の盤を始めても始まらない", await p.evaluate(() => { __yk.start("d", __yk.todayKey()); return __yk.MODE === null; }));
    await p.close(); }

  STEP = "朝のせりと日のおわり";
  // 朝のせり（1人）：札は押せず、額を決めると店主の額と一緒に開く。日のおわりは内わけを出し、「次の日へ」まで店主は動かない
  { const p = await fresh(ctx); await p.click("#go-p");
    const s0 = await p.evaluate(() => ({ go: !!document.getElementById("bid-go"), cards: document.querySelectorAll(".card[data-m]:not([disabled])").length, ph: __yk.G.phase }));
    await p.click("#bid-p"); const v1 = await p.textContent("#bid-v"); await p.click("#bid-go");
    await p.waitForSelector("#bid-ok", { timeout: 5000 });
    const r = await p.evaluate(() => { const l = __yk.G.log.filter((x) => x.a === "bid").pop(); return { l, txt: document.querySelector(".bid .vs").textContent, mv: __yk.RUN.moves[0] }; });
    check("朝のせり（1人）：はじめはせりで札は押せず、＋で額を上げて決めると、2人の額と先に選ぶ人が出る", s0.go && s0.cards === 0 && s0.ph === "bid" && /1/.test(v1) && r.mv.a === "bid" && r.mv.v === 1 && r.txt.includes(`${r.l.bids.a}💰`) && r.txt.includes(`${r.l.bids.b}💰`) && /先に選ぶ/.test(r.txt), JSON.stringify(r.l));
    const m0 = await p.evaluate(() => __yk.RUN.moves.length); await p.waitForTimeout(1500);
    check("せりの結果を出しているあいだは、店主も動かない", (await p.evaluate(() => __yk.RUN.moves.length)) === m0);
    await p.click("#bid-ok");
    const t0 = Date.now(); while (!(await p.$("#nextday")) && Date.now() - t0 < 30000) { const st = await p.evaluate(() => __yk.G.turn); if (st === "a" && !(await p.$("#bid-ok"))) await step1(p); else if (await p.$("#bid-ok")) await p.click("#bid-ok"); else await p.waitForTimeout(120); }
    const d = await p.evaluate(() => { const L = __yk.G.log.filter((x) => x.a === "day").pop(), G = __yk.G; return { inc: L.inc, money: { a: G.p.a.money, b: G.p.b.money }, gains: document.querySelectorAll(".cell .gain").length, shops: G.board.filter((c) => c && c.t !== "ie").length, mv: [...document.querySelectorAll(".dayend .mv")].map((e) => e.textContent), sum: [...document.querySelectorAll(".dayend .sum b")].map((e) => e.textContent), focus: document.activeElement && document.activeElement.id }; });
    check("日のおわり：店ごとに +💰 が浮かび、内わけ（客→+💰）とお金の前→後が出る", d.gains === d.shops && d.mv.length === 2 && d.mv[0].endsWith(`→ ${d.money.a}`) && d.mv[1].endsWith(`→ ${d.money.b}`) && d.focus === "h-de", JSON.stringify(d));
    const m1 = await p.evaluate(() => __yk.RUN.moves.length); await p.waitForTimeout(1500);
    check("日のおわりを出しているあいだは、だれも動けない（「次の日へ」で進む）", (await p.evaluate(() => __yk.RUN.moves.length)) === m1 && !(await p.$(".card[data-m]:not([disabled])")) && !!(await p.$("#pass[disabled]")));
    await p.click("#nextday");
    // 押したあとの描きかえを待ってから見る（すぐ見ると、遅い端末でまれに前の画面を読む）
    const nd = await p.waitForFunction(() => __yk.G.day === 2 && __yk.G.phase === "bid" && !!document.getElementById("bid-go"), null, { timeout: 5000 }).then(() => true, () => false);
    check("「次の日へ」で2日目の朝のせりになる", nd, await p.evaluate(() => JSON.stringify({ day: __yk.G.day, ph: __yk.G.phase, turn: __yk.G.turn })));
    await p.close(); }
  // 朝のせり（2人）：1Pの額は2Pに見せず、渡す画面をはさむ
  { const p = await fresh(ctx); await p.click("#go-v");
    await p.click("#bid-p"); await p.click("#bid-p"); await p.click("#bid-go");
    const h = await p.evaluate(() => ({ hand: !!document.getElementById("hand-ok"), go: !!document.getElementById("bid-go"), txt: document.querySelector(".bid").textContent }));
    await p.click("#hand-ok"); const v2 = await p.textContent("#bid-v"); await p.click("#bid-go");
    const res = await p.evaluate(() => document.querySelector(".bid .vs") && document.querySelector(".bid .vs").textContent);
    check("朝のせり（2人）：1Pが決めると2Pに渡す画面になり、1Pの額は出さない。2Pは0から決め、決めたら2人の額が開く", h.hand && !h.go && !/2💰/.test(h.txt) && /^0/.test(v2) && /2💰/.test(res || "") && /0💰/.test(res || ""), `${h.txt} / ${v2} / ${res}`);
    await p.close(); }
  { const p = await fresh(ctx); await p.click("#rl-a"); await p.click("#go-v"); await p.click("#bid-go");
    const pk = await p.evaluate(() => ({ hand: !!document.getElementById("hand-ok"), peek: !!document.getElementById("peek") }));
    await p.click("#hand-ok"); const pk2 = await p.evaluate(() => !!document.getElementById("peek"));
    check("上級2人：2Pに渡す画面のあいだは「目標を見る」が無い（1Pが2Pの目標を見られない）。渡したあとは出る", pk.hand && !pk.peek && pk2, JSON.stringify(pk));
    await p.close(); }
  // 古い記録（朝のせりの前）の途中経過は続きからに出さない・今日の結果は点で出す
  { const p = await fresh(ctx);
    await p.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); s.runs = { p: { mode: "p", seed: 7, moves: [{ a: "pass" }, { a: "pass" }], id: "old1" } }; localStorage.setItem(k, JSON.stringify(s)); }, KEY);
    await p.reload(); const t = await p.textContent("#go-p");
    check("朝のせりの前の古い途中経過は「続きから」に出さず、新しく始まる", !/続きから/.test(t) && (await p.evaluate(() => __yk.load().runs.p)) === null, t);
    await p.close(); }

  STEP = "続きから・古いタブ";
  // 続きから・古いタブ
  { const p = await fresh(ctx); await p.click("#go-p"); await stepTo(p, 4);
    const n = await p.evaluate(() => __yk.RUN.moves.length), seed = await p.evaluate(() => __yk.RUN.seed);
    await p.reload(); const btn = await p.textContent("#go-p"); await p.click("#go-p");
    const n2 = await p.evaluate(() => __yk.RUN.moves.length), seed2 = await p.evaluate(() => __yk.RUN.seed);
    check("練習を途中で閉じても、続きから同じ盤・同じ手数で始まる", /続きから/.test(btn) && n === n2 && seed === seed2 && n >= 2, `${n}→${n2}`);
    const q = watch(await ctx.newPage()); await q.goto(url); await q.click("#go-p");
    await stepTo(q, 6);
    const qn = await q.evaluate(() => __yk.RUN.moves.length);
    await p.evaluate(() => __yk.act({ a: "borrow" }));
    const pn = await p.evaluate(() => __yk.RUN.moves.length), msg = await p.textContent("#live");
    check("古いタブで手を打っても二重に進めず、別のタブの進み具合に合わせる", pn === qn && /別の画面で進んでいた/.test(msg), `${pn}/${qn} ${msg}`);
    await q.close(); await p.close(); }

  STEP = "あとから（7日前まで）";
  // あとから（7日前まで）。はじめの日から3日後に開き、あとからの日が必ずある日で確かめる
  { const p = await fresh(ctx, "2026-11-14T12:00:00+09:00");
    const late = await p.$$eval("[data-late]", (a) => a.map((b) => b.dataset.late));
    const t = await p.evaluate(() => __yk.todayKey());
    const okRange = late.every((d) => d < t && Date.parse(t) - Date.parse(d) <= 7 * 864e5 && d >= "2026-11-11");
    let rec = true;
    // 途中の日の ▶ をもう一度押しても、進めた手が消えない（PR #1 の CodeRabbit）
    let keep = true;
    if (late.length) { await p.click(`[data-late="${late[0]}"]`); await step1(p); const n1 = await p.evaluate(() => __yk.load().runs.a.moves.length); await p.evaluate(() => __yk.home()); await p.click(`[data-late="${late[0]}"]`); keep = n1 > 0 && (await p.evaluate(() => __yk.RUN.moves.length)) === n1; await p.evaluate(() => __yk.home()); }
    check("あとから：途中の日の ▶ を押すと続きから（進めた手が残る）", keep, late.join(","));
    if (late.length) { await p.click(`[data-late="${late[0]}"]`); const m = await p.evaluate(() => __yk.G.deck.slice(0, 3).join(",")); await playOut(p); const s = await p.evaluate(() => __yk.load()); rec = m === Y.deckOf(Y.seedOfDate(late[0])).slice(0, 3).join(",") && !!s.adays[late[0]] && Object.keys(s.days).length === 0 && JSON.stringify(s.kofi) === "{}"; }
    check("あとから：7日前まで・始めた日より後だけ。その日の盤で遊べ、今日の記録・連続・Ko-fi に入れない", late.length === 3 && okRange && rec, late.join(","));
    await p.close(); }

  STEP = "実績・記録の合わせ方";
  // 実績・記録の合わせ方
  { const p = await fresh(ctx);
    const r = await p.evaluate(() => { const A = __yk.ACH; __yk.save((s) => { s.st.wins = 3; s.st.nob = 1; }); const s = __yk.load(); return [A.length, A.filter((a) => a[3](s) >= a[4]).length]; });
    check("実績は10〜14個で、記録から数える", r[0] >= 10 && r[0] <= 14 && r[1] === 3, JSON.stringify(r));
    check("保存に失敗したあと別のタブが保存しても、両方の記録を合わせる", await p.evaluate((K) => { const s0 = __yk.load(); mem = JSON.stringify(Object.assign({}, s0, { t: 5, days: { "2000-01-01": { w: 1 } }, st: Object.assign({}, s0.st, { wins: 9 }) })); localStorage.setItem(K, JSON.stringify(Object.assign({}, s0, { t: 9, days: { "2000-01-02": { w: 0 } } }))); const r2 = __yk.load(); mem = null; return !!r2.days["2000-01-01"] && !!r2.days["2000-01-02"] && r2.st.wins === 9; }, KEY));
    await p.close(); }

  STEP = "店主の強さ";
  // 店主の強さ・2人対戦の「やり直し」で画面が残らない
  { const p = await fresh(ctx); await p.click("#lv-e"); await p.click("#go-p");
    check("店主の強さ（やさしい）を選べ、練習に持ちこまれる", await p.evaluate(() => __yk.RUN.lv === "easy"));
    await p.click("#back"); await p.waitForTimeout(900);
    check("ホームへ戻ったら店主は手を打たない", await p.evaluate(() => __yk.MODE === null && !!document.getElementById("go-v")));
    await p.close(); }

  STEP = "上級ルール";
  // 上級ルール：切り替え・行事の札・目標・大通り・増築・おわりの目標
  { const p = await fresh(ctx); await p.click("#rl-a");
    check("上級：ホームで基本／上級を切り替えられ、記録に残る", (await p.getAttribute("#rl-a", "aria-pressed")) === "true" && (await p.evaluate(() => __yk.load().rule)) === "adv");
    await p.click("#go-p");
    const v = await p.evaluate(() => ({ r: __yk.RUN.adv, g: __yk.G.adv, ev: document.querySelectorAll(".ev").length, gl: document.querySelectorAll(".goals li").length, ave: document.querySelectorAll(".cell.ave").length, tag: document.querySelector(".turn .tag") && document.querySelector(".turn .tag").textContent }));
    check("上級：練習が上級で始まり、行事の札3日分・自分の目標2つ・大通り5マスが出る", v.r === true && v.g === true && v.ev === 3 && v.gl === 2 && v.ave === 5 && v.tag === "上級", JSON.stringify(v));
    let up = false;
    // 増築できるまで：自分の店（住宅のぞく）が無ければ置き、あれば店番でお金をためる（いつも札を買うと、種によってはお金がたまらず一度も増築できない）。
    // 店主の番を待つ回は数えない（数で区切ると、遅い CI では増築できる日まで進まずに終わる。2026-11-11 PR #4 の CI で落ちた）。ゲームのおわりか90秒で止める
    const t0 = Date.now();
    while (!up && Date.now() - t0 < 90000) {
      if (await panel(p)) continue;
      const st = await p.evaluate(() => ({ o: __yk.G.over, t: __yk.G.turn }));
      if (st.t === "a" && (await p.$("#bid-go"))) { await p.click("#bid-go"); continue; }
      if (st.o) break; if (st.t !== "a") { await p.waitForTimeout(120); continue; }
      if (await p.$("#up:not([disabled])")) { await p.click("#up"); const c = await p.$(".cell[data-up]"); if (c) { const i = Number(await c.getAttribute("data-up")); await c.click(); up = await p.evaluate((i) => __yk.G.board[i].up === true && __yk.G.log.some((l) => l.a === "up" && l.who === "a"), i) && !!(await p.$(".cell .up")); } }
      else if (await p.evaluate(() => __yk.G.board.some((c) => c && c.o === "a" && c.t !== "ie"))) await p.click("#pass");
      else { const c = await p.$('.card[data-m]:not([disabled]):not([aria-label^="住宅"])'); if (c) { await c.click(); await p.click(".cell.can[data-i]"); } else await p.click("#pass"); } // 住宅は客0でお金がたまらない（住宅ばかり買うと 300局中26局で増築できずに終わった）
    }
    check("上級：「増築する」から自分の店を押すと2階建てになり、盤に「2F」が出る", up);
    check("上級：おわりまで遊べる", await playOut(p));
    const e = await p.evaluate(() => ({ h: document.querySelectorAll(".end ~ section h3, section h3").length, a: __yk.Y.score(__yk.G, "a"), m: __yk.G.p.a.money - 5 * __yk.G.p.a.loans + __yk.Y.goalPts(__yk.G, "a") + __yk.Y.terr(__yk.G.board, "a") + __yk.Y.komiOf(__yk.G, "a"), txt: document.body.textContent.includes("点の内わけ") && document.body.textContent.includes("秘密の目標") && document.body.textContent.includes("商店会") }));
    check("上級：おわりに両方の目標を見せ、目標の点を足して比べる", e.h >= 2 && e.a === e.m && e.txt, JSON.stringify(e));
    await p.close(); }
  { const p = await fresh(ctx); await p.click("#rl-a"); await p.click("#go-v");
    const hid = !(await p.$(".goals")); await p.click("#peek"); const shown = await p.$$eval(".goals li", (a) => a.length); const who = await p.evaluate(() => __yk.G.turn);
    await step1(p); const after = !(await p.$(".goals")) && (await p.evaluate(() => __yk.G.turn)) !== who;
    check("上級の2人対戦：目標は「見る」を押すまでかくれ、番が替わるとまたかくれる", hid && shown === 2 && after, `${hid}/${shown}/${after}`);
    await p.close(); }

  STEP = "チュートリアル";
  // チュートリアル：決まった盤で1歩ずつ。せり・札・置くは、やってみるまで次へ進めない。数は rules.js と同じ。いつでもとばせる（2026-11-11）
  { const c3 = await browser.newContext({ viewport: { width: 320, height: 700 } }); const p = await fresh(c3);
    await p.click("#go-tut");
    const t1 = await p.textContent("#h-tut"); await p.click("#tut-next");
    const lock1 = await p.$eval("#tut-next", (b) => b.disabled);
    await p.click('[data-tbid="1"]'); const bidTxt = await p.textContent(".tut");
    const ok1 = !(await p.$eval("#tut-next", (b) => b.disabled)); await p.click("#tut-next");
    await p.click('[data-tm="0"]'); const lock2 = await p.$eval("#tut-next", (b) => b.disabled); const msg2 = await p.textContent(".live");
    await p.click('[data-tm="1"]'); await p.click("#tut-next");
    const lock3 = await p.$eval("#tut-next", (b) => b.disabled);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    const small = await p.$$eval("button", (bs) => bs.filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim().slice(0, 10)));
    const best = await p.evaluate(() => { const c = [...document.querySelectorAll("[data-ti]")]; let b = null, v = -99; for (const e of c) { const n = Number(e.querySelector(".p").textContent); if (n > v) { v = n; b = e.dataset.ti; } } return { i: b, v }; });
    await p.click(`[data-ti="${best.i}"]`);
    const placed = await p.evaluate(() => ({ txt: document.querySelector(".tut").textContent, m: document.querySelector(".meterline b").textContent }));
    const exp = await p.evaluate((i) => { const Y = __yk.Y, b = Array(Y.N * Y.N).fill(null); b[12] = { t: "pan", o: "a" }; b[7] = { t: "ie", o: "a" }; b[16] = { t: "cafe", o: "b" }; const m0 = Y.income(b, "a"), d = Y.delta(b, "cafe", Number(i), "a"); return { m: m0 + d.me, d: d.me, cost: Y.SHOPS.cafe.c, start: Y.START }; }, best.i);
    check("チュートリアル：ホームから開き、せり・札・置くは、やってみるまで「次へ」が押せない", /ようこそ/.test(t1) && lock1 && ok1 && lock2 && lock3 && /喫茶を押して/.test(msg2), JSON.stringify({ lock1, ok1, lock2, lock3 }));
    check("チュートリアル：せりは同じ額なら優先札の人が先で、どちらも払わない", /同じ額なので、どちらも払いません/.test(bidTxt));
    check("チュートリアル：置いた所の増え方とメーターは rules.js の delta・income と同じ（いちばん増える所をほめる）", Number(placed.m) === exp.m && placed.txt.includes(`+${exp.d}`) && /いちばん増える所を選べました/.test(placed.txt), JSON.stringify({ placed: placed.m, exp }));
    await p.click("#tut-next"); const day = await p.textContent(".tut");
    check("チュートリアル：日のおわりは「はじめ − 喫茶 ＋ 客メーター」の💰", day.includes(`💰${exp.start - exp.cost} ＋ ${exp.m} ＝ 💰${exp.start - exp.cost + exp.m}`), day.slice(0, 160));
    await p.click("#tut-next"); await p.click("#tut-next"); const ter = await p.textContent(".tut");
    const te = await p.evaluate(() => { const Y = __yk.Y, b = Array(Y.N * Y.N).fill(null); const A = [0, 1, 2, 5, 7, 12, 13, 17], B = [3, 4, 8, 9, 14, 18, 19, 22]; const k = ["pan", "cafe", "ie", "hon", "yasai"]; A.forEach((i, n) => (b[i] = { t: k[n % 5], o: "a" })); B.forEach((i, n) => (b[i] = { t: k[(n + 2) % 5], o: "b" })); return [Y.groupOf(b, "a"), Y.groupOf(b, "b"), Y.linesOf(b, "a"), Y.linesOf(b, "b")]; });
    check("チュートリアル：陣取りの数（商店会・通り）は rules.js と同じ", ter.includes(`●${te[0]}点・◆${te[1]}点`) && ter.includes(`●${te[2]}列・◆${te[3]}列`), JSON.stringify(te));
    check("チュートリアル：幅320pxではみ出さず、押せる所は44px以上", w <= 320 && small.length === 0, `${w} ${small.join(",")}`);
    await p.click("#tut-next"); await p.click("#tut-play"); const mode = await p.evaluate(() => __yk.MODE);
    await p.click("#back"); await p.click("#go-tut"); await p.click("#tut-skip"); const back = !!(await p.$("#go-tut")) && (await p.evaluate(() => __yk.MODE)) === null;
    check("チュートリアル：おわりの「練習で遊んでみる」で練習が始まり、「とばす」でいつでもホームへ", mode === "p" && back, `${mode}/${back}`);
    await c3.close(); }

  STEP = "スマホ幅";
  // スマホ幅・押せる大きさ・色だけで分けない
  { const c2 = await browser.newContext({ viewport: { width: 320, height: 700 } }); const p = await fresh(c2);
    const homeW = await p.evaluate(() => document.documentElement.scrollWidth);
    await p.click("#go-v"); await toPick(p); await p.click(".card[data-m]:not([disabled])");
    const gameW = await p.evaluate(() => document.documentElement.scrollWidth);
    const small = await p.$$eval("button:not(.gone), a", (bs) => bs.filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim().slice(0, 10)));
    await p.click(".cell.can");
    const marks = await p.evaluate(() => [...document.querySelectorAll(".cell.a .mk, .cell.b .mk")].map((e) => e.textContent).join(""));
    check("幅320px でホーム・遊ぶ画面が横にはみ出さない", homeW <= 320 && gameW <= 320, `${homeW}/${gameW}`);
    check("押せる所は高さ44px以上", small.length === 0, small.join(","));
    check("どちらの店かは色だけでなく ●◆ の印と、実線・破線の枠でも分かる", /[●◆]/.test(marks) && (await p.$$eval(".who.b", (a) => getComputedStyle(a[0]).borderLeftStyle === "dashed")));
    await c2.close(); }

  // 説明書は文字の形（端末の字・CI の字）で数mm伸びる。手元でぎりぎり入っても CI ではみ出したので、5mm 以上の空きを見る（2026-11-11 #6）
  const slackMm = (p) => p.evaluate(async () => { await document.fonts.ready; const e = document.querySelector('.page[aria-label="説明書"]'); const h = e.clientHeight, st = e.getAttribute("style"); e.style.height = "auto"; e.style.minHeight = "0"; e.style.maxHeight = "none"; const n = e.scrollHeight; if (st === null) e.removeAttribute("style"); else e.setAttribute("style", st); return ((h - n) * 25.4) / 96; });
  STEP = "印刷の7枚";
  // 印刷の7枚
  { const p = watch(await ctx.newPage()); await p.goto(printUrl); await p.waitForTimeout(300);
    const pages = await p.$$eval(".page", (a) => a.map((e) => [e.scrollHeight <= e.clientHeight + 1, e.getAttribute("aria-label")]));
    const tiles = await p.$$eval(".tile", (a) => a.length), cells = await p.$$eval(".board > div", (a) => a.length);
    const sz = await p.evaluate(() => { const mm = (px) => (px * 25.4) / 96; const t = document.querySelector(".tile").getBoundingClientRect(), c = document.querySelector(".board > div").getBoundingClientRect(); return [mm(t.width), mm(c.width)]; });
    check("印刷：説明書・盤・店札・お金・印と客メーター・上級ルール・行事と目標の札の7枚で、どの紙からもはみ出さない", pages.length === 7 && pages.every((x) => x[0]), JSON.stringify(pages));
    { const mm = await slackMm(p); check("印刷：説明書の下に5mm以上の空きがある（字の形がちがう端末でもはみ出さない）", mm >= 5, `${mm.toFixed(1)}mm`); }
    check("印刷：行事の札12枚・目標の札8枚・2Fの札12枚・盤の大通り5マスで、文は rules.js と同じ", await p.evaluate(() => { const t = document.body.textContent; return document.querySelectorAll(".card:not(.goal)").length === 12 && document.querySelectorAll(".card.goal").length === 8 && document.querySelectorAll(".mark.up").length === 12 && document.querySelectorAll(".board .ave").length === 5 && YRK.EV_KEYS.every((k) => t.includes(YRK.EVENTS[k].txt)) && YRK.GOAL_KEYS.every((k) => t.includes(YRK.GOALS[k].txt) && t.includes(`${YRK.GOALS[k].pt}点`)) && [...document.querySelectorAll(".foot span:last-child")].every((e, i) => e.textContent === `${i + 1} / 7`); }));
    check("印刷：店札は30枚・盤は25マスで、店札（34mm）が盤のマス（36mm）に乗る", tiles === 30 && cells === 25 && Math.abs(sz[0] - 34) < 0.5 && Math.abs(sz[1] - 36) < 0.5, sz.map((v) => v.toFixed(1)).join("/"));
    check("印刷：説明書の店の値段・客は rules.js と同じ", Y.KINDS.every((k) => print.includes("rules.js")) && await p.evaluate(() => YRK.KINDS.every((k) => document.body.textContent.includes(`${YRK.SHOPS[k].nm} ${YRK.SHOPS[k].c}💰・客${YRK.SHOPS[k].base}`))));
    check("印刷：説明書に奥付（対象年齢・小さな部品の注意・作り手と連絡先・絵の出どころ）がある", await p.evaluate(() => { const c = document.querySelector('.page[aria-label="説明書"] .colophon'); const t = c ? c.textContent : ""; return /対象年齢 \d+歳以上/.test(t) && t.includes("3歳未満") && t.includes("小さな部品") && t.includes("連絡先：https://") && t.includes("Noto Color Emoji"); }));
    { const sub = decodeURIComponent((print.match(/family=Noto\+Color\+Emoji&text=([^&"]+)/) || [])[1] || ""); const used = await p.evaluate(() => [...new Set((document.getElementById("sheets").textContent.match(/\p{Extended_Pictographic}/gu) || []))]);
      check("印刷：使う絵文字はすべて Noto Color Emoji の読み込み（text=）に入っている（端末の絵文字にならない）", used.length > 0 && used.every((e) => sub.includes(e)), used.filter((e) => !sub.includes(e)).join("") || used.join("")); }
    await p.emulateMedia({ media: "print" });
    const pdf = await p.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
    const n = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    check("印刷：PDF にすると A4 でちょうど7ページ", n === 7, `${n}ページ`);
    await p.close(); }
  // 切る数の少ない版（A4 4枚）：お金は記録表に鉛筆・持ち主は店札のふちの印
  { const p = watch(await ctx.newPage()); await p.goto(liteUrl); await p.waitForTimeout(300);
    const pages = await p.$$eval(".page", (a) => a.map((e) => [e.scrollHeight <= e.clientHeight + 1, e.getAttribute("aria-label")]));
    check("少ない版：説明書・盤・店札・記録表の4枚で、どの紙からもはみ出さない", pages.length === 4 && pages.every((x) => x[0]), JSON.stringify(pages));
    { const mm = await slackMm(p); check("少ない版：説明書の下に5mm以上の空きがある（字の形がちがう端末でもはみ出さない）", mm >= 5, `${mm.toFixed(1)}mm`); }
    check("少ない版：切る札は店札30枚だけ（お金・印・借り札の札が無い）で、どの店札にも ● と ◆ のふちがある", await p.evaluate(() => document.querySelectorAll(".t").length === 30 && [...document.querySelectorAll(".tile")].every((t) => t.querySelector(".own.a")?.textContent === "●" && t.querySelector(".own.b")?.textContent === "◆")));
    const sz = await p.evaluate(() => { const mm = (px) => (px * 25.4) / 96; return [mm(document.querySelector(".tile").getBoundingClientRect().width), mm(document.querySelector(".board > div").getBoundingClientRect().width)]; });
    check("少ない版：店札（34mm）が盤のマス（36mm）に乗る", Math.abs(sz[0] - 34) < 0.5 && Math.abs(sz[1] - 36) < 0.5, sz.map((v) => v.toFixed(1)).join("/"));
    check("少ない版：記録表は2人分 × はじめ＋毎日の行で、はじめの のこり は rules.js の START", await p.evaluate(() => { const t = [...document.querySelectorAll("table.money")]; return t.length === 2 && t.every((x) => x.tBodies[0].rows.length === YRK.DAYS + 1 && x.tBodies[0].rows[0].querySelector(".left").textContent === String(YRK.START)); }));
    check("少ない版：説明書の店の値段・客は rules.js と同じで、奥付がある", await p.evaluate(() => YRK.KINDS.every((k) => document.body.textContent.includes(`${YRK.SHOPS[k].nm} ${YRK.SHOPS[k].c}💰・客${YRK.SHOPS[k].base}`)) && /対象年齢 \d+歳以上/.test(document.querySelector('.page[aria-label="説明書"] .colophon')?.textContent || "")));
    { const sub = decodeURIComponent((lite.match(/family=Noto\+Color\+Emoji&text=([^&"]+)/) || [])[1] || ""); const used = await p.evaluate(() => [...new Set((document.getElementById("sheets").textContent.match(/\p{Extended_Pictographic}/gu) || []))]);
      check("少ない版：使う絵文字はすべて Noto Color Emoji の読み込みに入っている", used.length > 0 && used.every((e) => sub.includes(e)), used.filter((e) => !sub.includes(e)).join("") || used.join("")); }
    await p.emulateMedia({ media: "print" });
    const pdf = await p.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
    const n = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    check("少ない版：PDF にすると A4 でちょうど4ページ", n === 4, `${n}ページ`);
    check("少ない版と5枚の版は、たがいにリンクしている（それぞれのファイルで）", print.includes('href="print-lite.html"') && lite.includes('href="print.html"'));
    check("少ない版：持ち主は盤の同じ側（● の人の側）のふちの印だけで決まる（説明書・盤・店札の案内がそろっている）", await p.evaluate(() => { const t = document.body.textContent; return t.includes("盤の下側（● の人の側）のふちにある印が、その店の持ち主") && document.querySelectorAll(".street")[1]?.textContent.includes("持ち主の印をこちら") && !/自分の印が手前/.test(t); }));
    await p.close(); }
  await ctx.close();

  try { // 引き継ぎコード（shared-workflows template/qa/transfer-check.mjs）
    await checkTransfer({ browser, url, game: "yarikuri-shotengai", sample: { "yrk-v1": JSON.stringify({ v: 1, tut: true, lv: "easy", days: { "2026-11-11": { w: 1, s: 80, o: 60, lv: "easy" } }, st: { games: 1, wins: 1 } }) }, check, open: async (p) => { await p.click("#howto-ok", { timeout: 1500 }).catch(() => {}); } });
  } catch (e) { check("引き継ぎコード", false, e.message.split("\n")[0]); }
  // 保存に失敗したら知らせる
  { const ps = watch(await browser.newPage()); await ps.goto(url); await ps.waitForTimeout(200);
    check("保存に失敗したら、保存できるまで知らせ続け、保存できたら消す", await ps.evaluate(async () => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error("full"); }; save(() => {}); save(() => {}); const one = document.querySelectorAll("#savewarn").length === 1 && document.getElementById("savewarn").textContent.includes("保存できませんでした"); await new Promise((r) => setTimeout(r, 2500)); const stay = !!document.getElementById("savewarn"); Storage.prototype.setItem = orig; save(() => {}); return one && stay && !document.getElementById("savewarn"); }));
    check("保存できない帯は画面のいちばん上に場所を取り、スクロールしても見えている", await ps.evaluate(async () => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error("full"); }; save(() => {}); const b = document.getElementById("savewarn"); const top = !!b && document.body.firstElementChild === b && getComputedStyle(b).position === "sticky"; const pad = document.createElement("div"); pad.style.height = "3000px"; document.body.appendChild(pad); scrollTo(0, document.documentElement.scrollHeight); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const r = b.getBoundingClientRect(); const ok = top && scrollY > 1000 && r.top >= -1 && r.top < 5; pad.remove(); scrollTo(0, 0); Storage.prototype.setItem = orig; save(() => {}); return ok && !document.getElementById("savewarn"); }));
    await ps.close(); }
} catch (e) { check("画面の検査が最後まで動く", false, `${STEP}: ${e.message.split("\n").slice(0, 4).join(" ")}`); }
await browser.close();
check("画面のエラーが無い", errors.length === 0, errors.slice(0, 3).join(" | "));

{ // 見やすさ・読みやすさ・偏り（shared-workflows template/qa/a11y.mjs の写し）
  const { spawnSync } = await import("node:child_process");
  const a = spawnSync(process.execPath, [path.join(root, "qa", "a11y.mjs")], { encoding: "utf8", env: process.env });
  check("見やすさ・読みやすさの検査（qa/a11y.mjs。中身は qa-report/a11y.md）", a.status === 0, (a.stdout.match(/^- ❌.*$/gm) || []).join(" / ") || (a.status ? a.stderr.slice(-300) : ""));
}

const ng = results.filter((r) => !r.ok);
const md = `# やりくり商店街 QA\n\n${results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? `（${r.detail}）` : ""}`).join("\n")}\n\n${ng.length ? `❌ ${ng.length}件` : `✅ ${results.length}項目すべて通過`}\n`;
mkdirSync(path.join(root, "qa-report"), { recursive: true });
writeFileSync(path.join(root, "qa-report/report.md"), md);
console.log(md);
process.exit(ng.length ? 1 : 0);
