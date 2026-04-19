'use strict';

/* ════════════════════════════════════════════════════
   iDROID OS v7.0
   Storage: GitHub API (JSON file in your repo)
   Fallback: localStorage
════════════════════════════════════════════════════ */

/* ── UTILS ── */
const clamp   = (v,a,b) => Math.max(a,Math.min(b,v));
const today   = () => { const d=new Date(); d.setHours(0,0,0,0); return d; };
const dk      = d  => d.toISOString().slice(0,10);
const addD    = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
const isToday = d  => dk(d)===dk(today());

/* ── LOCAL CONFIG ── */
const CFG_KEY  = 'idroid_cfg_v7';
const DATA_KEY = 'idroid_data_v7';  // local fallback

function getCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
}
function saveCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }

/* ── GITHUB STORAGE ── */
// Data shape in GitHub file:
// { days: { "YYYY-MM-DD": {...} }, media: { games:[], screen:[] }, sha: "..." }

let _ghSha = null;   // current file SHA (needed for updates)
let _data  = null;   // in-memory data cache

function localLoad() {
  try { return JSON.parse(localStorage.getItem(DATA_KEY)) || { days:{}, media:{games:[],screen:[]} }; }
  catch { return { days:{}, media:{games:[],screen:[]} }; }
}
function localSave(data) {
  const d = { ...data }; delete d.sha;
  localStorage.setItem(DATA_KEY, JSON.stringify(d));
}

async function ghLoad() {
  const cfg = getCfg();
  if(!cfg.token || !cfg.repo || !cfg.path) return null;
  try {
    setSyncState('busy','SYNC...');
    const res = await fetch(
      `https://api.github.com/repos/${cfg.repo}/contents/${cfg.path}`,
      { headers:{ 'Authorization':`token ${cfg.token}`, 'Accept':'application/vnd.github.v3+json' } }
    );
    if(res.status===404) {
      // file doesn't exist yet — start fresh
      _ghSha = null;
      setSyncState('ok','GITHUB');
      return { days:{}, media:{games:[],screen:[]} };
    }
    if(!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();
    _ghSha = json.sha;
    const content = JSON.parse(atob(json.content.replace(/\n/g,'')));
    setSyncState('ok','GITHUB');
    return content;
  } catch(e) {
    console.error('GitHub load error:', e);
    setSyncState('error','ERROR');
    return null;
  }
}

async function ghSave(data) {
  const cfg = getCfg();
  if(!cfg.token || !cfg.repo || !cfg.path) {
    localSave(data); return;
  }
  try {
    setSyncState('busy','GUARDANDO...');
    const payload = { ...data }; delete payload.sha;
    const body = {
      message: `iDROID sync ${dk(today())}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2)))),
      ..._ghSha ? { sha: _ghSha } : {}
    };
    const res = await fetch(
      `https://api.github.com/repos/${cfg.repo}/contents/${cfg.path}`,
      {
        method:'PUT',
        headers:{
          'Authorization':`token ${cfg.token}`,
          'Accept':'application/vnd.github.v3+json',
          'Content-Type':'application/json'
        },
        body: JSON.stringify(body)
      }
    );
    if(!res.ok) throw new Error('HTTP '+res.status);
    const result = await res.json();
    _ghSha = result.content.sha;
    localSave(data); // mirror locally
    setSyncState('ok','GITHUB');
  } catch(e) {
    console.error('GitHub save error:', e);
    setSyncState('error','SYNC ERROR');
    localSave(data);
  }
}

function setSyncState(state, label) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  if(dot) dot.className = 'sync-dot ' + state;
  if(lbl) lbl.textContent = label;
}

/* ── DATA ACCESS ── */
function getDay(d) { return _data?.days?.[dk(d)] || null; }
function saveDay(d, dayData) {
  if(!_data) _data = { days:{}, media:{games:[],screen:[]} };
  _data.days[dk(d)] = dayData;
}
function getMedia() { return _data?.media || { games:[], screen:[] }; }
function saveMedia(m) { if(_data) _data.media = m; }

const DEF_DAY = () => ({
  mood:null, energy:null, anxiety:null, mental_clarity:null, introspection:null,
  sleepH:null, sleepQ:null, habits:{}, notes:''
});

/* ── AUTOSAVE ── */
let _saveTimer;
const trigSave = () => {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => doSave(false), 1000);
};

