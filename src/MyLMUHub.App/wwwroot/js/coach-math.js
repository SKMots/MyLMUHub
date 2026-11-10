// AI Coach (coach.html): what is sent to the user's AI and how its answer is shown. Pure functions (tests/js/coach-math.test.js).
// Few tokens on purpose: the app does the maths (pace-math.js, potential-math.js), the AI only gets a short summary in numbers (no names) and explains / plans.
// The page calls the provider through the app (CoachService.cs), never by itself.
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, M = P.paceMath, R = P.paceRef, F = P.format;
  var SEC = ['S1', 'S2', 'S3'], CLASS_LABEL = { LMH: 'Hypercar', LMP2wec: 'LMP2', LMP2elms: 'LMP2 ELMS', LMP3: 'LMP3', LMGT3: 'GT3', GTE: 'GTE' };

  // ---------- models ----------
  // the chat models of a provider's list (no image / audio / embedding ...), the best default first: a small, cheap, fast one
  var SKIP = {
    openai: /(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|codex|dall|whisper|davinci|babbage|computer|deep-research|-pro\b|oss)/,
    gemini: /(tts|image|live|embedding|aqa|robotics|computer|native-audio|veo|imagen|learnlm|gemma|nano-banana|deep-research)/,
    anthropic: /^$/
  };
  var KEEP = { openai: /^(gpt-|o\d|chatgpt-)/, gemini: /^gemini-/, anthropic: /^claude-/ };
  function version(id) { var m = /(\d+(?:\.\d+)?)/.exec(id.replace(/-(\d)-(\d)(?=-|$)/, '-$1.$2')); return m ? Number(m[1]) : 0; }
  function tier(p, id) {
    var dated = /-\d{4}-?\d{2}-?\d{2}$|-\d{8}$|-\d{3}$/.test(id), pre = /(preview|exp|latest)/.test(id);
    var t;
    if (p === 'anthropic') t = /haiku/.test(id) ? 0 : /sonnet/.test(id) ? 1 : 2;
    else if (p === 'openai') t = /mini/.test(id) ? 0 : /nano/.test(id) ? 1 : 2;
    else t = /flash/.test(id) && !/lite/.test(id) ? 0 : /lite/.test(id) ? 1 : 2;
    return t * 4 + (pre ? 2 : 0) + (dated && p !== 'anthropic' ? 1 : 0);
  }
  function models(provider, ids) {
    var keep = KEEP[provider], skip = SKIP[provider]; if (!keep) return [];
    var list = (ids || []).filter(function (id) { return keep.test(id) && !skip.test(id); });
    var order = {}; list.forEach(function (id, i) { order[id] = i; });
    return list.sort(function (a, b) {
      return tier(provider, a) - tier(provider, b) || (provider === 'anthropic' ? order[a] - order[b] : version(b) - version(a) || a.length - b.length || (a < b ? -1 : 1));
    });
  }

  // ---------- what is sent ----------
  var SYSTEM = 'You are a direct, friendly sim racing coach for Le Mans Ultimate. The driver sends numbers from their own lap data (lap and sector times, m:ss.sss or seconds). ' +
    'Rules: use only the numbers given. Telemetry is limited to what is given (at the weak spots maybe brake point, speed and full-throttle point; never steering, gears or tyres): when you suggest technique, say it is a suggestion and how ' +
    'the driver can check it in the next session with these numbers. Name a corner only if you are sure which corner is at that distance on this track, else use the distance. ' +
    'Be short and practical, plain English, no filler. Format: "## " headings, "- " bullets or "1. " steps, **bold** for the key number.';

  function spot(o) {
    var r = function (v) { return Math.round(v); }, out = [];
    out.push(o.brakeAt !== null ? 'brake at ' + r(o.brakeAt) + ' m' + (o.brakeMax !== null ? ' (' + r(o.brakeMax) + ' %)' : '') : 'no braking');
    if (o.entry !== null) out.push('in ' + r(o.entry) + ' km/h');
    if (o.min !== null) out.push('slowest ' + r(o.min) + ' km/h' + (o.minAt !== null ? ' at ' + r(o.minAt) + ' m' : ''));
    if (o.throttleAt !== null) out.push('full throttle at ' + r(o.throttleAt) + ' m');
    if (o.exit !== null) out.push('out ' + r(o.exit) + ' km/h');
    return out.join(', ');
  }
  function lap(t) { return t > 0 ? F.lap(t).replace(/^0(\d:)/, '$1') : '-'; }
  function sec(t) { return t > 0 ? F.sector(t) : '-'; }
  function s3(d) { return F.plusSec(d) + ' s'; }
  function typeName(t) { return t === 'Qualify' ? 'Qualifying' : t || 'Session'; }
  function trackLabel(s) { var b = R.trackName(s.track, s.layout) || s.track; return b + (s.layout && R.variantLabel(b, s.layout) !== 'standard' ? ' (' + R.variantLabel(b, s.layout) + ')' : ''); }
  function sameTrack(a, b) { return R.trackKey(a.track, a.layout) === R.trackKey(b.track, b.layout); }

  // the numbers of one session for the AI: this session, your history there (same car, before it), the reference sheet, a repeated weak sector,
  // where on the track you lose time (zones from your segments, optional). o = { sessions, ref, slow, focus (potential-math focus() entry), zones (zones()), spots (driving lines there: [{ n, best, usual }]) }
  function sessionData(s, o) {
    o = o || {}; var slow = o.slow > 0 ? o.slow : 0.05, a = M.session(s, slow), d = a.dry, L = [];
    var why = {}; a.laps.forEach(function (l) { if (l.why) why[l.why] = (why[l.why] || 0) + 1; });
    var wet = a.laps.filter(function (l) { return l.wet; }).length;
    L.push('Session: ' + typeName(s.type) + ' on ' + F.day(s.time) + ' · ' + trackLabel(s) + ' · ' + s.car + ' (' + (CLASS_LABEL[R.className(s['class'])] || s['class']) + ')' +
      (s.classPos > 0 && s.classCars > 0 ? ' · finished P' + s.classPos + ' of ' + s.classCars + ' in class' : ''));
    L.push('Laps: ' + a.laps.length + ', ' + (d.clean + a.wet.clean) + ' counted' + (Object.keys(why).length ? ' (not counted: ' + Object.keys(why).map(function (k) { return why[k] + ' ' + k; }).join(', ') +
      '; slow = more than ' + Math.round(slow * 100) + ' % off the median)' : '') + (wet ? '; ' + wet + ' laps wet' : ''));
    if (d.best) {
      L.push('This session (dry): best ' + lap(d.best) + ' · optimal ' + lap(d.optimal) + ' (your best S1+S2+S3) · average of counted laps ' + lap(d.pace) + ' · median ' + lap(d.median) +
        ' · consistency (std dev of counted laps) ' + (d.sd > 0 ? d.sd.toFixed(3) + ' s' : '-'));
      var clean = a.laps.filter(function (l) { return !l.why && !l.wet && l.s[0] > 0 && l.s[1] > 0 && l.s[2] > 0; });
      if (clean.length >= 2) L.push('Sectors (best / median of counted laps / difference): ' + [0, 1, 2].map(function (i) {
        var m = M.median(clean.map(function (l) { return l.s[i]; })); return SEC[i] + ' ' + sec(d.sectors[i]) + ' / ' + sec(m) + ' / ' + s3(m - d.sectors[i]);
      }).join(' · '));
    }
    if (a.wet.best) L.push('Wet laps: best ' + lap(a.wet.best) + ' · average ' + lap(a.wet.pace) + ' (' + a.wet.clean + ' counted)');
    var before = (o.sessions || []).filter(function (x) { return x !== s && !x.old && x.car === s.car && sameTrack(x, s) && x.time < s.time; });
    if (before.length) {
      var h = M.combine(before, slow, null).dry;
      L.push('Your history here before this session (same car, ' + before.length + ' session' + (before.length === 1 ? '' : 's') + ', ' + h.clean + ' counted dry laps): best ever ' + lap(h.best) + ' · optimal ever ' + lap(h.optimal) +
        ' · usual average pace ' + lap(h.pace) + (d.pace && h.pace ? ' → this session ' + s3(d.pace - h.pace) + ' per lap against it' : ''));
    } else L.push('Your first session here with this car (no history to compare with).');
    var rf = R.lookup(o.ref, s.track, s.layout, s['class']);
    if (rf && rf.race && rf.race[0] > 0 && d.pace) {
      L.push('Reference (community lap time sheet): alien race pace ' + lap(rf.race[0]) + (rf.hot ? ', alien hotlap ' + lap(rf.hot) : '') + '. Your average this session = ' +
        (100 * d.pace / rf.race[0]).toFixed(1) + ' % of the alien race pace (bands: ~100 alien, 101 competitive, 102-103 good, 104-105 midpack, 106 tail-ender, 107+ offline).');
    }
    var f = o.focus;
    if (f) {
      if (f.behind > 0) L.push('Against your level on your other tracks of this class: this track is ' + s3(f.behind) + ' per lap behind.');
      var w = f.sectors.filter(function (x) { return x.weakest >= 2; }).sort(function (x, y) { return y.weakest - x.weakest; })[0];
      if (w && f.sessions >= 2) L.push('Pattern: ' + SEC[w.i] + ' was your weakest sector in ' + w.weakest + ' of your last ' + f.sessions + ' sessions here.');
    }
    var z = o.zones;
    if (z && z.zones && z.zones.length) L.push('Weak spots (numbered as on the driver\'s map: call them spot 1, spot 2, spot 3; ' + (z.turns ? 'the lap split corner by corner (a turn = from braking for a corner to braking for the next one); ' : '') + 'segment timing, your last ' + z.sessions + ' sessions here, your usual time against your best' + (z.turns ? ' through that turn' : ' per ~150 m') + '; lap ' +
      (z.segs.length && z.segs[z.segs.length - 1].to ? F.km(z.segs[z.segs.length - 1].to) : '') + '): ' + z.zones.map(function (q) {
        return q.n + ') ' + (q.turn ? 'turn ' + q.turn + ' of the lap, ' : '') + F.km(q.from) + '-' + F.km(q.to) + (q.sector >= 0 ? ' (' + SEC[q.sector] + ')' : '') + ': ' + s3(q.loss) + ' per lap';
      }).join('; '));
    // the driving lines at those spots (optional): o.spots = [{ n, best, usual }] (potential-math lineSpot / lineMedian)
    var sp = z && z.zones && z.zones.length ? (o.spots || []).filter(function (x) { return x && (x.best || x.usual); }) : [];
    if (sp.length) {
      L.push('Recorded driving lines at the weak spots (metres into the lap; brake = where the braking for the slowest point starts and the most brake pedal; ' +
        'full throttle = the first full throttle after the slowest point; best lap against the median of the driver\'s last laps here):');
      sp.forEach(function (x) {
        L.push('- spot ' + x.n + ': ' + [x.best ? 'best lap: ' + spot(x.best) : '', x.usual ? 'usual (' + x.usual.n + ' laps): ' + spot(x.usual) : ''].filter(Boolean).join('; '));
      });
    }
    // the laps: with sectors up to 40, else only the times (an endurance race), * = not counted
    var laps = a.laps;
    if (laps.length <= 40) {
      L.push('Laps (number, time, S1, S2, S3, why not counted):');
      laps.forEach(function (l) { L.push(l.n + ' ' + lap(l.t) + ' ' + sec(l.s[0]) + ' ' + sec(l.s[1]) + ' ' + sec(l.s[2]) + (l.why ? ' ' + l.why : '') + (l.wet ? ' wet' : '')); });
    } else {
      L.push('Lap times in order (* = not counted: out, pit, slow or invalid; w = wet):');
      L.push(laps.map(function (l) { return lap(l.t) + (l.why ? '*' : '') + (l.wet ? 'w' : ''); }).join(', '));
    }
    return L.join('\n');
  }

  var ASK = {
    debrief: 'Write a debrief of this session, at most 250 words:\n## In short\n2 sentences.\n## Went well\n2 bullets.\n## Work on\n2-3 bullets, each with the number that shows it.\n' +
      '## Next session plan\n3-5 numbered steps with concrete targets (how many laps, which sector, a target time).',
    question: 'Answer the question below about this data, at most 200 words. If the data cannot answer it, say what is missing.\nQuestion: '
  };
  // { kind, title, cacheKey, system, prompt, maxOut } for CoachService.Ask
  function debrief(s, o) {
    return { kind: 'debrief', title: 'Debrief · ' + typeName(s.type) + ' · ' + trackLabel(s) + ' · ' + F.day(s.time), cacheKey: 'debrief|' + s.file + '|' + s.time,
             system: SYSTEM, prompt: 'Data from Le Mans Ultimate:\n' + sessionData(s, o) + '\n\n' + ASK.debrief, maxOut: 900 };
  }
  function question(s, text, o) {
    var q = String(text || '').trim().slice(0, 1000);
    return { kind: 'question', title: q.length > 70 ? q.slice(0, 70) + '…' : q, cacheKey: 'question|' + s.file + '|' + s.time + '|' + q.toLowerCase(),
             system: SYSTEM, prompt: 'Data from Le Mans Ultimate:\n' + sessionData(s, o) + '\n\n' + ASK.question + q, maxOut: 700 };
  }
  // tokens, roughly (about 4 characters each in English): for the "what it costs" line before sending
  function tokens(req) { return Math.ceil(((req.system || '').length + (req.prompt || '').length) / 4); }

  // ---------- the answer ----------
  // a little markdown -> safe HTML (everything escaped first): ## headings, - / * bullets, 1. steps, **bold**, paragraphs
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>'); }
  function md(text) {
    var out = [], list = null, para = [];
    function flush() { if (para.length) { out.push('<p>' + para.map(inline).join(' ') + '</p>'); para = []; } }
    function close() { if (list) { out.push('</' + list + '>'); list = null; } }
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim(), m;
      if (!line) { flush(); close(); return; }
      if ((m = /^#{1,6}\s+(.*)$/.exec(line))) { flush(); close(); out.push('<h3>' + inline(m[1].replace(/\*\*/g, '')) + '</h3>'); return; }
      if ((m = /^[-*•]\s+(.*)$/.exec(line))) { flush(); if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) { flush(); if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      close(); para.push(line);
    });
    flush(); close();
    return out.join('');
  }

  P.coachMath = { models: models, sessionData: sessionData, debrief: debrief, question: question, tokens: tokens, md: md, SYSTEM: SYSTEM };
  if (typeof module !== 'undefined') module.exports = P.coachMath;
})(typeof window !== 'undefined' ? window : globalThis);
