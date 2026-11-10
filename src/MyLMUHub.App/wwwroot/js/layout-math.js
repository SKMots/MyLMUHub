// Geometry for moving / resizing widgets on the canvas. Pure functions (unit-tested in tests/js).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  function snap(v, grid) { return grid > 1 ? Math.round(v / grid) * grid : Math.round(v); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // keep a rectangle fully inside the canvas
  function clampRect(r, cw, ch) {
    var w = Math.min(r.w, cw), h = Math.min(r.h, ch);
    return { x: clamp(r.x, 0, cw - w), y: clamp(r.y, 0, ch - h), w: w, h: h };
  }
  // edges to line up with: the other widgets' sides and the canvas border. tol = how close (canvas px) an edge must come to lock on.
  function edgesOf(rects, cw, ch, tol) {
    var e = { xs: [0, cw], ys: [0, ch], tol: tol };
    rects.forEach(function (r) { e.xs.push(r.x, r.x + r.w); e.ys.push(r.y, r.y + r.h); });
    return e;
  }
  function nearest(v, targets, tol) {
    var best = null;
    for (var i = 0; i < targets.length; i++) { var d = Math.abs(targets[i] - v); if (d <= tol && (!best || d < best.d)) best = { v: targets[i], d: d }; }
    return best;
  }
  // one edge: lock onto a nearby widget edge, else onto the grid. line = the edge it locked onto (for the guide), null = grid
  function snapEdge(v, grid, targets, tol) { var n = nearest(v, targets, tol); return n ? { v: n.v, line: n.v, d: n.d } : { v: snap(v, grid), line: null }; }
  // a whole side of a moving box: whichever of its two edges (start / end) is closer to a widget edge wins
  function snapSpan(pos, size, grid, targets, tol) {
    var a = nearest(pos, targets, tol), b = nearest(pos + size, targets, tol);
    if (a && (!b || a.d <= b.d)) return { v: a.v, line: a.v };
    if (b) return { v: b.v - size, line: b.v };
    return { v: snap(pos, grid), line: null };
  }
  // move: start rectangle + pointer movement (in canvas units). edges (optional, from edgesOf) adds widget snapping and r.guides = {x, y}
  function drag(start, dx, dy, grid, cw, ch, edges) {
    if (!edges) return clampRect({ x: snap(start.x + dx, grid), y: snap(start.y + dy, grid), w: start.w, h: start.h }, cw, ch);
    var sx = snapSpan(start.x + dx, start.w, grid, edges.xs, edges.tol), sy = snapSpan(start.y + dy, start.h, grid, edges.ys, edges.tol);
    var r = clampRect({ x: sx.v, y: sy.v, w: start.w, h: start.h }, cw, ch); r.guides = { x: sx.line, y: sy.line }; return r;
  }
  // resize by dragging a handle: 'n','s','e','w','ne','nw','se','sw'. min = {w,h}. keepAspect keeps the start ratio (corner handles).
  function resize(start, handle, dx, dy, grid, min, cw, ch, keepAspect, edges) {
    var x1 = start.x, y1 = start.y, x2 = start.x + start.w, y2 = start.y + start.h, gx = null, gy = null, dx_ = 0, dy_ = 0;
    var e = edges || { xs: [], ys: [], tol: -1 };
    function sx(v) { var s = snapEdge(v, grid, e.xs, e.tol); if (s.line !== null) { gx = s.line; dx_ = s.d; } return s.v; }
    function sy(v) { var s = snapEdge(v, grid, e.ys, e.tol); if (s.line !== null) { gy = s.line; dy_ = s.d; } return s.v; }
    if (handle.indexOf('w') >= 0) x1 = sx(start.x + dx);
    if (handle.indexOf('e') >= 0) x2 = sx(start.x + start.w + dx);
    if (handle.indexOf('n') >= 0) y1 = sy(start.y + dy);
    if (handle.indexOf('s') >= 0) y2 = sy(start.y + start.h + dy);
    if (x2 - x1 < min.w) { if (handle.indexOf('w') >= 0) x1 = x2 - min.w; else x2 = x1 + min.w; }
    if (y2 - y1 < min.h) { if (handle.indexOf('n') >= 0) y1 = y2 - min.h; else y2 = y1 + min.h; }
    if (keepAspect && handle.length === 2) {
      var ratio = start.w / start.h, w = x2 - x1, h = y2 - y1;
      if (gy !== null && (gx === null || dy_ <= dx_)) w = h * ratio;     // an edge locked onto another widget decides the size (the closer one if both)
      else if (gx !== null) h = w / ratio;
      else if (w / h > ratio) w = h * ratio; else h = w / ratio;       // nothing locked: the smaller of the two wins
      if (handle.indexOf('w') >= 0) x1 = x2 - w; else x2 = x1 + w;
      if (handle.indexOf('n') >= 0) y1 = y2 - h; else y2 = y1 + h;
    }
    x1 = clamp(x1, 0, cw); x2 = clamp(x2, 0, cw); y1 = clamp(y1, 0, ch); y2 = clamp(y2, 0, ch);
    var r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    if (edges) r.guides = { x: (gx === x1 || gx === x2) ? gx : null, y: (gy === y1 || gy === y2) ? gy : null };   // keeping the shape may pull an edge off its line
    return r;
  }
  // ---- several widgets at once ----
  // the box around rectangles
  function bbox(rs) {
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    rs.forEach(function (r) { x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); });
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  // rectangles inside box 'from' stretched into box 'to' (edges rounded the same way, so widgets that touched still touch and never overlap)
  function scaleInto(rs, from, to) {
    var sx = to.w / from.w, sy = to.h / from.h;
    return rs.map(function (r) {
      var x1 = Math.round(to.x + (r.x - from.x) * sx), x2 = Math.round(to.x + (r.x + r.w - from.x) * sx);
      var y1 = Math.round(to.y + (r.y - from.y) * sy), y2 = Math.round(to.y + (r.y + r.h - from.y) * sy);
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    });
  }
  // two rectangles overlap (touching edges is fine)
  function overlap(a, b) { return a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5; }
  // where b lies next to a (start positions): right / left / below / above (two for a diagonal neighbour)
  function sides(a, b) { return [b.x >= a.x + a.w - 0.5, b.x + b.w <= a.x + 0.5, b.y >= a.y + a.h - 0.5, b.y + b.h <= a.y + 0.5]; }
  // push 'others' out of the way of the 'fixed' rectangles (the ones being moved / resized); a pushed widget pushes the next one.
  // A widget is pushed away on the side it was on at the start (fixedStart / others = start positions): to the right of the dragged box -> further right, below -> down
  // (diagonal: the shorter way; overlapping already at the start: any way). It never goes off the canvas or into a fixed one; dir (drag direction) wins a tie.
  // ok = false when something cannot make room: the caller keeps the last state that fitted.
  function push(fixed, others, cw, ch, dir, fixedStart) {
    var out = others.map(function (r) { return { x: r.x, y: r.y, w: r.w, h: r.h }; }), moved = out.map(function () { return false; });
    var queue = fixed.map(function (r, i) { return { cur: r, from: (fixedStart || fixed)[i] }; }), guard = 0; dir = dir || { x: 0, y: 0 };
    while (queue.length && guard++ < 5000) {
      var q = queue.shift(), s = q.cur;
      for (var i = 0; i < out.length; i++) {
        var o = out[i]; if (o === s || !overlap(s, o)) continue;
        var side = sides(q.from, others[i]), any = side.indexOf(true) < 0, oo = o;
        // one way out per side: just clear of s, then on past every fixed box it would land on
        var c = [0, 1, 2, 3].map(function (k) {
          var n = { x: oo.x, y: oo.y, w: oo.w, h: oo.h }, hit = s, g = 0;
          while (hit && g++ < 50) {
            if (k === 0) n.x = hit.x + hit.w; else if (k === 1) n.x = hit.x - n.w; else if (k === 2) n.y = hit.y + hit.h; else n.y = hit.y - n.h;
            hit = null; for (var f = 0; f < fixed.length; f++) if (overlap(n, fixed[f])) { hit = fixed[f]; break; }
          }
          return [n.x - oo.x, n.y - oo.y, k === 0 ? dir.x > 0 : k === 1 ? dir.x < 0 : k === 2 ? dir.y > 0 : dir.y < 0, n, k];
        }).filter(function (m) {
          var n = m[3]; if (!any && !side[m[4]]) return false;
          return n.x >= 0 && n.x + n.w <= cw && n.y >= 0 && n.y + n.h <= ch && !fixed.some(function (f) { return overlap(n, f); });
        })
          .sort(function (a, b) { return (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])) || (b[2] ? 1 : 0) - (a[2] ? 1 : 0); });
        if (!c.length) return { ok: false, rects: out };
        o.x += c[0][0]; o.y += c[0][1]; moved[i] = true; queue.push({ cur: o, from: others[i] });
      }
    }
    for (var a = 0; a < out.length; a++) {
      if (!moved[a]) continue;
      for (var f = 0; f < fixed.length; f++) if (overlap(out[a], fixed[f])) return { ok: false, rects: out };
      for (var b = 0; b < out.length; b++) if (b !== a && overlap(out[a], out[b])) return { ok: false, rects: out };
    }
    return { ok: true, rects: out };
  }
  // moving: push the others out of the way; where that cannot make room (a corner, a full row), the widgets the moved box lands on jump to the nearest
  // free place instead - first choice the place the moved box came from (two widgets swap). Always from the start positions, so a widget jumps back when
  // the box moves on. ok = false only when there is no free place at all.
  function arrange(fixed, others, cw, ch, dir, fixedStart) {
    var p = push(fixed, others, cw, ch, dir, fixedStart);
    if (p.ok) return p;
    var vac = bbox(fixedStart || fixed), out = others.map(function (r) { return { x: r.x, y: r.y, w: r.w, h: r.h }; }), placed = fixed.slice(), hit = [];
    others.forEach(function (r, i) { if (fixed.some(function (f) { return overlap(r, f); })) hit.push(i); else placed.push(out[i]); });
    hit.sort(function (a, b) { return others[b].w * others[b].h - others[a].w * others[a].h; });   // the big ones first: they are the hardest to fit
    var keep = placed.slice(), fits = true;
    for (var k = 0; k < hit.length && fits; k++) {
      var s = nearestFree(others[hit[k]], placed, cw, ch, vac);
      if (s) { out[hit[k]] = s; placed.push(s); } else fits = false;
    }
    if (fits) return { ok: true, rects: out, jumped: hit };
    // a full dashboard: no free place of their size. They take the space the moved box left (the largest free part of it), resized to fill it together
    var region = freePart(vac, keep), hr = hit.map(function (i) { return others[i]; });
    var into = region ? scaleInto(hr, bbox(hr), region) : null;
    if (into && !into.some(function (r) { return r.w < 120 || r.h < 80; })) {                      // not too small to be of use
      hit.forEach(function (i, n) { out[i] = into[n]; });
      return { ok: true, rects: out, jumped: hit, resized: true };
    }
    // a small box dropped on a big widget: the widgets under it shrink to the largest part of themselves around it
    var placed2 = keep.slice();
    for (var m = 0; m < hit.length; m++) {
      var part = freePart(others[hit[m]], placed2);
      if (!part) return { ok: false, rects: out };
      out[hit[m]] = part; placed2.push(part);
    }
    return { ok: true, rects: out, jumped: hit, resized: true };
  }
  // the largest part of box v that overlaps none of rects: v itself, else the strips of v left / right / above / below each rect in it; null = none of 120 x 80
  function freePart(v, rects) {
    var c = [v];
    rects.forEach(function (r) {
      if (!overlap(v, r)) return;
      c.push({ x: v.x, y: v.y, w: r.x - v.x, h: v.h }, { x: r.x + r.w, y: v.y, w: v.x + v.w - r.x - r.w, h: v.h },
             { x: v.x, y: v.y, w: v.w, h: r.y - v.y }, { x: v.x, y: r.y + r.h, w: v.w, h: v.y + v.h - r.y - r.h });
    });
    var best = null;
    c.forEach(function (p) {
      if (p.w < 120 || p.h < 80 || rects.some(function (r) { return overlap(p, r); })) return;
      if (!best || p.w * p.h > best.w * best.h) best = p;
    });
    return best ? { x: Math.round(best.x), y: Math.round(best.y), w: Math.round(best.w), h: Math.round(best.h) } : null;
  }
  // the free place for r closest to where it is (inside 'prefer' first), lined up with the canvas border or another widget's edge; null = none
  function nearestFree(r, rects, cw, ch, prefer) {
    var xs = [0, cw - r.w, r.x], ys = [0, ch - r.h, r.y], best = null;
    if (prefer) { xs.push(prefer.x, prefer.x + prefer.w - r.w); ys.push(prefer.y, prefer.y + prefer.h - r.h); }
    rects.forEach(function (q) { xs.push(q.x, q.x + q.w, q.x - r.w, q.x + q.w - r.w); ys.push(q.y, q.y + q.h, q.y - r.h, q.y + q.h - r.h); });
    for (var i = 0; i < xs.length; i++) for (var j = 0; j < ys.length; j++) {
      var c = { x: Math.round(xs[i]), y: Math.round(ys[j]), w: r.w, h: r.h };
      if (c.x < 0 || c.y < 0 || c.x + c.w > cw || c.y + c.h > ch || rects.some(function (q) { return overlap(c, q); })) continue;
      var inside = prefer && c.x >= prefer.x - 0.5 && c.y >= prefer.y - 0.5 && c.x + c.w <= prefer.x + prefer.w + 0.5 && c.y + c.h <= prefer.y + prefer.h + 0.5;
      var score = Math.abs(c.x - r.x) + Math.abs(c.y - r.y) - (inside ? 1e6 : 0);
      if (!best || score < best.s) best = { s: score, c: c };
    }
    return best ? best.c : null;
  }
  // first free place for a w x h box (top to bottom, left to right), tried at the canvas corner and next to / below every widget; null = no room
  function freeSpot(rects, w, h, cw, ch) {
    var xs = [0], ys = [0];
    rects.forEach(function (r) { xs.push(r.x + r.w); ys.push(r.y + r.h); });
    xs.sort(function (a, b) { return a - b; }); ys.sort(function (a, b) { return a - b; });
    for (var j = 0; j < ys.length; j++) for (var i = 0; i < xs.length; i++) {
      var c = { x: xs[i], y: ys[j], w: w, h: h };
      if (c.x + w <= cw && c.y + h <= ch && !rects.some(function (r) { return overlap(c, r); })) return c;
    }
    return null;
  }
  // auto align: the same space (gap) between every two neighbouring widgets, and none at the canvas edges. A widget's left / top edge moves to gap after its
  // neighbour (the nearest edge within reach that it overlaps the other way), or to the canvas edge when nothing is between; its right / bottom edge then grows to gap
  // before the next widget, or to the canvas edge when no widget follows within reach. Spaces bigger than reach are left alone. Sizes change, the order never; a widget is not made
  // smaller than its minimum (mins[i] {w, h}, else 0). Returns new rects.
  function align(rects, cw, ch, gap, reach, mins) {
    var out = rects.map(function (r) { return { x: r.x, y: r.y, w: r.w, h: r.h }; });
    function pass(rs, len, minOf) {                                                   // along x (y pass: the same on swapped rects)
      function across(a, b) { return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1; }
      var idx = rs.map(function (r, i) { return i; }).sort(function (a, b) { return rs[a].x - rs[b].x; });
      idx.forEach(function (i) {
        var r = rs[i], right = r.x + r.w, to = r.x <= reach ? 0 : null;
        rs.forEach(function (o, j) {
          var e = o.x + o.w;
          if (j !== i && across(o, r) && e <= r.x + 1 && r.x - e <= reach) to = Math.max(to === null ? -Infinity : to, e + gap);
        });
        if (to !== null && right - to >= minOf(i)) { r.x = Math.round(to); r.w = right - r.x; }
      });
      rs.forEach(function (r, i) {                                                    // right edge: up to gap before the next widget, else the canvas edge
        var right = r.x + r.w, to = len - right <= reach ? len : null;
        rs.forEach(function (o, j) { if (j !== i && across(o, r) && o.x >= right - 1 && o.x - right <= reach) to = Math.min(to === null ? Infinity : to, o.x - gap); });
        if (to !== null && to > right) r.w = Math.round(to) - r.x;
      });
    }
    function sw(r) { return { x: r.y, y: r.x, w: r.h, h: r.w }; }
    pass(out, cw, function (i) { return mins && mins[i] ? mins[i].w : 0; });
    var t = out.map(sw); pass(t, ch, function (i) { return mins && mins[i] ? mins[i].h : 0; });
    return t.map(sw);
  }
  // uniform scale that fits base-size content into a box
  function fitScale(boxW, boxH, baseW, baseH) { return Math.max(0.01, Math.min(boxW / baseW, boxH / baseH)); }
  // scale + offset that fit the whole canvas into the window (letterboxed, centred)
  function stageFit(winW, winH, cw, ch) {
    var k = Math.max(0.01, Math.min(winW / cw, winH / ch));
    return { k: k, ox: (winW - cw * k) / 2, oy: (winH - ch * k) / 2 };
  }
  P.layoutMath = { snap: snap, clampRect: clampRect, edgesOf: edgesOf, drag: drag, resize: resize, fitScale: fitScale, stageFit: stageFit,
                   bbox: bbox, scaleInto: scaleInto, overlap: overlap, push: push, arrange: arrange, nearestFree: nearestFree, freeSpot: freeSpot, align: align };
  if (typeof module !== 'undefined') module.exports = P.layoutMath;
})(typeof window !== 'undefined' ? window : globalThis);