/* ── DATE HEADER ── */
function updateDateHeader() {
  const el = document.getElementById('tb-date');
  if(!el) return;
  const d    = new Date();
  const DAYS = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
  el.textContent = `${DAYS[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

/* ── NAVIGATION ── */
let appView = 'today', curDate = today(), mediaTab = 'games';

function nav(v) {
  appView = v;
  document.querySelectorAll('.tb-nav').forEach(b => b.classList.toggle('on', b.dataset.v===v));
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('on', el.id==='v-'+v));
  if(v==='today') renderToday();
  if(v==='media') renderMedia();
}
document.querySelectorAll('.tb-nav').forEach(b => b.addEventListener('click', ()=>nav(b.dataset.v)));

/* ════════════════════════════════════════
   SCORING ENGINE v3
════════════════════════════════════════ */
function calcScore(data) {
  const h  = data.habits || {};
  const bd = {};

  /* SUEÑO 20pts */
  let slpPts = 0;
  if(data.sleepH != null) {
    const hrs = parseFloat(data.sleepH)||0;
    slpPts =
      (hrs>=7&&hrs<=9)               ? 14 :
      (hrs>=6.5&&hrs<7)||(hrs>9&&hrs<=9.5) ? 11 :
      (hrs>=6&&hrs<6.5)              ?  7 :
      (hrs>=5&&hrs<6)                ?  3 : 1;
    slpPts = clamp(slpPts + (data.sleepQ!=null ? Math.round((data.sleepQ/10)*6) : 2), 0, 20);
  }
  bd.sleep = { pts:slpPts, max:20, cls:'c-t' };

  /* HIDRATACIÓN 8pts */
  const hydPts = Math.round((clamp(parseInt(h.hydration_level)||0,0,10)/10)*8);
  bd.water = { pts:hydPts, max:8, cls:'c-t' };

  /* NUTRICIÓN 18pts */
  let nutPts = 0;
  [['bkf_ate','bkf_prot','bkf_veg','bkf_carb'],
   ['lun_ate','lun_prot','lun_veg','lun_carb'],
   ['din_ate','din_prot','din_veg','din_carb']].forEach(([ate,prot,veg,carb]) => {
    if(h[ate]) { nutPts++; if(h[prot]) nutPts++; if(h[veg]) nutPts++; if(h[carb]) nutPts++; }
  });
  if(h.fruit_today)  nutPts+=2;
  if(h.no_processed) nutPts+=2;
  if(h.nosugar)      nutPts+=1;
  bd.nutrition = { pts:clamp(nutPts,0,18), max:18, cls:'c-g' };

  /* CUERPO 12pts */
  const gPerf = h.gym_perf||'rest';
  let bodyPts = gPerf==='intense'?9:gPerf==='moderate'?7:gPerf==='light'?5:gPerf==='rest'?4:0;
  bodyPts += (h.shower?2:0)+(h.teeth_am?1:0);
  bd.body = { pts:clamp(bodyPts,0,12), max:12, cls:'c-g' };

  /* TRABAJO 12pts */
  const wPerf = h.work_perf||'off';
  const workPts = wPerf==='flow'?12:wPerf==='average'?8:wPerf==='off'?8:3;
  bd.work = { pts:workPts, max:12, cls:'c-a' };

  /* ESTADO MENTAL 10pts */
  let mindPts = 0;
  if(data.mood!=null)           mindPts += Math.round((data.mood/10)*4);
  if(data.mental_clarity!=null) mindPts += Math.round((data.mental_clarity/10)*3);
  if(data.anxiety!=null)        mindPts += Math.round(((10-data.anxiety)/10)*2);
  else                           mindPts += 1;
  if(data.introspection!=null)  mindPts += Math.round((data.introspection/10)*1);
  bd.mind = { pts:clamp(mindPts,0,10), max:10, cls:'c-a' };

  /* SOCIAL 5pts */
  const socPts = {none:0,brief:2,meaningful:4,deep:5}[h.social_q]||0;
  bd.social = { pts:socPts, max:5, cls:'c-t' };

  /* DISCIPLINE BONUS */
  const discBonus = h.noporn ? 8 : 0;

  /* ENTRETENIMIENTO calidad */
  const eCalc = id => {
    if(!h['ent_'+id+'_consumed']) return 0;
    const q = clamp(parseInt(h['ent_'+id+'_q'])||5,1,10);
    return q<=3?-3:q<=5?-1:q<=6?0:q<=8?2:4;
  };
  const entTotal = ['interactive','visual','reading','digital'].reduce((s,id)=>s+eCalc(id),0);
  bd.ent_total = entTotal;

  /* PENALIZACIONES */
  const igMin = parseInt(h.instagram_min)||0;
  const igPen = igMin>120?12:igMin>90?8:igMin>60?5:igMin>30?2:0;
  const alcPen = (parseInt(h.alcohol_drinks)||0)*4;

  bd.ig_penalty  = igPen;
  bd.disc_bonus  = discBonus;

  const bonuses   = discBonus + Math.max(0,entTotal);
  const penalties = igPen + alcPen + Math.abs(Math.min(0,entTotal));

  const base  = slpPts+hydPts+bd.nutrition.pts+bd.body.pts+workPts+bd.mind.pts+socPts;
  const final = clamp(base+bonuses-penalties, 0, 100);

  let grade, gcls;
  if     (final>=93){grade='S+';gcls='r-S';}
  else if(final>=87){grade='S'; gcls='r-S';}
  else if(final>=81){grade='S-';gcls='r-S';}
  else if(final>=75){grade='A+';gcls='r-A';}
  else if(final>=68){grade='A'; gcls='r-A';}
  else if(final>=61){grade='A-';gcls='r-A';}
  else if(final>=53){grade='B+';gcls='r-B';}
  else if(final>=44){grade='B'; gcls='r-B';}
  else if(final>=33){grade='C'; gcls='r-C';}
  else              {grade='D'; gcls='r-D';}

  bd.penalties=penalties; bd.bonuses=bonuses; bd.base=base;
  return {final,grade,gcls,bd};
}

const GRADE_DESC = {
  'S+':'Flawless execution. Big Boss rank.',
  'S': 'Outstanding field performance.',
  'S-':'Excellent mission, minor inefficiencies.',
  'A+':'Strong ops. Primary objectives met.',
  'A': 'Good job. Mission accomplished.',
  'A-':'Above average. Minor friction.',
  'B+':'Solid deployment. Room to improve.',
  'B': 'Mission complete. Acceptable.',
  'C': 'Took damage. Recovery recommended.',
  'D': 'Mission failed. Regroup.'
};

/* ── SECTION ACCORDION ── */
function initSections() {
  document.querySelectorAll('.section-hd').forEach(hd => {
    hd.addEventListener('click', () => {
      const sec = hd.closest('.section');
      const wasOpen = sec.classList.contains('open');
      // close all
      document.querySelectorAll('.section.open').forEach(s => s.classList.remove('open'));
      if(!wasOpen) sec.classList.add('open');
    });
  });
}

/* ── MENTAL CARDS ── */
function updateMentalCards() {
  const g = id => parseInt(document.getElementById('sl-'+id)?.value)||0;
  const mv = g('mood'), av = g('anxiety'), cv = g('clarity'), iv = g('intro');

  const moodInfo  = mv>=9?{d:'EUFÓRICO',c:'var(--grn-hi)'}:mv>=7?{d:'POSITIVO',c:'var(--grn)'}:mv>=5?{d:'ESTABLE',c:'var(--teal)'}:mv>=3?{d:'BAJO',c:'var(--amber)'}:{d:'CRÍTICO',c:'var(--red)'};
  const anxInfo   = av>=8?{d:'ALTO',c:'var(--red)'}:av>=5?{d:'MODERADO',c:'var(--amber)'}:av>=3?{d:'LEVE',c:'var(--teal)'}:{d:'TRANQUILO',c:'var(--grn)'};
  const clarInfo  = cv>=8?{d:'NÍTIDO',c:'var(--teal-hi)'}:cv>=6?{d:'ENFOCADO',c:'var(--teal)'}:cv>=4?{d:'DISPERSO',c:'var(--amber)'}:{d:'BLOQUEADO',c:'var(--red)'};
  const introInfo = iv>=8?{d:'PROFUNDO',c:'var(--gold)'}:iv>=6?{d:'REFLEXIVO',c:'var(--teal)'}:iv>=3?{d:'SUPERFICIAL',c:'var(--text-mid)'}:{d:'AUSENTE',c:'var(--text-dim)'};

  const set = (id,val,info) => {
    const v=document.getElementById('mc-v-'+id), d=document.getElementById('mc-d-'+id);
    if(v){v.textContent=val;v.style.color=info.c;}
    if(d){d.textContent=info.d;d.style.color=info.c;}
  };
  set('mood',mv,moodInfo); set('anx',av,anxInfo); set('clar',cv,clarInfo); set('intro',iv,introInfo);
}

/* ── HYDRATION ── */
function updateHydroUI(val) {
  const fill = document.getElementById('hydro-fill');
  const lbl  = document.getElementById('hydro-lbl');
  if(!fill) return;
  const pct = val*10;
  const info = val>=8?{t:'ÓPTIMA',cls:'st-g',bg:'var(--teal)'}:val>=6?{t:'BUENA',cls:'st-g',bg:'var(--teal)'}:val>=4?{t:'NORMAL',cls:'st-a',bg:'var(--amber)'}:val>=2?{t:'BAJA',cls:'st-a',bg:'var(--amber)'}:{t:'CRÍTICA',cls:'st-r',bg:'var(--red)'};
  fill.style.width=pct+'%';
  fill.style.background=info.bg;
  if(lbl){lbl.textContent=info.t;lbl.className='hydro-label '+info.cls;
    lbl.style.borderColor=info.bg+'80';lbl.style.color=lbl.className.includes('st-g')?'var(--grn)':lbl.className.includes('st-a')?'var(--amber)':'var(--red)';}
}

/* ── INSTAGRAM ── */
function igInfo(min) {
  return min>120?{t:'CRITICAL',cls:'st-r',pen:12}:min>90?{t:'HIGH',cls:'st-a',pen:8}:min>60?{t:'MED',cls:'st-a',pen:5}:min>30?{t:'LOW',cls:'st-a',pen:2}:{t:'CLEAN',cls:'st-g',pen:0};
}
function updateIgUI(min) {
  const st = igInfo(min);
  const vEl=document.getElementById('ig-val'), bEl=document.getElementById('ig-fill');
  const sEl=document.getElementById('ig-status'), pEl=document.getElementById('ig-pen');
  if(vEl) vEl.textContent=min;
  if(bEl){bEl.style.width=Math.min(100,(min/120)*100)+'%';bEl.className='ig-fill'+(min>90?' danger':min>30?' warn':'');}
  if(sEl){sEl.textContent=st.t;sEl.className='digi-st '+st.cls;}
  if(pEl) pEl.textContent=st.pen>0?`−${st.pen} pts`:'';
}

/* ── ENTERTAINMENT ── */
function entInfo(q) {
  const v=parseInt(q)||0;
  if(v===0)return{l:'NO CONSUMIDO',p:'±0',c:'ei-mid'};
  if(v<=3) return{l:'TIEMPO PERDIDO',p:'−3 pts',c:'ei-waste'};
  if(v<=5) return{l:'MEDIOCRE',p:'−1 pt',c:'ei-poor'};
  if(v<=6) return{l:'PASABLE',p:'±0',c:'ei-mid'};
  if(v<=8) return{l:'BUENO',p:'+2 pts',c:'ei-good'};
  return{l:'EXCELENTE',p:'+4 pts',c:'ei-excel'};
}
function updateEntCard(id) {
  const cb=document.getElementById('ent-cb-'+id);
  const sl=document.getElementById('ent-sl-'+id);
  if(!cb||!sl) return;
  const on=cb.checked, q=on?(parseInt(sl.value)||5):0;
  const info=entInfo(q);
  const wrap=document.getElementById('ent-qw-'+id);
  const qnum=document.getElementById('ent-qn-'+id);
  const imp =document.getElementById('ent-imp-'+id);
  const card=document.getElementById('ent-card-'+id);
  const lbl =document.getElementById('ent-lbl-'+id);
  if(wrap) wrap.classList.toggle('vis',on);
  if(card) card.classList.toggle('on',on);
  if(lbl)  lbl.classList.toggle('on',on);
  if(qnum){qnum.textContent=on?q:'—';qnum.style.color=on?(q>=7?'var(--grn-hi)':q>=5?'var(--teal)':'var(--red)'):'var(--text-dim)';}
  if(imp) {imp.className='ent-impact '+info.c;imp.innerHTML=`<span>${info.l}</span><span class="ent-pts">${info.p}</span>`;}
  if(sl)  sl.className=on?(q>=7?'r-g':q>=5?'':'r-r'):'';
}

/* ── SLIDER INIT ── */
function initSl(slId, vlId, val, cls='') {
  const sl=document.getElementById(slId), vl=document.getElementById(vlId);
  if(!sl||!vl) return;
  sl.value=val!=null?val:5; vl.textContent=val!=null?val:'—';
  if(cls) sl.classList.add(cls);
  sl.addEventListener('input',()=>{ vl.textContent=sl.value; updateMentalCards(); trigSave(); });
}

/* ── SECTION STATUS UPDATER ── */
function updateSectionStatus(secId, done) {
  const sec = document.getElementById(secId);
  if(!sec) return;
  const st = sec.querySelector('.section-status');
  if(!st) return;
  st.textContent = done ? '✓ OK' : '—';
  st.classList.toggle('done', done);
}

/* ── SAVE ── */
function doSave(showMsg=true) {
  const el = document.getElementById('v-today');
  if(!el) return;

  const mv = id => {
    const v=document.getElementById('vl-'+id);
    return (v&&v.textContent!=='—') ? parseInt(v.textContent) : null;
  };

  let h = {};
  // Toggles
  el.querySelectorAll('.tag[data-hid],.mbtn[data-hid]').forEach(b => {
    h[b.dataset.hid] = b.classList.contains('on')||b.classList.contains('on-g');
  });
  el.querySelectorAll('select[data-hid]').forEach(s => h[s.dataset.hid]=s.value);

  h.hydration_level = parseInt(document.getElementById('sl-hydration')?.value)||0;
  h.alcohol_drinks  = parseInt(document.getElementById('drinks-val')?.textContent)||0;
  h.instagram_min   = parseInt(document.getElementById('ig-val')?.textContent)||0;
  h.social_q        = el.querySelector('.social-opt.on')?.dataset.v||'none';
  h.noporn          = document.getElementById('disc-card')?.classList.contains('on')||false;

  ['interactive','visual','reading','digital'].forEach(id => {
    h['ent_'+id+'_consumed'] = document.getElementById('ent-cb-'+id)?.checked||false;
    h['ent_'+id+'_q']        = parseInt(document.getElementById('ent-sl-'+id)?.value)||5;
  });

  const data = {
    mood:           mv('mood'),
    energy:         mv('energy'),
    anxiety:        mv('anxiety'),
    mental_clarity: mv('clarity'),
    introspection:  mv('intro'),
    sleepH:         document.getElementById('inp-sleeph')?.value ? parseFloat(document.getElementById('inp-sleeph').value) : null,
    sleepQ:         mv('sleepq'),
    notes:          document.getElementById('inp-notes')?.value||'',
    habits:         h
  };

  saveDay(curDate, data);
  ghSave(_data);       // async push to GitHub
  refreshScore(data);

  // update section statuses
  updateSectionStatus('sec-bio',  data.sleepH!=null);
  updateSectionStatus('sec-ment', data.mood!=null||data.anxiety!=null);
  updateSectionStatus('sec-hyd',  h.hydration_level>0);
  updateSectionStatus('sec-nut',  h.bkf_ate||h.lun_ate||h.din_ate);
  updateSectionStatus('sec-hig',  h.shower||h.teeth_am);
  updateSectionStatus('sec-ig',   true);
  updateSectionStatus('sec-ent',  true);
  updateSectionStatus('sec-soc',  h.social_q!=='none');

  if(showMsg) {
    const msg=document.getElementById('save-msg');
    if(msg){msg.classList.add('show');setTimeout(()=>msg.classList.remove('show'),2500);}
  }
}

/* ── SCORE WIDGET ── */
function refreshScore(data) {
  const el = document.getElementById('score-widget');
  if(!el) return;
  const h = data.habits||{};
  const hasData = data.sleepH || (h.hydration_level||0)>0 || h.bkf_ate || h.lun_ate || h.din_ate;
  if(!hasData) {
    el.innerHTML=`<div class="score-pending">// AWAITING FIELD DATA</div>`;
    return;
  }
  const s = calcScore(data);
  const bar = (lbl,pts,max,cls) => `
    <div class="sbar">
      <span class="sbar-lbl">${lbl}</span>
      <div class="sbar-segs">${Array.from({length:10},(_,i)=>`<div class="seg ${i<Math.round((pts/max)*10)?cls:''}"></div>`).join('')}</div>
      <span class="sbar-n">${pts}</span>
    </div>`;

  const pens=[], bons=[];
  if(s.bd.ig_penalty>0) pens.push(`IG −${s.bd.ig_penalty}`);
  if((h.alcohol_drinks||0)>0) pens.push(`ALC −${(h.alcohol_drinks||0)*4}`);
  if(s.bd.ent_total<0) pens.push(`ENT −${Math.abs(s.bd.ent_total)}`);
  if(s.bd.disc_bonus>0) bons.push(`DISC +${s.bd.disc_bonus}`);
  if(s.bd.ent_total>0)  bons.push(`ENT +${s.bd.ent_total}`);

  el.innerHTML=`
    <div class="score-card">
      <div class="score-top">
        <div class="score-grade ${s.gcls}">${s.grade}</div>
        <div class="score-info">
          <div class="score-pts">${s.final} <small>/ 100</small></div>
          <div class="score-quote">"${GRADE_DESC[s.grade]||''}"</div>
        </div>
      </div>
      <div class="sbars">
        ${bar('SLEEP',s.bd.sleep.pts,20,'c-t')}
        ${bar('H2O',s.bd.water.pts,8,'c-t')}
        ${bar('NUTRI',s.bd.nutrition.pts,18,'c-g')}
        ${bar('BODY',s.bd.body.pts,12,'c-g')}
        ${bar('WORK',s.bd.work.pts,12,'c-a')}
        ${bar('MIND',s.bd.mind.pts,10,'c-a')}
        ${bar('SOCIAL',s.bd.social.pts,5,'c-t')}
      </div>
      <div class="score-modifiers">
        ${pens.length?`<div class="pen-line">⚠ ${pens.join('  |  ')}</div>`:''}
        ${bons.length?`<div class="bon-line">▲ ${bons.join('  |  ')}</div>`:''}
      </div>
      <div class="score-label">MISSION DEBRIEF</div>
    </div>`;
}

