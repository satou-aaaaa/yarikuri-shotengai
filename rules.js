// やりくり商店街のきまり（画面 index.html・印刷 print.html・検査 qa/run.mjs が同じものを使う）。
// 盤は 5×5。毎日3枚の店札から2人が順に1枚ずつ取り、空き地に置く（先に取る人は日ごとに交代）。
// 日のおわりに、自分の店の客の数だけお金が入り、借りた札1枚につき利息1。10日目のおわりに「お金 − 返していない借り×5」が多いほうの勝ち。
// ゲームの進み方は「種（seed）＋手の並び（moves）」だけで決まる。となりの店主（AI）も決まった手順で選ぶので、同じ種と手なら同じ結果になる。
(function (root) {
  "use strict";
  // 店の種類。並びと中身を変えると過去の日の盤が変わる（足すときは最後に足し、QA の PIN を直す）
  const SHOPS = {
    yasai: { e: "🥕", nm: "八百屋", c: 3, base: 1, txt: "となりの🏠1軒につき、さらに +1" },
    pan: { e: "🍞", nm: "パン屋", c: 5, base: 2, txt: "となりの☕1軒につき +1" },
    cafe: { e: "☕", nm: "喫茶", c: 4, base: 1, txt: "となりの📚・🍞1軒につき +1" },
    hon: { e: "📚", nm: "本屋", c: 6, base: 3, txt: "となりに頼らず、いつも 3" },
    ie: { e: "🏠", nm: "住宅", c: 2, base: 0, txt: "自分の客は0。となりのお店（相手の店も）が +1" },
  };
  const KINDS = ["yasai", "pan", "cafe", "hon", "ie"];
  const N = 5, DAYS = 10, LOAN = 5, MAX_LOANS = 3, START = 4, PER_KIND = 6, MARKET = 3;
  const PLAYERS = ["a", "b"]; // a＝1P（1人のときは「あなた」）、b＝2P（1人のときは「となりの店主」）

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rngOf(seed) { let a = seed >>> 0; return function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const seedOfDate = (d) => hash("yarikuri:" + d);
  function deckOf(seed) {
    const r = rngOf(seed), deck = [];
    for (const k of KINDS) for (let i = 0; i < PER_KIND; i++) deck.push(k);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
    return deck;
  }
  const other = (o) => (o === "a" ? "b" : "a");
  function nb(i) { const x = i % N, y = (i / N) | 0, o = []; if (x > 0) o.push(i - 1); if (x < N - 1) o.push(i + 1); if (y > 0) o.push(i - N); if (y < N - 1) o.push(i + N); return o; }
  // その店の客の数（となりは上下左右だけ）
  function cust(board, i) {
    const c = board[i]; if (!c || c.t === "ie") return 0;
    let v = SHOPS[c.t].base;
    for (const j of nb(i)) {
      const d = board[j]; if (!d) continue;
      if (d.t === "ie") { v += 1; if (c.t === "yasai") v += 1; }
      if (c.t === "pan" && d.t === "cafe") v += 1;
      if (c.t === "cafe" && (d.t === "hon" || d.t === "pan")) v += 1;
      if (d.t === c.t && d.o !== c.o) v -= 1; // 同じ種類の店が相手の店ととなり合うと、客を取り合って −1
    }
    return Math.max(0, v);
  }
  function income(board, o) { let s = 0; for (let i = 0; i < board.length; i++) if (board[i] && board[i].o === o) s += cust(board, i); return s; }
  function delta(board, t, i, o) {
    const b = board.slice(), m0 = income(b, o), a0 = income(b, other(o));
    b[i] = { t: t, o: o };
    return { me: income(b, o) - m0, op: income(b, other(o)) - a0 };
  }

  function newGame(seed) {
    const deck = deckOf(seed);
    const g = { seed: seed >>> 0, deck: deck, day: 1, board: new Array(N * N).fill(null), p: {}, market: [], turn: "a", picks: 0, over: false, last: -1, log: [] };
    for (const o of PLAYERS) g.p[o] = { money: START, loans: 0, interest: 0, borrowed: 0, inc: [] };
    openDay(g);
    return g;
  }
  const firstOf = (day) => (day % 2 === 1 ? "a" : "b");
  function openDay(g) { g.market = g.deck.slice((g.day - 1) * MARKET, g.day * MARKET); g.picks = 0; g.turn = firstOf(g.day); }
  const daysLeft = (g) => DAYS - g.day + 1;
  // 手が今できるか。手の形：{a:"pick",m:市場の番号,i:マス} / {a:"pass"} / {a:"borrow"} / {a:"repay"}
  function legal(g, mv) {
    if (g.over || !mv) return false;
    const p = g.p[g.turn];
    if (mv.a === "pick") { const t = g.market[mv.m]; return !!t && Number.isInteger(mv.i) && mv.i >= 0 && mv.i < N * N && !g.board[mv.i] && p.money >= SHOPS[t].c; }
    if (mv.a === "pass") return true;
    if (mv.a === "borrow") return p.loans < MAX_LOANS;
    if (mv.a === "repay") return p.loans > 0 && p.money >= LOAN;
    return false;
  }
  // 手を当てる（できない手なら何もしないで false）。日のおわり・ゲームのおわりもここで進む
  function apply(g, mv) {
    if (!legal(g, mv)) return false;
    const who = g.turn, p = g.p[who];
    if (mv.a === "borrow") { p.money += LOAN; p.loans++; p.borrowed++; g.log.push({ who, a: "borrow" }); return true; }
    if (mv.a === "repay") { p.money -= LOAN; p.loans--; g.log.push({ who, a: "repay" }); return true; }
    if (mv.a === "pick") { const t = g.market[mv.m]; p.money -= SHOPS[t].c; g.board[mv.i] = { t: t, o: who }; g.market[mv.m] = null; g.last = mv.i; g.log.push({ who, a: "pick", t: t, i: mv.i }); }
    else { p.money += 1; g.log.push({ who, a: "pass" }); }
    g.picks++;
    if (g.picks < 2) { g.turn = other(who); return true; }
    // 日のおわり
    const end = { a: "day", day: g.day, inc: {}, it: {} };
    for (const o of PLAYERS) { const q = g.p[o], inc = income(g.board, o); q.money += inc; q.money -= q.loans; q.interest += q.loans; q.inc.push(inc); end.inc[o] = inc; end.it[o] = q.loans; }
    g.log.push(end);
    if (g.day >= DAYS) { g.over = true; g.turn = null; return true; }
    g.day++; openDay(g);
    return true;
  }
  const score = (g, o) => g.p[o].money - LOAN * g.p[o].loans;
  function winner(g) { const a = score(g, "a"), b = score(g, "b"); if (a !== b) return a > b ? "a" : "b"; const ia = income(g.board, "a"), ib = income(g.board, "b"); return ia === ib ? null : ia > ib ? "a" : "b"; }

  // となりの店主：決まった手順で動く相手。どこに置くと残りの日でいちばん得かを、相手の得を少し引いて比べる。
  // 返すお金があり余裕があれば先に返す。足りない札は、残りが3日以上あって得なら借りてから取る。得が小さければ店番。
  // level："easy"（やさしい：借りない・相手のじゃまを考えない）／"normal"（ふつう）
  function aiMove(g, level) {
    const easy = level === "easy", W = easy ? 0 : 0.6;
    const me = g.turn, p = g.p[me], left = daysLeft(g);
    let best = null;
    for (let m = 0; m < MARKET; m++) {
      const t = g.market[m]; if (!t) continue;
      const need = Math.max(0, SHOPS[t].c - p.money), loans = Math.ceil(need / LOAN);
      if (loans > 0 && (easy || left < 3 || p.loans + loans > MAX_LOANS)) continue;
      for (let i = 0; i < N * N; i++) {
        if (g.board[i]) continue;
        const d = delta(g.board, t, i, me);
        const v = (d.me - W * d.op) * left - SHOPS[t].c - loans * 3; // 借りる重さ：返すまでの利息（おおよそ3日分）
        if (!best || v > best.v) best = { v: v, m: m, i: i, loans: loans, c: SHOPS[t].c };
      }
    }
    const pick = best && best.v >= 1 ? best : null;
    // 返す：取りたい店を建てても5残るとき（取らないなら5あれば）。借りるのは足りないときだけなので、返す→借りるをくり返さない
    if (p.loans > 0 && p.money - (pick && !pick.loans ? pick.c : 0) >= LOAN && (!pick || !pick.loans)) return { a: "repay" };
    if (!pick) return { a: "pass" };
    if (pick.loans > 0) return { a: "borrow" };
    return { a: "pick", m: pick.m, i: pick.i };
  }
  // 種と手の並びから今の盤を作り直す（続きから・別のタブとの照らし合わせに使う）
  function replay(seed, moves) { const g = newGame(seed); for (const mv of moves || []) if (!apply(g, mv)) break; return g; }

  const api = { SHOPS, KINDS, N, DAYS, LOAN, MAX_LOANS, START, PER_KIND, MARKET, hash, rngOf, seedOfDate, deckOf, nb, cust, income, delta, newGame, legal, apply, score, winner, aiMove, replay, other, firstOf, daysLeft };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.YRK = api;
})(typeof window !== "undefined" ? window : this);
