
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

  /* workspace sign-in (placeholder until a login layer exists) */
  if($('#signin')) $('#signin').addEventListener('submit',e=>{e.preventDefault();$('#signinWrap').hidden=true;$('#dash').hidden=false;drawChart($('#dashUi .chart'));});
  $$('#dashUi .side a').forEach(a=>a.addEventListener('click',()=>{$$('#dashUi .side a').forEach(x=>x.classList.remove('is-active'));a.classList.add('is-active')}));

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
