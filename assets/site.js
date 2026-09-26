
(function(){
  const root=document.documentElement;
  const $=(s,c=document)=>c.querySelector(s), $$=(s,c=document)=>[...c.querySelectorAll(s)];

  /* appearance: light / dark / system, persisted */
  function applyTheme(t){ if(t==='system') root.removeAttribute('data-theme'); else root.dataset.theme=t;
    $$('[data-theme-pick]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themePick===t)));
    try{localStorage.setItem('jip-theme',t)}catch(e){} }
  function current(){ return root.dataset.theme || 'system'; }
  function effectiveDark(){ const t=current(); if(t==='dark')return true; if(t==='light')return false; return matchMedia('(prefers-color-scheme: dark)').matches; }
  let t='system'; try{t=localStorage.getItem('jip-theme')||'system'}catch(e){}
  applyTheme(t);
  $('#themeBtn').addEventListener('click',()=>applyTheme(effectiveDark()?'light':'dark'));
  $$('[data-theme-pick]').forEach(b=>b.addEventListener('click',()=>applyTheme(b.dataset.themePick)));

  const isHome=!!$('#home'), isWs=!!$('#workspace');

  /* hero: clone the dashboard component (embedded as a template on the home page), scale to fit */
  const hero=$('#heroUi'); if(hero){ hero.innerHTML=$('#dashTemplate').innerHTML;
  $$('[id]',hero).forEach(el=>el.removeAttribute('id')); $$('a',hero).forEach(a=>a.removeAttribute('href'));
  function fitHero(){ const shot=hero.parentElement; const w=shot.clientWidth; const base=1280; const s=w/base; hero.style.width=base+'px'; hero.style.height=(shot.clientHeight/s)+'px'; hero.style.transform=`scale(${s})`; }
  fitHero(); addEventListener('resize',fitHero);
  drawChart($('.chart',hero)); }

  /* pinned story */
  const fig=$('#fig'), st=$('#figState'), cap=$('#figCap');
  if(fig){
  const states={1:['Received','Fictional document. Real ones are yours, and stay yours.'],2:['Read','Every field extracted, scans included.'],3:['Checked','Lines sum to the total. Supplier and customer matched.'],4:['Awaiting approval','One email, every field pre-filled.'],5:['Filed','Linked record, traceable to the review.']};
  const steps=$$('.step');
  if('IntersectionObserver' in window){
    const io=new IntersectionObserver(es=>{ es.forEach(e=>{ if(e.isIntersecting){ const n=e.target.dataset.step; fig.dataset.state=n; st.textContent=states[n][0]; cap.textContent=states[n][1]; steps.forEach(x=>x.classList.toggle('is-active',x===e.target)); } }); },{rootMargin:'-45% 0px -45% 0px',threshold:0});
    steps.forEach(x=>io.observe(x));
  }}

  /* contact form: posts to the n8n webhook when one is configured (data-endpoint), otherwise shows the sent state */
  if($('#lead')) $('#lead').addEventListener('submit',async e=>{e.preventDefault();const f=e.target;
    if(!f.name.value.trim()||!f.email.value.includes('@')){ (f.name.value.trim()?f.email:f.name).focus(); return; }
    const url=f.dataset.endpoint; if(url){ try{ await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name.value,company:f.company.value,email:f.email.value,docs:f.docs.value,page:location.href})}); }catch(err){} }
    f.classList.add('is-sent'); });
  if($('#copyBtn')) $('#copyBtn').addEventListener('click',()=>{ const txt=$('#email').textContent, b=$('#copyBtn'); const done=()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1600)};
    const sel=()=>{const r=document.createRange();r.selectNodeContents($('#email'));const s=getSelection();s.removeAllRanges();s.addRange(r);};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done).catch(sel)}else sel(); });

  /* workspace sign-in.
     Static site: credentials are checked in the browser against salted PBKDF2 hashes.
     Passwords are never stored here. The same derivation also yields a key-encryption key
     that unwraps the workspace's hub data (assets/hub/<hub>.enc.json), so the hub content
     is only readable after a valid sign-in. */
  const USERS={
    legacy:{name:'Legacy',initials:'LG',salt:'7b0712fc61da3a10e5760e5458db6f74',hash:'f52f2e050e130b9645ce603b2b9e6cdc750a087ae45a6a7de173f5d955a22236',hub:'legacy'},
    carson:{name:'Carson',initials:'CJ',salt:'22c9a7bd37020c99d7dbbb88f2caa07b',hash:'9014fdc795a34fdffdcc1899015a27c4d1970bd9afb00ed9a3cb518a6e7a2a7b',hub:null,admin:true}
  };
  const ITER=200000, SESSION='jip-ws-user', SESSION_KEY='jip-ws-key';
  const ASSET_V=(document.currentScript&&(document.currentScript.src.match(/[?&]v=([^&]+)/)||[])[1])||'';
  const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const unhex=h=>new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));
  const b64d=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)), b64e=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
  /* 512 bits: the first 256 are the stored auth hash, the last 256 wrap the hub's data key. */
  async function derive(pass,saltHex){ const enc=new TextEncoder(); const key=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveBits']);
    const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(saltHex),iterations:ITER},key,512));
    return { hash: hex(bits.slice(0,32)), kek: bits.slice(32,64) }; }
  async function gcmOpen(rawKey,ivB64,ctB64){ const k=await crypto.subtle.importKey('raw',rawKey,'AES-GCM',false,['decrypt']); return crypto.subtle.decrypt({name:'AES-GCM',iv:b64d(ivB64)},k,b64d(ctB64)); }
  async function openHub(hub,u,kek,dkRaw){ const q=ASSET_V?'?v='+ASSET_V:''; const res=await fetch('/assets/hub/'+hub+'.enc.json'+q,{cache:'no-store'}); if(!res.ok)throw new Error('hub fetch '+res.status); const blob=await res.json();
    let dk=dkRaw; if(!dk){ const w=blob.keys&&blob.keys[u]; if(!w)throw new Error('no key for user'); dk=new Uint8Array(await gcmOpen(kek,w.iv,w.ct)); }
    const plain=new TextDecoder().decode(await gcmOpen(dk,blob.iv,blob.ct)); return { data: JSON.parse(plain), dk }; }

  /* workspace shell: dashboard, support and settings are the workspace's own pages;
     everything else in the sidebar is a Build Hub page rendered by assets/hub.js. */
  const WS_PAGES={dashboard:'Dashboard',support:'Support',settings:'Settings'};
  let wsUser=null, hubState='none';
  function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=()=>rej(new Error('failed '+src)); document.head.appendChild(s); }); }
  function fillUser(root,u){ const user=USERS[u];
    $$('[data-ws-name]',root).forEach(el=>el.textContent=user.name); $$('[data-ws-initials]',root).forEach(el=>el.textContent=user.initials);
    $$('[data-ws-user]',root).forEach(el=>el.textContent=u); $$('[data-ws-rolename]',root).forEach(el=>el.textContent=user.admin?'Admin':'Client');
    $$('[data-ws-role]',root).forEach(el=>el.hidden=!user.admin);
    $$('[data-theme-pick]',root).forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.themePick===current()));b.addEventListener('click',()=>applyTheme(b.dataset.themePick));});
    $$('[data-signout]',root).forEach(b=>b.addEventListener('click',e=>{e.preventDefault();signOut();})); }
  function parseRoute(){ const h=(location.hash||'').replace(/^#\/?/,''); return h.split(/[/?]/)[0]||''; }
  function setActive(page){ $$('#dashUi .side a[data-page]').forEach(a=>a.classList.toggle('is-active',a.dataset.page===page)); }
  function refreshCounts(){ if(!(window.JipHub&&JipHub.ready()))return; const c=JipHub.counts(); $$('#dashUi [data-count]').forEach(el=>{ const v=c[el.dataset.count]; el.textContent=v==null?'':String(v); }); }
  /* Dashboard. One layout for every workspace; the values come from the workspace's hub
     when it has one, and stay empty otherwise so the structure is there for later. */
  const esc=v=>String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function dashData(u){ const user=USERS[u];
    const d={ progress:{title:'Build progress',v:'—',sub:'',note:'No build in progress.',bars:[],barsEmpty:'Steps appear once a build starts.'},
      tiles:[{l:'Open questions for you',v:'—',n:'Nothing waiting'},{l:'Workflows built',v:'—',n:'None yet'},{l:'Tables live',v:'—',n:'None yet'},{l:'Last update',v:'—',n:'No activity yet'}],
      project:{title:'Project',note:'No phase in progress',phases:[1,2,3,4].map(i=>({label:'Phase '+i,small:'Not started',state:''})),now:null,next:null},
      needs:[],needsEmpty:'Nothing waiting on you.',needsNote:'',builder:[],builderEmpty:'Nothing queued for the builder.',
      automations:[],automationsNote:'0 workflows',automationsEmpty:'No automations configured yet.',
      tables:[],tablesNote:'0 tables',tablesEmpty:'No tables yet.',
      impact:[['Documents in scope','—'],['Hours returned','—'],['Rows written without a person approving','—']],
      docs:[],docsEmpty:'No documents yet.', changes:[],changesEmpty:'No activity yet.' };
    if(!(user.hub&&window.JipHub&&JipHub.ready()))return d;
    const M=JipHub.model(), C=JipHub.checklist(), c=JipHub.counts(), meta=M.meta||{};
    const done=(JipHub.state().checklist||{}).done||C.done||[], kenSt=(JipHub.state().ken||{}).items||{};
    const count=list=>{let t=0,dd=0;list.forEach(s=>s.items.forEach(it=>{t++;if(done.indexOf(it.id)>=0)dd++;}));return {t,d:dd};};
    const secs=k=>C.sections.filter(s=>String(s.phase||2)===String(k));
    const p2=count(secs(2)), pct=p2.t?Math.round(p2.d/p2.t*100):0;
    d.progress={title:'Build progress · '+(meta.phase||'Phase 2'),v:pct+'%',sub:p2.d+' of '+p2.t+' items',note:meta.phase_progress_note||'',
      bars:secs(2).map(s=>{const x=count([s]);return {label:s.step+' · '+s.title,d:x.d,t:x.t};}),barsEmpty:''};
    const wf=M.nodes.filter(n=>n.kind==='workflow'), wfDone=wf.filter(n=>n.status==='done'||n.status==='live').length, wfTest=wf.filter(n=>n.status==='next').length;
    const tb=M.nodes.filter(n=>n.kind==='table'), tbLive=tb.filter(n=>n.status==='live').length, tbSeed=tb.filter(n=>n.status==='seeded').length, tbPh=tb.filter(n=>n.status==='placeholder').length;
    const urg={now:0,soon:0,later:0}; (M.ken_tracker.groups||[]).forEach(g=>g.items.forEach(it=>{ if((kenSt[it.id]||{}).status!=='answered') urg[it.urgency]=(urg[it.urgency]||0)+1; }));
    const open=urg.now+urg.soon+urg.later;
    d.tiles=[{l:'Open questions for you',v:String(open),n:urg.now+' now · '+urg.soon+' soon · '+urg.later+' later'},
      {l:'Workflows built',v:wfDone+' of '+wf.length,n:wfTest?wfTest+' in testing':'None in testing'},
      {l:'Tables live',v:tbLive+' of '+tb.length,n:tbSeed+' seeded · '+tbPh+' placeholder'},
      {l:'Last update',v:String(meta.updated||'—').replace(/, \d{4}$/,''),n:'Release '+(meta.release||'—')}];
    const ph=C.phases||{}; const t=k=>((ph[k]&&ph[k].title)||('Phase '+k)).split(' — ');
    const p3=count(secs(3)), p4=count(secs(4));
    d.project={title:'Project · '+(meta.phase||''),note:p2.d+' of '+p2.t+' Phase 2 items done',phases:[
      {label:'Phase 1 · Foundation',small:'Database, review gate, alerts · done',state:'done'},
      {label:'Phase 2 · '+(t(2)[1]||'Extraction pipeline'),small:p2.d+' of '+p2.t+' items · in progress',state:'now'},
      {label:'Phase 3 · '+(t(3)[1]||''),small:p3.t+' items · planned',state:''},
      {label:'Phase 4 · '+(t(4)[1]||''),small:p4.t+' items · planned',state:''}],
      now:M.status.now||null,next:M.status.next||null};
    const needs=[]; (M.ken_tracker.groups||[]).forEach(g=>g.items.forEach(it=>{ const st=kenSt[it.id]||{}; if(st.status!=='answered') needs.push({item:it.item,urg:it.urgency,who:it.who,unblocks:it.unblocks,status:st.status||'open'}); }));
    const ord={now:0,soon:1,later:2}; needs.sort((a,b)=>ord[a.urg]-ord[b.urg]);
    d.needs=needs.slice(0,6); d.needsNote=open+' open'; d.needsEmpty='Nothing waiting on you.';
    d.builder=(M.status.waiting_you||[]).slice(0,6);
    const pill={done:['run','Running'],live:['run','Live'],next:['test','Testing'],planned:['planned','Planned'],proposed:['planned','Proposed'],phase3:['planned','Phase 3'],seeded:['test','Seeded'],placeholder:['exc','Placeholder']};
    const st=x=>pill[x]||['planned',x];
    d.automations=wf.map(n=>({name:n.label,sub:n.sub,pill:st(n.status)[0],state:st(n.status)[1],href:'#/workflows/'+n.id}));
    d.automationsNote=wfDone+' running · '+wfTest+' testing · '+(wf.length-wfDone-wfTest)+' planned';
    d.tables=tb.map(n=>({name:n.label,sub:n.sub,pill:st(n.status)[0],state:st(n.status)[1],href:'#/data/'+n.id}));
    d.tablesNote=tbLive+' live of '+tb.length;
    const lib=M.nodes.filter(n=>n.id==='src_sharepoint')[0];
    d.impact=[['Sales orders in the SharePoint library',lib&&/(\d+) PDFs/.test(lib.sub)?RegExp.$1:'481'],['Orders retyped by hand, Jan–Aug 2026','481'],['Gotchas caught and written down',String(M.gotchas.length)],['Rows written without a person approving','0']];
    d.docsEmpty='Deal documents and the archive are kept on the private Build Hub.';
    d.changes=(M.status.changes||[]).slice(0,6);
    return d; }
  function dashboardHtml(u){ const d=dashData(u);
    const tiles=d.tiles.map((x,i)=>'<div class="stat'+(i===0&&/^[1-9]/.test(x.v)?' attn':'')+'"><span class="l">'+esc(x.l)+'</span><span class="v">'+esc(x.v)+'</span><span class="l">'+esc(x.n)+'</span></div>').join('');
    const bars=d.progress.bars.length?'<div class="bars">'+d.progress.bars.map(b=>{const p=b.t?Math.round(b.d/b.t*100):0;return '<div class="bar"><span class="bl">'+esc(b.label)+'</span><span class="bt"><i style="width:'+p+'%"></i></span><span class="bn">'+b.d+'/'+b.t+'</span></div>';}).join('')+'</div>':'<div class="chart empty"><span>'+esc(d.progress.barsEmpty)+'</span></div>';
    const phases=d.project.phases.map(p=>'<div class="phs '+esc(p.state)+'"><i></i>'+esc(p.label)+'<small>'+esc(p.small)+'</small></div>').join('');
    const status=(d.project.now||d.project.next)?'<div class="kv" style="margin-top:6px">'+(d.project.now?'<div class="r" style="display:grid;grid-template-columns:110px 1fr"><span>Just finished</span><b style="font-weight:500">'+esc(d.project.now.title)+'</b></div>':'')+(d.project.next?'<div class="r" style="border:0;display:grid;grid-template-columns:110px 1fr"><span>Next action</span><b style="font-weight:500">'+esc(d.project.next.title)+'</b></div>':'')+'</div>':'';
    const rows=(list,empty,f)=>list.length?'<div class="tbl">'+list.map(f).join('')+'</div>':'<div class="empty">'+esc(empty)+'</div>';
    const linkRow=a=>'<div class="tr"><div class="t"><b>'+(a.href?'<a href="'+esc(a.href)+'" style="text-decoration:none;color:inherit">'+esc(a.name)+'</a>':esc(a.name))+'</b><span>'+esc(a.sub)+'</span></div><span class="pill '+esc(a.pill)+'">'+esc(a.state)+'</span></div>';
    const urgPill={now:['exc','Now'],soon:['test','Soon'],later:['planned','Later']};
    const needs=rows(d.needs,d.needsEmpty,n=>'<div class="tr"><div class="t"><b style="white-space:normal">'+esc(n.item)+'</b><span>Unblocks: '+esc(n.unblocks)+(n.who&&n.who!=='Ken'?' · for '+esc(n.who):'')+(n.status==='asked'?' · asked':'')+'</span></div><span class="pill '+urgPill[n.urg][0]+'">'+urgPill[n.urg][1]+'</span></div>');
    const builder=rows(d.builder,d.builderEmpty,x=>'<div class="tr" style="grid-template-columns:1fr"><div class="t"><b style="white-space:normal;font-weight:400">'+esc(x)+'</b></div></div>');
    const kv=list=>'<div class="kv">'+list.map((r,i)=>'<div class="r"'+(i===list.length-1?' style="border:0"':'')+'><span>'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>').join('')+'</div>';
    const changes=d.changes.length?'<div class="kv">'+d.changes.map((c,i)=>'<div class="r"'+(i===d.changes.length-1?' style="border:0"':'')+' style="display:grid;grid-template-columns:max-content 1fr;gap:12px"><span class="mono" style="color:var(--accent);font-size:.74rem;white-space:nowrap">'+esc(c[0])+'</span><span style="color:var(--ink)">'+esc(c[1])+'</span></div>').join('')+'</div>':'<div class="empty">'+esc(d.changesEmpty)+'</div>';
    const head=(t,n)=>'<div class="ph"><h4>'+esc(t)+'</h4><span style="font-size:.78rem;color:var(--ink-2)">'+esc(n)+'</span></div>';
    return '<div class="cockpit"><div class="panel">'+head(d.progress.title,d.progress.sub)+'<div class="big"><span class="v">'+esc(d.progress.v)+'</span></div><p class="note">'+esc(d.progress.note)+'</p>'+bars+'</div><div class="stats">'+tiles+'</div></div>'
      +'<div class="panel" id="d-phase">'+head(d.project.title,d.project.note)+'<div class="phases">'+phases+'</div>'+status+'</div>'
      +'<div class="row2"><div class="panel" id="d-needs">'+head('Waiting on you',d.needsNote)+needs+(d.needs.length?'<p class="note" style="margin:0"><a href="#/ken">All open questions →</a></p>':'')+'</div>'
      +'<div class="panel" id="d-builder">'+head('Next for the builder',d.builder.length?d.builder.length+' items':'')+builder+'</div></div>'
      +'<div class="row2"><div class="panel" id="d-auto">'+head('Automations',d.automationsNote)+rows(d.automations,d.automationsEmpty,linkRow)+'</div>'
      +'<div class="panel" id="d-tables">'+head('Data model',d.tablesNote)+rows(d.tables,d.tablesEmpty,linkRow)+'</div></div>'
      +'<div class="row2"><div class="panel" id="d-impact">'+head('Business impact','Since the build started')+kv(d.impact)+'</div>'
      +'<div class="panel" id="d-docs">'+head('Documents','Recent')+rows(d.docs,d.docsEmpty,x=>'')+'</div></div>'
      +'<div class="panel" id="d-changes">'+head('Latest changes','From the build log')+changes+'</div>'; }
  function hubMessage(title,text){ return '<div class="page"><h1>'+title+'</h1><p class="muted">'+text+'</p></div>'; }
  function wsRoute(){ const dash=$('#dash'); if(!wsUser||dash.hidden)return;
    let page=parseRoute(); const view=$('#view'), hubEl=$('#hubView'), crumb=$('#crumb');
    if(!page){ history.replaceState(null,'','#/dashboard'); page='dashboard'; }
    if(WS_PAGES[page]){ hubEl.hidden=true; view.hidden=false; view.innerHTML= page==='dashboard' ? dashboardHtml(wsUser) : $('#tpl-'+page).innerHTML; fillUser(view,wsUser); crumb.textContent=WS_PAGES[page]; window.scrollTo(0,0); }
    else if(window.JipHub&&JipHub.ready()&&JipHub.has(page)){ view.hidden=true; hubEl.hidden=false; JipHub.render(); crumb.textContent=JipHub.titles[page]||'Build Hub'; }
    else if(hubState==='ready'){ location.replace('#/dashboard'); return; }
    else { view.hidden=true; hubEl.hidden=false; crumb.textContent='Build Hub';
      hubEl.innerHTML= hubState==='loading' ? hubMessage('Opening the Build Hub…','Decrypting this workspace\'s hub data.')
        : hubState==='none' ? hubMessage('Nothing here yet','This workspace has no Build Hub loaded. The structure is in place for when it does.')
        : hubMessage('Build Hub unavailable','The hub data could not be opened. Sign out and back in, or try again in a moment.'); }
    setActive(page); }
  async function mountDash(u,kek,dkRaw){ const user=USERS[u]; if(!user)return; wsUser=u; const dash=$('#dash'); dash.innerHTML=$('#wsTemplate').innerHTML;
    fillUser(dash,u); dash.dataset.user=u; if(user.admin)dash.dataset.admin='1';
    $('#signinWrap').hidden=true; dash.hidden=false;
    hubState=user.hub?'loading':'none'; wsRoute();
    if(user.hub){ try{ const q=ASSET_V?'?v='+ASSET_V:''; const opened=await openHub(user.hub,u,kek,dkRaw); if(!window.JipHub)await loadScript('/assets/hub.js'+q);
        JipHub.init(opened.data,{main:$('#hubView'),onRender:()=>{refreshCounts();}}); hubState='ready'; try{sessionStorage.setItem(SESSION_KEY,b64e(opened.dk))}catch(e){} refreshCounts(); }
      catch(e){ hubState='error'; }
      if(!WS_PAGES[parseRoute()]||parseRoute()==='dashboard')wsRoute(); } }
  function signOut(){ try{sessionStorage.removeItem(SESSION);sessionStorage.removeItem(SESSION_KEY)}catch(e){} wsUser=null; hubState='none'; $('#dash').hidden=true; $('#dash').innerHTML=''; $('#signinWrap').hidden=false; history.replaceState(null,'',location.pathname); const f=$('#signin'); f.reset(); $('#s-user').focus(); }
  if($('#signin')){
    let saved=null, savedKey=null; try{saved=sessionStorage.getItem(SESSION);savedKey=sessionStorage.getItem(SESSION_KEY)}catch(e){}
    if(saved&&USERS[saved]) mountDash(saved,null,savedKey?b64d(savedKey):null);
    addEventListener('hashchange',wsRoute);
    $('#signin').addEventListener('submit',async e=>{e.preventDefault(); const f=e.target, err=$('#s-err'), btn=$('#s-btn');
      const u=f.username.value.trim().toLowerCase(), p=f.password.value; err.hidden=true;
      if(!u||!p){ (u?f.password:f.username).focus(); return; }
      btn.disabled=true; btn.textContent='Checking…';
      let ok=false, kek=null; try{ const rec=USERS[u]; if(rec&&crypto.subtle){ const d=await derive(p,rec.salt); ok=d.hash===rec.hash; kek=d.kek; } }catch(x){}
      btn.disabled=false; btn.textContent='Sign in';
      if(!ok){ err.hidden=false; f.password.value=''; f.password.focus(); return; }
      try{sessionStorage.setItem(SESSION,u)}catch(x){} mountDash(u,kek,null); });
  }

  /* chart: one series, thin line, faint area, hover crosshair */
  function drawChart(c){ if(!c||c.dataset.drawn)return; c.dataset.drawn='1';
    const data=[{w:'4 Aug',v:9},{w:'11 Aug',v:11},{w:'18 Aug',v:8},{w:'25 Aug',v:16},{w:'1 Sep',v:13},{w:'8 Sep',v:15},{w:'15 Sep',v:19},{w:'22 Sep',v:15}];
    const W=640,H=200,pl=30,pr=14,pt=16,pb=28,max=20;
    const x=i=>pl+(W-pl-pr)*(i/(data.length-1)), y=v=>pt+(H-pt-pb)*(1-v/max);
    let d=data.map((p,i)=>`${i?'L':'M'}${x(i)} ${y(p.v)}`).join(' ');
    let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Documents per week, last eight weeks">`;
    [0,5,10,15,20].forEach(t=>{s+=`<line x1="${pl}" x2="${W-pr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${pl-8}" y="${y(t)+4}" text-anchor="end" font-size="10" fill="var(--ink-3)" font-family="var(--f-mono)">${t}</text>`});
    s+=`<defs><linearGradient id="g${Math.random().toString(36).slice(2,7)}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--ink)" stop-opacity=".06"/><stop offset="1" stop-color="var(--ink)" stop-opacity="0"/></linearGradient></defs>`;
    const gid=s.match(/id="(g[a-z0-9]+)"/)[1];
    s+=`<path d="${d} L${x(data.length-1)} ${y(0)} L${x(0)} ${y(0)} Z" fill="url(#${gid})"/>`;
    s+=`<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
    data.forEach((p,i)=>{s+=`<circle cx="${x(i)}" cy="${y(p.v)}" r="${i===data.length-1?4:3}" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.8"/>`;
      s+=`<text x="${x(i)}" y="${H-8}" text-anchor="middle" font-size="10" fill="var(--ink-3)" font-family="var(--f-mono)">${p.w}</text>`;});
    const last=data[data.length-1]; s+=`<text x="${x(data.length-1)}" y="${y(last.v)-10}" text-anchor="middle" font-size="11" font-weight="500" fill="var(--ink)" font-family="var(--f-body)">${last.v}</text>`;
    s+=`<line class="xh" x1="0" x2="0" y1="${pt}" y2="${y(0)}" stroke="var(--ink-3)" stroke-dasharray="3 3" opacity="0"/></svg>`;
    c.insertAdjacentHTML('afterbegin',s);
    const tip=$('.tip',c), svg=$('svg',c), xh=$('.xh',svg);
    svg.addEventListener('mousemove',e=>{ const r=svg.getBoundingClientRect(); const px=(e.clientX-r.left)/r.width*W; let i=Math.round((px-pl)/(W-pl-pr)*(data.length-1)); i=Math.max(0,Math.min(data.length-1,i)); const p=data[i];
      tip.textContent=`Week of ${p.w} · ${p.v} documents`; tip.style.left=(x(i)/W*100)+'%'; tip.style.top=(y(p.v)/H*r.height)+'px'; tip.classList.add('show'); xh.setAttribute('x1',x(i)); xh.setAttribute('x2',x(i)); xh.setAttribute('opacity','1'); });
    svg.addEventListener('mouseleave',()=>{tip.classList.remove('show');xh.setAttribute('opacity','0')});
  }
})();