/* ════════════════════════════════════════
   RENDER TODAY
════════════════════════════════════════ */
function renderToday() {
  const el    = document.getElementById('v-today');
  const data  = getDay(curDate) || DEF_DAY();
  const h     = data.habits || {};
  const isTod = isToday(curDate);

  const dateStr  = isTod ? 'HOY' : curDate.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'short'}).toUpperCase();
  const dateSub  = isTod ? `CAMPO OPS // REGISTRO ACTIVO` : `CAMPO OPS // ARCHIVO`;

  /* helpers */
  const sl = (id,opts,val) => {
    let s=`<select data-hid="${id}" class="sel">`;
    opts.forEach(o=>s+=`<option value="${o.v}"${val===o.v?' selected':''}>${o.l}</option>`);
    return s+'</select>';
  };

  const tag = (id,lbl,green=false) => {
    const isOn = h[id];
    return `<button class="tag${isOn?(green?' on-g':' on'):''}" data-hid="${id}">${lbl}</button>`;
  };

  const mb = (id,lbl,span=false) => {
    const isAte = id.includes('_ate');
    const ateKey= id.replace(/_prot|_veg|_carb/,'_ate');
    const dis   = (!isAte && !h[ateKey]) ? ' disabled' : '';
    const cls   = h[id] ? (isAte?' on':' on-g') : '';
    return `<button class="mbtn${cls}${span?' span2':''}" data-hid="${id}"${dis}>${lbl}</button>`;
  };

  const igInit   = parseInt(h.instagram_min)||0;
  const igSt     = igInfo(igInit);
  const hydLevel = parseInt(h.hydration_level)||0;

  el.innerHTML = `
    <div class="today-wrap">

      <!-- ══ LEFT COLUMN ══ -->
      <div class="col-left">
        <!-- Date Nav -->
        <div>
          <div class="date-nav">
            <button class="btn-nav" id="d-prev">◄</button>
            <div>
              <div class="date-label">${dateStr}</div>
              <div class="date-sub">${dateSub}</div>
            </div>
            <button class="btn-nav" id="d-next" ${isTod?'disabled':''}>►</button>
          </div>
          ${!isTod?'<div style="text-align:center;margin-top:6px"><button class="btn-nav" id="d-now" style="width:100%">VOLVER A HOY</button></div>':''}
        </div>

        <!-- Score -->
        <div id="score-widget"></div>

        <!-- Notes -->
        <div>
          <div style="font-family:var(--mono);font-size:0.58rem;color:var(--text-dim);letter-spacing:2px;margin-bottom:6px">// FIELD NOTES</div>
          <textarea class="ta" id="inp-notes" rows="4" placeholder="Notas del día...">${data.notes||''}</textarea>
        </div>
      </div>

      <!-- ══ RIGHT COLUMN ══ -->
      <div class="col-right">

        <!-- OBJ.01 BIOMETRÍA -->
        <div class="section${data.sleepH!=null?' open':''}" id="sec-bio">
          <div class="section-hd">
            <span class="section-num">01</span>
            <span class="section-ico">🌙</span>
            <span class="section-title">BIOMETRÍA</span>
            <span class="section-status${data.sleepH!=null?' done':''}" id="st-bio">${data.sleepH!=null?'✓ OK':'—'}</span>
            <span class="section-chevron">▶</span>
          </div>
          <div class="section-body">
            <div class="row">
              <span class="lbl">HORAS SUEÑO</span>
              <input type="number" class="num-inp" id="inp-sleeph" step="0.5" min="0" max="16" value="${data.sleepH||''}">
            </div>
            <div class="row">
              <span class="lbl">CALIDAD SUEÑO</span>
              <input type="range" min="1" max="10" id="sl-sleepq">
              <span class="val-badge" id="vl-sleepq">—</span>
            </div>
            <div class="row">
              <span class="lbl">ENERGÍA</span>
              <input type="range" min="1" max="10" id="sl-energy" class="r-a">
              <span class="val-badge v-t" id="vl-energy">—</span>
            </div>
            <div style="height:10px"></div>
            <div class="row">
              <span class="lbl">TRABAJO</span>
              ${sl('work_perf',[{v:'off',l:'Libre / Finde'},{v:'poor',l:'Distraído'},{v:'average',l:'Normal'},{v:'flow',l:'▲ Deep Work / Flow'}],h.work_perf||'off')}
            </div>
            <div class="row">
              <span class="lbl">GYM / E.F.</span>
              ${sl('gym_perf',[{v:'rest',l:'Descanso'},{v:'missed',l:'Saltado'},{v:'light',l:'Ligero'},{v:'moderate',l:'Moderado'},{v:'intense',l:'▲ Intenso / PR'}],h.gym_perf||'rest')}
            </div>
          </div>
        </div>

        <!-- OBJ.02 ESTADO MENTAL -->
        <div class="section${data.mood!=null||data.anxiety!=null?' open':''}" id="sec-ment">
          <div class="section-hd">
            <span class="section-num">02</span>
            <span class="section-ico">🧠</span>
            <span class="section-title">ESTADO MENTAL</span>
            <span class="section-status${data.mood!=null?' done':''}">${data.mood!=null?'✓ OK':'—'}</span>
            <span class="section-chevron">▶</span>
          </div>
          <div class="section-body">
            <div class="mental-cards">
              <div class="mc"><div class="mc-lbl">ÁNIMO</div><div class="mc-val" id="mc-v-mood" style="color:var(--grn)">${data.mood??'—'}</div><div class="mc-desc" id="mc-d-mood" style="color:var(--grn)">—</div></div>
              <div class="mc"><div class="mc-lbl">ANSIEDAD</div><div class="mc-val" id="mc-v-anx" style="color:var(--grn)">${data.anxiety??'—'}</div><div class="mc-desc" id="mc-d-anx" style="color:var(--grn)">—</div></div>
              <div class="mc"><div class="mc-lbl">CLARIDAD</div><div class="mc-val" id="mc-v-clar" style="color:var(--teal)">${data.mental_clarity??'—'}</div><div class="mc-desc" id="mc-d-clar" style="color:var(--teal)">—</div></div>
              <div class="mc"><div class="mc-lbl">INTROSPECCIÓN</div><div class="mc-val" id="mc-v-intro" style="color:var(--text-dim)">${data.introspection??'—'}</div><div class="mc-desc" id="mc-d-intro" style="color:var(--text-dim)">—</div></div>
            </div>
            <div class="row"><span class="lbl">ÁNIMO</span><input type="range" min="1" max="10" id="sl-mood" class="r-g"><span class="val-badge v-g" id="vl-mood">—</span></div>
            <div class="row"><span class="lbl">ANSIEDAD</span><input type="range" min="1" max="10" id="sl-anxiety" class="r-r"><span class="val-badge v-r" id="vl-anxiety">—</span></div>
            <div class="row"><span class="lbl">CLARIDAD</span><input type="range" min="1" max="10" id="sl-clarity"><span class="val-badge v-t" id="vl-clarity">—</span></div>
            <div class="row"><span class="lbl">INTROSPECCIÓN</span><input type="range" min="1" max="10" id="sl-intro" class="r-a"><span class="val-badge" id="vl-intro">—</span></div>
          </div>
        </div>

        <!-- OBJ.03 HIDRATACIÓN -->
        <div class="section${hydLevel>0?' open':''}" id="sec-hyd">
          <div class="section-hd">
            <span class="section-num">03</span>
            <span class="section-ico">💧</span>
            <span class="section-title">HIDRATACIÓN</span>
            <span class="section-status${hydLevel>=5?' done':''}">${hydLevel>0?hydLevel+'/10':'—'}</span>
            <span class="section-chevron">▶</span>
          </div>
          <div class="section-body">
            <div class="row">
              <span class="lbl">NIVEL 0–10</span>
              <input type="range" min="0" max="10" id="sl-hydration" value="${hydLevel}">
              <span class="val-badge v-t" id="vl-hydration">${hydLevel}</span>
            </div>
            <div class="hydro-wrap">
              <div class="hydro-bar"><div class="hydro-fill" id="hydro-fill" style="width:${hydLevel*10}%"></div></div>
              <div id="hydro-lbl" class="hydro-label"></div>
            </div>
          </div>
        </div>

        <!-- OBJ.04 NUTRICIÓN -->
        <div class="section${(h.bkf_ate||h.lun_ate||h.din_ate)?' open':''}" id="sec-nut">
          <div class="section-hd">
            <span class="section-num">04</span>
            <span class="section-ico">🥗</span>
            <span class="section-title">NUTRICIÓN</span>
            <span class="section-status${(h.bkf_ate&&h.lun_ate&&h.din_ate)?' done':''}">${(h.bkf_ate||h.lun_ate||h.din_ate)?'ACTIVO':'—'}</span>
            <span class="section-chevron">▶</span>
          </div>
          <div class="section-body">
            <div class="meals-grid">
              <div class="meal-col">
                <div class="meal-hd">☀ DESAYUNO</div>
                <div class="meal-grid">
                  ${mb('bkf_ate','COMÍ',true)}
                  ${mb('bkf_prot','PROTEÍNA')}
                  ${mb('bkf_veg','VERDURAS')}
                  ${mb('bkf_carb','H.BUENOS')}
                </div>
              </div>
              <div class="meal-col">
                <div class="meal-hd">◑ COMIDA</div>
                <div class="meal-grid">
                  ${mb('lun_ate','COMÍ',true)}
                  ${mb('lun_prot','PROTEÍNA')}
                  ${mb('lun_veg','VERDURAS')}
                  ${mb('lun_carb','H.BUENOS')}
                </div>
              </div>
              <div class="meal-col">
                <div class="meal-hd">☾ CENA</div>
                <div class="meal-grid">
                  ${mb('din_ate','COMÍ',true)}
                  ${mb('din_prot','PROTEÍNA')}
                  ${mb('din_veg','VERDURAS')}
                  ${mb('din_carb','H.BUENOS')}
                </div>
              </div>
            </div>
            <div class="tags" style="margin-top:10px;padding-top:8px;border-top:1px solid #162030">
              ${tag('fruit_today','🍊 Fruta hoy',true)}
              ${tag('no_processed','✓ Sin Procesados',true)}
              ${tag('nosugar','✓ Sin Azúcar',true)}
            </div>
            <div class="row" style="margin-top:10px;padding-top:8px;border-top:1px solid #162030">
              <span class="lbl" style="color:var(--red)">🍺 ALCOHOL</span>
              <div class="counter">
                <button class="cnt-btn" id="alc-dec">−</button>
                <div class="cnt-val" id="drinks-val">${h.alcohol_drinks||0}</div>
                <button class="cnt-btn" id="alc-inc">+</button>
              </div>
              <span id="alc-pen" style="font-family:var(--mono);font-size:0.7rem;color:var(--red);font-weight:700;margin-left:6px">${(h.alcohol_drinks||0)>0?`−${(h.alcohol_drinks||0)*4} pts`:''}</span>
            </div>
          </div>
        </div>

        <!-- OBJ.05 HIGIENE -->
        <div class="section${(h.shower||h.teeth_am)?' open':''}" id="sec-hig">
          <div class="section-hd">
            <span class="section-num">05</span>
            <span class="section-ico">🚿</span>
            <span class="section-title">HIGIENE & CUERPO</span>
            <span class="section-status${(h.shower&&h.teeth_am)?' done':''}">${(h.shower||h.teeth_am)?'ACTIVO':'—'}</span>
            <span class="section-chevron">▶</span>
          </div>
          <div class="section-body">
            <div class="tags">
              ${tag('shower','🚿 Ducha',true)}
              ${tag('teeth_am','🦷 Dientes AM',true)}
            </div>
          </div>
        </div>

        <!-- OBJ.06 DISCIPLINA -->
        <div class="section open" id="sec-disc">
          <div class="section-hd">
            <span class="section-num">06</span>
            <span class="section-ico">◉</span>
            <span class="section-title">DISCIPLINA</span>
            <span class="section-status${h.noporn?' done':''}">${h.noporn?'+8 PTS':'—'}</span>
            <span class="section-chevron">▶</span>
          </div>
          <div class="section-body">
            <div class="disc-card${h.noporn?' on':''}" id="disc-card">
              <div class="disc-card-ico">${h.noporn?'◉':'○'}</div>
              <div class="disc-card-info">
                <div class="disc-card-title">SIN PORNO HOY</div>
                <div class="disc-card-sub">Hábito a construir — bonus de +8 pts</div>
              </div>
              <div class="disc-card-pts" id="disc-pts">${h.noporn?'+8':'+0'}</div>
              <div class="disc-card-check">${h.noporn?'✓ ACTIVO':'REGISTRAR'}</div>
            </div>
          </div>
        </div>

        <!-- OBJ.07 INSTAGRAM -->
        <div class="section" id="sec-ig">
          <div class="section-hd">
            <span class="section-num">07</span>
            <span class="section-ico">📸</span>
            <span class="section-title">EXPOSICIÓN DIGITAL</span>
            <span class="section-status${igInit<=30?' done':''}">${igInit>0?igInit+'min':'—'}</span>
            <span class="section-chevron">▶</span>
          </div>
          <div class="section-body">
            <div class="digi-hd">
              <span class="digi-ttl">INSTAGRAM</span>
              <div class="digi-st ${igSt.cls}" id="ig-status">${igSt.t}</div>
              <span class="digi-pen" id="ig-pen">${igSt.pen>0?`−${igSt.pen} pts`:''}</span>
            </div>
            <div class="ig-bar">
              <div class="ig-fill${igInit>90?' danger':igInit>30?' warn':''}" id="ig-fill" style="width:${Math.min(100,(igInit/120)*100)}%"></div>
              <div class="ig-tick" style="left:25%"><span>30m</span></div>
              <div class="ig-tick" style="left:50%"><span>60m</span></div>
              <div class="ig-tick" style="left:75%"><span>90m</span></div>
            </div>
            <div class="dbtn-row">
              <button class="dbtn" data-ig="+10">+10m</button>
              <button class="dbtn" data-ig="+15">+15m</button>
              <button class="dbtn" data-ig="+30">+30m</button>
              <button class="dbtn neg" data-ig="-10">−10m</button>
              <span class="digi-val"><span id="ig-val">${igInit}</span> min</span>
            </div>
            <div class="ig-scale">
              <div class="igseg ${igInit<=30?'ig-clean':'ig-filled'}">0–30m<br><span>✓</span></div>
              <div class="igseg ${igInit>30&&igInit<=60?'ig-low':igInit>60?'ig-filled':''}">30–60m<br><span>−2</span></div>
              <div class="igseg ${igInit>60&&igInit<=90?'ig-med':igInit>90?'ig-filled':''}">60–90m<br><span>−5</span></div>
              <div class="igseg ${igInit>90&&igInit<=120?'ig-high':igInit>120?'ig-filled':''}">90–120m<br><span>−8</span></div>
              <div class="igseg ${igInit>120?'ig-crit':''}">120m+<br><span>−12</span></div>
            </div>
          </div>
        </div>

        <!-- OBJ.08 ENTRETENIMIENTO -->
        <div class="section" id="sec-ent">
          <div class="section-hd">
            <span class="section-num">08</span>
            <span class="section-ico">🎮</span>
            <span class="section-title">ENTRETENIMIENTO</span>
            <span class="section-status">—</span>
            <span class="section-chevron">▶</span>
          </div>
          <div class="section-body">
            <div class="ent-grid">
              ${entCardHTML('interactive','INTERACTIVO','🎮',h)}
              ${entCardHTML('visual','VISUAL','🎬',h)}
              ${entCardHTML('reading','LECTURA','📖',h)}
              ${entCardHTML('digital','DIGITAL','📱',h)}
            </div>
            <div class="ent-legend" style="margin-top:10px">
              <div class="el-seg el-waste">1–3<span>−3pts</span></div>
              <div class="el-seg el-poor">4–5<span>−1pt</span></div>
              <div class="el-seg el-mid">6<span>±0</span></div>
              <div class="el-seg el-good">7–8<span>+2pts</span></div>
              <div class="el-seg el-excel">9–10<span>+4pts</span></div>
            </div>
          </div>
        </div>

        <!-- OBJ.09 SOCIAL -->
        <div class="section${h.social_q&&h.social_q!=='none'?' open':''}" id="sec-soc">
          <div class="section-hd">
            <span class="section-num">09</span>
            <span class="section-ico">👤</span>
            <span class="section-title">SOCIAL</span>
            <span class="section-status${h.social_q&&h.social_q!=='none'?' done':''}">${h.social_q&&h.social_q!=='none'?h.social_q.toUpperCase():'—'}</span>
            <span class="section-chevron">▶</span>
          </div>
          <div class="section-body">
            <div class="social-grid">
              <div class="social-opt${(!h.social_q||h.social_q==='none')?' on':''}" data-v="none"><div class="s-lbl">— Ninguno</div><div class="s-pts">0 pts</div></div>
              <div class="social-opt${h.social_q==='brief'?' on':''}" data-v="brief"><div class="s-lbl">Superficial</div><div class="s-pts">+2 pts</div></div>
              <div class="social-opt${h.social_q==='meaningful'?' on':''}" data-v="meaningful"><div class="s-lbl">Meaningful</div><div class="s-pts">+4 pts</div></div>
              <div class="social-opt${h.social_q==='deep'?' on':''}" data-v="deep"><div class="s-lbl">◈ Profunda</div><div class="s-pts">+5 pts</div></div>
            </div>
          </div>
        </div>

      </div><!-- end col-right -->
    </div><!-- end today-wrap -->

    <!-- SAVE BAR -->
    <div class="save-bar">
      <span class="save-msg" id="save-msg">◈ DATOS GUARDADOS</span>
      <button class="btn-log" id="btn-save">▶ LOG DAY</button>
    </div>
  `;

  /* ──────────────────────────────────
     BIND ALL LISTENERS
  ────────────────────────────────── */
  initSections();

  // Sliders
  initSl('sl-sleepq','vl-sleepq',data.sleepQ);
  initSl('sl-energy','vl-energy',data.energy,'r-a');
  initSl('sl-mood',  'vl-mood',  data.mood,   'r-g');
  initSl('sl-anxiety','vl-anxiety',data.anxiety,'r-r');
  initSl('sl-clarity','vl-clarity',data.mental_clarity);
  initSl('sl-intro', 'vl-intro', data.introspection,'r-a');
  updateMentalCards();
  ['sl-mood','sl-anxiety','sl-clarity','sl-intro'].forEach(id=>
    document.getElementById(id)?.addEventListener('input',()=>{updateMentalCards();trigSave();})
  );

  // Hydration
  const hydSl=document.getElementById('sl-hydration'), hydVl=document.getElementById('vl-hydration');
  if(hydSl){ updateHydroUI(hydLevel); hydSl.addEventListener('input',()=>{ const v=parseInt(hydSl.value); if(hydVl) hydVl.textContent=v; updateHydroUI(v); trigSave(); }); }

  // Sleep / notes / selects
  document.getElementById('inp-sleeph')?.addEventListener('input',trigSave);
  document.getElementById('inp-notes')?.addEventListener('input',trigSave);
  el.querySelectorAll('select[data-hid]').forEach(s=>s.addEventListener('change',trigSave));

  // Generic tags (non-meal)
  const GRN=new Set(['shower','teeth_am','fruit_today','no_processed','nosugar']);
  el.querySelectorAll('.tag:not(.mbtn)').forEach(b=>{
    b.onclick=()=>{ b.classList.toggle(GRN.has(b.dataset.hid)?'on-g':'on'); trigSave(); };
  });

  // Meal buttons
  el.querySelectorAll('.mbtn').forEach(b=>{
    const hid=b.dataset.hid||'', isAte=hid.includes('_ate');
    // init disabled for macro buttons
    if(!isAte){ const ak=hid.replace(/_prot|_veg|_carb/,'_ate'); if(!h[ak]){b.disabled=true;b.style.opacity='0.28';} }
    b.onclick=()=>{
      if(b.disabled) return;
      if(isAte){
        b.classList.toggle('on');
        const pfx=hid.replace('_ate','');
        const deps=el.querySelectorAll(`[data-hid="${pfx}_prot"],[data-hid="${pfx}_veg"],[data-hid="${pfx}_carb"]`);
        if(b.classList.contains('on')) deps.forEach(d=>{d.disabled=false;d.style.opacity='1';});
        else deps.forEach(d=>{d.classList.remove('on-g');d.disabled=true;d.style.opacity='0.28';});
      } else { b.classList.toggle('on-g'); }
      trigSave();
    };
  });

  // Alcohol
  const dEl=document.getElementById('drinks-val'), pEl=document.getElementById('alc-pen');
  const upAlc=delta=>{ const v=Math.max(0,parseInt(dEl.textContent)+delta); dEl.textContent=v; if(pEl) pEl.textContent=v>0?`−${v*4} pts`:''; trigSave(); };
  document.getElementById('alc-inc').onclick=()=>upAlc(1);
  document.getElementById('alc-dec').onclick=()=>upAlc(-1);

  // Instagram
  const upIG=delta=>{
    const cur=Math.max(0,parseInt(el.querySelector('#ig-val').textContent)+delta);
    updateIgUI(cur);
    el.querySelectorAll('.igseg').forEach((seg,i)=>{
      seg.className='igseg';
      const thr=[30,60,90,120]; const mn=i===0?0:thr[i-1]; const mx=thr[i]??Infinity;
      if(cur>=mx) seg.classList.add('ig-filled');
      else if(cur>mn) seg.classList.add(['ig-clean','ig-low','ig-med','ig-high','ig-crit'][i]||'');
      if(i===4&&cur>120) seg.classList.add('ig-crit');
    });
    trigSave();
  };
  upIG(0);
  el.querySelectorAll('[data-ig]').forEach(b=>b.onclick=()=>upIG(parseInt(b.dataset.ig)));

  // Discipline toggle
  const discCard=document.getElementById('disc-card');
  if(discCard){
    discCard.onclick=()=>{
      const on=discCard.classList.toggle('on');
      discCard.querySelector('.disc-card-ico').textContent=on?'◉':'○';
      discCard.querySelector('.disc-card-check').textContent=on?'✓ ACTIVO':'REGISTRAR';
      document.getElementById('disc-pts').textContent=on?'+8':'+0';
      const st=document.querySelector('#sec-disc .section-status');
      if(st){st.textContent=on?'+8 PTS':'—';st.classList.toggle('done',on);}
      trigSave();
    };
  }

  // Entertainment
  ['interactive','visual','reading','digital'].forEach(id=>{
    const cb=document.getElementById('ent-cb-'+id);
    const sl=document.getElementById('ent-sl-'+id);
    const lbl=document.getElementById('ent-lbl-'+id);
    if(!cb||!sl) return;
    if(h['ent_'+id+'_consumed']) cb.checked=true;
    if(h['ent_'+id+'_q'])        sl.value=String(h['ent_'+id+'_q']);
    if(lbl) lbl.classList.toggle('on',cb.checked);
    updateEntCard(id);
    cb.addEventListener('change',()=>{ if(lbl) lbl.classList.toggle('on',cb.checked); updateEntCard(id); trigSave(); });
    sl.addEventListener('input',()=>{ updateEntCard(id); trigSave(); });
  });

  // Social
  el.querySelectorAll('.social-opt').forEach(b=>{
    b.onclick=()=>{ el.querySelectorAll('.social-opt').forEach(x=>x.classList.remove('on')); b.classList.add('on'); trigSave(); };
  });

  // Date nav
  document.getElementById('d-prev').onclick=()=>{ curDate=addD(curDate,-1); renderToday(); };
  document.getElementById('d-next').onclick=()=>{ if(!isToday(curDate)){curDate=addD(curDate,1);renderToday();} };
  const dnNow=document.getElementById('d-now');
  if(dnNow) dnNow.onclick=()=>{ curDate=today(); renderToday(); };

  document.getElementById('btn-save').onclick=()=>doSave(true);

  refreshScore(data);
}

