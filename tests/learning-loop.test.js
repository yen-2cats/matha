'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load-app');

test('級分校準只採完整模擬，三場皆過 72% 才標穩定', () => {
  const { run } = loadApp();
  const result = plain(run(`(() => {
    S.attempts = Array.from({length: 40}, (_, i) => ({ qid: BANK[i].id, ok: true, ms: 1000, d: today(), mode: 'mixed', ts: i + 1 }));
    const before = mockCalibration();
    S.mocks = [
      { d: addDays(today(), -2), ok: 9, n: 12, acc: .75 },
      { d: addDays(today(), -1), ok: 10, n: 12, acc: 10 / 12 },
      { d: today(), ok: 9, n: 12, acc: .75 },
    ];
    const after = mockCalibration();
    return { before, after, pulse: practicePulse() };
  })()`));
  assert.equal(result.before.count, 0, '全對的弱項練習也不得冒充模擬校準');
  assert.equal(result.after.count, 3);
  assert.equal(result.after.stable, true);
  assert.equal(result.after.passes, 3);
  assert.equal(result.after.grade, '13 級分');
  assert.equal(result.pulse.n, 40);
});

test('下一步優先順序為隔日盲訂正、全真校準、嚴重斷裂，否則混合題', () => {
  const { run } = loadApp();
  const states = plain(run(`(() => {
    S.attempts = []; S.mocks = []; S.wrong = {}; S.corrections = [];
    const noData = nextBestAction();
    S.corrections = [{ id:'c1', due:today(), entries:[{ qid:BANK[0].id, done:false }] }];
    const due = nextBestAction();
    S.corrections = [];
    S.mocks = [{ d: today(), score:68, total:100, ok:68, n:100, acc:.68 }];
    for (let i = 0; i < 4; i++) S.attempts.push({ qid:BANK.find((q) => q.topic === 'num').id, ok:false, ms:180000, d:today(), mode:'mixed', ts:i + 1 });
    const weak = nextBestAction();
    S.attempts = [];
    const normal = nextBestAction();
    return { noData: noData.kind, due: due.kind, weak: weak.kind, normal: normal.kind };
  })()`));
  assert.deepEqual(states, { noData: 'mock', due: 'correction', weak: 'topic', normal: 'mixed' });
});

test('全真多選採部分計分，模考錯題排到隔天且當天不開放', () => {
  const { run } = loadApp();
  const result = plain(run(`(() => {
    mock = { judge:{} };
    const q = { id:'x', type:'multi', opts:['a','b','c','d','e'], ans:[0,2], points:5 };
    const oneError = mockAnswerResult(q, { type:'multi', v:[0] });
    const detail = [{ q:{ id:BANK[0].id, examNo:1, examSection:'single', points:5 }, ok:false, yourAns:'(2)', answered:true }];
    S.corrections = [];
    const batch = queueMockCorrection(detail, 123);
    return { points:oneError.points, due:batch.due, today:today(), dueNow:dueCorrections().length };
  })()`));
  assert.equal(result.points, 3);
  assert.notEqual(result.due, result.today);
  assert.equal(result.dueNow, 0);
});

test('主要導覽只留下新版五條路，章節與速度工具不再佔主入口', () => {
  const { run } = loadApp();
  const views = plain(run('Object.entries(VIEWS).map(([key, value]) => [key, value.label])'));
  assert.deepEqual(views, [
    ['home', '今日'],
    ['prac', '混合練習'],
    ['mock', '全真模考'],
    ['correct', '隔日訂正'],
    ['stats', '分析'],
  ]);
  assert.equal(run("Object.values(VIEWS).some((v) => /章節|速度|番茄/.test(v.label))"), false);
});

test('模考交卷當天只顯示分數與錯題號，不洩漏答案、章節或詳解', () => {
  const { context, run } = loadApp();
  context.__app = { innerHTML: '' };
  context.document.querySelector = (selector) => selector === '#app' ? context.__app : null;
  run(`sessionChrome = () => {}; save = () => {}; recordAttempt = () => {};
    S.attempts = []; S.mocks = []; S.corrections = [];
    const q = { ...BANK.find((x) => x.id === 'line5'), examNo: 13, examSection: 'fill', points: 100 };
    mock = { graded:[q], answers:{ [q.id]:{ type:'fill', v:'0' } }, times:{}, proc:{}, aiv:{}, partial:false };
    mockFinal();`);
  const html = context.__app.innerHTML;
  assert.match(html, /得分 <b>0 \/ 100/);
  assert.match(html, /今天到此為止，不訂正/);
  assert.doesNotMatch(html, /25\/3/);
  assert.doesNotMatch(html, /直線與圓/);
  assert.doesNotMatch(html, /詳解：|正確答案/);
});

