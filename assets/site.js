
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
    carson:{name:'Carson',initials:'CJ',salt:'22c9a7bd37020c99d7dbbb88f2caa07b',hash:'9014fdc795a34fdffdcc1899015a27c4d1970bd9afb00ed9a3cb518a6e7a2a7b',hub:'legacy',admin:true}
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
  function hubMessage(title,text){ return '<div class="page"><h1>'+title+'</h1><p class="muted">'+text+'</p></div>'; }
  function wsRoute(){ const dash=$('#dash'); if(!wsUser||dash.hidden)return;
    let page=parseRoute(); const view=$('#view'), hubEl=$('#hubView'), crumb=$('#crumb');
    if(!page){ history.replaceState(null,'','#/dashboard'); page='dashboard'; }
    if(WS_PAGES[page]){ hubEl.hidden=true; view.hidden=false; view.innerHTML=$('#tpl-'+page).innerHTML; fillUser(view,wsUser); crumb.textContent=WS_PAGES[page]; window.scrollTo(0,0); }
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
      if(!WS_PAGES[parseRoute()])wsRoute(); } }
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