/* ── ENT CARD TEMPLATE ── */
function entCardHTML(id,name,icon,h) {
  const consumed=h['ent_'+id+'_consumed'], qval=h['ent_'+id+'_q']||5;
  const info=entInfo(consumed?qval:0);
  return `
    <div class="ent-card${consumed?' on':''}" id="ent-card-${id}">
      <div class="ent-hd">
        <span class="ent-name">${name}</span>
        <span class="ent-icon">${icon}</span>
      </div>
      <label class="ent-toggle${consumed?' on':''}" id="ent-lbl-${id}">
        <input type="checkbox" id="ent-cb-${id}"${consumed?' checked':''}>
        <div class="ent-box">✓</div>
        <span class="ent-lbl-txt">Consumido hoy</span>
      </label>
      <div class="ent-q-wrap${consumed?' vis':''}" id="ent-qw-${id}">
        <div class="ent-q-row">
          <span class="ent-q-lbl">CALIDAD</span>
          <input type="range" min="1" max="10" id="ent-sl-${id}" value="${qval}" class="${consumed&&qval>=7?'r-g':consumed&&qval<5?'r-r':''}">
          <div class="ent-q-num" id="ent-qn-${id}" style="color:${consumed?(qval>=7?'var(--grn-hi)':qval>=5?'var(--teal)':'var(--red)'):'var(--text-dim)'}">${consumed?qval:'—'}</div>
        </div>
        <div class="ent-impact ${info.c}" id="ent-imp-${id}">
          <span>${consumed?info.l:'—'}</span>
          <span class="ent-pts">${consumed?info.p:'±0'}</span>
        </div>
      </div>
    </div>`;
}

