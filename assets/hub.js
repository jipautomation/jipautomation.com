/* Legacy Build Hub, ported from the Cowork artifact to run inside the Jip Automation workspace.
   Pages render into a container the workspace provides; the workspace owns the sidebar and routing. */
window.JipHub = (function () {
"use strict";
var H = null, M = null, C = null, DOCS = null, NODE = {};
var OPTS = { main: null, onRender: null, admin: false };
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function chip(cls, txt) { return '<span class="chip ' + esc(cls) + '">' + esc(txt) + '</span>'; }
function statusLabel(s) { return ({ done: "done", live: "live", seeded: "seeded", next: "next", planned: "planned", proposed: "proposed", phase3: "phase 3", partial: "partial", placeholder: "placeholder", person: "" })[s] || s; }
function pageFor(n) {
  if (!n) return null;
  if (n.kind === "workflow") return "#/workflows/" + n.id;
  if (n.kind === "table") return "#/data/" + n.id;
  if (n.kind === "person") return "#/people";
  if (n.kind === "output") return "#/lifecycle";
  return "#/map?focus=" + n.id;
}

/* ---------------- store (db capability → localStorage fallback) ---------------- */
var Store = {
  db: null, mode: "local", ready: false, subs: [],
  state: { checklist: null, ken: null, notes: null },
  listeners: [], queue: {}, note: "",
  keys: ["checklist", "ken", "notes"],
  init: function () {
    var self = this;
    var seed = String(H.seed_version || "");
    try { if (localStorage.getItem("hub.seed") !== seed) { this.keys.forEach(function (k) { localStorage.removeItem("hub." + k); }); localStorage.setItem("hub.seed", seed); } } catch (e) { }
    this.state = { checklist: null, ken: null, notes: null };
    this.keys.forEach(function (k) { try { var v = localStorage.getItem("hub." + k); if (v) self.state[k] = JSON.parse(v); } catch (e) { } });
    if (!this.state.checklist) this.state.checklist = { done: C.done.slice() };
    if (!this.state.ken) this.state.ken = { items: Object.assign({}, (M.ken_tracker.state || {}).items || {}) };
    if (!this.state.notes) this.state.notes = { entries: [] };
    if (window.claude && window.claude.use) {
      window.claude.use("db").then(function (db) {
        if (!db) { self.ready = true; self.note = "Saving on this device only."; self.emit(); return; }
        self.db = db; self.mode = "db"; self.ready = true; self.note = "Shared saving is on — ticks and notes are kept for every viewer and read back by Claude.";
        self.keys.forEach(function (k) {
          try {
            var un = db.doc("hub/" + k).onSnapshot(function (snap) {
              // A missing doc is not an error: the built-in defaults stand until someone acts (or Claude seeds it).
              if (snap.exists) { self.state[k] = snap.data(); try { localStorage.setItem("hub." + k, JSON.stringify(self.state[k])); } catch (e) { } self.emit(); }
            }, function (err) { self.note = "Shared saving unavailable (" + (err && err.code) + ") — saving on this device."; self.mode = "local"; self.emit(); });
            self.subs.push(un);
          } catch (e) { }
        });
        self.emit();
      }).catch(function () { self.ready = true; self.emit(); });
    } else { this.ready = true; this.note = "Ticks and notes are saved in this browser only."; }
  },
  set: function (k, val) {
    var self = this; this.state[k] = val;
    try { localStorage.setItem("hub." + k, JSON.stringify(val)); } catch (e) { }
    this.emit();
    if (this.db) {
      if (this.queue[k]) clearTimeout(this.queue[k]);
      this.queue[k] = setTimeout(function () {
        self.db.doc("hub/" + k).set(val).catch(function (err) {
          if (err && (err.code === "invalid_argument" || err.code === "not_granted")) { self.note = "This view is read-only — changes are kept on this device only."; self.mode = "local"; self.emit(); }
        });
      }, 700);
    }
  },
  on: function (fn) { this.listeners.push(fn); },
  emit: function () { this.listeners.forEach(function (f) { try { f(); } catch (e) { } }); }
};

/* ---------------- markdown (mini renderer) ---------------- */
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, function (_, c) { return "<code>" + c + "</code>"; });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) { var ext = /^https?:/.test(u); return '<a href="' + u + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + t + "</a>"; });
  return s;
}
function md(src) {
  var lines = src.replace(/\r/g, "").split("\n"), out = [], i = 0;
  function isTableSep(l) { return /^\s*\|?\s*:?-{2,}/.test(l) && l.indexOf("|") >= 0; }
  while (i < lines.length) {
    var l = lines[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    if (/^```/.test(l)) { var code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; } i++; out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>"); continue; }
    var h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
    if (/^>/.test(l)) { var q = []; while (i < lines.length && /^>/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i++; } out.push("<blockquote>" + md(q.join("\n")) + "</blockquote>"); continue; }
    if (l.indexOf("|") >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      var cells = function (r) { r = r.trim(); if (r[0] === "|") r = r.slice(1); if (r[r.length - 1] === "|") r = r.slice(0, -1); return r.split("|").map(function (c) { return c.trim(); }); };
      var head = cells(l); i += 2; var rows = [];
      while (i < lines.length && lines[i].indexOf("|") >= 0 && !/^\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      var t = '<div class="tblwrap"><table><thead><tr>' + head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
      rows.forEach(function (r) { t += "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; });
      out.push(t + "</tbody></table></div>"); continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      var ordered = /^\s*\d+\./.test(l), items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        var item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""); i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) { item += " " + lines[i].trim(); i++; }
        items.push("<li>" + inline(item) + "</li>");
      }
      out.push((ordered ? "<ol>" : "<ul>") + items.join("") + (ordered ? "</ol>" : "</ul>")); continue;
    }
    var para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|>|\s*([-*]|\d+\.)\s+|\s*-{3,}\s*$)/.test(lines[i]) && !(lines[i].indexOf("|") >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1]))) { para.push(lines[i]); i++; }
    if (para.length) out.push("<p>" + inline(para.join(" ")) + "</p>"); else i++;
  }
  return out.join("\n");
}

/* ---------------- router ---------------- */
function parseHash() {
  var h = (location.hash || "#/home").replace(/^#\/?/, "");
  var q = {}; var qi = h.indexOf("?");
  if (qi >= 0) { h.slice(qi + 1).split("&").forEach(function (kv) { var p = kv.split("="); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ""); }); h = h.slice(0, qi); }
  var parts = h.split("/").filter(Boolean);
  return { page: parts[0] || "home", param: parts.slice(1).join("/") || "", q: q };
}
function counts() {
  var st = (Store.state.ken && Store.state.ken.items) || {}, kenOpen = 0;
  (M.ken_tracker.groups || []).forEach(function (g) { g.items.forEach(function (it) { if ((st[it.id] || {}).status !== "answered") kenOpen++; }); });
  var done = Store.state.checklist.done, t = 0, d = 0;
  C.sections.forEach(function (sec) { if (String(sec.phase || 2) !== "2") return; sec.items.forEach(function (it) { t++; if (done.indexOf(it.id) >= 0) d++; }); });
  return { workflows: M.nodes.filter(function (n) { return n.kind === "workflow"; }).length, data: M.nodes.filter(function (n) { return n.kind === "table"; }).length, ken: kenOpen, archive: M.docs.length, gotchas: M.gotchas.length, glossary: M.glossary.length, checklist: d + "/" + t };
}
function clientName() { return (M && M.meta && (M.meta.client_short || (M.meta.org || "").split(" · ")[0])) || "the client"; }
var TITLES = { home: "Build notes", map: "Project Map", lifecycle: "Deal Lifecycle", workflows: "Workflows", data: "Data Model", checklist: "Checklist", gotchas: "Gotchas", people: "People & Roles", glossary: "Glossary", ken: "Inputs Needed" };

/* ---------------- pages ---------------- */
var P = {};


function kenNow() {
  var st = (Store.state.ken && Store.state.ken.items) || {}, out = [];
  (M.ken_tracker.groups || []).forEach(function (g) { g.items.forEach(function (it) { if (it.urgency === "now" && (st[it.id] || {}).status !== "answered") out.push(it.item); }); });
  return out.length ? out : (M.status.waiting_ken || []);
}
P.home = function () {
  var s = M.status, j = M.journey;
  var h = '<div class="page"><div class="hero"><div class="mission"><p class="eyebrow">' + esc(M.meta.org) + '</p><h1>' + esc(M.mission.headline) + '</h1><p class="body">' + esc(M.mission.body) + '</p><div class="principles">' +
    M.mission.principles.map(function (p) { return '<div class="p"><b>' + esc(p[0]) + "</b><span>" + esc(p[1]) + "</span></div>"; }).join("") + "</div></div>";
  h += '<div class="statusbox"><div class="card cell"><div class="k">Just finished</div><div class="v">' + esc(s.now.title) + '</div><div class="d">' + esc(s.now.detail) + '</div></div>' +
    '<div class="card cell"><div class="k">Next action</div><div class="v">' + esc(s.next.title) + '</div><div class="d">' + esc(s.next.detail) + '</div></div>' +
    '<div class="card cell"><div class="k">Waiting on ' + esc(clientName()) + '</div><ul>' + kenNow().map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul><a class="small" href="#/ken?urg=now">Inputs needed →</a></div>' +
    '<div class="card cell"><div class="k">Waiting on you</div><ul>' + s.waiting_you.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul><a class="small" href="#/checklist">Checklist →</a></div></div></div>';
  h += '<div class="changes card"><div class="in"><h2>Latest changes</h2><dl>' + s.changes.map(function (c) { return "<dt>" + esc(c[0]) + "</dt><dd>" + esc(c[1]) + "</dd>"; }).join("") + "</dl></div></div>";
  h += '<p class="muted small" style="margin-top:14px">Deal documents, the document archive and the worked example of a real order are kept on the private Build Hub, not in this workspace.</p>';
  if (j && j.steps && j.steps.length) {
  h += '<div class="journey"><p class="eyebrow">How it works</p><h2>Follow one sales order through the whole system</h2><p class="intro">' + esc(j.intro) + '</p>';
  h += '<div class="strip">' + j.steps.map(function (st, i) { return '<button data-go="ch-' + st.id + '"><i>' + (i + 1) + "</i>" + esc(st.title) + "</button>"; }).join("") + "</div>";
  j.steps.forEach(function (st, i) {
    h += '<section class="chapter" id="ch-' + st.id + '"><div class="num">' + (i + 1) + '</div><div><h3>' + esc(st.title) + '</h3><div class="who">' + esc(st.who) + '</div><p class="body">' + esc(st.body) + '</p>' +
      '<div class="learn"><b>Worth knowing.</b> ' + esc(st.learn) + '</div>' +
      '<div class="mini">' + st.nodes.map(function (id, k) { var n = NODE[id]; return (k ? '<span class="arrow">→</span>' : "") + '<a class="chip link" href="#/map?focus=' + esc(id) + '">' + esc(n ? n.label : id) + "</a>"; }).join("") + '<a class="chip link" href="#/map?trace=sales_order">See on the map</a></div>' +
      '<div class="links">' + st.links.map(function (l) { return '<a href="' + esc(l[1]) + '">' + esc(l[0]) + " →</a>"; }).join("") + "</div></div></section>";
  });
  h += '</div>';
  }
  h += '<footer class="page">Legacy Build Hub · regenerated at the end of every working session · ' + esc(M.meta.updated) + "</footer></div>";
  return h;
};
P.home.after = function () {
  $$(".strip button").forEach(function (b) { b.addEventListener("click", function () { var el = document.getElementById(b.getAttribute("data-go")); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }); });
  var btns = $$(".strip button"), chs = $$(".chapter");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { var id = e.target.id; btns.forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-go") === id); }); } }); }, { rootMargin: "-30% 0px -55% 0px" });
    chs.forEach(function (c) { io.observe(c); });
  }
};

/* ---- map ---- */
var COLS = [
  { kind: "source", title: "Where documents come from", x: 20, w: 224 },
  { kind: "workflow", title: "n8n workflows", x: 294, w: 250 },
  { kind: "table", title: "Airtable tables (one base)", x: 594, w: 226 },
  { kind: "output", title: "What comes out", x: 870, w: 226 },
  { kind: "person", title: "People", x: 1146, w: 204 }
];
var NH = 46, GAP = 16, TOP = 46;
function layout() {
  var pos = {}, perCol = {};
  M.nodes.forEach(function (n) { (perCol[n.col] = perCol[n.col] || []).push(n); });
  var maxH = 0;
  Object.keys(perCol).forEach(function (c) {
    var col = COLS[c];
    perCol[c].forEach(function (n, i) { pos[n.id] = { x: col.x, y: TOP + i * (NH + GAP), w: col.w, h: NH }; });
    maxH = Math.max(maxH, TOP + perCol[c].length * (NH + GAP));
  });
  return { pos: pos, height: maxH + 10, width: 1370 };
}
function edgePath(a, b, sameColIndex) {
  var ay = a.y + a.h / 2, by = b.y + b.h / 2;
  if (b.x > a.x + a.w - 1) { var x1 = a.x + a.w, x2 = b.x, mx = (x1 + x2) / 2; return "M" + x1 + "," + ay + " C" + mx + "," + ay + " " + mx + "," + by + " " + x2 + "," + by; }
  if (Math.abs(b.x - a.x) < 2) { var xr = a.x + a.w, bulge = 44 + (sameColIndex % 3) * 14; return "M" + xr + "," + ay + " C" + (xr + bulge) + "," + ay + " " + (xr + bulge) + "," + by + " " + xr + "," + by; }
  var x1b = a.x, x2b = b.x + b.w, mxb = (x1b + x2b) / 2; return "M" + x1b + "," + ay + " C" + mxb + "," + ay + " " + mxb + "," + by + " " + x2b + "," + by;
}
var MapState = { lens: "all", trace: null, selected: null };
P.map = function (param, q) {
  if (q.lens) MapState.lens = q.lens; if (q.trace) { MapState.trace = q.trace; } if (q.focus) MapState.selected = q.focus;
  var L = layout();
  var lens = M.lenses.filter(function (l) { return l.id === MapState.lens; })[0] || M.lenses[0];
  var svg = '<svg viewBox="0 0 ' + L.width + " " + L.height + '" id="mapsvg" role="img" aria-label="Project map"><defs>' +
    ["writes", "reads", "calls", "triggers", "error", "produces", "sends", "flow", "feeds", "maintains"].map(function (t) { return '<marker id="mk-' + t + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" class="mkp t-' + t + '"/></marker>'; }).join("") + "</defs>";
  COLS.forEach(function (c) { svg += '<text class="colhead" x="' + (c.x + 2) + '" y="26">' + esc(c.title) + "</text>"; });
  var sameIdx = 0;
  M.edges.forEach(function (e, i) {
    var a = L.pos[e.from], b = L.pos[e.to]; if (!a || !b) return;
    var vis = lens.types.indexOf(e.type) >= 0 && lens.kinds.indexOf(NODE[e.from].kind) >= 0 && lens.kinds.indexOf(NODE[e.to].kind) >= 0;
    if (Math.abs(a.x - b.x) < 2) sameIdx++;
    svg += '<path class="e t-' + esc(e.type) + '" data-i="' + i + '" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '" d="' + edgePath(a, b, sameIdx) + '" marker-end="url(#mk-' + esc(e.type) + ')"' + (vis ? "" : " hidden") + "><title>" + esc(NODE[e.from].label + " " + e.type + " " + NODE[e.to].label + (e.label ? " · " + e.label : "")) + "</title></path>";
  });
  M.nodes.forEach(function (n) {
    var p = L.pos[n.id], vis = lens.kinds.indexOf(n.kind) >= 0;
    var dotColor = { done: "var(--green)", live: "var(--green)", seeded: "var(--green)", next: "var(--amber)", planned: "var(--slate)", proposed: "var(--slate)", phase3: "var(--slate)", partial: "var(--wine)", placeholder: "var(--wine)", person: "var(--line)" }[n.status] || "var(--muted)";
    svg += '<g class="n k-' + esc(n.kind) + '" data-id="' + esc(n.id) + '" transform="translate(' + p.x + "," + p.y + ')" tabindex="0" role="button"' + (vis ? "" : " hidden") + '><rect width="' + p.w + '" height="' + p.h + '"/>' +
      '<circle class="dot" cx="14" cy="' + (p.h / 2) + '" r="4" fill="' + dotColor + '"/>' +
      '<text x="26" y="19">' + esc(n.label) + '</text><text class="sub" x="26" y="35">' + esc(n.sub) + "</text></g>";
  });
  svg += "</svg>";
  var h = '<div class="page wide"><div class="pagehead"><p class="eyebrow">Project map</p><h1>How everything connects</h1><p class="lede">Documents come in on the left, workflows read and route them, tables hold what was read, outputs go to people. Hover anything to see its neighbours; click to pin it and read about it. Lenses hide what you are not asking about; traces walk one document through.</p></div>';
  h += '<div class="maptools"><div class="grp"><span class="lbl">Lens</span>' + M.lenses.map(function (l) { return '<button class="btn' + (l.id === MapState.lens ? " on" : "") + '" data-lens="' + l.id + '">' + esc(l.label) + "</button>"; }).join("") + '</div><div class="grp"><span class="lbl">Trace</span>' + Object.keys(M.traces).map(function (k) { return '<button class="btn' + (MapState.trace === k ? " on" : "") + '" data-trace="' + k + '">' + esc(M.traces[k].label) + "</button>"; }).join("") + '<button class="btn" data-clear="1">Clear</button></div></div>';
  h += '<div class="mapwrap"><div><div class="card mapcard">' + svg + '</div><div class="maphint">Tight window? The map scrolls sideways inside its frame — drag or shift-scroll to see the right-hand columns.</div><div class="legend"><span><i style="border-color:var(--oak)"></i>writes</span><span><i class="dash" style="border-color:var(--slate)"></i>reads</span><span><i style="border-color:var(--wine)"></i>calls</span><span><i style="border-color:var(--green)"></i>triggers</span><span><i style="border-color:var(--amber)"></i>produces</span><span><i class="dash"></i>sends / feeds</span><span><i class="dot"></i>errors → WF-00</span><span>● status: <b style="color:var(--green)">done</b> · <b style="color:var(--amber)">next</b> · <b style="color:var(--wine)">placeholder</b> · <b style="color:var(--slate)">planned</b></span></div></div>';
  h += '<aside class="panel card" id="mappanel"><div class="in" id="panelin"></div></aside></div></div>';
  return h;
};
function neighbors(id) {
  var ns = {}, es = [];
  M.edges.forEach(function (e, i) { if (e.from === id) { ns[e.to] = 1; es.push(i); } if (e.to === id) { ns[e.from] = 1; es.push(i); } });
  return { nodes: ns, edges: es };
}
function paintFocus(id) {
  var svg = $("#mapsvg"); if (!svg) return;
  svg.classList.remove("trace-on");
  var nb = id ? neighbors(id) : null;
  $$(".n", svg).forEach(function (g) { var nid = g.getAttribute("data-id"); g.classList.remove("dim", "lit", "focus"); if (nb) { if (nid === id) g.classList.add("focus"); else if (nb.nodes[nid]) g.classList.add("lit"); else g.classList.add("dim"); } });
  $$(".e", svg).forEach(function (p) { var i = +p.getAttribute("data-i"); p.classList.remove("dim", "lit"); if (nb) { if (nb.edges.indexOf(i) >= 0) p.classList.add("lit"); else p.classList.add("dim"); } });
}
function paintTrace(key) {
  var svg = $("#mapsvg"); if (!svg) return; var t = M.traces[key]; if (!t) return;
  $$(".n,.e", svg).forEach(function (el) { el.classList.remove("dim", "lit", "focus"); el.style.transitionDelay = ""; });
  svg.classList.add("trace-on");
  var path = t.path;
  path.forEach(function (id, k) { var g = svg.querySelector('.n[data-id="' + id + '"]'); if (g) { g.hidden = false; g.classList.add("lit"); g.style.transitionDelay = (k * 0.12) + "s"; } });
  for (var k = 0; k < path.length - 1; k++) {
    (function (a, b, k) {
      $$(".e", svg).forEach(function (p) { var f = p.getAttribute("data-from"), to = p.getAttribute("data-to"); if ((f === a && to === b) || (f === b && to === a)) { p.hidden = false; p.classList.add("lit"); p.style.transitionDelay = (k * 0.12) + "s"; } });
    })(path[k], path[k + 1], k);
  }
  var pin = $("#panelin");
  if (pin) pin.innerHTML = '<h3>' + esc(t.label) + '</h3><p class="sub">' + path.length + ' stops</p><div class="conn"><h4>Path</h4>' + path.map(function (id, k) { var n = NODE[id]; return '<a href="#/map?focus=' + esc(id) + '">' + (k + 1) + ". " + esc(n.label) + " <small>" + esc(n.sub) + "</small></a>"; }).join("") + "</div>";
}
function panelFor(id) {
  var n = NODE[id], pin = $("#panelin"); if (!pin) return;
  if (!n) { pin.innerHTML = '<h3>Pick anything</h3><p class="desc muted">Hover to see what a piece touches. Click to pin it here with its status, what it reads and writes, who it calls, and a link to its page.</p><div class="conn"><h4>Start with</h4><a href="#/map?focus=WF-02">WF-02 — the front door</a><a href="#/map?focus=sales_order_header">sales_order_header — the table you build next</a><a href="#/map?trace=sales_order">Trace a sales order</a></div>'; return; }
  var groups = {};
  M.edges.forEach(function (e) {
    if (e.from === id) { (groups[e.type] = groups[e.type] || []).push({ n: NODE[e.to], dir: "→", label: e.label }); }
    if (e.to === id) { var key = ({ writes: "written by", reads: "read by", calls: "called by", triggers: "triggered by", produces: "produced by", sends: "receives from", flow: "receives from", feeds: "fed by", maintains: "maintained by", error: "catches errors from" })[e.type] || e.type; (groups[key] = groups[key] || []).push({ n: NODE[e.from], dir: "←", label: e.label }); }
  });
  var order = ["triggers", "reads", "writes", "calls", "produces", "sends", "feeds", "error", "flow", "maintains", "triggered by", "written by", "read by", "called by", "produced by", "receives from", "fed by", "maintained by", "catches errors from"];
  var conn = Object.keys(groups).sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); }).map(function (k) {
    return "<h4>" + esc(k) + "</h4>" + groups[k].map(function (x) { return '<a href="#/map?focus=' + esc(x.n.id) + '">' + esc(x.n.label) + (x.label ? " <small>· " + esc(x.label) + "</small>" : "") + "</a>"; }).join("");
  }).join("");
  var pg = pageFor(n);
  pin.innerHTML = '<div class="row" style="justify-content:space-between"><span class="chip kind">' + esc(n.kind) + "</span>" + (n.status !== "person" ? chip(n.status, statusLabel(n.status)) : "") + '</div><h3 style="margin-top:8px">' + esc(n.label) + '</h3><p class="sub">' + esc(n.sub) + '</p><p class="desc">' + esc(n.desc) + '</p><div class="conn">' + (conn || '<p class="muted small">No connections drawn yet.</p>') + "</div>" + (pg && pg.indexOf("#/map") !== 0 ? '<a class="open" href="' + pg + '">Open its page →</a>' : "");
}
P.map.after = function (param, q) {
  var svg = $("#mapsvg"); if (!svg) return;
  var pinned = MapState.selected || null;
  panelFor(pinned); if (pinned) paintFocus(pinned);
  if (MapState.trace && !q.focus) paintTrace(MapState.trace);
  svg.addEventListener("mouseover", function (e) { var g = e.target.closest(".n"); if (g && !MapState.trace) paintFocus(g.getAttribute("data-id")); });
  svg.addEventListener("mouseleave", function () { if (!MapState.trace) paintFocus(pinned); });
  svg.addEventListener("click", function (e) { var g = e.target.closest(".n"); if (!g) return; var id = g.getAttribute("data-id"); MapState.trace = null; MapState.selected = pinned = id; paintFocus(id); panelFor(id); $$(".maptools [data-trace]").forEach(function (b) { b.classList.remove("on"); }); history.replaceState(null, "", "#/map?focus=" + encodeURIComponent(id)); });
  svg.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { var g = e.target.closest(".n"); if (g) { e.preventDefault(); g.dispatchEvent(new MouseEvent("click", { bubbles: true })); } } });
  $$(".maptools [data-lens]").forEach(function (b) { b.addEventListener("click", function () { MapState.lens = b.getAttribute("data-lens"); MapState.trace = null; location.hash = "#/map?lens=" + MapState.lens + (MapState.selected ? "&focus=" + MapState.selected : ""); }); });
  $$(".maptools [data-trace]").forEach(function (b) { b.addEventListener("click", function () { MapState.trace = b.getAttribute("data-trace"); MapState.selected = null; MapState.lens = "all"; location.hash = "#/map?trace=" + MapState.trace; }); });
  var cl = $(".maptools [data-clear]"); if (cl) cl.addEventListener("click", function () { MapState.trace = null; MapState.selected = null; location.hash = "#/map?lens=" + MapState.lens; });
  if (pinned) { var g = svg.querySelector('.n[data-id="' + pinned + '"]'); if (g && g.scrollIntoView) { try { g.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) { } } }
};

/* ---- lifecycle ---- */
P.lifecycle = function () {
  var h = '<div class="page wide"><div class="pagehead"><p class="eyebrow">Deal lifecycle</p><h1>From sales order to funded — Ken\'s stages, Legacy\'s documents</h1><p class="lede">The STATUS column in Ken\'s SharePoint list was never about delivery. It is the deal moving through lender approval, client signature and funding. Each stage has a document Legacy sends and a workflow that will produce it.</p></div><div class="stages">';
  M.lifecycle.forEach(function (s, i) {
    h += '<div class="card stage"><span class="idx">' + (i + 1) + "</span>" + (s.code ? '<div class="code">' + esc(s.code) + "</div>" : '<div class="code muted">—</div>') + "<h3>" + esc(s.stage) + '</h3><div class="who">' + esc(s.who) + '</div><p class="note">' + esc(s.note) + "</p>" + (s.docs.length ? '<div class="docs">' + s.docs.map(function (d) { return '<span class="chip kind">' + esc(d) + "</span>"; }).join("") + "</div>" : "") + '<div class="wf">' + esc(s.wf) + "</div></div>";
  });
  h += '</div><div class="sect"><h2>Two lifecycles, not one</h2><p class="muted" style="max-width:70ch">The <b>deal</b> moves RFLA → NOLA → PRE-FUNDING → InFunding → FINAL and lives on <a href="#/data/lease_master">lease_master</a>. Each <b>order</b> under it has its own document flags — CTAN sent, FCBR sent, PRE-COMMENCE — and its own delivery status, on <a href="#/data/sales_order_header">sales_order_header</a>. Ken\'s <b>TYPE</b> (NEW, CR-1…CR-4, A2A, Cancel &amp; Rollover, NEW + LEASEBACK) describes the deal and is kept as his single list.</p></div></div>';
  return h;
};

/* ---- workflows ---- */
function wfCard(n) {
  var d = M.workflow_details[n.id] || {};
  return '<div class="card wfcard"><div class="in"><div class="row" style="justify-content:space-between">' + chip(n.status, statusLabel(n.status)) + '<span class="muted small mono">' + esc(d.phase || "") + '</span></div><h3 style="margin-top:8px"><a href="#/workflows/' + esc(n.id) + '">' + esc(n.label) + '</a></h3><div class="sub">' + esc(n.sub) + '</div><p class="desc">' + esc(n.desc) + '</p><div class="foot"><a class="small" href="#/map?focus=' + esc(n.id) + '">On the map</a><a class="small" href="#/workflows/' + esc(n.id) + '">Detail →</a></div></div></div>';
}
P.workflows = function (param) {
  var wfs = M.nodes.filter(function (n) { return n.kind === "workflow"; });
  if (param) {
    var n = NODE[param]; if (!n) return P.notfound();
    var d = M.workflow_details[n.id] || {};
    var reads = [], writes = [], calls = [], calledBy = [], produces = [];
    M.edges.forEach(function (e) { if (e.from === n.id) { if (e.type === "reads") reads.push(e); if (e.type === "writes") writes.push(e); if (e.type === "calls") calls.push(e); if (e.type === "produces") produces.push(e); } if (e.to === n.id && (e.type === "calls" || e.type === "triggers")) calledBy.push(e); });
    var lst = function (arr) { return arr.length ? arr.map(function (e) { var o = NODE[e.to === n.id ? e.from : e.to]; return '<a class="chip link" href="' + pageFor(o) + '">' + esc(o.label) + "</a>"; }).join(" ") : '<span class="empty">none</span>'; };
    var shape = (d.shape || []).map(function (s, i) { if (s === "|") return '<span class="br"></span>'; return (i && (d.shape[i - 1] !== "|") ? '<span class="ar">→</span>' : "") + '<span class="nd">' + esc(s) + "</span>"; }).join("");
    return '<div class="page"><div class="crumbs"><a href="#/workflows">Workflows</a> / ' + esc(n.id) + '</div><div class="pagehead"><div class="row">' + chip(n.status, statusLabel(n.status)) + '<span class="muted small mono">' + esc(d.phase || "") + '</span></div><h1 style="margin-top:8px">' + esc(n.label) + '</h1><p class="lede">' + esc(n.desc) + '</p></div>' +
      '<div class="card"><div class="in"><h3>Node shape</h3><div class="shape">' + (shape || '<span class="empty">Not designed yet</span>') + "</div></div></div>" +
      '<div class="sect cards"><div class="card"><div class="in"><h3>Reads</h3><div class="row" style="margin-top:8px">' + lst(reads) + '</div></div></div><div class="card"><div class="in"><h3>Writes</h3><div class="row" style="margin-top:8px">' + lst(writes) + '</div></div></div><div class="card"><div class="in"><h3>Calls</h3><div class="row" style="margin-top:8px">' + lst(calls) + '</div></div></div><div class="card"><div class="in"><h3>Started by</h3><div class="row" style="margin-top:8px">' + lst(calledBy) + '</div></div></div>' + (produces.length ? '<div class="card"><div class="in"><h3>Produces</h3><div class="row" style="margin-top:8px">' + lst(produces) + "</div></div></div>" : "") + "</div>" +
      '<div class="sect"><h2>What tripped us here</h2>' + ((d.gotchas || []).length ? '<ul class="list">' + d.gotchas.map(function (g) { return "<li>" + esc(g) + "</li>"; }).join("") + "</ul>" : '<p class="empty">Nothing yet.</p>') + "</div>" +
      '<div class="sect card"><div class="in"><h3>Next for this workflow</h3><p style="margin-top:6px">' + esc(d.next || "—") + '</p><p class="small" style="margin-top:10px"><a href="#/map?focus=' + esc(n.id) + '">See it on the map →</a></p></div></div></div>';
  }
  return '<div class="page wide"><div class="pagehead"><p class="eyebrow">Workflows</p><h1>Eleven small workflows, one job each</h1><p class="lede">Hub-and-spoke: focused workflows call shared services instead of duplicating logic. Nothing writes to a business table without WF-08 saying yes; nothing fails without WF-09 or WF-00 leaving a row.</p></div><div class="cards">' + wfs.map(wfCard).join("") + "</div></div>";
};

/* ---- data model ---- */
P.data = function (param) {
  var tables = M.nodes.filter(function (n) { return n.kind === "table"; });
  if (param) {
    var n = NODE[param], spec = M.tables[param]; if (!n || !spec) return P.notfound();
    var writers = [], readers = [];
    M.edges.forEach(function (e) { if (e.to === n.id && (e.type === "writes" || e.type === "maintains")) writers.push(NODE[e.from]); if (e.to === n.id && e.type === "reads") readers.push(NODE[e.from]); });
    var links = spec.fields.filter(function (f) { return /Link →/.test(f[1]); }).map(function (f) { return f[1].replace("Link → ", ""); });
    return '<div class="page"><div class="crumbs"><a href="#/data">Data model</a> / ' + esc(n.id) + '</div><div class="pagehead"><div class="row">' + chip(n.status, statusLabel(n.status)) + '<span class="muted small">' + esc(spec.status) + '</span></div><h1 class="mono" style="margin-top:8px;font-size:26px">' + esc(n.label) + '</h1><p class="lede">' + esc(n.desc) + '</p></div>' +
      '<div class="cards"><div class="card"><div class="in"><h3>Written by</h3><div class="row" style="margin-top:8px">' + (writers.length ? writers.map(function (w) { return '<a class="chip link" href="' + pageFor(w) + '">' + esc(w.label) + "</a>"; }).join("") : '<span class="muted small">' + esc(spec.written_by) + "</span>") + '</div></div></div><div class="card"><div class="in"><h3>Read by</h3><div class="row" style="margin-top:8px">' + (readers.length ? readers.map(function (w) { return '<a class="chip link" href="' + pageFor(w) + '">' + esc(w.label) + "</a>"; }).join("") : '<span class="empty">no readers drawn</span>') + '</div></div></div><div class="card"><div class="in"><h3>Links to</h3><div class="row" style="margin-top:8px">' + (links.length ? links.map(function (l) { var t = l.split(" ")[0]; return '<a class="chip link" href="#/data/' + esc(t) + '">' + esc(l) + "</a>"; }).join("") : '<span class="empty">—</span>') + "</div></div></div></div>" +
      '<div class="sect card"><div class="in"><h3>Fields</h3><p class="muted small" style="margin:4px 0 10px">Names and types are exact — build Airtable from this list, top to bottom. Formula fields last.</p><div class="tblwrap"><table class="t"><thead><tr><th>Field</th><th>Type</th><th>Notes / options</th></tr></thead><tbody>' + spec.fields.map(function (f) { return '<tr><td class="mono">' + esc(f[0]) + "</td><td>" + esc(f[1]) + "</td><td>" + esc(f[2]) + "</td></tr>"; }).join("") + '</tbody></table></div></div></div><p class="small" style="margin-top:14px"><a href="#/map?focus=' + esc(n.id) + '">See it on the map →</a></p></div>';
  }
  return '<div class="page wide"><div class="pagehead"><p class="eyebrow">Data model</p><h1>One base, thirteen tables</h1><p class="lede">Three master tables people maintain, ten operational tables workflows write. Operational tables are created just-in-time, alongside the workflow that first writes to them. Click a table for its field spec.</p></div><div class="cards">' +
    tables.map(function (n) { var spec = M.tables[n.id] || { fields: [] }; var links = spec.fields.filter(function (f) { return /Link →/.test(f[1]); }).map(function (f) { return f[1].replace("Link → ", "").split(" ")[0]; }); return '<div class="card wfcard"><div class="in"><div class="row" style="justify-content:space-between">' + chip(n.status, statusLabel(n.status)) + '<span class="muted small">' + spec.fields.length + ' fields</span></div><h3 class="mono" style="margin-top:8px;font-size:15px"><a href="#/data/' + esc(n.id) + '">' + esc(n.label) + '</a></h3><div class="sub">' + esc(n.sub) + " · written by " + esc(spec.written_by || "") + '</div><p class="desc">' + esc(n.desc) + "</p>" + (links.length ? '<div class="row" style="margin-top:10px">' + links.map(function (l) { return '<a class="chip link" href="#/data/' + esc(l) + '">→ ' + esc(l) + "</a>"; }).join("") + "</div>" : "") + "</div></div>"; }).join("") + "</div></div>";
};

/* ---- people ---- */
P.people = function () {
  return '<div class="page wide"><div class="pagehead"><p class="eyebrow">People &amp; roles</p><h1>Who touches the system</h1><p class="lede">Four people at Legacy, one builder, and the roles from Ken\'s SOP matrix that the gates and alerts are routed to. The name-to-role mapping is Ken\'s to confirm.</p></div><div class="cards">' +
    M.people.map(function (p) { return '<div class="card"><div class="in"><h3>' + esc(p.name) + '</h3><div class="muted small" style="margin-top:2px">' + esc(p.title) + '</div><p style="margin-top:10px;font-size:14px">' + esc(p.role) + '</p><dl class="kv" style="margin-top:10px"><dt>Gates</dt><dd>' + esc(p.gates) + "</dd><dt>Confirmed</dt><dd>" + (p.confirmed === true ? "yes" : esc(p.confirmed)) + "</dd></dl></div></div>"; }).join("") +
    '</div><div class="sect card"><div class="in"><h3>Roles in Ken\'s SOP matrix</h3><div class="tblwrap" style="margin-top:10px"><table class="t"><thead><tr><th>Role</th><th>Does</th><th>Gates</th><th>Who</th></tr></thead><tbody>' + M.roles.map(function (r) { return "<tr><td><b>" + esc(r.role) + "</b></td><td>" + esc(r.does) + "</td><td>" + esc(r.gates) + "</td><td>" + esc(r.who) + "</td></tr>"; }).join("") + "</tbody></table></div></div></div></div>";
};

/* ---- glossary ---- */
P.glossary = function () {
  return '<div class="page"><div class="pagehead"><p class="eyebrow">Glossary</p><h1>Ken\'s words, and the system\'s</h1><p class="lede">Definitions from the Sep 20 call and Melanie\'s documents first; the build\'s own terms after.</p></div><div class="searchrow"><input type="search" id="gsearch" placeholder="Search terms…" aria-label="Search glossary"></div><div class="glist card" style="margin-top:14px"><div class="in" id="glist">' + glossaryList("") + "</div></div></div>";
};
function glossaryList(q) { q = q.toLowerCase(); var rows = M.glossary.filter(function (g) { return !q || (g.term + " " + g.def).toLowerCase().indexOf(q) >= 0; }); return rows.length ? rows.map(function (g) { return '<div class="g"><b>' + esc(g.term) + '</b><span class="src">' + esc(g.src) + "</span><p>" + esc(g.def) + "</p></div>"; }).join("") : '<p class="empty">No match.</p>'; }
P.glossary.after = function () { var i = $("#gsearch"); if (i) i.addEventListener("input", function () { $("#glist").innerHTML = glossaryList(i.value); }); };

/* ---- gotchas ---- */
P.gotchas = function (param, q) {
  var tags = []; M.gotchas.forEach(function (g) { if (tags.indexOf(g.tag) < 0) tags.push(g.tag); });
  return '<div class="page"><div class="pagehead"><p class="eyebrow">Gotchas</p><h1>The hard-won list</h1><p class="lede">Each of these cost debugging time once. When something breaks, check here first — the two data-shape rules account for most of the project\'s debugging history.</p></div><div class="searchrow"><input type="search" id="gosearch" placeholder="Search…" aria-label="Search gotchas"></div><div class="filters" id="gotags"><button class="btn on" data-tag="">All</button>' + tags.map(function (t) { return '<button class="btn" data-tag="' + esc(t) + '">' + esc(t) + "</button>"; }).join("") + '</div><div class="glist card"><div class="in" id="golist">' + gotchaList("", "") + "</div></div></div>";
};
function gotchaList(tag, q) { q = q.toLowerCase(); var rows = M.gotchas.filter(function (g) { return (!tag || g.tag === tag) && (!q || g.text.toLowerCase().indexOf(q) >= 0); }); return rows.length ? rows.map(function (g) { return '<div class="g">' + chip("kind", g.tag) + "<p>" + esc(g.text) + "</p></div>"; }).join("") : '<p class="empty">No match.</p>'; }
P.gotchas.after = function () { var tag = "", i = $("#gosearch"); var re = function () { $("#golist").innerHTML = gotchaList(tag, i.value); }; i.addEventListener("input", re); $$("#gotags button").forEach(function (b) { b.addEventListener("click", function () { tag = b.getAttribute("data-tag"); $$("#gotags button").forEach(function (x) { x.classList.toggle("on", x === b); }); re(); }); }); };

/* ---- checklist ---- */
function tagHtml(t) { return t === "you" ? chip("you", "on you") : t === "ken" ? chip("ken", clientName()) : t === "new" ? chip("new", "new") : t === "hold" ? chip("hold", "on hold") : ""; }
P.checklist = function (param, q) {
  var done = Store.state.checklist.done;
  var phase = String((q && q.phase) || "2");
  var phases = C.phases || { "2": { title: "Phase 2", lede: "" } };
  var secs = C.sections.filter(function (s) { return String(s.phase || 2) === phase; });
  var cnt = function (list) { var t = 0, d = 0; list.forEach(function (s) { s.items.forEach(function (it) { t++; if (done.indexOf(it.id) >= 0) d++; }); }); return { t: t, d: d }; };
  var all = cnt(secs), pct = all.t ? Math.round(all.d / all.t * 100) : 0;
  var ph = phases[phase] || { title: "Phase " + phase, lede: "" };
  var tabs = Object.keys(phases).sort().map(function (k) { var c = cnt(C.sections.filter(function (s) { return String(s.phase || 2) === k; })); return '<a class="btn' + (k === phase ? " on" : "") + '" href="#/checklist?phase=' + k + '">' + esc(phases[k].title.split(" — ")[0]) + ' <span class="n">' + c.d + "/" + c.t + "</span></a>"; }).join("");
  var h = '<div class="page"><div class="pagehead"><p class="eyebrow">' + esc(ph.title) + '</p><h1>' + (phase === "2" ? "What is done, what is next" : "What comes after the machine can read") + '</h1><p class="lede">' + esc(ph.lede) + '</p></div><div class="kenbar"><div class="grp"><span class="lbl">Phase</span>' + tabs + '</div></div><div class="progress"><div class="bar"><i style="width:' + pct + '%"></i></div><span class="mono">' + all.d + " / " + all.t + '</span></div><p class="savenote">' + esc(Store.note) + "</p>";
  secs.forEach(function (s) {
    var sd = s.items.filter(function (it) { return done.indexOf(it.id) >= 0; }).length;
    h += '<section class="card step" style="margin-top:16px"><div class="head"><span class="no">' + esc(s.step) + "</span><h3>" + esc(s.title) + "</h3>" + (s.statusLabel ? chip(s.status, s.statusLabel) : "") + '<span class="cnt">' + sd + "/" + s.items.length + "</span></div>" + (s.blurb ? '<p class="blurb">' + esc(s.blurb) + "</p>" : "") + "<ul>";
    s.items.forEach(function (it) { h += '<li><label class="item"><input type="checkbox" id="ck-' + esc(it.id) + '" data-id="' + esc(it.id) + '"' + (done.indexOf(it.id) >= 0 ? " checked" : "") + '><span class="box"></span><span class="txt"><span class="lbl">' + esc(it.label) + "</span>" + (it.note ? '<span class="note">' + esc(it.note) + "</span>" : "") + "</span>" + (it.tag ? tagHtml(it.tag) : "") + "</label></li>"; });
    h += "</ul></section>";
  });
  return h + "</div>";
};
P.checklist.after = function () {
  $$('input[type=checkbox][data-id]').forEach(function (cb) { cb.addEventListener("change", function () { var done = Store.state.checklist.done.slice(); var id = cb.getAttribute("data-id"); var k = done.indexOf(id); if (cb.checked && k < 0) done.push(id); if (!cb.checked && k >= 0) done.splice(k, 1); Store.set("checklist", { done: done }); }); });
};

/* ---- ken tracker ---- */
P.ken = function (param, q) {
  var st = Store.state.ken.items || {};
  var K = M.ken_tracker, filt = (q && q.urg) || "all", showDone = !!(q && q.done);
  var all = []; K.groups.forEach(function (g) { g.items.forEach(function (it) { all.push(it); }); });
  var stat = function (it) { return (st[it.id] || { status: "open", note: "" }); };
  var counts = { now: 0, soon: 0, later: 0, open: 0, asked: 0, answered: 0 };
  all.forEach(function (it) { var s = stat(it); counts[s.status] = (counts[s.status] || 0) + 1; if (s.status !== "answered") counts[it.urgency]++; });
  var link = function (u, d) { return "#/ken?urg=" + u + (d ? "&done=1" : ""); };
  var h = '<div class="page"><div class="pagehead"><p class="eyebrow">Inputs needed</p><h1>Inputs needed from ' + esc(clientName()) + '</h1><p class="lede">' + (OPTS.admin ? 'Everything the build is waiting on from ' + esc(clientName()) + ', grouped by what the answer unblocks. Mark an item <i>asked</i> when it goes out and <i>answered</i> when it comes back; put the answer in the note.' : 'Everything the build is waiting on from ' + esc(clientName()) + ', grouped by what each answer unblocks. Reply to any item and it comes straight to Carson.') + '</p></div>';
  h += '<div class="kenbar"><div class="grp"><span class="lbl">Urgency</span>' +
    [["all", "All open"], ["now", "Now"], ["soon", "Soon"], ["later", "Later"]].map(function (o) { var n = o[0] === "all" ? (counts.open + counts.asked) : counts[o[0]]; return '<a class="btn' + (filt === o[0] ? " on" : "") + '" href="' + link(o[0], showDone) + '">' + o[1] + ' <span class="n">' + n + "</span></a>"; }).join("") +
    '</div><div class="grp"><a class="btn' + (showDone ? " on" : "") + '" href="' + link(filt, !showDone) + '">' + (showDone ? "Hide" : "Show") + " answered (" + counts.answered + ')</a>' + (OPTS.admin ? '<button class="btn" id="kencopy" type="button">Copy open items for an email</button>' : '') + '</div></div>';
  h += '<div class="urglegend">' + ["now", "soon", "later"].map(function (u) { return '<span><i class="urg ' + u + '">' + u + "</i> " + esc(K.urgency[u]) + "</span>"; }).join("") + '</div><p class="savenote">' + (OPTS.admin ? esc(Store.note) : '') + "</p>";
  var order = { now: 0, soon: 1, later: 2 };
  K.groups.forEach(function (g) {
    var items = g.items.filter(function (it) { var s = stat(it); if (s.status === "answered" && !showDone) return false; if (filt !== "all" && it.urgency !== filt && s.status !== "answered") return false; if (filt !== "all" && s.status === "answered" && it.urgency !== filt) return false; return true; })
      .sort(function (a, b) { return order[a.urgency] - order[b.urgency]; });
    if (!items.length) return;
    var openN = g.items.filter(function (it) { return stat(it).status !== "answered"; }).length;
    h += '<div class="sect kengroup"><div class="kenhead"><div><h2>' + esc(g.title) + '</h2><p class="why">' + esc(g.why) + '</p></div><span class="chip kind">' + openN + " open</span></div><div class=\"card\"><div class=\"in\">";
    items.forEach(function (it) {
      var s = stat(it);
      var mail = "mailto:carson@jipautomation.com?subject=" + encodeURIComponent("Re: " + it.item) + "&body=" + encodeURIComponent("Question: " + it.item + "\n\nAnswer:\n");
      h += '<div class="kenrow ' + esc(s.status) + '"><div><div class="item"><i class="urg ' + esc(it.urgency) + '">' + esc(it.urgency) + "</i>" + (it.who && it.who !== "Ken" ? '<span class="chip person">' + esc(it.who) + "</span>" : "") + esc(it.item) + '</div><div class="meta"><b>Unblocks:</b> ' + esc(it.unblocks) + " · since " + esc(it.since) + '</div>' +
        (OPTS.admin ? '<textarea data-note="' + esc(it.id) + '" placeholder="Answer / note…">' + esc(s.note) + '</textarea>' : '') + '</div><div>' +
        (OPTS.admin ? '<select data-status="' + esc(it.id) + '">' + ["open", "asked", "answered"].map(function (o) { return '<option value="' + o + '"' + (s.status === o ? " selected" : "") + ">" + o + "</option>"; }).join("") + "</select>" : '<a class="btn" href="' + mail + '">Reply by email</a>') + "</div></div>";
    });
    h += "</div></div></div>";
  });
  h += '<div class="sect"><h2>Cleared</h2><div class="card"><div class="in"><div class="tblwrap"><table class="t"><tbody>' + K.cleared.map(function (c) { return '<tr><td class="mono small" style="white-space:nowrap">' + esc(c.date) + "</td><td>" + esc(c.item) + "</td></tr>"; }).join("") + "</tbody></table></div></div></div></div></div>";
  return h;
};
P.ken.after = function () {
  var save = function (id, patch) { var items = Object.assign({}, Store.state.ken.items || {}); items[id] = Object.assign({ status: "open", note: "" }, items[id] || {}, patch); Store.set("ken", { items: items }); };
  $$("select[data-status]").forEach(function (s) { s.addEventListener("change", function () { save(s.getAttribute("data-status"), { status: s.value }); s.closest(".kenrow").className = "kenrow " + s.value; }); });
  $$("textarea[data-note]").forEach(function (t) { var tm; t.addEventListener("input", function () { clearTimeout(tm); tm = setTimeout(function () { save(t.getAttribute("data-note"), { note: t.value }); }, 900); }); });
  var cp = document.getElementById("kencopy");
  if (cp) cp.addEventListener("click", function () {
    var st = Store.state.ken.items || {}, lines = [];
    M.ken_tracker.groups.forEach(function (g) {
      var open = g.items.filter(function (it) { return (st[it.id] || {}).status !== "answered"; });
      if (!open.length) return;
      lines.push(g.title.toUpperCase());
      open.sort(function (a, b) { return ({ now: 0, soon: 1, later: 2 })[a.urgency] - ({ now: 0, soon: 1, later: 2 })[b.urgency]; }).forEach(function (it, i) { lines.push((i + 1) + ". " + (it.ask || it.item) + (it.who && it.who !== "Ken" ? "  (for " + it.who + ")" : "")); });
      lines.push("");
    });
    var text = lines.join("\n").trim();
    var done = function () { cp.textContent = "Copied — paste into the email"; setTimeout(function () { cp.textContent = "Copy open items for an email"; }, 2500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { window.prompt("Copy this:", text); });
    else window.prompt("Copy this:", text);
  });
};

P.notfound = function () { return '<div class="page"><h1>Not here</h1><p class="muted">That page or item isn\'t in this workspace. <a href="#/home">Back to the Build Hub</a>.</p></div>'; };

/* ---------------- render ---------------- */
var current = null;
function render() {
  if (!M || !OPTS.main) return;
  var r = parseHash(); var page = P[r.page] ? r.page : "notfound";
  current = r;
  OPTS.main.innerHTML = P[page](r.param, r.q);
  if (P[page].after) P[page].after(r.param, r.q);
  if (OPTS.onRender) OPTS.onRender(page, r);
  if (!r.q.focus) window.scrollTo(0, 0);
}
Store.on(function () { var r = parseHash(); if (r.page === "checklist" || r.page === "ken") { if (document.activeElement && document.activeElement.tagName === "TEXTAREA") return; if (OPTS.main && P[r.page]) render(); } });

return {
  init: function (hub, opts) {
    H = hub; M = H.model; C = H.checklist; DOCS = H.docs; NODE = {};
    M.nodes.forEach(function (n) { NODE[n.id] = n; });
    OPTS.main = opts.main; OPTS.onRender = opts.onRender || null; OPTS.admin = !!opts.admin;
    Store.init();
  },
  ready: function () { return !!M; },
  has: function (page) { return !!P[page] && page !== "notfound"; },
  render: render,
  counts: counts,
  titles: TITLES,
  meta: function () { return M ? M.meta : null; },
  model: function () { return M; },
  state: function () { return Store.state; },
  checklist: function () { return C; },
  parseHash: parseHash
};
})();