test('隔日訂正至少記下一次重想，才允許解鎖詳解', () => {
  const { run } = loadApp();
  const result = plain(run(`(() => {
    save = () => {}; renderCorrectionWork = () => {};
    const entry = { qid:BANK[0].id, examNo:1, done:false, attempts:0, logs:[] };
    const batch = { id:'c1', d:addDays(today(), -1), due:today(), mt:1, entries:[entry] };
    S.corrections = [batch]; correction = { batch, indexes:[0], i:0, t0:Date.now() };
    correctionUnlock();
    const locked = entry.solutionUnlockedAt == null;
    entry.attempts = 1; correctionUnlock();
    return { locked, unlocked:!!entry.solutionUnlockedAt };
  })()`));
  assert.deepEqual(result, { locked: true, unlocked: true });
});

test('答對但猜中會留下 confidence 並排入隔日重測，不灌成熟練', () => {
  const { run } = loadApp();
  const result = plain(run(`(() => {
    S.attempts = []; S.wrong = {}; S.mocks = []; S.daily = {};
    const q = BANK.find((x) => x.id === 'num1');
    const rec = recordAttempt(q, true, 50000, '用猜的', 'practice');
    return { rec, wrong: S.wrong[q.id] };
  })()`));
  assert.equal(result.rec.ok, true);
  assert.equal(result.rec.confidence, 'guess');
  assert.equal(result.rec.err, '用猜的');
  assert.equal(result.wrong.fails, 0);
  assert.equal(result.wrong.err, '用猜的');
  assert.match(result.wrong.due, /^\d{4}-\d{2}-\d{2}$/);
});

test('儀表板明示練習答對率不換算級分，並保存類題遷移欄位', () => {
  const { run } = loadApp();
  const html = run('scoreGoalCard()');
  assert.match(html, /弱項刷題答對率不拿來灌高級分/);
  const sourceShape = run(`(() => {
    const src = String(qResolve);
    return ['independent-transfer', 'originErr', 'topic: q.topic', 'diff: q.diff'].every((x) => src.includes(x));
  })()`);
  assert.equal(sourceShape, true);
});

test('實體模考優先作為級分證據，失分單元會進入修分建議', () => {
  const { run } = loadApp();
  const result = plain(run(`(() => {
    S.attempts = []; S.mocks = [{ d: today(), ok: 12, n: 12, acc: 1 }]; S.wrong = {};
    S.extMocks = [
      { d: addDays(today(), -1), name: '<img src=x onerror=alert(1)>', score: 68, total: 100, topics: ['prob'], err: '看錯題意', minutesLeft: 0, note: '<script>x</script>', ts: 1 },
      { d: today(), name: '第二次模考', score: 74, total: 100, topics: ['prob', 'comb'], err: '計算失誤', minutesLeft: 3, ts: 2 },
    ];
    const cal = mockCalibration();
    return { source: cal.source, acc: cal.acc, plan: recoveryPlanCard(), card: extMockCard() };
  })()`));
  assert.equal(result.source, 'external');
  assert.equal(result.acc, 0.71);
  assert.match(result.plan, /機率/);
  assert.doesNotMatch(result.card, /<img src=x/);
  assert.doesNotMatch(result.card, /<script>x/);
  assert.match(result.card, /&lt;img/);
  assert.match(result.card, /剩 3 分/);
});

test('未登入時離線開練不再被原生確認框阻擋', () => {
  const { context, run } = loadApp();
  let confirms = 0;
  context.confirm = () => { confirms++; return true; };
  const allowed = run(`(() => { supa = {}; syncState.user = null; syncGateAsked = false; return syncGate(); })()`);
  assert.equal(allowed, true);
  assert.equal(confirms, 0);
  assert.match(run('syncState.msg'), /只存這台/);
});