/* ── RENDER MEDIA ── */
const MEDIA_DEF = {
  games:  { label:'GAMES',   fields:[{id:'title',l:'Título'},{id:'status',l:'Estado',opts:['Jugando','Completado','Backlog','Abandonado']},{id:'rating',l:'Score /10',t:'number'},{id:'notes',l:'Notas'}] },
  screen: { label:'PANTALLA',fields:[{id:'title',l:'Título'},{id:'kind',l:'Formato',opts:['Serie','Película','Anime','Documental']},{id:'status',l:'Estado',opts:['Viendo','Finalizado','Backlog','Abandonado']},{id:'rating',l:'Score /10',t:'number'},{id:'notes',l:'Notas'}] }
};

function renderMedia() {
  const el=document.getElementById('v-media');
  const med=getMedia();
  const list=med[mediaTab]||[];

  let tabs='';
  Object.keys(MEDIA_DEF).forEach(k=>{ tabs+=`<button class="tab-btn${mediaTab===k?' on':''}" onclick="mediaTab='${k}';renderMedia()">${MEDIA_DEF[k].label}</button>`; });

  const rows=list.map((item,i)=>`
    <div class="mp-row">
      <div style="flex:1"><div class="mp-title">${item.title}</div><div class="mp-meta">${item.status||''}${item.kind?' — '+item.kind:''}</div></div>
      ${item.rating?`<div class="mp-score">${item.rating}/10</div>`:''}
      <button class="btn-sm" onclick="editMedia('${mediaTab}',${i})">EDIT</button>
    </div>`).join('');

  el.innerHTML=`
    <div class="media-wrap">
      <div style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center">
        <div style="font-family:var(--orb);font-size:1rem;color:var(--teal);letter-spacing:2px">MOTHER BASE LIBRARY</div>
      </div>
      <div class="media-tabs">${tabs}</div>
      <div class="media-panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <span style="font-family:var(--mono);font-size:0.62rem;color:var(--teal);letter-spacing:2px">// DATABASE</span>
          <button class="btn-primary" onclick="editMedia('${mediaTab}',-1)">+ ADD</button>
        </div>
        ${rows||'<div style="font-family:var(--mono);font-size:0.74rem;color:var(--text-dim);padding:10px 0">// ARCHIVE EMPTY</div>'}
      </div>
    </div>`;
}

