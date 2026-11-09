// AI Coach page (coach.html): the first-time terms, the user's own provider + API key + model (kept by the app: CoachService.cs, api/coach), and per session
// a debrief or a question. What is sent is built by coach-math.js (numbers only, a few hundred tokens). Nothing is asked by itself: only on a click, and a
// saved answer for the same session is shown again for free.
(function (root) {
  'use strict';
  var P = root.Pitwall, F = P.format, R = P.paceRef, U = P.potentialMath, C = P.coachMath, H = P.hub, TM = P.trackMap, esc = H.esc;
  function $(id) { return document.getElementById(id); }
  var SLOW = 0.05, info = null, data = null, ref = {}, focList = [], segAll = [], kind = 'debrief', cur = null, req = null, reqToken = 0, setupProv = null, busy = false;
  var PROV = {
    gemini: { name: 'Google Gemini', tag: 'Free tier', get: 'https://aistudio.google.com/apikey', note: 'A free key with daily limits at Google AI Studio ("Get API key"). Paid once you switch on billing there.' },
    openai: { name: 'OpenAI', tag: 'Paid', get: 'https://platform.openai.com/api-keys', note: 'Prepaid credit on the OpenAI platform. Not part of ChatGPT Plus.' },
    anthropic: { name: 'Anthropic (Claude)', tag: 'Paid', get: 'https://console.anthropic.com/settings/keys', note: 'Credit in the Claude Console. Not part of Claude Pro.' }
  };
  var CLASS_LABEL = { LMH: 'Hypercar', LMP2wec: 'LMP2', LMP2elms: 'LMP2 ELMS', LMP3: 'LMP3', LMGT3: 'GT3', GTE: 'GTE' };
  var IDEAS = ['What should I practise first on this track?', 'Why am I not consistent, and how do I fix it?', 'How far am I from the next level, and where do I find it?'];
  H.header('coach');

  function post(what, body, q) {
    return H.json('api/coach?do=' + what + (q || ''), { method: 'POST', body: body ? JSON.stringify(body) : '' });
  }
  function provider() { return info && info.provider; }
  function model() { return info && info.models && info.models[provider()]; }
  function ready() { return info && info.accepted && provider() && info.keys[provider()] && model(); }

  // ---------- which part shows: the terms (first time), the settings (no key / model yet, or opened), the coach ----------
  var setupOpen = false;
  function view() {
    var acc = info && info.accepted;
    $('terms').hidden = !!acc; $('topBar').hidden = !acc;
    $('setup').hidden = !acc || !(setupOpen || !ready());
    $('main').hidden = !acc || !ready();
    $('setClose').hidden = !ready();
    if (acc) {
      $('useInfo').textContent = (ready() ? PROV[provider()].name + ' · ' + model() + ' · ' : '') + 'last 24 h: ' + info.calls24h + ' request' + (info.calls24h === 1 ? '' : 's') +
        (info.tokens24h ? ', ' + info.tokens24h.toLocaleString('en-US') + ' tokens' : '');
      if (!$('setup').hidden) setup();
      if (!$('main').hidden) { renderHist(); prepare(); }
    }
  }
  function load() { return H.json('api/coach').then(function (i) { info = i; view(); }); }

  $('okBox').onchange = function () { $('okBtn').disabled = !this.checked; };
  $('okBtn').onclick = function () { post('accept').then(function (i) { info = i; view(); }); };
  $('setBtn').onclick = function () { setupOpen = !setupOpen || !ready(); view(); };
  $('setClose').onclick = function () { setupOpen = false; view(); };
  $('resetBtn').onclick = function () {
    if (confirm('Forget everything of the AI Coach?\n\nYour API keys, your saved answers and the accepted terms are removed from this PC.')) post('reset').then(function () { location.reload(); });
  };

  // ---------- settings: provider, key, model ----------
  var modelsFor = {};
  function setup() {
    if (!setupProv) setupProv = provider() || 'gemini';
    $('provList').innerHTML = Object.keys(PROV).map(function (k) {
      var p = PROV[k];
      return '<label class="coach-p' + (k === setupProv ? ' on' : '') + '"><input type="radio" name="prov" value="' + k + '"' + (k === setupProv ? ' checked' : '') + '>' +
        '<span><b>' + esc(p.name) + '</b> <span class="chip ' + (p.tag === 'Paid' ? 'dim' : 'lime') + '">' + esc(p.tag.toUpperCase()) + '</span>' + (info.keys[k] ? ' <span class="faint">key saved ' + esc(info.keys[k]) + '</span>' : '') +
        '<small>' + esc(p.note) + ' <a class="back" data-url="' + esc(p.get) + '">Get a key</a></small></span></label>';
    }).join('');
    $('keyHint').textContent = info.keys[setupProv] ? '(saved: ' + info.keys[setupProv] + ' · paste a new one to replace it)' : '';
    $('keyDel').hidden = !info.keys[setupProv];
    fillModels();
  }
  $('provList').onclick = function (e) {
    var a = e.target.closest('[data-url]'); if (a) { e.preventDefault(); window.open(a.getAttribute('data-url'), '_blank'); return; }
    var r = e.target.closest('input[name=prov]'); if (!r || r.value === setupProv) return;
    setupProv = r.value; $('keyIn').value = ''; $('keyMsg').textContent = ''; setup();
  };
  // the model list of the saved key (asked once per provider: free); the saved model, else the first (a small, cheap one)
  function fillModels(force) {
    var p = setupProv, sel = $('modelSel');
    if (!info.keys[p]) { sel.innerHTML = '<option>Save a key first</option>'; sel.disabled = true; $('modelNote').textContent = ''; return Promise.resolve(); }
    if (modelsFor[p] && !force) return Promise.resolve(showModels(p));
    sel.innerHTML = '<option>Checking the key...</option>'; sel.disabled = true;
    return post('models', { provider: p }).then(function (r) {
      if (r.error) { sel.innerHTML = '<option>--</option>'; $('keyMsg').innerHTML = '<span class="red">' + esc(r.error) + '</span>'; return; }
      modelsFor[p] = C.models(p, r.models);
      if (p !== setupProv) return;
      $('keyMsg').innerHTML = '<span class="green">Key works.</span>';
      showModels(p);
      var m = info.models[p];
      if (!m || modelsFor[p].indexOf(m) < 0 || provider() !== p) return use(p, modelsFor[p].indexOf(m) >= 0 ? m : modelsFor[p][0]);
    }, function () { sel.innerHTML = '<option>--</option>'; $('keyMsg').textContent = 'Could not check the key.'; });
  }
  function showModels(p) {
    var list = modelsFor[p] || [], m = info.models[p], sel = $('modelSel');
    sel.disabled = !list.length;
    sel.innerHTML = list.length ? list.map(function (id, i) { return '<option value="' + esc(id) + '"' + (id === m ? ' selected' : '') + '>' + esc(id) + (i === 0 ? ' (suggested)' : '') + '</option>'; }).join('') : '<option>No chat model for this key</option>';
    $('modelNote').textContent = list.length ? 'Small, cheap models first: the suggested one is plenty for this. Bigger models cost more per token' + (p === 'gemini' ? ' and have lower free limits' : '') + '.' : '';
  }
  function use(p, m) { return post('use', { provider: p, model: m }).then(function (i) { if (i && !i.error) { info = i; view(); } }); }
  $('modelSel').onchange = function () { use(setupProv, this.value); };
  $('keySave').onclick = function () {
    var k = $('keyIn').value.trim(); if (!k) { $('keyMsg').textContent = info.keys[setupProv] ? '' : 'Paste a key first.'; if (info.keys[setupProv]) fillModels(true); return; }
    $('keyMsg').textContent = 'Saving...';
    post('key', { provider: setupProv, key: k }).then(function (i) { info = i; $('keyIn').value = ''; delete modelsFor[setupProv]; setup(); return fillModels(true); });
  };
  $('keyDel').onclick = function () {
    if (!confirm('Remove the ' + PROV[setupProv].name + ' key from this PC?')) return;
    post('key', { provider: setupProv, key: '' }).then(function (i) { info = i; delete modelsFor[setupProv]; $('keyMsg').textContent = 'Key removed.'; view(); });
  };

  // ---------- the session and what is sent ----------
  function sessions() {
    return (data ? data.sessions : []).filter(function (s) { return !s.old && s.laps && s.laps.some(function (l) { return l[1] > 0; }); })
      .sort(function (a, b) { return b.time - a.time; }).slice(0, 60);
  }
  function sesLabel(s) {
    var t = R.trackName(s.track, s.layout) || s.track;
    return F.day(s.time) + ' · ' + (s.type === 'Qualify' ? 'Qualifying' : s.type) + ' · ' + t + ' · ' + s.car + ' · ' + s.laps.length + ' laps';
  }
  function fillSessions() {
    var list = sessions(), sel = $('sesSel'), k = cur ? cur.file + '|' + cur.time : null;
    if (!list.length) { sel.innerHTML = '<option>No sessions yet</option>'; cur = null; return; }
    cur = list.filter(function (s) { return s.file + '|' + s.time === k; })[0] || list[0];
    sel.innerHTML = list.map(function (s, i) { return '<option value="' + i + '"' + (s === cur ? ' selected' : '') + '>' + esc(sesLabel(s)) + '</option>'; }).join('');
  }
  $('sesSel').onchange = function () { cur = sessions()[Number(this.value)] || null; shown = null; prepare(); };
  function tile(k, v, n, c) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (c || '') + '">' + esc(v) + '</div><div class="n">' + esc(n || '') + '</div></div>'; }
  function tiles(s) {
    var a = P.paceMath.session(s, SLOW), d = a.dry.best ? a.dry : a.wet;
    $('sesTiles').innerHTML = tile('Best lap', F.lap(d.best), a.dry.best ? 'dry' : 'wet', 'purple') + tile('Optimal lap', F.lap(d.optimal), 'your best three sectors') +
      tile('Average', F.lap(d.pace), d.clean + ' counted laps') + tile('Consistency', d.sd > 0 ? '± ' + d.sd.toFixed(3) + ' s' : '--', 'how much your counted laps vary') +
      tile('Class', CLASS_LABEL[R.className(s['class'])] || s['class'], s.classPos > 0 ? 'P' + s.classPos + ' of ' + s.classCars : '');
  }
  // the segments of this track + car (where on the track you lose time), if the app timed any: same track name and car, else the same class with most laps.
  // -> { rec, z (zones: weak spots, null = not enough sessions yet), car } or null
  function segsFor(s) {
    if (!H.inApp) return Promise.resolve(null);
    var base = R.trackName(s.track, '') || s.track, c = R.className(s['class']) || s['class'];
    var m = segAll.filter(function (x) { return (R.trackName(x.track, '') || x.track) === base && (R.className(x.cls) || x.cls) === c; });
    var hit = m.filter(function (x) { return x.car === s.car; })[0] || m.sort(function (a, b) { return b.laps - a.laps; })[0];
    if (!hit) return Promise.resolve(null);
    return H.json('api/segments?key=' + encodeURIComponent(hit.key)).then(function (rec) {
      if (!(rec && rec.n)) return null;
      var sg = { rec: rec, z: U.zones(rec, 5), car: hit.car, key: hit.key, spots: null };
      return spotsFor(sg).then(function (sp) { sg.spots = sp; return sg; }, function () { return sg; });
    }, function () { return null; });
  }
  // the driving lines at the weak spots (speed, brake, throttle): your best lap against the median of your last laps here (up to 8, within 5 % of your best).
  // Loaded once per track + car (about 25 KB a lap, from this PC). -> [{ n, best, usual }] (potential-math lineSpot / lineMedian) or null
  var lineCache = {};
  function spotsFor(sg) {
    var z = sg.z, rec = sg.rec; if (!z || !z.zones.length) return Promise.resolve(null);
    function get(w) { return H.json('api/segments?key=' + encodeURIComponent(sg.key) + '&line=' + w).then(function (j) { return j || null; }, function () { return null; }); }
    var p = lineCache[sg.key] || (lineCache[sg.key] = get('list').then(function (l) {
      if (!l || (!l.best && !(l.laps || []).length)) return null;
      var top = l.best ? l.best.time : rec.bestLap, laps = (l.laps || []).filter(function (x) { return x.time > 0 && (!(top > 0) || x.time <= top * 1.05); }).slice(0, 8);
      return Promise.all([l.best ? get('best') : null].concat(laps.map(function (x) { return get(x.t); }))).then(function (r) {
        return { best: r[0] && r[0].line ? r[0].line : null, laps: r.slice(1).filter(function (x) { return x && x.line; }).map(function (x) { return x.line; }) };
      });
    }));
    return p.then(function (d) {
      if (!d) return null; var st = rec.length / rec.n;
      var out = z.zones.map(function (w) {
        return { n: w.n, best: d.best ? U.lineSpot(d.best, w.from, w.len * st, rec.length) : null,
                 usual: U.lineMedian(d.laps.map(function (l) { return U.lineSpot(l, w.from, w.len * st, rec.length); })) };
      }).filter(function (x) { return x.best || x.usual; });
      return out.length ? out : null;
    });
  }
  // the game's own map of this track (saved by the app the first time you drove there): the grey outline when there is no timing yet
  var trackNames = null, outlines = {};
  function outlineFor(s) {
    var want = R.trackName(s.track, s.layout) || s.track;
    return (trackNames ? Promise.resolve(trackNames) : H.json('api/tracks').then(function (l) { return (trackNames = l || []); }, function () { return []; })).then(function (names) {
      var n = names.filter(function (x) { return (R.trackName(x, '') || x) === want; })[0];
      if (!n) return null;
      if (outlines[n] !== undefined) return outlines[n];
      return H.json('api/tracks?name=' + encodeURIComponent(n)).then(function (t) { return (outlines[n] = t && t.paths ? t.paths : null); }, function () { return null; });
    });
  }
  // the map card: the segment map (red = where you lose the most; the numbered weak spots are "spot 1, 2, 3" in the AI's answer), else the game's outline in grey
  function drawMap(s, sg) {
    var box = $('cMap'), side = $('cSpots'), name = R.trackName(s.track, s.layout) || s.track;
    box.onclick = null; box.className = 'mapbox'; box.title = '';
    if (sg && sg.rec.points) {
      var rec = sg.rec, z = sg.z, a = U.segments(rec), vals = TM.vals(rec, z, a, z ? 'loss' : 'bestlap');
      $('mapSub').textContent = z ? 'Your usual lap against your best, piece by piece (about ' + Math.round(rec.length / rec.n) + ' m each), your last ' + z.sessions + ' session' + (z.sessions > 1 ? 's' : '') + ' here' +
        (sg.car !== s.car ? ' (' + sg.car + ')' : '') + '. The numbers are your weak spots: the AI calls them spot 1, 2 and 3.' : 'What your best lap lost, piece by piece. Your weak spots appear after a session with 3 or more laps within 5 % of your best here.';
      box.innerHTML = TM.draw(rec, vals, { zones: z ? z.zones : [], title: function (i) { return 'Segment ' + (i + 1); } }) + '<div class="hint">Red = where you lose the most · click to open the map</div>';
      box.className = 'mapbox click'; box.onclick = function () { TM.open(rec, name + ' · ' + sg.car, sg.key); };
      var zl = z ? z.zones : [];
      side.innerHTML = zl.length ? '<table class="tbl"><thead><tr><th>Spot</th><th>Where</th><th class="num">Per lap</th><th class="num">Came back</th></tr></thead><tbody>' + zl.map(function (w) {
        return '<tr><td><span class="chip lime">' + w.n + '</span></td><td>' + esc(TM.where(w)) + '</td><td class="num red">' + F.plusSec(w.loss) + ' s</td><td class="num">' + w.seen + ' of ' + w.of + '</td></tr>';
      }).join('') + '</tbody></table><div class="foot">Per lap = how much slower your usual lap is there than your best. Came back = in how many of those sessions it was one of your 3 biggest losses. ' +
        'These spots are sent to the AI with the session.</div>' : '<div class="muted">' + (z ? 'No weak spots: you are close to your best everywhere.' : 'No weak spots yet.') + '</div>';
      return;
    }
    $('mapSub').textContent = 'The app times every piece of the lap while you drive. After a few valid laps here this map shows where you lose time, and the AI gets those spots too.';
    side.innerHTML = '<div class="muted">No timing for this track yet.</div>';
    box.innerHTML = '<div class="muted" style="padding:20px">Loading the map...</div>';
    var k = s.file + '|' + s.time;
    outlineFor(s).then(function (paths) {
      if (!cur || cur.file + '|' + cur.time !== k) return;
      var svg = paths ? TM.outline(paths) : '';
      box.innerHTML = svg ? svg + '<div class="hint">The game\'s map of ' + esc(name) + ': no timing here yet</div>' : '<div class="muted" style="padding:20px">No map of this track yet: it is saved the first time you drive there with the app running.</div>';
    });
  }
  function build(s, sg) {
    var o = { sessions: data.sessions, ref: ref, slow: SLOW, zones: sg ? sg.z : null, spots: sg ? sg.spots : null, focus: focList.filter(function (f) { return f.key === s.track + '\u0001' + s.car; })[0] || null };
    return kind === 'question' ? C.question(s, $('qIn').value, o) : C.debrief(s, o);
  }
  var zCache = {}, shown = null, mapFor = null;
  function saved(key) { return info.history.filter(function (h) { return h.cacheKey === key; })[0] || null; }
  function prepare() {
    if (!data) { $('sesInfo').textContent = 'Reading your sessions...'; return; }
    $('sesInfo').textContent = data.error ? data.error : '';
    if (!$('sesSel').options.length || !cur) fillSessions();
    if (!cur) { $('goBtn').disabled = true; $('sesTiles').innerHTML = ''; return; }
    tiles(cur);
    var s = cur, k = s.file + '|' + s.time, my = ++reqToken;
    var z = zCache[k] !== undefined ? Promise.resolve(zCache[k]) : segsFor(s).then(function (v) { zCache[k] = v; return v; });
    z.then(function (sg) { if (my !== reqToken) return; if (mapFor !== k) { mapFor = k; drawMap(s, sg); } req = build(s, sg); costLine(); });
  }
  function costLine() {
    var q = kind === 'question', empty = q && !$('qIn').value.trim(), old = req && saved(req.cacheKey);
    $('goBtn').textContent = q ? 'Ask' : old ? 'Ask again (new request)' : 'Get my debrief';
    $('goBtn').disabled = busy || !req || empty;
    $('cost').textContent = req ? 'Sends about ' + C.tokens(req).toLocaleString('en-US') + ' tokens, answer up to about ' + req.maxOut + ' · ' + PROV[provider()].name + ' · ' + model() : '';
    $('sent').textContent = req ? req.system + '\n\n' + req.prompt : '';
    if (!q && old && shown !== old.id) openSaved(old.id);
    else if (!q && !old && !busy && shown !== null) { $('answer').hidden = true; shown = null; }
  }
  $('kindTab').onclick = function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return; kind = b.getAttribute('data-v');
    [].forEach.call(this.querySelectorAll('button'), function (x) { x.className = x === b ? 'on' : ''; });
    $('askDebrief').hidden = kind !== 'debrief'; $('askQuestion').hidden = kind !== 'question';
    $('answer').hidden = true; shown = null; $('goMsg').textContent = ''; prepare();
  };
  $('qIdeas').innerHTML = IDEAS.map(function (t) { return '<button class="btn" data-q="' + esc(t) + '" style="padding:5px 12px;font-weight:600">' + esc(t) + '</button>'; }).join('');
  $('qIdeas').onclick = function (e) { var b = e.target.closest('[data-q]'); if (!b) return; $('qIn').value = b.getAttribute('data-q'); prepare(); };
  var qTimer = null;
  $('qIn').oninput = function () { clearTimeout(qTimer); qTimer = setTimeout(prepare, 250); costLine(); };
  $('showSent').onclick = function () { var p = $('sent'); p.hidden = !p.hidden; this.textContent = p.hidden ? 'See what is sent' : 'Hide what is sent'; };

  // ---------- asking (only here: a click) ----------
  $('goBtn').onclick = function () {
    if (!req || busy) return;
    var r = req, fresh = kind === 'debrief' && !!saved(r.cacheKey);
    busy = true; costLine(); $('goMsg').textContent = 'Asking ' + model() + '...';
    H.json('api/coach?do=ask', { method: 'POST', body: JSON.stringify({ kind: r.kind, title: r.title, cacheKey: r.cacheKey, system: r.system, prompt: r.prompt, maxOut: r.maxOut, fresh: fresh }) })
      .then(function (a) {
        busy = false;
        if (a.error) { $('goMsg').innerHTML = '<span class="red">' + esc(a.error) + '</span>' + otherModel(a); costLine(); return; }
        $('goMsg').textContent = ''; showAnswer(a); load();
      }, function (e) { busy = false; $('goMsg').innerHTML = '<span class="red">Failed: ' + esc(String(e)) + '</span>'; costLine(); });
  };
  // busy or out of free quota on this model: offer the next model of the list (one click, the user picks; nothing switches by itself)
  function otherModel(a) {
    var p = provider(), cur = model(); if (!a.busy) return '';
    (modelsFor[p] ? Promise.resolve(modelsFor[p]) : post('models', { provider: p }).then(function (r) { return r.error ? [] : (modelsFor[p] = C.models(p, r.models)); }))
      .then(function (list) {
        var i = list.indexOf(cur), next = list.filter(function (m, k) { return k > i; })[0] || (i !== 0 ? list[0] : null), box = $('tryNext');
        if (!next || !box) return;
        box.innerHTML = ' <button class="btn" style="padding:4px 12px">Use ' + esc(next) + ' instead</button>';
        box.firstElementChild.onclick = function () { use(p, next).then(function () { $('goMsg').textContent = 'Switched to ' + next + ': click again to ask.'; }); };
      }, function () {});
    return '<span id="tryNext"></span>';
  }
  function showAnswer(a) {
    shown = a.id; var box = $('answer'); box.hidden = false;
    box.innerHTML = '<div class="coach-ah"><b>' + esc(a.title) + '</b><span class="faint">' + esc(F.wallClock(a.time * 1000)) + ' · ' + esc(a.model) + ' · ' +
      (a.inTok + a.outTok).toLocaleString('en-US') + ' tokens (' + a.inTok + ' in, ' + a.outTok + ' out)</span></div>' + C.md(a.text) +
      '<div class="faint" style="font-size:12px;margin-top:10px">AI advice from your numbers only (no telemetry): ideas to try, check them in your next session.</div>';
  }
  function openSaved(id) { shown = id; return H.json('api/coach?id=' + encodeURIComponent(id)).then(showAnswer, function () {}); }

  // ---------- saved answers ----------
  function renderHist() {
    var list = info.history || [];
    if (!list.length) { $('histTbl').innerHTML = '<tbody><tr><td class="empty">No answers yet.</td></tr></tbody>'; return; }
    $('histTbl').innerHTML = '<thead><tr><th>When</th><th>What</th><th>Model</th><th class="num">Tokens</th><th></th></tr></thead><tbody>' + list.map(function (h) {
      return '<tr class="click" data-id="' + esc(h.id) + '"><td>' + esc(F.wallClock(h.time * 1000)) + '</td><td>' + esc(h.title) + '</td><td>' + esc(h.model) +
        '</td><td class="num">' + (h.inTok + h.outTok).toLocaleString('en-US') + '</td><td><button class="btn" data-del="' + esc(h.id) + '" style="padding:4px 10px">Delete</button></td></tr>';
    }).join('') + '</tbody>';
  }
  $('histTbl').onclick = function (e) {
    var d = e.target.closest('[data-del]');
    if (d) { e.stopPropagation(); post('delete', null, '&id=' + encodeURIComponent(d.getAttribute('data-del'))).then(function (i) { info = i; if (shown === d.getAttribute('data-del')) { $('answer').hidden = true; shown = null; } view(); }); return; }
    var r = e.target.closest('tr[data-id]'); if (r) openSaved(r.getAttribute('data-id')).then(function () { $('answer').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  };

  // ---------- data ----------
  if (!H.inApp) {
    $('terms').hidden = true;
    $('main').insertAdjacentHTML('beforebegin', '<section class="card" style="margin-top:14px"><div class="empty">Open this page in the app: the AI Coach uses your API key through the app.</div></section>');
    return;
  }
  load().catch(function () { $('terms').hidden = false; });
  function show(i) {
    data = i; H.setWho(i.names && i.names[0]); U.markOld(data.sessions, ref);
    focList = U.focus(data.sessions, ref, Date.now() / 1000, SLOW, 5); zCache = {}; mapFor = null;
    $('sesSel').innerHTML = ''; if (info && ready()) prepare();
  }
  H.loadPace(function () { $('sesInfo').textContent = 'Reading your sessions...'; }, function (i) { show(i); H.watchPace(i.gen, show); });
  H.json('api/reference').then(function (r) { ref = R.parse(r.csv); if (data) show(data); }, function () {});
  H.json('api/segments').then(function (r) { segAll = (r && r.list) || []; zCache = {}; lineCache = {}; mapFor = null; if (data && info && ready()) prepare(); }, function () {});
})(window);
