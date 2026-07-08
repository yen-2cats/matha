/* 數A 13級分特訓系統 — 核心邏輯
   設計原則：每一題都帶碼表、每一個錯都分類、用數據決定練什麼。 */
'use strict';

/* ═══════════ 狀態 ═══════════ */
const KEY = 'mathA13';
let S = load();
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { attempts: [], wrong: {}, drills: {}, mocks: [], daily: {}, ver: 1 };
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); syncQueue(); }
function exportData() {
  const blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mathA13-備份-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importData(input) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.attempts)) { alert('這不是本系統的備份檔（缺 attempts 欄位）。'); return; }
      const cur = S.attempts.length;
      if (!confirm(`備份檔含 ${d.attempts.length} 筆作答紀錄、${Object.keys(d.wrong || {}).length} 題錯題。\n匯入會覆蓋目前這個瀏覽器裡的 ${cur} 筆紀錄，確定？`)) return;
      S = d; save(); location.reload();
    } catch (e) { alert('讀取失敗：' + e.message); }
  };
  r.readAsText(f);
  input.value = '';
}
function backupCard() {
  return `<div class="card"><h2>💾 資料備份</h2>
    <p class="dim">所有紀錄只存在<b>這台裝置、這個瀏覽器</b>的 localStorage（跟著網址的網域走）——
    換裝置、換網址、清瀏覽器資料都<b>不會自動帶走</b>。養成習慣：每週日匯出一份，存進雲端硬碟或傳給自己。</p>
    <button class="btn" onclick="exportData()">匯出備份（.json）</button>
    <button class="btn" onclick="$('#impfile').click()">匯入備份</button>
    <button class="btn" onclick="exportInk()">匯出今日筆跡</button>
    <input type="file" id="impfile" accept=".json,application/json" style="display:none" onchange="importData(this)">
    <p class="dim">筆跡（手寫板的完整書寫過程）只存在本次開啟的頁面記憶體，<b>關掉頁面就消失</b>——想要深度過程分析的那天，練完先匯出。</p>
  </div>`;
}

/* ═══════════ ✍️ 手寫過程紀錄（平板＋觸控筆） ═══════════
   每一筆記錄時間戳。自動偵測：起筆猶豫、題中停頓（≥15s）、塗改（擦/復原/清空）、
   尾段放棄（最後一筆到送出）。超過目標時間又 30 秒無筆跡 → 即時警示＋震動。 */
const HES_GAP = 15000;
const INK_COLOR = '#dfe6f2';
let ink = null;
let replaying = false;
const sessionInk = {}; // qid → { s: strokes, e: 塗改事件時間 }，僅存於本頁開啟期間