function editMedia(type,idx) {
  const m=getMedia(), def=MEDIA_DEF[type], item=idx>=0?m[type][idx]:{};
  const inputs=def.fields.map(f=>{
    const val=item[f.id]||'';
    if(f.opts){ const opts=f.opts.map(o=>`<option${val===o?' selected':''}>${o}</option>`).join(''); return `<div class="mf"><label class="mf-lbl">${f.l}</label><select class="sel" id="mf-${f.id}">${opts}</select></div>`; }
    return `<div class="mf"><label class="mf-lbl">${f.l}</label><input class="inp-txt" type="${f.t||'text'}" id="mf-${f.id}" value="${val}"></div>`;
  }).join('');

  const mod=document.getElementById('modal');
  mod.classList.remove('hide');
  mod.innerHTML=`
    <div class="mbox">
      <div class="mbox-title">${idx>=0?'EDITAR':'AÑADIR'} REGISTRO</div>
      ${inputs}
      <div class="modal-footer">
        ${idx>=0?`<button class="btn-cancel" style="color:var(--red);border-color:var(--red)" id="m-del">BORRAR</button>`:'<div></div>'}
        <div style="display:flex;gap:8px">
          <button class="btn-cancel" onclick="document.getElementById('modal').classList.add('hide')">CANCELAR</button>
          <button class="btn-primary" id="m-save">GUARDAR</button>
        </div>
      </div>
    </div>`;

  document.getElementById('m-save').onclick=()=>{
    const t=document.getElementById('mf-title')?.value.trim(); if(!t) return;
    const up={id:item.id||Date.now()};
    def.fields.forEach(f=>{ const v=document.getElementById('mf-'+f.id)?.value; up[f.id]=f.t==='number'?parseFloat(v):v; });
    if(idx>=0) m[type][idx]=up; else m[type].unshift(up);
    saveMedia(m); ghSave(_data); mod.classList.add('hide'); renderMedia();
  };
  if(idx>=0) document.getElementById('m-del').onclick=()=>{ m[type].splice(idx,1); saveMedia(m); ghSave(_data); mod.classList.add('hide'); renderMedia(); };
}

