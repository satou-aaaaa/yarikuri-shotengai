// やりくり商店街のきまり（画面 index.html・印刷 print.html・検査 qa/run.mjs が同じものを使う）。
// 盤は 5×5。毎日3枚の店札から2人が1枚ずつ取り、空き地に置く。どちらが先に取るかは、毎朝のせり（2人がこっそり決めた額を同時に開く）で決める。
// 毎日のおわりに、2人とも決まった額（ALLOW＝5💰）をもらう。利息はない。
// 点を数えるのは10日目のおわりの1回だけ（囲碁のように。2026-11-12 satouさん「計算するタイミングをできるだけ減らしたい」）：
// 自分の店の客1人＝1点 ＋ 陣取りの点（商店会・通り）＋ 残ったお金 − 返していない借り札×LOAN_PT ＋ コミ。
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
  const ALLOW = 5, LOAN_PT = 7; // 毎日もらうお金・おわりに返していない借り札1枚で引く点（借りれば 5💰 入るが、返さないと 7点へる）
  // ===== 上級ルール（opts.adv）。基本ルールの盤・店札の順は変えない =====
  // 大通り：まん中の横の列は客 +1・値段 +1。四すみ（角）は目標「角の店」で使う
  // （角の値引き・増築の客2倍は、先手後手の差が大きくなったのでやめた。2026-11-11 の1000局の試し）
  const MAIN = [10, 11, 12, 13, 14], CORNER = [0, 4, 20, 24];
  const UP_ADD = 2; // 増築した店の客の増え方
  // 行事の札：毎日1枚。今日と、その先2日分まで見える。12枚から10日分を、店札とは別の乱数で並べる（足すときは最後に足す）
  // どれも「今日の値段」か「今日もらうお金」だけを変える（客の数は変えない。点はおわりに1回だけ数えるため。2026-11-12）
  const EVENTS = {
    quiet: { e: "🌤", nm: "いつもの日", txt: "なにも起きない" },
    rain: { e: "☔", nm: "雨の日", txt: "☕喫茶が今日は 1💰安い" },
    payday: { e: "💴", nm: "給料日", txt: "今日のおわりに もらうお金 +2💰" },
    rateup: { e: "📈", nm: "値上がり", txt: "今日の店札は どれも 1💰高い" },
    ratedown: { e: "📉", nm: "値下がり", txt: "今日の店札は どれも 1💰安い" },
    sale: { e: "🏷", nm: "大売り出し", txt: "🥕八百屋が今日は 2💰安い" },
    bookfair: { e: "📖", nm: "古本市", txt: "📚本屋が今日は 2💰安い" },
    morning: { e: "🌅", nm: "朝市", txt: "🍞パン屋・🥕八百屋が今日は 1💰安い" },
    festival: { e: "🏮", nm: "お祭り", txt: "今日は大通りに置いても 高くならない" },
    tax: { e: "🧾", nm: "税の日", txt: "今日のおわりに もらうお金 −2💰" },
    holiday: { e: "🎌", nm: "連休", txt: "🏠住宅が今日は 1💰安い" },
    work: { e: "🚧", nm: "道路工事", txt: "今日は大通りに置けない（増築はできる）" },
  };
  const EV_KEYS = ["quiet", "rain", "payday", "rateup", "ratedown", "sale", "bookfair", "morning", "festival", "tax", "holiday", "work"];
  const EV_SEE = 3; // 今日をふくめて見える日数
  // 秘密の目標：はじめに2枚ずつ。相手には見せない。10日目のおわりに満たしていれば点（💰と同じに数える）
  const GOALS = {
    corner: { e: "📐", nm: "角の店", txt: "四すみのうち2つに自分の店", need: 2, pt: 6 },
    books: { e: "📚", nm: "本の通り", txt: "自分の📚本屋を3軒", need: 3, pt: 8 },
    pair: { e: "☕", nm: "喫茶とパン", txt: "自分の☕と🍞のとなり合う組を2つ", need: 2, pt: 6 },
    main: { e: "🛣", nm: "大通りの顔", txt: "大通りに自分の店を3軒", need: 3, pt: 8 },
    homes: { e: "🏠", nm: "住宅街", txt: "自分の🏠住宅を3軒", need: 3, pt: 10 },
    up: { e: "🏢", nm: "2階建て", txt: "増築した店を2軒", need: 2, pt: 6 },
    noloan: { e: "🐷", nm: "借りずに", txt: "一度も借りない", need: 1, pt: 12 },
    veg: { e: "🥕", nm: "八百屋の並び", txt: "自分の🥕八百屋を3軒", need: 3, pt: 10 },
  };
  const GOAL_KEYS = ["corner", "books", "pair", "main", "homes", "up", "noloan", "veg"];
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
  // その店の客の数（となりは上下左右だけ）。上級ルールでは、大通りは +1、増築した店（up）は +UP_ADD
  function cust(board, i, adv) {
    const c = board[i]; if (!c || c.t === "ie") return 0;
    let v = SHOPS[c.t].base + (adv && MAIN.includes(i) ? 1 : 0);
    for (const j of nb(i)) {
      const d = board[j]; if (!d) continue;
      if (d.t === "ie") { v += 1; if (c.t === "yasai") v += 1; }
      if (c.t === "pan" && d.t === "cafe") v += 1;
      if (c.t === "cafe" && (d.t === "hon" || d.t === "pan")) v += 1;
      if (d.t === c.t && d.o !== c.o) v -= 1; // 同じ種類の店が相手の店ととなり合うと、客を取り合って −1
    }
    // 0で止めない（止めると、紙の客メーターに「置いたときの増減」を足すだけでは合わなくなる。1000局で 0.03% の店だけ）
    return c.up ? v + UP_ADD : v;
  }
  function income(board, o, adv) { let s = 0; for (let i = 0; i < board.length; i++) if (board[i] && board[i].o === o) s += cust(board, i, adv); return s; }
  // 行事の札で変わる今日の値引き（店札だけ。増築はかわらない）と、今日のおわりにもらうお金
  function evOff(t, ev) {
    if (ev === "ratedown") return 1; if (ev === "rateup") return -1;
    if (ev === "rain" && t === "cafe") return 1;
    if (ev === "sale" && t === "yasai") return 2;
    if (ev === "bookfair" && t === "hon") return 2;
    if (ev === "morning" && (t === "pan" || t === "yasai")) return 1;
    if (ev === "holiday" && t === "ie") return 1;
    return 0;
  }
  const allowOf = (ev) => ALLOW + (ev === "payday" ? 2 : ev === "tax" ? -2 : 0);
  // 陣取りの点（おわりに1回だけ数える）。商店会：つながった自分の店（住宅もふくむ）のいちばん大きいかたまり1軒につき1点。
  // 通り：横5列・たて5列のそれぞれで、自分の店が相手より多ければ LINE_PT 点（同じならどちらも0）。上級の2階建ては、どちらも2軒と数える
  const LINE_PT = 3;
  function groupOf(board, o) {
    const seen = new Array(board.length).fill(false); let best = 0;
    for (let i = 0; i < board.length; i++) {
      if (seen[i] || !board[i] || board[i].o !== o) continue;
      let n = 0; const st = [i]; seen[i] = true;
      while (st.length) { const k = st.pop(); n += board[k].up ? 2 : 1; for (const j of nb(k)) if (!seen[j] && board[j] && board[j].o === o) { seen[j] = true; st.push(j); } }
      if (n > best) best = n;
    }
    return best;
  }
  function linesOf(board, o) {
    let n = 0;
    for (let r = 0; r < N; r++) for (const col of [false, true]) {
      let m = 0, t = 0; for (let k = 0; k < N; k++) { const c = board[col ? k * N + r : r * N + k]; if (c) { const w = c.up ? 2 : 1; if (c.o === o) m += w; else t += w; } }
      if (m > t) n++;
    }
    return n;
  }
  const terr = (board, o) => groupOf(board, o) + LINE_PT * linesOf(board, o);
  function delta(board, t, i, o, adv) {
    const b = board.slice(), m0 = income(b, o, adv), a0 = income(b, other(o), adv);
    b[i] = { t: t, o: o };
    return { me: income(b, o, adv) - m0, op: income(b, other(o), adv) - a0 };
  }
  // 置く場所で変わる値段（上級：大通りは +1、行事の札で上下。0より下にはならない）
  const costAt = (t, i, adv, ev) => Math.max(0, SHOPS[t].c + (adv && MAIN.includes(i) && ev !== "festival" ? 1 : 0) - (adv ? evOff(t, ev) : 0));
  const upCost = (board, i) => SHOPS[board[i].t].c; // 増築の値段は、その店の値段と同じ
  function eventsOf(seed) { const r = rngOf((seed ^ 0x9e3779b9) >>> 0), d = EV_KEYS.slice(); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; } return d.slice(0, DAYS); }
  function goalsOf(seed) { const r = rngOf((seed ^ 0x85ebca6b) >>> 0), d = GOAL_KEYS.slice(); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; } return { a: d.slice(0, 2), b: d.slice(2, 4) }; }
  // 目標の進み具合 [いま, 要る数]
  function goalProg(g, o, k) {
    const B = g.board, mine = (i) => B[i] && B[i].o === o, G = GOALS[k];
    let n = 0;
    if (k === "corner") n = CORNER.filter(mine).length;
    else if (k === "books" || k === "homes" || k === "veg") { const t = k === "books" ? "hon" : k === "homes" ? "ie" : "yasai"; n = B.filter((c) => c && c.o === o && c.t === t).length; }
    else if (k === "pair") { for (let i = 0; i < B.length; i++) if (mine(i) && B[i].t === "cafe") for (const j of nb(i)) if (mine(j) && B[j].t === "pan") n++; }
    else if (k === "main") n = MAIN.filter(mine).length;
    else if (k === "up") n = B.filter((c) => c && c.o === o && c.up).length;
    else if (k === "noloan") n = g.p[o].borrowed === 0 ? 1 : 0;
    return [Math.min(n, G.need), G.need];
  }
  const goalPts = (g, o) => (g.adv ? g.goals[o].reduce((s, k) => { const [h, n] = goalProg(g, o, k); return s + (h >= n ? GOALS[k].pt : 0); }, 0) : 0);

  function newGame(seed, opts) {
    const deck = deckOf(seed), adv = !!(opts && opts.adv);
    const g = { seed: seed >>> 0, adv: adv, deck: deck, events: adv ? eventsOf(seed) : null, goals: adv ? goalsOf(seed) : null, day: 1, board: new Array(N * N).fill(null), p: {}, market: [], turn: "a", picks: 0, phase: "bid", bid: { a: null, b: null }, tok: tok0(seed), over: false, last: -1, log: [] };
    for (const o of PLAYERS) g.p[o] = { money: START, loans: 0, borrowed: 0, inc: [] };
    openDay(g);
    return g;
  }
  // 朝のせり（2026-11-11 satouさん「先攻後攻の有利不利が出ないように」）：毎朝、2人がこっそり額を決め（1P→2P の順に入れるが、相手の額は見ない）、
  // 同時に開く。多いほうが先に札を取り、その額を払う（もう一方は払わない）。同じ額ならどちらも払わず、優先札を持つ人が先。
  // 優先札は毎朝せりのあとで相手に回す。はじめに持つ人は種で決める（紙ではじゃんけん）。
  // 3000局の試し：同じ額のときだけ回す形や、はじめに持つ人を決めておく形では、はじめに持つ人が 47% と差が出た（2026-11-11）
  const tok0 = (seed) => (hash("tok" + (seed >>> 0)) & 1 ? "a" : "b"); // はじめに優先札を持つ人
  function openDay(g) { g.market = g.deck.slice((g.day - 1) * MARKET, g.day * MARKET); g.picks = 0; g.phase = "bid"; g.bid = { a: null, b: null }; g.turn = "a"; }
  function settleBid(g) {
    const A = g.bid.a, B = g.bid.b, tie = A === B, first = tie ? g.tok : A > B ? "a" : "b", pay = tie ? 0 : g.bid[first];
    g.p[first].money -= pay; g.p[first].paid = (g.p[first].paid || 0) + pay;
    g.tok = other(g.tok);
    g.log.push({ a: "bid", day: g.day, bids: { a: A, b: B }, first, pay, tie, tok: g.tok });
    g.phase = "play"; g.turn = first; g.first = first;
  }
  const firstOf = (g) => g.first;
  const daysLeft = (g) => DAYS - g.day + 1;
  const evOf = (g, day) => (g.adv ? g.events[(day || g.day) - 1] : null);
  // 手が今できるか。手の形：{a:"pick",m:市場の番号,i:マス} / {a:"up",i:マス}（上級：増築） / {a:"pass"} / {a:"borrow"} / {a:"repay"}
  function legal(g, mv) {
    if (g.over || !mv) return false;
    const p = g.p[g.turn];
    if (g.phase === "bid") { if (mv.a === "bid") return Number.isInteger(mv.v) && mv.v >= 0 && mv.v <= Math.max(0, p.money); if (mv.a === "borrow") return p.loans < MAX_LOANS; if (mv.a === "repay") return p.loans > 0 && p.money >= LOAN; return false; }
    if (mv.a === "bid") return false;
    if (mv.a === "pick") { const t = Number.isInteger(mv.m) ? g.market[mv.m] : null; return !!t && Number.isInteger(mv.i) && mv.i >= 0 && mv.i < N * N && !g.board[mv.i] && !(evOf(g) === "work" && MAIN.includes(mv.i)) && p.money >= costAt(t, mv.i, g.adv, evOf(g)); }
    if (mv.a === "up") { const c = Number.isInteger(mv.i) && g.board[mv.i]; return !!g.adv && !!c && c.o === g.turn && c.t !== "ie" && !c.up && p.money >= upCost(g.board, mv.i); }
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
    if (mv.a === "bid") { g.bid[who] = mv.v; if (who === "a") g.turn = "b"; else settleBid(g); return true; }
    if (mv.a === "pick") { const t = g.market[mv.m]; p.money -= costAt(t, mv.i, g.adv, evOf(g)); g.board[mv.i] = { t: t, o: who }; g.market[mv.m] = null; g.last = mv.i; g.log.push({ who, a: "pick", t: t, i: mv.i }); }
    else if (mv.a === "up") { p.money -= upCost(g.board, mv.i); g.board[mv.i] = Object.assign({}, g.board[mv.i], { up: true }); g.last = mv.i; g.log.push({ who, a: "up", t: g.board[mv.i].t, i: mv.i }); }
    else { p.money += 1; g.log.push({ who, a: "pass" }); }
    g.picks++;
    if (g.picks < 2) { g.turn = other(who); return true; }
    // 日のおわり
    const ev = evOf(g), end = { a: "day", day: g.day, ev: ev, inc: {} };
    for (const o of PLAYERS) { const q = g.p[o], inc = allowOf(ev); q.money += inc; q.inc.push(inc); end.inc[o] = inc; }
    g.log.push(end);
    if (g.day >= DAYS) { g.over = true; g.turn = null; return true; }
    g.day++; openDay(g);
    return true;
  }
  // コミ（囲碁の考え方）：はじめに優先札を持った人は、1日目に先に取らされるぶん少し不利なので、おわりに点を足す。基本と上級で差がちがう（3000局で決める）
  const KOMI = 3, KOMI_ADV = 0;
  const komiOf = (g, o) => (o === tok0(g.seed) ? (g.adv ? KOMI_ADV : KOMI) : 0);
  // おわりの点の内わけ（画面・印刷の記録用紙と同じ並び）
  const scoreParts = (g, o) => ({ cust: income(g.board, o, g.adv), terr: terr(g.board, o), money: g.p[o].money, loan: -LOAN_PT * g.p[o].loans, goal: goalPts(g, o), komi: komiOf(g, o) });
  const score = (g, o) => { const q = scoreParts(g, o); return q.cust + q.terr + q.money + q.loan + q.goal + q.komi; };
  function winner(g) { const a = score(g, "a"), b = score(g, "b"); if (a !== b) return a > b ? "a" : "b"; const ia = income(g.board, "a", g.adv), ib = income(g.board, "b", g.adv); return ia === ib ? null : ia > ib ? "a" : "b"; }

  // となりの店主：決まった手順で動く相手。どこに置くと残りの日でいちばん得かを、相手の得を少し引いて比べる。
  // 返すお金があり余裕があれば先に返す。足りない札は、残りが3日以上あって得なら借りてから取る。得が小さければ店番。
  // 上級ルールでは、見えている行事の札・置く場所の値段・増築・自分の目標も数える。
  // level："easy"（やさしい：借りない・増築しない・相手のじゃまと目標を考えない）／"normal"（ふつう）
  // 置く・増築するのに、いちばん得な手を探す（g.turn の人として。g は書きかえない）
  function searchBest(g, level) {
    const easy = level === "easy", W = easy ? 0 : 0.6;
    const me = g.turn, p = g.p[me], adv = g.adv, ev = evOf(g);
    // 残りの日の客の増え方の合計（見えている日は行事の札で、その先はふつうの日で数える）
    const gain = (b0, b1, o) => income(b1, o, adv) - income(b0, o, adv); // 客1人＝おわりに1点
    const goalBonus = (b1) => { if (!adv || easy) return 0; let v = 0; const h = { board: b1, p: g.p }; for (const k of g.goals[me]) { const [x0, n] = goalProg(g, me, k), [x1] = goalProg(h, me, k); if (x0 < n && x1 > x0) v += (GOALS[k].pt * (x1 - x0)) / n; } return v * 0.9; };
    const keepNoLoan = adv && !easy && g.goals[me].includes("noloan") && p.borrowed === 0 ? GOALS.noloan.pt : 0; // 目標「借りずに」を守る重さ
    const t0m = terr(g.board, me), t0o = terr(g.board, other(me)), TW = 1; // 陣取りの点の変わり方（やさしい店主も自分の分は見る。見ないと客だけでは値段に届かず、店番ばかりになる）
    let best = null;
    for (let m = 0; m < MARKET; m++) {
      const t = g.market[m]; if (!t) continue;
      for (let i = 0; i < N * N; i++) {
        if (g.board[i]) continue;
        if (ev === "work" && MAIN.includes(i)) continue;
        const c = costAt(t, i, adv, ev), need = Math.max(0, c - p.money), loans = Math.ceil(need / LOAN);
        if (loans > 0 && (easy || p.loans + loans > MAX_LOANS)) continue;
        const b1 = g.board.slice(); b1[i] = { t: t, o: me };
        const v = gain(g.board, b1, me) - W * gain(g.board, b1, other(me)) + TW * (terr(b1, me) - t0m) - TW * W * (terr(b1, other(me)) - t0o) + goalBonus(b1) - c - loans * (LOAN_PT - LOAN) - (loans > 0 ? keepNoLoan : 0); // 借りる重さ：返さなければおわりに LOAN_PT 点へる
        if (!best || v > best.v) best = { v: v, a: "pick", m: m, i: i, loans: loans, c: c };
      }
    }
    if (adv && !easy) for (let i = 0; i < N * N; i++) {
      const c0 = g.board[i]; if (!c0 || c0.o !== me || c0.t === "ie" || c0.up) continue;
      const c = upCost(g.board, i); if (p.money < c) continue;
      const b1 = g.board.slice(); b1[i] = Object.assign({}, c0, { up: true });
      const v = gain(g.board, b1, me) + TW * (terr(b1, me) - t0m) - TW * W * (terr(b1, other(me)) - t0o) + goalBonus(b1) - c;
      if (!best || v > best.v) best = { v: v, a: "up", i: i, loans: 0, c: c };
    }
    return best;
  }
  // 朝のせりの額：先に取れたときと、相手に先に取られたときの得の差の半分くらいまで出す（相手の額は見ない）。やさしい店主は出さない
  function aiBid(g, level) {
    const me = g.turn, op = other(me), p = g.p[me];
    if (level === "easy") return 0;
    const val = (b) => (b ? Math.max(b.v, 1) : 1);
    const as = (o, board, market) => Object.assign({}, g, { turn: o, board: board || g.board, market: market || g.market, phase: "play" });
    const v1 = val(searchBest(as(me), level)), ob = searchBest(as(op), level);
    let v2 = v1;
    if (ob && ob.a === "pick") { const b1 = g.board.slice(); b1[ob.i] = { t: g.market[ob.m], o: op }; const m1 = g.market.slice(); m1[ob.m] = null; v2 = val(searchBest(as(me, b1, m1), level)); }
    const mine = searchBest(as(me), level), keep = mine && mine.a === "pick" && !mine.loans ? mine.c : 0;
    return Math.max(0, Math.min(Math.floor((v1 - v2) * BID_K), p.money - keep));
  }
  const BID_K = 0.5;
  function aiMove(g, level) {
    if (g.phase === "bid") return { a: "bid", v: aiBid(g, level) };
    const easy = level === "easy", me = g.turn, p = g.p[me], adv = g.adv;
    const best = searchBest(g, level);
    const pick = best && best.v >= 1 ? best : null;
    // 返す：取りたい店を建てても5残るとき（取らないなら5あれば）。借りるのは足りないときだけなので、返す→借りるをくり返さない
    if (p.loans > 0 && p.money - (pick && !pick.loans ? pick.c : 0) >= LOAN && (!pick || !pick.loans)) return { a: "repay" };
    if (!pick) return { a: "pass" };
    if (pick.loans > 0) return { a: "borrow" };
    return pick.a === "up" ? { a: "up", i: pick.i } : { a: "pick", m: pick.m, i: pick.i };
  }
  // 種と手の並びから今の盤を作り直す（続きから・別のタブとの照らし合わせに使う）
  // 当てられない手で止まったら g.bad にその番号を残す（朝のせりの前の古い記録など。index.html が続きから外す）
  function replay(seed, moves, opts) { const g = newGame(seed, opts), M = moves || []; for (let k = 0; k < M.length; k++) if (!apply(g, M[k])) { g.bad = k; break; } return g; }

  const api = { UP_ADD, EVENTS, EV_KEYS, EV_SEE, GOALS, GOAL_KEYS, MAIN, CORNER, evOff, allowOf, ALLOW, LOAN_PT, LINE_PT, groupOf, linesOf, terr, KOMI, KOMI_ADV, komiOf, scoreParts, tok0, costAt, upCost, eventsOf, goalsOf, goalProg, goalPts, evOf, SHOPS, KINDS, N, DAYS, LOAN, MAX_LOANS, START, PER_KIND, MARKET, hash, rngOf, seedOfDate, deckOf, nb, cust, income, delta, newGame, legal, apply, score, winner, aiMove, replay, other, firstOf, daysLeft };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.YRK = api;
})(typeof window !== "undefined" ? window : this);