let inkEraCfg = Object.assign({ m: 'stroke', r: 16 }, S.inkcfg || {});
function inkHTML(exam) {
  if (exam) return `<div class="card ink-card">
    <div class="ink-bar"><b>✍️ 計算區 <span class="warnc">考場模式</span></b><span class="ink-tools">
      <label class="dim"><input type="checkbox" id="ink-finger" onchange="inkFingerToggle(this)"> 手指</label>
    </span></div>
    <div id="ink-flash" class="ink-flash" style="display:none"></div>
    <div class="ink-scroll"><canvas id="ink-cv"></canvas></div>
    <p class="dim ink-hint">跟考場一樣：空間就這麼多、沒有橡皮擦——寫錯就劃掉、學會排版。這也是訓練的一部分。</p>
  </div>`;
  return `<div class="card ink-card">
    <div class="ink-bar"><b>✍️ 計算區</b><span class="ink-tools">
      <button class="btn sm" id="ink-pen" onclick="inkMode('pen')">✏️ 筆</button>
      <button class="btn sm" id="ink-era" onclick="inkMode('erase')">🧽 擦</button>
      <button class="btn sm" onclick="inkUndo()">↩ 復原</button>
      <button class="btn sm" onclick="inkExtend(320)">⬇ 加長</button>
      <label class="dim"><input type="checkbox" id="ink-finger" onchange="inkFingerToggle(this)"> 手指</label>
    </span></div>
    <div id="ink-eopts" class="ink-eopts" style="display:none">
      <span class="dim">擦除</span>
      <button class="btn sm" id="ink-e-stroke" onclick="inkEraSet('m','stroke')">整筆</button>
      <button class="btn sm" id="ink-e-area" onclick="inkEraSet('m','area')">區域</button>
      <span class="dim">｜粗細</span>
      <button class="btn sm" id="ink-e-r8" onclick="inkEraSet('r',8)">細</button>
      <button class="btn sm" id="ink-e-r16" onclick="inkEraSet('r',16)">中</button>
      <button class="btn sm" id="ink-e-r32" onclick="inkEraSet('r',32)">粗</button>
      <button class="btn sm" onclick="inkClear()">🗑 全部清除</button>
    </div>
    <div id="ink-flash" class="ink-flash" style="display:none"></div>
    <div class="ink-scroll"><canvas id="ink-cv"></canvas></div>
    <p class="dim ink-hint">筆寫字、手指上下捲動；寫到底自動加長（也可按「⬇ 加長」）。沒有主動式觸控筆才勾「手指」。這塊就是你的計算紙——別在旁邊另外打草稿，過程要留在這裡才抓得到卡點。</p>
  </div>`;
}
function inkStore(qid) { return (sessionInk[qid] = sessionInk[qid] || { s: [], e: [] }); }
function inkStart(qid, t0, exam) {
  const cv = $('#ink-cv'); if (!cv) return;
  const st = inkStore(qid);
  let maxY = 0;
  for (const s of st.s) if (!s.dead) for (const p of s.pts) if (p[1] > maxY) maxY = p[1];
  const h = exam
    ? Math.max(460, Math.ceil(maxY + 40)) // 考場模式：固定空間（約半頁題本空白），不可加長
    : Math.max(340, Math.round(window.innerHeight * 0.45), Math.ceil(maxY + 80));
  ink = { qid, t0, cv, ctx: cv.getContext('2d'), mode: 'pen', cur: null, penSeen: false, warnedAt: 0, h, exam: !!exam };
  inkSizeCanvas();
  cv.onpointerdown = inkDown; cv.onpointermove = inkMove;
  cv.onpointerup = cv.onpointercancel = inkUp;
  inkMode('pen');
  inkFingerToggle($('#ink-finger'));
}
function inkSizeCanvas() {
  const { cv, ctx } = ink;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.parentElement.clientWidth;
  cv.width = w * dpr; cv.height = ink.h * dpr;
  cv.style.width = w + 'px'; cv.style.height = ink.h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  inkRedraw();
  if (ink.cur && ink.cur.pts && ink.cur.pts.length > 1) {
    ctx.strokeStyle = INK_COLOR; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(ink.cur.pts[0][0], ink.cur.pts[0][1]);
    for (let i = 1; i < ink.cur.pts.length; i++) ctx.lineTo(ink.cur.pts[i][0], ink.cur.pts[i][1]);
    ctx.stroke();
  }
}
function inkExtend(dh) {
  if (!ink || ink.exam || ink.h >= 4000) return;
  ink.h = Math.min(4000, ink.h + dh);
  inkSizeCanvas();
}
function inkFingerToggle(el) {
  if (!ink) return;
  ink.cv.style.touchAction = el && el.checked ? 'none' : 'pan-y';
}
function inkEraSet(k, v) {
  inkEraCfg[k] = v;
  S.inkcfg = { m: inkEraCfg.m, r: inkEraCfg.r };
  save();
  inkEraUI();
}
function inkEraUI() {
  const on = (id, yes) => { const b = $(id); if (b) b.className = 'btn sm' + (yes ? ' active' : ''); };
  on('#ink-e-stroke', inkEraCfg.m === 'stroke'); on('#ink-e-area', inkEraCfg.m === 'area');
  on('#ink-e-r8', inkEraCfg.r === 8); on('#ink-e-r16', inkEraCfg.r === 16); on('#ink-e-r32', inkEraCfg.r === 32);
}
function inkAllow(e) {
  if (!ink) return false;
  if (e.pointerType === 'pen') { ink.penSeen = true; return true; }
  if (e.pointerType === 'mouse') return true;
  const f = $('#ink-finger');
  return !ink.penSeen && f && f.checked;
}
function inkPos(e) {
  const r = ink.cv.getBoundingClientRect();
  return [Math.round(e.clientX - r.left), Math.round(e.clientY - r.top)];
}
function inkDown(e) {
  if (!inkAllow(e)) return;
  e.preventDefault();
  try { ink.cv.setPointerCapture(e.pointerId); } catch (_) {}
  const [x, y] = inkPos(e);
  if (ink.mode === 'erase') { ink.cur = { erase: true, hit: 0 }; inkErase(x, y); return; }
  ink.cur = { t0: Date.now(), pts: [[x, y]] };
}
function inkMove(e) {
  if (!ink || !ink.cur || !inkAllow(e)) return;
  e.preventDefault();
  const [x, y] = inkPos(e);
  if (ink.cur.erase) { inkErase(x, y); return; }
  const pts = ink.cur.pts; const p = pts[pts.length - 1];
  if (Math.abs(x - p[0]) + Math.abs(y - p[1]) < 2) return;
  pts.push([x, y]);
  const c = ink.ctx;
  c.strokeStyle = INK_COLOR; c.lineWidth = 2;
  c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(x, y); c.stroke();
  if (y > ink.h - 48) inkExtend(320);
}
function inkUp() {
  if (!ink || !ink.cur) return;
  const cur = ink.cur; ink.cur = null;
  if (cur.erase) { if (cur.hit) inkStore(ink.qid).e.push(Date.now()); inkRedraw(); return; }
  if (cur.pts.length > 1) { cur.t1 = Date.now(); inkStore(ink.qid).s.push(cur); }
}
function distSeg2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qy = ay + t * dy;
  return (px - qx) * (px - qx) + (py - qy) * (py - qy);
}
function inkErase(x, y) {
  const r = inkEraCfg.r;
  if (inkEraCfg.m === 'area') inkEraseArea(x, y, r);
  else inkEraseStroke(x, y, r);
  inkRedraw();
  inkEraCursor(x, y, r);
}
function inkEraseStroke(x, y, r) {
  const r2 = r * r;
  for (const s of inkStore(ink.qid).s) {
    if (s.dead) continue;
    for (let i = 1; i < s.pts.length; i++) {
      if (distSeg2(x, y, s.pts[i - 1][0], s.pts[i - 1][1], s.pts[i][0], s.pts[i][1]) < r2) {
        s.dead = Date.now(); ink.cur.hit++;
        break;
      }
    }
  }
}
function inkEraseArea(x, y, r) {
  const r2 = r * r;
  const st = inkStore(ink.qid);
  for (const s of st.s.slice()) {
    if (s.dead) continue;
    const cut = [];
    let any = false;
    for (let i = 1; i < s.pts.length; i++) {
      const c = distSeg2(x, y, s.pts[i - 1][0], s.pts[i - 1][1], s.pts[i][0], s.pts[i][1]) < r2;
      cut.push(c); if (c) any = true;
    }
    if (!any) continue;
    s.dead = Date.now(); ink.cur.hit++;
    // 沒被擦到的段落切成子筆畫留下（sub 不重複計入過程指標）
    let run = [s.pts[0]];
    for (let i = 1; i < s.pts.length; i++) {
      if (cut[i - 1]) {
        if (run.length > 1) st.s.push({ t0: s.t0, t1: s.t1, pts: run, sub: true });
        run = [s.pts[i]];
      } else run.push(s.pts[i]);
    }
    if (run.length > 1) st.s.push({ t0: s.t0, t1: s.t1, pts: run, sub: true });
  }
}
function inkEraCursor(x, y, r) {
  const c = ink.ctx;
  c.strokeStyle = 'rgba(223, 230, 242, 0.65)';
  c.setLineDash([4, 4]); c.lineWidth = 1;
  c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.stroke();
  c.setLineDash([]);
}
function inkUndo() {
  if (!ink) return;
  const st = inkStore(ink.qid);
  const alive = st.s.filter((s) => !s.dead);
  if (!alive.length) return;
  alive[alive.length - 1].dead = Date.now();
  st.e.push(Date.now());
  inkRedraw();
}
function inkClear() {
  if (!ink) return;
  const st = inkStore(ink.qid);
  const alive = st.s.filter((s) => !s.dead);
  if (!alive.length) return;
  const now = Date.now();
  alive.forEach((s) => (s.dead = now));
  st.e.push(now);
  inkRedraw();
}
function inkMode(m) {
  if (ink && ink.exam && m === 'erase') return; // 考場模式沒有橡皮擦
  if (ink) ink.mode = m;
  const pen = $('#ink-pen'); const era = $('#ink-era');
  if (pen) pen.className = 'btn sm' + (m === 'pen' ? ' active' : '');
  if (era) era.className = 'btn sm' + (m === 'erase' ? ' active' : '');
  const o = $('#ink-eopts'); if (o) o.style.display = m === 'erase' ? 'flex' : 'none';
  if (m === 'erase') inkEraUI();
}
function inkDrawStroke(ctx, s) {
  ctx.strokeStyle = INK_COLOR; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(s.pts[0][0], s.pts[0][1]);
  for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1]);
  ctx.stroke();
}
function inkWipe(cv, ctx) {
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
}
function inkRedraw() {
  if (!ink) return;
  inkWipe(ink.cv, ink.ctx);
  for (const s of inkStore(ink.qid).s) if (!s.dead) inkDrawStroke(ink.ctx, s);
}
function inkStop() {
  if (!ink) return null;
  const { qid, t0, cv } = ink;
  cv.onpointerdown = cv.onpointermove = cv.onpointerup = cv.onpointercancel = null;
  ink = null;
  const st = inkStore(qid);
  const now = Date.now();
  const ss = st.s.filter((s) => s.t0 >= t0 && !s.sub).sort((a, b) => a.t0 - b.t0);
  const era = st.e.filter((t) => t >= t0).length;
  if (!ss.length && !era) return null;
  const sec = (x) => Math.round(x / 1000);
  const hes = [];
  for (let i = 1; i < ss.length; i++) {
    const gap = ss[i].t0 - ss[i - 1].t1;
    if (gap >= HES_GAP) hes.push([sec(ss[i - 1].t1 - t0), sec(gap)]);
  }
  return {
    fi: ss.length ? sec(ss[0].t0 - t0) : null,
    hes: hes.slice(0, 12),
    era,
    tail: ss.length ? sec(now - ss[ss.length - 1].t1) : null,
    n: ss.length,
  };
}
function inkWatch(targetMs) {
  if (!ink) return;
  const st = inkStore(ink.qid);
  let lastAct = ink.t0;
  for (const s of st.s) if (s.t1 > lastAct) lastAct = s.t1;
  for (const t of st.e) if (t > lastAct) lastAct = t;
  const now = Date.now();
  if (now - ink.t0 > targetMs && now - lastAct > 30000 && now - ink.warnedAt > 30000) {
    ink.warnedAt = now;
    const f = $('#ink-flash');
    if (f) {
      f.textContent = '⚠ 已超過目標時間、且 30 秒沒有筆跡——考場上這一刻就該跳題！';
      f.style.display = 'block';
      setTimeout(() => { if (f) f.style.display = 'none'; }, 4500);
    }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
}
function inkSummary(p) {
  if (!p) return '';
  const longest = p.hes.length ? Math.max(...p.hes.map((h) => h[1])) : 0;
  return `<p class="dim">✍️ 過程：起筆 ${p.fi != null ? p.fi + 's' : '—'}｜題中停頓 ${p.hes.length} 次${longest ? `（最長 ${longest}s）` : ''}｜塗改 ${p.era} 次｜最後一筆到送出 ${p.tail != null ? p.tail + 's' : '—'}</p>`;
}
function mergeProc(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { fi: a.fi != null ? a.fi : b.fi, hes: a.hes.concat(b.hes).slice(0, 12), era: a.era + b.era, tail: b.tail != null ? b.tail : a.tail, n: a.n + b.n };
}
async function inkReplay(qid, t0) {
  const cv = $('#ink-cv'); if (!cv || replaying) return;
  replaying = true;
  const ctx = cv.getContext('2d');
  const st = inkStore(qid);
  const all = st.s.filter((s) => s.t0 >= t0);
  const evs = all.filter((s) => !s.sub).sort((a, b) => a.t0 - b.t0);
  const deaths = all.filter((s) => s.dead).map((s) => s.dead);
  const f = $('#ink-flash');
  const flash = (msg) => { if (f) { f.textContent = msg; f.style.display = 'block'; } };
  const unflash = () => { if (f) f.style.display = 'none'; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const aliveAt = (t) => all.filter((s) => s.t0 <= t && (!s.dead || s.dead > t));
  inkWipe(cv, ctx);
  let prevEnd = null;
  for (const s of evs) {
    if (prevEnd !== null) {
      if (deaths.some((d) => d > prevEnd && d <= s.t0)) {
        inkWipe(cv, ctx);
        for (const a of aliveAt(s.t0)) inkDrawStroke(ctx, a);
        flash('🧽 這裡塗改了'); await sleep(600); unflash();
      }
      const gap = s.t0 - prevEnd;
      if (gap >= HES_GAP) { flash(`⏸ 這裡停頓了 ${Math.round(gap / 1000)} 秒`); await sleep(1000); unflash(); }
      else await sleep(Math.min(250, gap / 8));
    }
    ctx.strokeStyle = INK_COLOR; ctx.lineWidth = 2;
    for (let i = 1; i < s.pts.length; i++) {
      ctx.beginPath(); ctx.moveTo(s.pts[i - 1][0], s.pts[i - 1][1]); ctx.lineTo(s.pts[i][0], s.pts[i][1]); ctx.stroke();
      if (i % 6 === 0) await sleep(8);
    }
    prevEnd = s.t1;
  }
  inkWipe(cv, ctx);
  for (const a of aliveAt(Date.now())) inkDrawStroke(ctx, a);
  replaying = false;
}
function exportInk() {
  const qids = Object.keys(sessionInk);
  if (!qids.length) { alert('這次開啟期間還沒有任何筆跡。'); return; }
  const blob = new Blob([JSON.stringify({ d: today(), ink: sessionInk })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mathA13-筆跡-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function today() { return new Date().toISOString().slice(0, 10); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const ERR_TYPES = ['概念不熟', '計算失誤', '看錯題意', '用猜的', '超時'];
const EXAM_DATE = '2027-01-22'; // 116 學年度學測（暫定）

/* ═══════════ 工具 ═══════════ */
const $ = (sel) => document.querySelector(sel);
const app = () => $('#app');
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}
function fmtSec(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}分${s % 60}秒` : `${s}秒`;
}
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function median(nums) {
  if (!nums.length) return 0;
  const a = nums.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
// 答案字串正規化：全形→半形、去空白、統一負號與括號
function norm(s) {
  return String(s).trim()
    .replace(/[（]/g, '(').replace(/[）]/g, ')')
    .replace(/[，]/g, ',').replace(/[．]/g, '.')
    .replace(/[−–—]/g, '-').replace(/\s+/g, '')
    .toLowerCase();
}
function parseFrac(s) {
  s = norm(s);
  const m = s.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  if (m) return parseFloat(m[1]) / parseFloat(m[2]);
  const n = parseFloat(s);
  return /^-?\d+(?:\.\d+)?$/.test(s) ? n : NaN;
}
function checkFill(input, accepted) {
  const ni = norm(input);
  if (accepted.some((a) => norm(a) === ni)) return true;
  const vi = parseFrac(input);
  if (!isNaN(vi)) {
    return accepted.some((a) => {
      const va = parseFrac(a);
      return !isNaN(va) && Math.abs(va - vi) < 1e-9;
    });
  }
  return false;
}
function qTarget(q) { return (q.target || DIFF_TARGET[q.diff]) * 1000; }
function gradeOf(acc) {
  return GRADE_TABLE.find((g) => acc >= g.min).label;
}
function bankById(id) { return BANK.find((q) => q.id === id); }

/* ═══════════ 計時器 ═══════════ */
let ticker = null;
function startTicker(fn) { stopTicker(); ticker = setInterval(fn, 250); }
function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

/* ═══════════ 紀錄 ═══════════ */
function recordAttempt(q, ok, ms, err, mode, proc) {
  const rec = { qid: q.id, ok, ms, err: err || null, d: today(), mode, ts: Date.now() };
  if (proc) rec.p = proc;
  S.attempts.push(rec);
  if (!ok || err === '超時') {
    const w = S.wrong[q.id] || { fails: 0, wins: 0, itv: 0 };
    w.fails += ok ? 0 : 1;
    w.err = err || w.err || '概念不熟';
    w.itv = 1;
    w.due = addDays(today(), 1);
    S.wrong[q.id] = w;
  }
  save();
}
function reviewResult(qid, ok) {
  const w = S.wrong[qid];
  if (!w) return;
  if (ok) {
    w.wins += 1;
    const next = { 1: 3, 3: 7, 7: 14 }[w.itv] || 0;
    if (next === 0) { delete S.wrong[qid]; } // 畢業
    else { w.itv = next; w.due = addDays(today(), next); }
  } else {
    w.fails += 1; w.itv = 1; w.due = addDays(today(), 1);
  }
  save();
}
function dueWrong() {
  const t = today();
  return Object.keys(S.wrong).filter((id) => S.wrong[id].due <= t);
}

/* ═══════════ 導覽 ═══════════ */
const VIEWS = {
  home:  { label: '📋 診斷', fn: renderHome },
  drill: { label: '⚡ 速度特訓', fn: renderDrillMenu },
  prac:  { label: '🎯 主題刷題', fn: renderPracConfig },
  mock:  { label: '⏱️ 模擬實戰', fn: renderMockIntro },
  wrong: { label: '📓 錯題本', fn: renderWrong },
  stats: { label: '📊 數據', fn: renderStats },
  plan:  { label: '🗓️ 作戰計畫', fn: renderPlan },
};
let sessionActive = false;
function nav(view) {
  if (sessionActive && !confirm('目前訓練尚未完成，離開將不保留本題進度。確定離開？')) return;
  sessionActive = false;
  stopTicker();
  if (ink) inkStop();
  document.querySelectorAll('nav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  VIEWS[view].fn();
  updateBadge();
}
function updateBadge() {
  const n = dueWrong().length;
  const b = $('nav button[data-view="wrong"]');
  b.innerHTML = '📓 錯題本' + (n ? ` <span class="badge">${n}</span>` : '');
}

/* ═══════════ 首頁：診斷 ═══════════ */
function renderHome() {
  const days = Math.ceil((new Date(EXAM_DATE) - new Date()) / 86400000);
  const attempts = S.attempts.length;
  const mocks = S.mocks.length;
  let status;
  if (mocks === 0) {
    status = `<div class="card warn"><b>第一步：先做一次「模擬實戰」摸底。</b><br>
      你現在最缺的不是題目，是<b>數據</b>——先花 36 分鐘產生第一筆「每題耗時 × 錯因」紀錄，系統才知道你卡在哪。
      <div style="margin-top:8px"><button class="btn primary" onclick="nav('mock')">開始摸底模擬 →</button></div></div>`;
  } else {
    const recent = S.attempts.slice(-30);
    const acc = recent.filter((a) => a.ok).length / recent.length;
    status = `<div class="card"><b>目前體感級分（近 30 題答對率 ${(acc * 100).toFixed(0)}%）：${gradeOf(acc)}</b><br>
      已累積 ${attempts} 筆做題紀錄、${mocks} 次模擬。到「📊 數據」看你的時間都被哪個單元吃掉。</div>`;
  }
  app().innerHTML = `
  <div class="hero">
    <h1>數A 13級分特訓系統</h1>
    <p>距離 116 學測（2027/1/22）還有 <b class="accent">${days} 天</b>｜目標：9 → 13 級分｜台大獸醫</p>
  </div>
  ${status}
  <div class="card">
    <h2>你的問題在哪（診斷書）</h2>
    <p>「我會，但寫不完」＋ 兩次都停在 9 級分 ＋ 公式都背了 —— 這個組合指向的<b>不是知識缺口，是輸出速度與考試工程</b>：</p>
    <ol>
      <li><b>「會」的定義錯了。</b>線上課＋參考書是輸入型學習：看得懂解答、想得起來公式，會產生「熟悉感」。
        但學測要的是<b>多數題在 90～240 秒內獨立產出</b>（帳面平均 5 分鐘一題，扣掉檢查、讓難題超支後，基本與中等題就剩這個額度）。「看懂」到「限時寫出」中間差一整個訓練量，
        而你過去的讀書法幾乎沒有練到後者。這叫「熟練度錯覺」——不是比喻，是有實驗證據的效應：集中式練習後，
        學生對自己考試成績的預測被研究者形容為「嚴重過度自信」。它正是你兩次考出同樣分數的原因：輸入再多，輸出速度沒變。</li>
      <li><b>你沒有自己的耗時數據。</b>寫不完是「結果」，不是「原因」。真正的原因通常是：某 2~3 類題型你的單題耗時是別人的 2~3 倍
        （常見兇手：多選逐項判斷、條件機率長題幹、需要翻譯題意的應用題）。不量測就永遠不知道兇手是誰，
        只會籠統地覺得「時間不夠」。</li>
      <li><b>基本運算沒有自動化。</b>指對數化簡、特殊角三角值、配方、餘式——這些動作如果還要「想 3 秒」，
        工作記憶就被占滿，難題沒腦力、簡單題變慢。公式「背得出來」和「不經思考直接用」是兩個等級。</li>
      <li><b>缺考試工程：</b>沒有跳題紀律（90 秒無路線就跳）、沒有兩輪作答、沒有把「會的題 100% 拿到」當第一目標。
        9 級分的人常常不是難題不會，而是<b>會的題目只拿到七成</b>——超時、粗心、沒時間檢查。</li>
    </ol>
    <p><b>換算給你聽（113~115 官方對照表核實過）：</b>得分率約 50% ≈ 9 級分，三年皆成立。
    而 13 級分門檻其實只要 <b>69~74%</b>（113 年 74.0 分、114 年 73.5、115 年 68.7）——80 分在近兩年已經是 14 級分。
    所以目標線是<b>雙線制：73% 保底 13 級、80% 進攻 14 級</b>。你要補的 20~25 個百分點裡，
    相當大一部分不是「學新東西」，而是把<b>你已經會的題目的失分（超時未完成＋粗心）</b>收回來
    （這個佔比是本系統的估計，你的錯因數據會逐週驗證它）。這就是為什麼這個系統練的是速度與流程，不是再上一輪課。</p>
  </div>
  <div class="card">
    <h2>切角：四條訓練線</h2>
    <table class="tbl">
      <tr><th>訓練線</th><th>解決什麼</th><th>頻率</th></tr>
      <tr><td><b>⚡ 速度特訓</b><br>基本運算限時連發</td><td>把公式從「背得出」練到「反射」，釋放工作記憶</td><td>每天 10 分鐘（暖身）</td></tr>
      <tr><td><b>🎯 主題刷題</b><br>每題帶碼表＋錯因分類</td><td>找出吃時間的單元；「會但慢」的題現形</td><td>每天 30~40 分鐘</td></tr>
      <tr><td><b>⏱️ 模擬實戰</b><br>兩輪作答法訓練</td><td>跳題紀律、時間分配、先收會的分</td><td>每週 2 次</td></tr>
      <tr><td><b>📓 錯題本</b><br>間隔重測（1→3→7→14天）</td><td>錯過的題不再錯第二次；連對四次才畢業</td><td>每天 10 分鐘（到期題）</td></tr>
    </table>
    <p class="dim">內建題庫是自製訓練題，用來練「速度與流程」。進入 9~11 月後，主戰場換成大考中心的<b>歷屆試題</b>（108 課綱後的數A卷），本系統的模擬實戰改為輔助維持手感。</p>
  </div>`;
}

/* ═══════════ 速度特訓 ═══════════ */
const TRI_VAL = {
  sin: { 0:'0',30:'1/2',45:'√2/2',60:'√3/2',90:'1',120:'√3/2',135:'√2/2',150:'1/2',180:'0',210:'-1/2',225:'-√2/2',240:'-√3/2',270:'-1',300:'-√3/2',315:'-√2/2',330:'-1/2' },
  cos: { 0:'1',30:'√3/2',45:'√2/2',60:'1/2',90:'0',120:'-1/2',135:'-√2/2',150:'-√3/2',180:'-1',210:'-√3/2',225:'-√2/2',240:'-1/2',270:'0',300:'1/2',315:'√2/2',330:'√3/2' },
  tan: { 0:'0',30:'√3/3',45:'1',60:'√3',120:'-√3',135:'-1',150:'-√3/3',180:'0',210:'√3/3',225:'1',240:'√3',300:'-√3',315:'-1',330:'-√3/3' },
};
const POWERS = [['8','2/3',4],['27','2/3',9],['16','3/4',8],['32','2/5',4],['4','3/2',8],['9','3/2',27],['8','4/3',16],['27','1/3',3],['125','2/3',25],['64','2/3',16],['81','3/4',27],['16','1/2',4]];
const PYTH = [[3,4,5],[6,8,10],[5,12,13],[8,15,17],[7,24,25],[9,12,15]];

const DRILLS = {
  tri: { name: '三角函數值', desc: '特殊角 sin/cos/tan，看到就要有答案', target: 12,
    gen() {
      const fn = pick(['sin', 'cos', 'tan']);
      const angles = Object.keys(TRI_VAL[fn]).map(Number);
      const a = pick(angles);
      const correct = TRI_VAL[fn][a];
      const pool = [...new Set(Object.values(TRI_VAL[fn]))].filter((v) => v !== correct);
      const opts = shuffle([correct, ...shuffle(pool).slice(0, 3)]);
      return { q: `${fn} ${a}° = ?`, kind: 'opts', opts, ans: opts.indexOf(correct) };
    } },
  logexp: { name: '指對數速算', desc: 'log 與分數指數，目標 15 秒內', target: 15,
    gen() {
      const t = rint(1, 3);
      if (t === 1) { const b = pick([2, 3, 5]); const k = rint(2, 5); return { q: `log<sub>${b}</sub>(${b ** k}) = ?`, kind: 'num', ans: String(k) }; }
      if (t === 2) { const p = pick(POWERS); return { q: `${p[0]}<sup>${p[1]}</sup> = ?`, kind: 'num', ans: String(p[2]) }; }
      const x = rint(2, 4), y = rint(2, 4);
      return pick([
        { q: `2<sup>${x}</sup> × 2<sup>${y}</sup> = 2<sup>?</sup>`, kind: 'num', ans: String(x + y) },
        { q: `(2<sup>${x}</sup>)<sup>${y}</sup> = 2<sup>?</sup>`, kind: 'num', ans: String(x * y) },
      ]);
    } },
  quad: { name: '二次函數最小值', desc: 'y = x²+bx+c 直接讀出最小值', target: 25,
    gen() {
      const b = pick([-8, -6, -4, -2, 2, 4, 6, 8]); const c = rint(-9, 9);
      const min = c - (b * b) / 4;
      return { q: `y = x² ${b < 0 ? '−' : '+'} ${Math.abs(b)}x ${c < 0 ? '−' : '+'} ${Math.abs(c)} 的最小值 = ?`, kind: 'num', ans: String(min) };
    } },
  rem: { name: '餘式定理', desc: 'f(x) 除以 (x−k)，答案就是 f(k)', target: 25,
    gen() {
      const a = rint(1, 3), b = rint(-5, 5), c = rint(-5, 5);
      const k = pick([-3, -2, -1, 1, 2, 3]);
      const val = a * k * k + b * k + c;
      const bs = b === 0 ? '' : ` ${b < 0 ? '−' : '+'} ${Math.abs(b)}x`;
      const cs = c === 0 ? '' : ` ${c < 0 ? '−' : '+'} ${Math.abs(c)}`;
      return { q: `${a === 1 ? '' : a}x²${bs}${cs} 除以 (x ${k < 0 ? '+' : '−'} ${Math.abs(k)}) 的餘式 = ?`, kind: 'num', ans: String(val) };
    } },
  cnk: { name: 'C 與 P 速算', desc: '組合數/排列數小數字，考場不許卡', target: 20,
    gen() {
      if (Math.random() < 0.6) {
        const n = rint(5, 10), k = rint(2, 4);
        let v = 1; for (let i = 0; i < k; i++) v = v * (n - i) / (i + 1);
        return { q: `C(${n}, ${k}) = ?`, kind: 'num', ans: String(Math.round(v)) };
      }
      const n = rint(4, 8), k = rint(2, 3);
      let v = 1; for (let i = 0; i < k; i++) v *= (n - i);
      return { q: `P(${n}, ${k}) = ?`, kind: 'num', ans: String(v) };
    } },
  dot: { name: '向量內積與長度', desc: '內積、畢氏長度，全部心算', target: 15,
    gen() {
      if (Math.random() < 0.7) {
        const v = [rint(-6, 6), rint(-6, 6), rint(-6, 6), rint(-6, 6)];
        return { q: `(${v[0]}, ${v[1]}) · (${v[2]}, ${v[3]}) = ?`, kind: 'num', ans: String(v[0] * v[2] + v[1] * v[3]) };
      }
      const p = pick(PYTH);
      return { q: `|(${p[0]}, ${p[1]})| = ?`, kind: 'num', ans: String(p[2]) };
    } },
  seqd: { name: '等差等比速算', desc: '第 n 項與求和公式即代即出', target: 20,
    gen() {
      const t = rint(1, 3);
      if (t === 1) { const a = rint(-5, 5), d = rint(2, 6), n = rint(5, 12); return { q: `等差：a₁=${a}、d=${d}，a${String(n).split('').map(c=>'₀₁₂₃₄₅₆₇₈₉'[+c]).join('')} = ?`, kind: 'num', ans: String(a + (n - 1) * d) }; }
      if (t === 2) { const a = rint(1, 3), r = pick([2, 3]), n = rint(3, 6); return { q: `等比：a₁=${a}、r=${r}，第 ${n} 項 = ?`, kind: 'num', ans: String(a * r ** (n - 1)) }; }
      const n = rint(5, 15);
      return { q: `1 + 2 + … + ${n} = ?`, kind: 'num', ans: String(n * (n + 1) / 2) };
    } },
  mul: { name: '兩位數心算', desc: '乘法與平方——計算慢，全卷都慢', target: 25,
    gen() {
      if (Math.random() < 0.5) { const a = rint(12, 29), b = rint(11, 19); return { q: `${a} × ${b} = ?`, kind: 'num', ans: String(a * b) }; }
      const a = rint(11, 25);
      return { q: `${a}² = ?`, kind: 'num', ans: String(a * a) };
    } },
  quadroot: { name: '解一元二次', desc: '十字交乘直接報兩根——全卷最高頻的機械步驟（近5年約10題用到）', target: 20,
    gen() {
      const eq = (b, c) => `x²${b ? (b > 0 ? ` + ${b}x` : ` − ${-b}x`) : ''}${c ? (c > 0 ? ` + ${c}` : ` − ${-c}`) : ''} = 0`;
      if (Math.random() < 0.2) {
        const r = rint(-6, 6) || 3;
        return { q: `${eq(-2 * r, r * r)}，重根 x = ?`, kind: 'num', ans: String(r) };
      }
      let p = rint(-9, 9) || 2;
      let q2 = rint(-9, 9) || -3;
      if (p === q2) q2 = p + rint(1, 4);
      const lo = Math.min(p, q2), hi = Math.max(p, q2);
      return { q: `${eq(-(p + q2), p * q2)}，兩根 = ?（由小到大，逗號分隔，如 -1,5）`, kind: 'num', ans: `${lo},${hi}` };
    } },
  frac: { name: '分數四則', desc: '機率、期望值的隱形時間殺手兼粗心大戶——答案一律最簡分數', target: 15,
    gen() {
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      const red = (p, q) => {
        if (q < 0) { p = -p; q = -q; }
        const d = gcd(Math.abs(p), q) || 1;
        p /= d; q /= d;
        return q === 1 ? String(p) : `${p}/${q}`;
      };
      const t = rint(1, 4);
      const a = rint(1, 9), b = rint(2, 9), c = rint(1, 9), d = rint(2, 9);
      if (t === 1) {
        const plus = Math.random() < 0.5;
        return { q: `${a}/${b} ${plus ? '+' : '−'} ${c}/${d} = ?（最簡分數）`, kind: 'num', ans: red(plus ? a * d + c * b : a * d - c * b, b * d) };
      }
      if (t === 2) return { q: `${a}/${b} × ${c}/${d} = ?（最簡分數）`, kind: 'num', ans: red(a * c, b * d) };
      if (t === 3) return { q: `(${a}/${b}) ÷ (${c}/${d}) = ?（最簡分數）`, kind: 'num', ans: red(a * d, b * c) };
      const k = rint(2, 6), p = rint(2, 9), q2 = rint(p + 1, 12);
      return { q: `約分到最簡：${p * k}/${q2 * k} = ?`, kind: 'num', ans: red(p, q2) };
    } },
  root: { name: '根式化簡', desc: '√48 要一眼變 4√3——所有距離、長度計算的收尾動作', target: 12,
    gen() {
      const t = rint(1, 3);
      if (t === 1) {
        const k = rint(2, 9), m = pick([2, 3, 5, 6, 7, 10]);
        const right = `${k}√${m}`;
        const opts = shuffle([right, `${k + 1}√${m}`, `${k}√${m === 10 ? 5 : m + (m === 3 ? 2 : 1)}`, `${k * 2}√${m}`]);
        return { q: `化簡：√${k * k * m} = ?`, opts, ans: opts.indexOf(right) };
      }
      if (t === 2) {
        const b = pick([2, 3, 5]), tt = rint(1, 4);
        const right = tt === 1 ? `√${b}` : `${tt}√${b}`;
        const cand = [right, `${tt}/√${b}`, `${tt * b}√${b}`, `${tt + 1}√${b}`, `${tt + 2}√${b}`, `${tt * b}/√${b}`];
        const opts = shuffle([...new Set(cand)].slice(0, 4));
        return { q: `有理化：${tt * b}/√${b} = ?`, opts, ans: opts.indexOf(right) };
      }
      // 距離計算收尾：√(x²+y²)
      const cases = [
        [6, 2, '2√10', ['4√10', '2√5', '√38']],
        [4, 2, '2√5', ['4√5', '2√10', '√18']],
        [6, 3, '3√5', ['9√5', '3√10', '2√5']],
        [5, 5, '5√2', ['2√5', '25√2', '5']],
        [4, 4, '4√2', ['2√4', '8', '4']],
        [8, 4, '4√5', ['2√5', '4√2', '8√5']],
        [3, 4, '5', ['7', '√7', '5√2']],
        [6, 8, '10', ['14', '2√7', '10√2']],
        [5, 12, '13', ['17', '√17', '13√2']],
        [9, 3, '3√10', ['9√3', '3√3', '27']],
      ];
      const [x, y, right, wrongs] = pick(cases);
      const opts = shuffle([right, ...wrongs]);
      return { q: `√(${x}² + ${y}²) = ?（距離計算的收尾）`, opts, ans: opts.indexOf(right) };
    } },
  mat2: { name: '2×2 矩陣速算', desc: 'det、面積、矩陣作用——112 起連三年必考的新主角', target: 18,
    gen() {
      const t = rint(1, 3);
      for (let tries = 0; tries < 8; tries++) {
        const a = rint(-6, 6), b = rint(-6, 6), c = rint(-6, 6), d = rint(-6, 6);
        if (t === 1) return { q: `二階行列式：第一列 (${a}, ${b})、第二列 (${c}, ${d})，ad−bc = ?`, kind: 'num', ans: String(a * d - b * c) };
        if (t === 2) {
          const x1 = rint(-5, 5), y1 = rint(-5, 5), x2 = rint(-5, 5), y2 = rint(-5, 5);
          if (x1 * y2 - x2 * y1 === 0) continue;
          return { q: `向量 (${x1}, ${y1}) 與 (${x2}, ${y2}) 張出的平行四邊形面積 = ?`, kind: 'num', ans: String(Math.abs(x1 * y2 - x2 * y1)) };
        }
        const x = rint(-4, 4), y = rint(-4, 4);
        if (!x && !y) continue;
        const right = `(${a * x + b * y}, ${c * x + d * y})`;
        const opts = [...new Set([right, `(${a * x + c * y}, ${b * x + d * y})`, `(${a * x - b * y}, ${c * x - d * y})`, `(${c * x + d * y}, ${a * x + b * y})`])];
        if (opts.length < 4) continue;
        const sh = shuffle(opts);
        return { q: `矩陣 A：第一列 (${a}, ${b})、第二列 (${c}, ${d})。A 作用在向量 (${x}, ${y}) 的結果 = ?`, opts: sh, ans: sh.indexOf(right) };
      }
      return { q: `二階行列式：第一列 (2, 3)、第二列 (1, 4)，ad−bc = ?`, kind: 'num', ans: '5' };
    } },
};

function renderDrillMenu() {
  const cards = Object.keys(DRILLS).map((k) => {
    const d = DRILLS[k];
    const hist = S.drills[k] || [];
    const last = hist[hist.length - 1];
    const stat = last
      ? `上次：中位數 ${(last.med / 1000).toFixed(1)}s／答對 ${last.acc}%${last.med / 1000 <= d.target && last.acc === 100 ? ' ✅' : ''}`
      : '尚未練過';
    return `<div class="card drill-card">
      <b>${d.name}</b><span class="dim"> 目標 ${d.target}s/題</span>
      <p class="dim">${d.desc}</p>
      <p class="dim">${stat}</p>
      <button class="btn primary" onclick="startDrill('${k}')">開始 12 題</button>
    </div>`;
  }).join('');
  app().innerHTML = `
    <h1>⚡ 速度特訓</h1>
    <p>目的：把基本運算練到<b>不經思考</b>。每輪 12 題。<b>達標＝中位數 ≤ 目標秒數，且 12 題全對</b>——兩個條件缺一不可，「快但會錯」在考場上比「慢」更貴。<br>
    <span class="dim">建議當作每天開始讀數學的 10 分鐘暖身，挑 2~3 種輪流——優先「上次未達標」的和新上架的四種（解一元二次、分數四則、根式化簡、2×2 矩陣）。</span></p>
    <div class="grid">${cards}</div>`;
}

let drill = null;
function startDrill(key) {
  if (!syncGate()) return;
  drill = { key, items: [], i: 0, results: [], t0: 0 };
  for (let i = 0; i < 12; i++) drill.items.push(DRILLS[key].gen());
  sessionActive = true;
  drillNext();
}
function drillNext() {
  if (drill.i >= drill.items.length) return drillDone();
  const d = DRILLS[drill.key];
  const it = drill.items[drill.i];
  drill.t0 = Date.now();
  const input = it.kind === 'num'
    ? `<input id="din" class="ans-input" inputmode="text" autocomplete="off" placeholder="答案" onkeydown="if(event.key==='Enter')drillSubmit()">
       <button class="btn primary" onclick="drillSubmit()">送出</button>`
    : it.opts.map((o, idx) => `<button class="btn opt" onclick="drillSubmit(${idx})">${o}</button>`).join('');
  app().innerHTML = `
    <div class="session-head">
      <span>${d.name}｜第 ${drill.i + 1} / 12 題</span>
      <span id="dtimer" class="timer">0.0s</span>
    </div>
    <div class="card qcard"><div class="qtext big">${it.q}</div>
      <div class="ansrow">${input}</div>
      <div id="dfb"></div>
    </div>`;
  const inp = $('#din'); if (inp) inp.focus();
  startTicker(() => {
    const e = (Date.now() - drill.t0) / 1000;
    const t = $('#dtimer');
    if (t) { t.textContent = e.toFixed(1) + 's'; t.className = 'timer' + (e > d.target ? ' over' : ''); }
  });
}
function drillSubmit(optIdx) {
  const it = drill.items[drill.i];
  const ms = Date.now() - drill.t0;
  let ok, given;
  if (it.kind === 'num') { given = $('#din').value; ok = checkFill(given, [it.ans]); }
  else { given = it.opts[optIdx]; ok = optIdx === it.ans; }
  const ansTxt = it.kind === 'num' ? it.ans : it.opts[it.ans];
  drill.results.push({ ok, ms, q: it.q, ans: ansTxt, given });
  stopTicker();
  const fb = $('#dfb');
  if (ok) {
    fb.innerHTML = `<p class="ok">✔ 正確（${(ms / 1000).toFixed(1)}s）</p>`;
    drill.i++;
    setTimeout(drillNext, 500);
  } else {
    fb.innerHTML = `<p class="bad">✘ 錯了，正確答案：<b>${ansTxt}</b></p>
      <button class="btn primary" onclick="drill.i++;drillNext()">下一題</button>`;
  }
}
function drillDone() {
  sessionActive = false;
  const d = DRILLS[drill.key];
  const times = drill.results.map((r) => r.ms);
  const med = median(times);
  const acc = Math.round(100 * drill.results.filter((r) => r.ok).length / drill.results.length);
  (S.drills[drill.key] = S.drills[drill.key] || []).push({ d: today(), med, acc });
  save();
  const hist = S.drills[drill.key];
  const prev = hist.length > 1 ? hist[hist.length - 2] : null;
  const speedOK = med / 1000 <= d.target;
  const accOK = acc === 100;
  const pass = speedOK && accOK;
  const totalMs = times.reduce((a, b) => a + b, 0);
  const fastest = Math.min(...times);
  const slowest = Math.max(...times);
  const wrongs = drill.results.filter((r) => !r.ok);
  const slows = drill.results.filter((r) => r.ok && r.ms > med * 2 && r.ms > 3000);
  const slowShare = Math.round(100 * slows.reduce((a, r) => a + r.ms, 0) / totalMs);
  // 診斷：分開判速度與準度，處方對症
  let verdict;
  if (pass) {
    verdict = `✅ <b>達標！</b>速度（${(med / 1000).toFixed(1)}s ≤ ${d.target}s）與準度（100%）雙過——這個動作接近自動化了。明天再過一輪確認穩定，就換下一種特訓。`;
  } else if (!accOK && speedOK) {
    verdict = `⚠️ <b>敗在準度，不是速度。</b>中位數 ${(med / 1000).toFixed(1)}s 遠低於目標 ${d.target}s，但答對率只有 ${acc}%——手比腦快了。
      <b>處方：下一輪刻意放慢兩成、每題送出前多看一眼，先拿 100% 再談快。</b>
      自動化的定義是「快、而且不會錯」——考場上錯一題的代價，比慢三秒大得多。`;
  } else if (accOK && !speedOK) {
    verdict = `⚠️ <b>全對，但還不夠快</b>（${(med / 1000).toFixed(1)}s > 目標 ${d.target}s）——代表這個運算你還在「想」，還沒變成反射。
      <b>處方：明天同一種再來一輪。</b>速度是重複出來的，不是想出來的。`;
  } else {
    verdict = `❌ 速度與準度都未達標。<b>處方：先不追速度——下一輪只求全對。</b>全對之後，速度通常會自己掉下來。`;
  }
  const trend = hist.slice(-6).map((h) => `${(h.med / 1000).toFixed(1)}s/${h.acc}%`).join(' → ');
  const rows = drill.results.map((r, i) => {
    const slow = r.ok && r.ms > med * 2 && r.ms > 3000;
    return `<tr>
      <td>${i + 1}</td><td>${r.q}</td>
      <td>${r.ok ? '<span class="okc">✔</span>' : `<span class="badc">✘ ${r.given || '（空白）'}</span>`}</td>
      <td><b>${r.ans}</b></td>
      <td class="${slow ? 'warnc' : ''}" style="font-variant-numeric:tabular-nums">${(r.ms / 1000).toFixed(1)}s${slow ? ' ⚠' : ''}</td></tr>`;
  }).join('');
  app().innerHTML = `
    <h1>${d.name} — 結果</h1>
    <div class="card ${pass ? 'good' : ''}">
      <p class="big">中位數 <b>${(med / 1000).toFixed(1)}s</b>／目標 ${d.target}s ｜ 答對 <b class="${accOK ? 'okc' : 'badc'}">${acc}%</b></p>
      <p>達標＝兩個條件同時成立：
        ① 中位數 ≤ ${d.target}s ${speedOK ? '<b class="okc">✓ 已達</b>' : `<b class="badc">✗ 未達（你 ${(med / 1000).toFixed(1)}s）</b>`}
        ② 12 題全對 ${accOK ? '<b class="okc">✓ 已達</b>' : `<b class="badc">✗ 未達（你 ${acc}%，錯 ${wrongs.length} 題）</b>`}</p>
      <p class="dim">全輪 ${(totalMs / 1000).toFixed(0)}s ｜ 最快 ${(fastest / 1000).toFixed(1)}s ｜ 最慢 ${(slowest / 1000).toFixed(1)}s</p>
      <p>${verdict}</p>
      ${prev ? `<p class="dim">上一輪 ${(prev.med / 1000).toFixed(1)}s／${prev.acc}% → 這一輪 ${(med / 1000).toFixed(1)}s／${acc}%
        ${med < prev.med && acc >= prev.acc ? '<span class="okc">（雙向進步 ↑）</span>' : ''}</p>` : ''}
      ${hist.length > 1 ? `<p class="dim">近 ${Math.min(6, hist.length)} 輪走勢：${trend}</p>` : ''}
    </div>
    ${wrongs.length ? `<div class="card warn"><h2>✘ 錯的 ${wrongs.length} 題——花 30 秒看懂它們再走</h2>
      <ul>${wrongs.map((r) => `<li>${r.q}　你答 <span class="badc">${r.given || '（空白）'}</span>，正解 <b>${r.ans}</b>（${(r.ms / 1000).toFixed(1)}s${r.ms < med ? '——比你的中位數還快，十之八九是搶快' : ''}）</li>`).join('')}</ul></div>` : ''}
    ${slows.length ? `<div class="card"><h2>⚠ 卡頓題 ${slows.length} 題（吃掉全輪 ${slowShare}% 的時間）</h2>
      <p class="dim">耗時超過自己中位數兩倍的題——這幾種數字組合就是你「還沒自動化」的精確位置，下一輪特別注意它們有沒有變快：</p>
      <ul>${slows.map((r) => `<li>${r.q}　<b class="warnc">${(r.ms / 1000).toFixed(1)}s</b></li>`).join('')}</ul></div>` : ''}
    <div class="card"><h2>逐題明細</h2>
      <div style="overflow-x:auto"><table class="tbl"><tr><th>#</th><th>題目</th><th>作答</th><th>正解</th><th>耗時</th></tr>${rows}</table></div>
      <button class="btn primary" onclick="startDrill('${drill.key}')">再來一輪</button>
      <button class="btn" onclick="nav('drill')">回特訓選單</button>
    </div>`;
}

/* ═══════════ 主題刷題 ═══════════ */
function attemptsOf(qid) { return S.attempts.filter((a) => a.qid === qid); }
function renderPracConfig() {
  const chips = Object.keys(TOPICS).map((k) => {
    const qs = BANK.filter((q) => q.topic === k);
    const seen = qs.filter((q) => attemptsOf(q.id).length);
    return `<label class="chip"><input type="checkbox" value="${k}" checked> ${TOPICS[k]} <span class="dim">${seen.length}/${qs.length}</span></label>`;
  }).join('');
  app().innerHTML = `
    <h1>🎯 主題刷題</h1>
    <p>每題帶碼表：計時條變<span class="warnc">黃</span>代表到達目標時間、變<span class="badc">紅</span>代表超時 1.5 倍（考場上這題該跳了）。答錯要選錯因——錯因數據決定你之後練什麼。</p>
    <div class="card">
      <h3>單元（預設全選）</h3>
      <div class="chips" id="topicChips">${chips}</div>
      <h3>難度</h3>
      <div class="chips" id="diffChips">
        <label class="chip"><input type="checkbox" value="1" checked> 易</label>
        <label class="chip"><input type="checkbox" value="2" checked> 中</label>
        <label class="chip"><input type="checkbox" value="3" checked> 難</label>
      </div>
      <h3>題數</h3>
      <div class="chips" id="cntChips">
        <label class="chip"><input type="radio" name="cnt" value="5"> 5 題</label>
        <label class="chip"><input type="radio" name="cnt" value="8" checked> 8 題</label>
        <label class="chip"><input type="radio" name="cnt" value="12"> 12 題</label>
      </div>
      <button class="btn primary" onclick="startPrac()">開始（未做過的題優先）</button>
    </div>`;
}
let prac = null;
function startPrac() {
  if (!syncGate()) return;
  const topics = [...document.querySelectorAll('#topicChips input:checked')].map((i) => i.value);
  const diffs = [...document.querySelectorAll('#diffChips input:checked')].map((i) => +i.value);
  const cnt = +document.querySelector('#cntChips input:checked').value;
  let pool = BANK.filter((q) => topics.includes(q.topic) && diffs.includes(q.diff));
  if (!pool.length) { alert('沒有符合條件的題目'); return; }
  // 未做過優先，其次做過次數少的
  pool = shuffle(pool).sort((a, b) => attemptsOf(a.id).length - attemptsOf(b.id).length);
  prac = { queue: pool.slice(0, cnt), i: 0, results: [], mode: 'practice' };
  sessionActive = true;
  pracNext();
}
function pracNext() {
  if (prac.i >= prac.queue.length) return pracDone();
  renderQuestion(prac.queue[prac.i], {
    head: `第 ${prac.i + 1} / ${prac.queue.length} 題`,
    onDone(res) {
      prac.results.push(res);
      prac.i++;
      pracNext();
    },
  });
}
function pracDone() {
  sessionActive = false;
  const r = prac.results;
  const okN = r.filter((x) => x.ok).length;
  const slowOk = r.filter((x) => x.ok && x.ms > x.target * 1.5).length;
  const rows = r.map((x, i) => {
    const q = prac.queue[i];
    return `<tr><td>${TOPICS[q.topic]}</td><td>${x.ok ? '✔' : '✘'}</td>
      <td class="${x.ms > x.target ? 'badc' : 'okc'}">${fmtSec(x.ms)} / ${fmtSec(x.target)}</td>
      <td>${x.err || '—'}</td></tr>`;
  }).join('');
  app().innerHTML = `
    <h1>刷題結果</h1>
    <div class="card">
      <p class="big">答對 <b>${okN} / ${r.length}</b>${slowOk ? `，其中 <b class="warnc">${slowOk} 題「對但超時」</b>（考場上等於失分，已加入錯題本重練速度）` : ''}</p>
      <table class="tbl"><tr><th>單元</th><th>結果</th><th>耗時/目標</th><th>錯因</th></tr>${rows}</table>
      <button class="btn primary" onclick="nav('prac')">再刷一輪</button>
      <button class="btn" onclick="nav('stats')">看數據</button>
    </div>`;
}

/* ═══════════ 單題渲染（刷題與錯題重測共用） ═══════════ */
let qsess = null;
function renderQuestion(q, cfg) {
  qsess = { q, cfg, t0: Date.now(), chosen: new Set() };
  const target = qTarget(q);
  let ansUI;
  if (q.type === 'single') {
    ansUI = q.opts.map((o, i) =>
      `<button class="btn opt block" onclick="qSubmit(${i})">(${i + 1}) ${o}</button>`).join('');
  } else if (q.type === 'multi') {
    ansUI = q.opts.map((o, i) =>
      `<label class="opt block check"><input type="checkbox" value="${i}"> (${i + 1}) ${o}</label>`).join('')
      + `<button class="btn primary" onclick="qSubmit()">送出（多選）</button>`;
  } else {
    ansUI = `<input id="qin" class="ans-input" autocomplete="off" placeholder="輸入答案（分數用 a/b）" onkeydown="if(event.key==='Enter')qSubmit()">
      <button class="btn primary" onclick="qSubmit()">送出</button>`;
  }
  app().innerHTML = `
    <div class="session-head">
      <span>${cfg.head}｜${TOPICS[q.topic]}｜${'★'.repeat(q.diff)}${'☆'.repeat(3 - q.diff)}｜目標 ${fmtSec(target)}</span>
      <span id="qtimer" class="timer">00:00</span>
    </div>
    <div class="timebar"><div id="tbfill" class="timebar-fill"></div></div>
    <div class="card qcard">
      <div class="qtext">${q.q}</div>
      <div class="ansarea">${ansUI}</div>
      <div id="qfb"></div>
    </div>
    ${inkHTML()}`;
  const inp = $('#qin'); if (inp) inp.focus();
  inkStart(q.id, qsess.t0);
  startTicker(() => {
    const e = Date.now() - qsess.t0;
    const t = $('#qtimer'); const f = $('#tbfill');
    if (!t) return;
    t.textContent = fmtClock(e);
    const ratio = e / target;
    f.style.width = Math.min(100, ratio * 100) + '%';
    f.className = 'timebar-fill' + (ratio > 1.5 ? ' red' : ratio > 1 ? ' yellow' : '');
    t.className = 'timer' + (ratio > 1.5 ? ' over' : ratio > 1 ? ' warn' : '');
    inkWatch(target);
  });
}
function qSubmit(optIdx) {
  const { q } = qsess;
  const ms = Date.now() - qsess.t0;
  const target = qTarget(q);
  stopTicker();
  qsess.proc = inkStop();
  syncInk(q.id, qsess.t0, qsess.proc);
  let ok, yourAns;
  if (q.type === 'single') {
    ok = optIdx === q.ans[0];
    yourAns = `(${optIdx + 1})`;
  } else if (q.type === 'multi') {
    const chosen = [...document.querySelectorAll('.ansarea input:checked')].map((i) => +i.value);
    ok = chosen.length === q.ans.length && q.ans.every((a) => chosen.includes(a));
    yourAns = chosen.length ? chosen.map((c) => `(${c + 1})`).join('') : '（未選）';
  } else {
    const v = $('#qin').value;
    ok = checkFill(v, q.ans);
    yourAns = v || '（空白）';
  }
  const correctTxt = q.type === 'fill' ? q.ans[0] : q.ans.map((a) => `(${a + 1})`).join('');
  const overtime = ok && ms > target * 1.5;
  // 鎖住作答區
  document.querySelectorAll('.ansarea button, .ansarea input').forEach((b) => (b.disabled = true));
  const fb = $('#qfb');
  const solBlock = `
    <div class="sol">
      <p>${ok ? '<span class="ok">✔ 答對</span>' : `<span class="bad">✘ 答錯</span>（你的答案：${yourAns}）`}
         ｜正解：<b>${correctTxt}</b>｜耗時 ${fmtSec(ms)}（目標 ${fmtSec(target)}）
         ${overtime ? '<span class="warnc"><b>⚠ 對但超時 1.5 倍——考場上這題等於沒拿到</b></span>' : ''}</p>
      <p><b>詳解：</b>${q.sol}</p>
      ${q.tip ? `<p class="tip">💡 <b>快解：</b>${q.tip}</p>` : ''}
      ${inkSummary(qsess.proc)}
      ${qsess.proc && qsess.proc.n ? `<button class="btn sm" onclick="inkReplay('${q.id}', ${qsess.t0})">▶ 回放解題過程</button>` : ''}
    </div>`;
  if (!ok) {
    fb.innerHTML = solBlock + `
      <p><b>錯因是什麼？（誠實選，這決定你之後練什麼）</b></p>
      <div class="chips">${ERR_TYPES.slice(0, 4).map((e) =>
        `<button class="btn err" onclick="qFinish(false, ${ms}, '${e}')">${e}</button>`).join('')}
      </div>`;
  } else if (overtime) {
    fb.innerHTML = solBlock + `<button class="btn primary" onclick="qFinish(true, ${ms}, '超時')">下一題</button>`;
  } else {
    fb.innerHTML = solBlock + `<button class="btn primary" onclick="qFinish(true, ${ms}, null)">下一題</button>`;
  }
}
function qFinish(ok, ms, err) {
  const { q, cfg } = qsess;
  if (cfg.review) reviewResult(q.id, ok);
  else recordAttempt(q, ok, ms, err, prac ? prac.mode : 'practice', qsess.proc);
  cfg.onDone({ ok, ms, err, target: qTarget(q) });
}

/* ═══════════ 模擬實戰 ═══════════ */
function renderMockIntro() {
  const n = S.mocks.length;
  app().innerHTML = `
    <h1>⏱️ 模擬實戰（兩輪作答法訓練）</h1>
    <div class="card">
      <p><b>12 題、36 分鐘</b>，難度混合。節奏刻意比帳面快：學測是 100 分鐘約 20 題，帳面平均 5 分鐘一題——
      但扣掉 15~20 分鐘檢查，再讓最難的 3~4 題與混合題各吃 6~10 分鐘，<b>剩下的基本題、中等題實際只分得到約 3 分鐘</b>
      （名師實戰配速表同一個方向：單選約 3.6 分／題、多選約 4.2 分／題，全卷預留 10~20 分鐘驗算＋畫卡）。
      每題都照 5 分鐘的節奏寫，就是「寫不完」的節奏。規則就是考場規則：</p>
      <ol>
        <li><b>第一輪：</b>每題先花 20 秒判斷「我知不知道第一步」。知道 → 做；不知道或猶豫 → <b>按跳過</b>，不辯論。</li>
        <li><b>第二輪：</b>回頭處理跳過的題，直到時間用完。</li>
        <li>作答中<b>不會顯示對錯</b>（跟考場一樣），全部結束才對答案。</li>
        <li>每題顯示建議時間上限，超過就該停損——系統會記錄你「該跳沒跳」幾次。</li>
      </ol>
      <p class="dim">已完成 ${n} 次模擬。${n === 0 ? '第一次就是摸底，考差完全沒關係——我們要的是數據。' : ''}</p>
      <button class="btn primary big" onclick="startMock()">開始模擬（36:00 倒數）</button>
    </div>`;
}
let mock = null;
function buildPaper() {
  const byDiff = (d, n) => {
    const pool = shuffle(BANK.filter((q) => q.diff === d));
    const picked = []; const used = new Set();
    for (const q of pool) { // 儘量不同單元
      if (picked.length >= n) break;
      if (!used.has(q.topic)) { picked.push(q); used.add(q.topic); }
    }
    for (const q of pool) { if (picked.length >= n) break; if (!picked.includes(q)) picked.push(q); }
    return picked;
  };
  return shuffle([...byDiff(1, 5), ...byDiff(2, 5), ...byDiff(3, 2)]);
}
function startMock() {
  if (!syncGate()) return;
  const paper = buildPaper();
  mock = {
    paper, orig: paper.slice(), i: 0, round: 1, skipped: [],
    answers: {}, times: {}, proc: {}, tEnd: Date.now() + 36 * 60 * 1000, t0: 0,
  };
  sessionActive = true;
  mockNext();
}
function mockNext() {
  if (Date.now() >= mock.tEnd) return mockGrade('時間到！');
  if (mock.i >= mock.paper.length) {
    if (mock.round === 1 && mock.skipped.length) {
      mock.round = 2; mock.paper = mock.skipped.slice(); mock.skipped = []; mock.i = 0;
      app().innerHTML = `<div class="card good"><h2>第一輪完成 ✔</h2>
        <p>剩餘 <b>${fmtClock(mock.tEnd - Date.now())}</b>，回頭處理 ${mock.paper.length} 題跳過的題。<br>
        還是沒路線的題，直接放棄它——保住檢查時間。</p>
        <button class="btn primary" onclick="mockQ()">進入第二輪</button></div>`;
      return;
    }
    return mockGrade('全部作答完成');
  }
  mockQ();
}
function mockQ() {
  const q = mock.paper[mock.i];
  const cap = qTarget(q);
  mock.t0 = Date.now();
  let ansUI;
  if (q.type === 'single') {
    ansUI = q.opts.map((o, i) => `<button class="btn opt block" onclick="mockAns(${i})">(${i + 1}) ${o}</button>`).join('');
  } else if (q.type === 'multi') {
    ansUI = q.opts.map((o, i) => `<label class="opt block check"><input type="checkbox" value="${i}"> (${i + 1}) ${o}</label>`).join('')
      + `<button class="btn primary" onclick="mockAns()">送出此題</button>`;
  } else {
    ansUI = `<input id="qin" class="ans-input" autocomplete="off" placeholder="答案（分數用 a/b）" onkeydown="if(event.key==='Enter')mockAns()">
      <button class="btn primary" onclick="mockAns()">送出此題</button>`;
  }
  app().innerHTML = `
    <div class="session-head">
      <span>第${mock.round === 1 ? '一' : '二'}輪｜第 ${mock.i + 1} / ${mock.paper.length} 題｜建議 ≤ ${fmtSec(cap)}</span>
      <span id="mclock" class="timer">${fmtClock(mock.tEnd - Date.now())}</span>
    </div>
    <div class="card qcard">
      <div class="qtext">${q.q}</div>
      <div class="ansarea">${ansUI}</div>
      <div class="mock-actions">
        ${mock.round === 1 ? `<button class="btn skip" onclick="mockSkip()">跳過 → 第二輪</button>` : `<button class="btn skip" onclick="mockGiveup()">放棄此題</button>`}
        <span id="mqtimer" class="dim"></span>
      </div>
    </div>
    ${inkHTML(true)}`;
  const inp = $('#qin'); if (inp) inp.focus();
  inkStart(q.id, mock.t0, true);
  startTicker(() => {
    const left = mock.tEnd - Date.now();
    if (left <= 0) { mockGrade('時間到！'); return; }
    const c = $('#mclock'); if (c) { c.textContent = fmtClock(left); c.className = 'timer' + (left < 5 * 60 * 1000 ? ' over' : ''); }
    const e = Date.now() - mock.t0;
    const t = $('#mqtimer');
    if (t) t.innerHTML = e > cap ? `<span class="badc">本題已 ${fmtSec(e)}，超過建議上限——停損！</span>` : `本題 ${fmtSec(e)}`;
    inkWatch(cap);
  });
}
function mockInkDone(qid) {
  const t0 = mock.t0;
  const p = inkStop();
  if (p) mock.proc[qid] = mergeProc(mock.proc[qid], p);
  syncInk(qid, t0, p);
}
function mockAns(optIdx) {
  const q = mock.paper[mock.i];
  let ans;
  if (q.type === 'single') ans = { type: 'single', v: optIdx };
  else if (q.type === 'multi') ans = { type: 'multi', v: [...document.querySelectorAll('.ansarea input:checked')].map((i) => +i.value) };
  else ans = { type: 'fill', v: $('#qin').value };
  mock.answers[q.id] = ans;
  mock.times[q.id] = (mock.times[q.id] || 0) + (Date.now() - mock.t0);
  mockInkDone(q.id);
  mock.i++;
  stopTicker();
  mockNext();
}
function mockSkip() {
  const q = mock.paper[mock.i];
  mock.times[q.id] = (mock.times[q.id] || 0) + (Date.now() - mock.t0);
  mockInkDone(q.id);
  mock.skipped.push(q);
  mock.i++;
  stopTicker();
  mockNext();
}
function mockGiveup() {
  const q = mock.paper[mock.i];
  mock.times[q.id] = (mock.times[q.id] || 0) + (Date.now() - mock.t0);
  mockInkDone(q.id);
  mock.i++;
  stopTicker();
  mockNext();
}
function mockGrade(reason) {
  stopTicker();
  if (ink) mockInkDone(ink.qid);
  sessionActive = false;
  const paper = mock.orig; // 完整原卷（含未作答的題）
  let okN = 0;
  const detail = paper.map((q) => {
    const a = mock.answers[q.id];
    const ms = mock.times[q.id] || 0;
    const target = qTarget(q);
    let ok = false, yourAns = '（未作答）';
    if (a) {
      if (a.type === 'single') { ok = a.v === q.ans[0]; yourAns = `(${a.v + 1})`; }
      else if (a.type === 'multi') { ok = a.v.length === q.ans.length && q.ans.every((x) => a.v.includes(x)); yourAns = a.v.length ? a.v.map((c) => `(${c + 1})`).join('') : '（未選）'; }
      else { ok = checkFill(a.v, q.ans); yourAns = a.v || '（空白）'; }
    }
    if (ok) okN++;
    recordAttempt(q, ok, ms, ok ? (ms > target * 1.5 ? '超時' : null) : '概念不熟', 'mock', mock.proc[q.id] || null);
    return { q, ok, ms, target, yourAns, answered: !!a };
  });
  const acc = okN / paper.length;
  const overStuck = detail.filter((d) => !d.ok && d.answered && d.ms > d.target * 1.5);
  const slowOk = detail.filter((d) => d.ok && d.ms > d.target * 1.5);
  const unused = mock.tEnd - Date.now();
  S.mocks.push({ d: today(), ok: okN, n: paper.length, acc });
  save();
  const rows = detail.map((x) => `
    <tr><td>${TOPICS[x.q.topic]} ${'★'.repeat(x.q.diff)}</td>
    <td>${x.ok ? '✔' : x.answered ? '✘' : '⊘'}</td>
    <td>${x.yourAns}</td>
    <td>${x.q.type === 'fill' ? x.q.ans[0] : x.q.ans.map((a) => `(${a + 1})`).join('')}</td>
    <td class="${x.ms > x.target ? 'badc' : ''}">${fmtSec(x.ms)}/${fmtSec(x.target)}</td></tr>`).join('');
  app().innerHTML = `
    <h1>模擬結果 — ${reason}</h1>
    <div class="card">
      <p class="big">答對 <b>${okN} / ${paper.length}</b>（${(acc * 100).toFixed(0)}%）→ 體感 <b class="accent">${gradeOf(acc)}</b></p>
      <ul>
        <li>「該跳沒跳」（答錯且耗時超過上限 1.5 倍）：<b class="${overStuck.length ? 'badc' : 'okc'}">${overStuck.length} 題</b>${overStuck.length ? ' ← 這是你寫不完的直接原因' : ' ✅'}</li>
        <li>「對但太慢」：<b class="${slowOk.length ? 'warnc' : 'okc'}">${slowOk.length} 題</b>${slowOk.length ? ' ← 已加入錯題本重練速度' : ''}</li>
        <li>剩餘未用時間：${unused > 0 ? fmtClock(unused) : '0（時間用罄）'}</li>
      </ul>
      <table class="tbl"><tr><th>題目</th><th>結果</th><th>你的答案</th><th>正解</th><th>耗時/建議</th></tr>${rows}</table>
      <p class="dim">錯題與超時題已自動加入錯題本，明天到期重測。詳解請到錯題本逐題看。</p>
      <button class="btn primary" onclick="nav('wrong')">去看錯題詳解</button>
      <button class="btn" onclick="nav('stats')">看數據</button>
    </div>`;
}

/* ═══════════ 錯題本 ═══════════ */
function renderWrong() {
  const ids = Object.keys(S.wrong);
  const due = dueWrong();
  if (!ids.length) {
    app().innerHTML = `<h1>📓 錯題本</h1><div class="card"><p>目前沒有錯題。去「主題刷題」或「模擬實戰」產生一些吧——錯題是最高價值的訓練材料。</p></div>`;
    return;
  }
  const rows = ids.map((id) => {
    const w = S.wrong[id]; const q = bankById(id);
    if (!q) return '';
    const isDue = w.due <= today();
    return `<tr class="${isDue ? 'due' : ''}">
      <td>${TOPICS[q.topic]} ${'★'.repeat(q.diff)}</td>
      <td>${w.err || '—'}</td><td>錯 ${w.fails} 次</td>
      <td>${isDue ? '<b class="warnc">今天到期</b>' : w.due}</td>
      <td><button class="btn sm" onclick="reviewOne('${id}')">重測</button></td></tr>`;
  }).join('');
  app().innerHTML = `
    <h1>📓 錯題本 <span class="dim">（間隔重測 1→3→7→14 天，連過四關畢業）</span></h1>
    ${due.length ? `<div class="card warn"><b>${due.length} 題今天到期。</b>先清這些，再刷新題——重測到期錯題的投報率是刷新題的 3 倍。
      <div style="margin-top:8px"><button class="btn primary" onclick="reviewDue()">開始重測到期題（${due.length}）</button></div></div>` : '<div class="card good">今天沒有到期的錯題 ✅</div>'}
    <div class="card"><table class="tbl"><tr><th>題目</th><th>錯因</th><th>次數</th><th>下次重測</th><th></th></tr>${rows}</table></div>
    <div class="card"><p class="dim"><b>訂正標準（名師版）：</b>不是「看懂詳解」，是能自己說出<b>題目的關鍵條件 → 對應的工具（公式/定理）→ 第一步</b>這條鏈。
    說不出來就還沒訂正完，重測時會原形畢露。</p></div>`;
}
let review = null;
function reviewDue() { if (!syncGate()) return; startReview(dueWrong()); }
function reviewOne(id) { if (!syncGate()) return; startReview([id]); }
function startReview(ids) {
  review = { ids: shuffle(ids), i: 0, okN: 0 };
  sessionActive = true;
  reviewNext();
}
function reviewNext() {
  if (review.i >= review.ids.length) {
    sessionActive = false;
    app().innerHTML = `<h1>重測完成</h1><div class="card good">
      <p class="big">過關 ${review.okN} / ${review.ids.length}</p>
      <p>答對的題進入下一個間隔；答錯的明天再來。</p>
      <button class="btn primary" onclick="nav('wrong')">回錯題本</button></div>`;
    return;
  }
  const q = bankById(review.ids[review.i]);
  renderQuestion(q, {
    head: `錯題重測 ${review.i + 1} / ${review.ids.length}`,
    review: true,
    onDone(res) {
      if (res.ok) review.okN++;
      review.i++;
      reviewNext();
    },
  });
}

/* ═══════════ 數據 ═══════════ */
function renderStats() {
  if (!S.attempts.length) {
    app().innerHTML = `<h1>📊 數據</h1><div class="card"><p>還沒有數據。先去做一次「模擬實戰」摸底，或刷一輪主題題。</p>
      <button class="btn primary" onclick="nav('mock')">去摸底</button></div>${syncCard()}${backupCard()}`;
    return;
  }
  // 單元統計
  const byTopic = {};
  for (const a of S.attempts) {
    const q = bankById(a.qid); if (!q) continue;
    const t = (byTopic[q.topic] = byTopic[q.topic] || { n: 0, ok: 0, ms: 0, target: 0 });
    t.n++; t.ok += a.ok ? 1 : 0; t.ms += a.ms; t.target += qTarget(q);
  }
  const topicRows = Object.keys(byTopic)
    .map((k) => ({ k, ...byTopic[k], acc: byTopic[k].ok / byTopic[k].n, speed: byTopic[k].ms / byTopic[k].target }))
    .sort((a, b) => (a.acc - b.acc) || (b.speed - a.speed));
  const worst = topicRows.slice(0, 3).filter((t) => t.acc < 0.8 || t.speed > 1.2);
  const bars = topicRows.map((t) => `
    <div class="bar-row"><span class="bar-label">${TOPICS[t.k]} <span class="dim">(${t.n}題)</span></span>
      <div class="bar"><div class="bar-fill ${t.acc >= 0.8 ? 'g' : t.acc >= 0.6 ? 'y' : 'r'}" style="width:${(t.acc * 100).toFixed(0)}%"></div></div>
      <span class="bar-val">${(t.acc * 100).toFixed(0)}%｜速度 ${t.speed > 1 ? '<b class="badc">' : '<b class="okc">'}${t.speed.toFixed(2)}×</b></span>
    </div>`).join('');
  // 錯因統計
  const errCount = {};
  for (const a of S.attempts) if (a.err) errCount[a.err] = (errCount[a.err] || 0) + 1;
  const errTotal = Object.values(errCount).reduce((x, y) => x + y, 0) || 1;
  const errBars = ERR_TYPES.filter((e) => errCount[e]).map((e) => `
    <div class="bar-row"><span class="bar-label">${e}</span>
      <div class="bar"><div class="bar-fill y" style="width:${(errCount[e] / errTotal * 100).toFixed(0)}%"></div></div>
      <span class="bar-val">${errCount[e]} 次</span></div>`).join('') || '<p class="dim">尚無錯因紀錄</p>';
  const ERR_RX = {
    '概念不熟': '回去看該單元的觀念（這是唯一該回頭看課的情況），看完立刻限時重做同型題。',
    '計算失誤': '不是粗心，是計算量訓練不足——加練「⚡兩位數心算」與該單元速度特訓。',
    '看錯題意': '養成「動筆前圈出問句關鍵字」的固定動作：求什麼？最大最小？正確錯誤？',
    '用猜的': '該題型完全沒把握——列入概念補強清單，優先級最高。',
    '超時': '會但慢：這種題重測時目標時間砍半練，或找它的「快解」套路。',
  };
  const advice = Object.keys(errCount).sort((a, b) => errCount[b] - errCount[a]).slice(0, 2)
    .map((e) => `<li><b>${e}（${errCount[e]} 次）：</b>${ERR_RX[e]}</li>`).join('');
  // 過程診斷（手寫板）
  const procAtt = S.attempts.filter((a) => a.p);
  let procCard = '';
  if (procAtt.length) {
    const fiAvg = Math.round(procAtt.reduce((s, a) => s + (a.p.fi || 0), 0) / procAtt.length);
    const hesPer = (procAtt.reduce((s, a) => s + a.p.hes.length, 0) / procAtt.length).toFixed(1);
    const eraPer = (procAtt.reduce((s, a) => s + a.p.era, 0) / procAtt.length).toFixed(1);
    const worstH = procAtt
      .map((a) => ({ a, m: a.p.hes.length ? Math.max(...a.p.hes.map((h) => h[1])) : 0 }))
      .filter((x) => x.m >= 30).sort((x, y) => y.m - x.m).slice(0, 3);
    procCard = `<div class="card"><h2>✍️ 過程診斷（手寫板）</h2>
      <p>平均起筆 <b>${fiAvg}s</b>｜題中停頓 <b>${hesPer} 次/題</b>｜塗改 <b>${eraPer} 次/題</b>（樣本 ${procAtt.length} 題）</p>
      ${worstH.length ? `<p><b>最嚴重卡點：</b></p><ul>${worstH.map(({ a, m }) => {
        const q = bankById(a.qid);
        return `<li>${q ? TOPICS[q.topic] : a.qid}：單次停頓 <b class="warnc">${m}s</b>（${a.d}${a.ok ? '，最後有解出來' : '，最後沒解出來'}）</li>`;
      }).join('')}</ul>` : ''}
      <p class="dim">判讀：<b>起筆慢</b>（>30s）→ 讀題轉化慢，練「看到題型就知道第一步」；<b>題中長停頓</b> → 解法鏈中段斷裂，
      該題型的完整路線沒背熟；<b>塗改多</b> → 動筆前先想 5 秒路線再寫；<b>長停頓後放棄</b> → 跳題紀律其實是對的，問題在第一步判讀。</p></div>`;
  }
  // 模擬歷史
  const mockRows = S.mocks.map((m) => `<tr><td>${m.d}</td><td>${m.ok}/${m.n}</td><td>${(m.acc * 100).toFixed(0)}%</td><td>${gradeOf(m.acc)}</td></tr>`).join('');
  // 特訓趨勢
  const drillRows = Object.keys(S.drills).map((k) => {
    const h = S.drills[k]; const last = h[h.length - 1]; const first = h[0];
    const trend = h.length > 1 ? `${(first.med / 1000).toFixed(1)}s → ${(last.med / 1000).toFixed(1)}s` : `${(last.med / 1000).toFixed(1)}s`;
    const pass = last.med / 1000 <= DRILLS[k].target && last.acc === 100;
    return `<tr><td>${DRILLS[k].name}</td><td>${h.length} 輪</td><td>${trend}</td><td>${pass ? '✅ 已自動化' : '訓練中'}</td></tr>`;
  }).join('');
  app().innerHTML = `
    <h1>📊 數據</h1>
    ${worst.length ? `<div class="card warn"><b>本週優先攻擊目標：</b>${worst.map((t) => TOPICS[t.k]).join('、')}
      <span class="dim">（答對率最低／耗時比最高的單元——把刷題時間集中在這裡，不要平均分配）</span></div>` : ''}
    <div class="card"><h2>單元答對率與速度比</h2>
      <p class="dim">速度比 = 實際耗時 ÷ 目標時間。大於 1.00× 代表這個單元在吃你的考試時間。</p>${bars}</div>
    <div class="card"><h2>錯因分布 → 對症處方</h2>${errBars}${advice ? `<ul>${advice}</ul>` : ''}</div>
    ${procCard}
    ${drillRows ? `<div class="card"><h2>速度特訓進度</h2><table class="tbl"><tr><th>項目</th><th>輪數</th><th>中位數變化</th><th>狀態</th></tr>${drillRows}</table></div>` : ''}
    ${mockRows ? `<div class="card"><h2>模擬成績走勢</h2><table class="tbl"><tr><th>日期</th><th>答對</th><th>答對率</th><th>體感級分</th></tr>${mockRows}</table></div>` : ''}
    ${syncCard()}
    ${backupCard()}`;
}

/* ═══════════ 作戰計畫 ═══════════ */
function renderPlan() {
  const days = Math.ceil((new Date(EXAM_DATE) - new Date()) / 86400000);
  const weeks = Math.floor(days / 7);
  const t = today();
  const done = S.daily[t] || {};
  const tasks = [
    ['drill', '⚡ 速度特訓 1~2 輪（10 分）'],
    ['wrongq', '📓 清空到期錯題（10 分）'],
    ['prac', '🎯 主題限時 8 題——打「數據」頁的優先單元（35 分）'],
    ['log', '看一眼 📊 數據，確認明天打哪個單元（2 分）'],
  ];
  const checklist = tasks.map(([k, label]) =>
    `<label class="task ${done[k] ? 'done' : ''}"><input type="checkbox" ${done[k] ? 'checked' : ''} onchange="toggleTask('${k}')"> ${label}</label>`).join('');
  const streak = Object.keys(S.daily).filter((d) => Object.values(S.daily[d]).some(Boolean)).length;
  app().innerHTML = `
    <h1>🗓️ 作戰計畫 <span class="dim">距學測 ${days} 天（約 ${weeks} 週）</span></h1>
    <div class="card">
      <h2>今日清單（每天約 60 分鐘數A）</h2>
      ${checklist}
      <p class="dim">已執行 ${streak} 天。每週三、六把「主題限時」換成一次「⏱️ 模擬實戰」。</p>
    </div>
    <div class="card">
      <h2>三階段路線（現在 → 2027/1/22）</h2>
      <table class="tbl">
        <tr><th>階段</th><th>期間</th><th>主軸</th><th>13 級分檢查點</th></tr>
        <tr><td><b>① 自動化＋補洞</b></td><td>7~8 月（8 週）</td>
          <td>速度特訓全部達標；用本系統地毯式限時刷完 14 單元；錯題滾動清零。<b>新的線上課一律停掉</b>；唯一例外：
          錯因數據指出某單元是真概念洞（連續錯在「概念不熟」），才回去看該單元的課或詳解，
          且 24 小時內必須限時重做同型題——看懂不算數，寫出來才算。</td>
          <td>8 月底：模擬答對率穩定 ≥ 70%，「該跳沒跳」= 0</td></tr>
        <tr><td><b>② 歷屆實戰</b></td><td>9~11 月（12 週）</td>
          <td>主戰場換成<b>大考中心歷屆數A卷</b>（111~115），每週 1 份全真限時＋逐題耗時分析（照本系統的格式手記或拍照記錄）；本系統改當暖身與錯題庫。</td>
          <td>11 月底：歷屆卷得分率 ≥ 78%，全卷寫得完且留 15 分鐘檢查</td></tr>
        <tr><td><b>③ 穩定輸出</b></td><td>12~1 月（6 週）</td>
          <td>每週 2 次全真模擬（含塗卡）；不碰新題型，只重測錯題本；把考場流程（先易後難、90 秒停損、最後 15~20 分鐘檢查）練成儀式。</td>
          <td>考前：連續 3 次模擬 ≥ 78%（≥ 80% 已是 14 級分區）</td></tr>
      </table>
      <p><b>唯一鐵律：</b>從今天起，<b>沒有計時的數學練習一律不算練習</b>。</p>
    </div>
    <div class="card">
      <h2>考場 SOP（背下來）</h2>
      <ol>
        <li>發卷先花 1 分鐘掃全卷，標出「一眼有路」的題。</li>
        <li>第一輪只做有路的題；90 秒內找不到第一步 → 標記跳過，零例外。</li>
        <li>多選題逐項判斷、判斷完立刻標 ✓✗，不整題重想。</li>
        <li>第二輪處理跳過題；<b>最後至少 15 分鐘只檢查不開新題</b>（名師標準是 20 分鐘——你的粗心失分就靠這段收回）。</li>
        <li>檢查順序：選填格式 → 簡單題 → 多選 → 計算最後一步。</li>
      </ol>
    </div>`;
}
function toggleTask(k) {
  const t = today();
  S.daily[t] = S.daily[t] || {};
  S.daily[t][k] = !S.daily[t][k];
  save();
  renderPlan();
}

/* ═══════════ ☁️ 雲端同步（Supabase） ═══════════
   離線優先：一切照常存 localStorage；登入後每次 save() 幾秒內自動上傳整包狀態，
   手寫筆跡逐題永久歸檔到 ink_sessions。只用 publishable key，資料由 RLS 保護。
   在封鎖外部連線的環境（claude.ai artifact）自動降級為純本機模式。 */
const SUPA_URL = 'https://jahqjaipeekkynpjjafw.supabase.co';
const SUPA_KEY = 'sb_publishable_0m8WTikRbOepsYSZjz0Epg_TkUiwLDu';
let supa = null;
let syncState = { user: null, msg: '', last: null };
let syncTimer = null;
function supaInit() {
  if (!window.supabase) { syncPill(); return; } // CDN 被擋（artifact 環境）→ 純本機模式
  supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);
  supa.auth.onAuthStateChange((ev, session) => {
    const was = syncState.user && syncState.user.id;
    syncState.user = session ? session.user : null;
    if (syncState.user && syncState.user.id !== was) syncPull();
    syncPill();
  });
  window.addEventListener('online', () => { if (syncState.user) syncPush(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && syncState.user) { clearTimeout(syncTimer); syncPush(); }
  });
  syncPill();
}
function syncQueue() {
  if (!supa || !syncState.user) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncPush, 4000);
}
/* 同步狀態燈（常駐右上角）＋開始做題前的登入攔檢 */
function syncPill() {
  let el = $('#syncpill');
  if (!el) {
    el = el || document.createElement('div');
    el.id = 'syncpill';
    el.onclick = () => nav('stats');
    document.body.appendChild(el);
  }
  if (!supa) { el.textContent = '⚫ 離線版（無法同步）'; el.className = 'off'; return; }
  if (!syncState.user) { el.textContent = '🔴 未登入——紀錄只存本機'; el.className = 'warn'; return; }
  el.textContent = syncState.pushErr ? '🟡 ' + syncState.msg : '🟢 ☁ ' + (syncState.msg || '已登入');
  el.className = syncState.pushErr ? 'mid' : 'ok';
}
function syncGate() {
  // 回傳 true = 放行。沒登入時攔下來問，避免「做了題但沒上雲」而不自知。
  if (!supa || syncState.user) return true;
  if (confirm('⚠️ 尚未登入雲端同步！\n\n現在開始做題，紀錄只會存在這台裝置的瀏覽器裡——換裝置、清瀏覽器就沒了。\n\n按「確定」先去登入（推薦）\n按「取消」仍然開始（僅本機保存）')) {
    nav('stats');
    return false;
  }
  return true;
}
async function syncPush() {
  if (!supa || !syncState.user) return;
  try {
    const { error } = await supa.from('app_state')
      .upsert({ user_id: syncState.user.id, data: S, updated_at: new Date().toISOString() });
    syncState.pushErr = !!error;
    syncState.msg = error ? '上傳失敗：' + error.message : '已同步 ' + new Date().toTimeString().slice(0, 5);
  } catch (e) { syncState.pushErr = true; syncState.msg = '離線（資料在本機，連上後自動補傳）'; }
  syncPill();
}
async function syncPull() {
  if (!supa || !syncState.user) return;
  try {
    const { data, error } = await supa.from('app_state').select('data').maybeSingle();
    if (error) { syncState.msg = '下載失敗：' + error.message; return; }
    if (data && data.data) {
      S = mergeState(S, data.data);
      localStorage.setItem(KEY, JSON.stringify(S));
      syncState.msg = '已從雲端合併';
      updateBadge();
    }
    syncPush();
  } catch (e) { syncState.msg = '離線（資料在本機）'; syncPill(); }
}
function mergeState(a, b) {
  // 兩台裝置各自累積也不丟資料：紀錄類取聯集，其餘欄位取較「多」的一方
  const akey = (x) => x.ts ? String(x.ts) : `${x.qid}|${x.d}|${x.ms}|${x.ok}`;
  const seen = new Set(); const attempts = [];
  for (const x of [...(a.attempts || []), ...(b.attempts || [])]) {
    const k = akey(x);
    if (!seen.has(k)) { seen.add(k); attempts.push(x); }
  }
  attempts.sort((x, y) => (x.ts || 0) - (y.ts || 0));
  const wrong = { ...(b.wrong || {}), ...(a.wrong || {}) };
  for (const q of Object.keys(b.wrong || {})) {
    const A = (a.wrong || {})[q], B = b.wrong[q];
    if (A && B) wrong[q] = (B.fails + B.wins > A.fails + A.wins) ? B : A;
  }
  const drills = { ...(b.drills || {}) };
  for (const k of Object.keys(a.drills || {})) {
    if (!drills[k]) { drills[k] = a.drills[k]; continue; }
    const have = new Set(drills[k].map((h) => JSON.stringify(h)));
    for (const h of a.drills[k]) if (!have.has(JSON.stringify(h))) drills[k].push(h);
  }
  const mset = new Set((a.mocks || []).map((m) => JSON.stringify(m)));
  const mocks = [...(a.mocks || [])];
  for (const m of b.mocks || []) if (!mset.has(JSON.stringify(m))) mocks.push(m);
  const daily = { ...(b.daily || {}) };
  for (const d of Object.keys(a.daily || {})) daily[d] = { ...(daily[d] || {}), ...a.daily[d] };
  return { ...b, ...a, attempts, wrong, drills, mocks, daily };
}
function syncInk(qid, t0, proc) {
  if (!supa || !syncState.user) return;
  const st = sessionInk[qid]; if (!st) return;
  const strokes = st.s.filter((s) => s.t0 >= t0);
  const eras = st.e.filter((t) => t >= t0);
  if (!strokes.length && !eras.length) return;
  supa.from('ink_sessions')
    .insert({ user_id: syncState.user.id, qid, t0, proc: proc || null, strokes: { s: strokes, e: eras } })
    .then(({ error }) => { if (error) syncState.msg = '筆跡上傳失敗：' + error.message; });
}
async function syncLogin(isSignup) {
  const email = $('#sy-email').value.trim();
  const pass = $('#sy-pass').value;
  if (!email || pass.length < 6) { syncState.msg = 'email 或密碼格式不對（密碼至少 6 碼）'; renderStats(); return; }
  syncState.msg = '處理中…'; renderStats();
  const { data, error } = isSignup
    ? await supa.auth.signUp({ email, password: pass })
    : await supa.auth.signInWithPassword({ email, password: pass });
  if (error) syncState.msg = (isSignup ? '註冊' : '登入') + '失敗：' + error.message;
  else if (isSignup && !data.session) syncState.msg = '註冊成功——去收信點確認連結後回來登入（或到 Supabase 後台 Auth 設定關掉 Confirm email）';
  else syncState.msg = '登入成功，同步啟動';
  renderStats();
}
async function syncLogout() { await supa.auth.signOut(); syncState.msg = ''; renderStats(); }
function syncPushNow() { syncState.msg = '上傳中…'; renderStats(); syncPush().then(() => renderStats()); }
function syncCard() {
  if (!supa) return `<div class="card"><h2>☁️ 雲端同步</h2>
    <p class="dim">這個網頁環境封鎖外部連線（claude.ai artifact），雲端同步自動停用——資料照常存本機，可用下方備份匯出。
    要用同步版請開本機版 index.html 或自架網址。</p></div>`;
  if (!syncState.user) return `<div class="card"><h2>☁️ 雲端同步</h2>
    <p class="dim">登入後：做題紀錄跨裝置自動同步、手寫筆跡永久保存（換裝置、清瀏覽器都不怕）。第一次用「註冊」。</p>
    <input id="sy-email" class="ans-input" autocomplete="username" placeholder="email">
    <input id="sy-pass" class="ans-input" type="password" autocomplete="current-password" placeholder="密碼（至少 6 碼）">
    <div style="margin-top:8px">
      <button class="btn primary" onclick="syncLogin(false)">登入</button>
      <button class="btn" onclick="syncLogin(true)">註冊</button>
    </div>
    ${syncState.msg ? `<p class="dim">${syncState.msg}</p>` : ''}</div>`;
  return `<div class="card"><h2>☁️ 雲端同步 <span class="okc">已登入</span></h2>
    <p class="dim">${syncState.user.email}｜${syncState.msg || '自動同步中：每次做完題幾秒內上傳'}</p>
    <button class="btn" onclick="syncPushNow()">立即同步</button>
    <button class="btn" onclick="syncLogout()">登出</button></div>`;
}

/* ═══════════ 啟動 ═══════════ */
function boot() {
  const navEl = $('nav');
  navEl.innerHTML = Object.keys(VIEWS).map((v) =>
    `<button data-view="${v}" onclick="nav('${v}')">${VIEWS[v].label}</button>`).join('');
  supaInit();
  nav('home');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