/* ══ CONFIG MODAL ══ */
document.getElementById('cfg-btn').onclick=()=>{ openConfig(); };

function openConfig() {
  const cfg=getCfg();
  const mod=document.getElementById('modal');
  mod.classList.remove('hide');
  mod.innerHTML=`
    <div class="mbox">
      <div class="mbox-title">⚙ CONFIGURACIÓN DE ENLACE</div>

      <div class="mf">
        <label class="mf-lbl">GITHUB PERSONAL ACCESS TOKEN</label>
        <input class="inp-txt" type="password" id="cfg-token" value="${cfg.token||''}" placeholder="ghp_xxxxxxxxxxxxxxxxxx">
        <div class="mf-hint">Necesita permisos: <code>repo</code> (o <code>contents:write</code> en fine-grained)</div>
      </div>
      <div class="mf">
        <label class="mf-lbl">REPOSITORIO (usuario/repo)</label>
        <input class="inp-txt" type="text" id="cfg-repo" value="${cfg.repo||''}" placeholder="tuusuario/mi-repo">
      </div>
      <div class="mf">
        <label class="mf-lbl">RUTA DEL ARCHIVO EN EL REPO</label>
        <input class="inp-txt" type="text" id="cfg-path" value="${cfg.path||'idroid-data.json'}" placeholder="idroid-data.json">
        <div class="mf-hint">El archivo se crea automáticamente si no existe.</div>
      </div>

      <div class="status-line" id="cfg-status"></div>

      <div class="modal-footer">
        <button class="btn-cancel" id="cfg-test">🔗 PROBAR CONEXIÓN</button>
        <div style="display:flex;gap:8px">
          <button class="btn-cancel" onclick="document.getElementById('modal').classList.add('hide')">CANCELAR</button>
          <button class="btn-primary" id="cfg-save">GUARDAR</button>
        </div>
      </div>
    </div>`;

  document.getElementById('cfg-save').onclick=async()=>{
    const newCfg={
      token: document.getElementById('cfg-token').value.trim(),
      repo:  document.getElementById('cfg-repo').value.trim(),
      path:  document.getElementById('cfg-path').value.trim()
    };
    saveCfg(newCfg);
    setStatus('cfg-status','Guardado. Cargando datos de GitHub...','var(--amber)');
    const loaded=await ghLoad();
    if(loaded){ _data=loaded; setSyncState('ok','GITHUB'); setStatus('cfg-status','✓ Conectado correctamente.','var(--grn)'); setTimeout(()=>{ mod.classList.add('hide'); renderToday(); },800); }
    else       { setStatus('cfg-status','✕ No se pudo conectar. Revisa token y repositorio.','var(--red)'); }
  };

  document.getElementById('cfg-test').onclick=async()=>{
    const cfg2={
      token: document.getElementById('cfg-token').value.trim(),
      repo:  document.getElementById('cfg-repo').value.trim(),
      path:  document.getElementById('cfg-path').value.trim()
    };
    if(!cfg2.token||!cfg2.repo||!cfg2.path){ setStatus('cfg-status','Rellena todos los campos.','var(--amber)'); return; }
    setStatus('cfg-status','Probando conexión...','var(--amber)');
    try {
      const res=await fetch(`https://api.github.com/repos/${cfg2.repo}`,{headers:{'Authorization':`token ${cfg2.token}`,'Accept':'application/vnd.github.v3+json'}});
      if(res.ok) setStatus('cfg-status','✓ Repositorio accesible. Guarda para activar.','var(--grn)');
      else setStatus('cfg-status',`✕ Error ${res.status} — revisa token y repo.`,'var(--red)');
    } catch { setStatus('cfg-status','✕ Error de red.','var(--red)'); }
  };
}

function setStatus(id,msg,color) {
  const el=document.getElementById(id);
  if(el){ el.textContent=msg; el.style.color=color; }
}

/* ══ BOOT ══ */
async function boot() {
  updateDateHeader();
  setSyncState('local','LOCAL');

  // Try loading from GitHub first
  const loaded = await ghLoad();
  if(loaded) {
    _data = loaded;
  } else {
    // Fallback to local
    _data = localLoad();
    setSyncState('local','LOCAL');
  }

  renderToday();
}

boot();
