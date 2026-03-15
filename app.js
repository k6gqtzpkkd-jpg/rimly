/* ==========================================================
   RIMLY v4 CLASSIC GLOW - Logic & State Handling
   ========================================================== */

const CORRECT_PW = '082655';
let pwInput = '';

let appState = {
  isGameActive: false,
  activeTab: 'setup',
  game: {
    home: { name: '', color: 'dark', players: [] },
    away: { name: '', color: 'light', players: [] },
    quarter: 1, isOT: false,
    score: { home: 0, away: 0 },
    teamFouls: { home: 0, away: 0 },
    timeouts: { home: { h1: 0, h2: 0, ot: 0 }, away: { h1: 0, h2: 0, ot: 0 } },
    logs: [] // {id, tstamp, qStr, team, pid, type('SCORE'|'FOUL'|'TO'), detail, val}
  },
  teamsDB: [],
  historyDB: []
};

// --- Storage Data ---
function loadData() {
  try {
    appState.teamsDB = JSON.parse(localStorage.getItem('rimly_v4_teams') || '[]');
    // Clean up corrupted or default data
    appState.teamsDB = appState.teamsDB.filter(t => t.name !== 'HOME TEAM' && t.name !== 'AWAY TEAM' && t.name !== 'HOME' && t.name !== 'AWAY');
    appState.teamsDB.forEach(t => { if(!t.players) t.players = []; });

    appState.historyDB = JSON.parse(localStorage.getItem('rimly_v4_history') || '[]');
  } catch(e) {}
}
function saveData() {
  localStorage.setItem('rimly_v4_teams', JSON.stringify(appState.teamsDB));
  localStorage.setItem('rimly_v4_history', JSON.stringify(appState.historyDB));
}

// --- PASSWORD SCREEN ---
function setupPassword() {
  const ds = Array.from({length:6}, (_,i) => document.getElementById(`dot-${i}`));
  
  const updateDots = (err=false) => {
    ds.forEach((d, i) => {
      d.className = 'dot';
      if(i < pwInput.length) d.classList.add('filled');
      if(err) d.classList.add('error');
    });
  };
  
  const checkPw = () => {
    if(pwInput === CORRECT_PW) {
      document.getElementById('password-screen').classList.remove('active');
      document.getElementById('app-screen').classList.add('active');
    } else {
      document.getElementById('pw-error').textContent = 'パスワードが一致しません';
      updateDots(true);
      setTimeout(() => { pwInput = ''; updateDots(); document.getElementById('pw-error').textContent=''; }, 1200);
    }
  };

  document.querySelectorAll('.num-btn[data-n]').forEach(btn => {
    btn.addEventListener('click', () => {
      if(pwInput.length < 6) { 
        pwInput += btn.dataset.n; 
        updateDots(); 
        if(pwInput.length===6) setTimeout(checkPw, 100); 
      }
    });
  });
  
  document.getElementById('pw-clear').addEventListener('click', () => { 
    pwInput = pwInput.slice(0, -1); 
    updateDots(); 
    document.getElementById('pw-error').textContent=''; 
  });
  
  // KB Support
  document.addEventListener('keydown', e => {
    if(!document.getElementById('password-screen').classList.contains('active')) return;
    if(e.key >= '0' && e.key <= '9' && pwInput.length < 6) { pwInput += e.key; updateDots(); if(pwInput.length===6) setTimeout(checkPw, 100); }
    else if(e.key === 'Backspace') { pwInput = pwInput.slice(0, -1); updateDots(); document.getElementById('pw-error').textContent=''; }
  });
}

// Canvas DB draw
function setupRimlyCanvas() {
  const canvas = document.getElementById('rimly-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = 360; canvas.height = 100;
  let drawn = 0; const speed = 8;
  
  function render() {
    ctx.clearRect(0,0, canvas.width, canvas.height);
    const t = Math.min(drawn/600, 1);
    ctx.shadowColor = '#FF6B00'; ctx.shadowBlur = 25*t;
    const g = ctx.createLinearGradient(60, 0, 300, 0);
    g.addColorStop(0, '#FF8C35'); g.addColorStop(0.5, '#FF6B00'); g.addColorStop(1, '#E05000');
    ctx.fillStyle = g;
    ctx.save(); ctx.beginPath(); ctx.rect(0,0, canvas.width*t, canvas.height); ctx.clip();
    
    ctx.font = 'bold 74px "Outfit"'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('Rimly', canvas.width/2, canvas.height/2 + 5);
    ctx.restore();
    drawn += speed;
    if(t < 1) requestAnimationFrame(render);
  }
  render();
}

// --- POP TOAST ---
function showPop(str) {
  const p = document.getElementById('score-pop');
  p.textContent = str;
  p.classList.add('show');
  setTimeout(() => p.classList.remove('show'), 1500);
}

// --- NAVIGATION TABS ---
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      const target = btn.dataset.tab;
      
      // Match lock check
      if(appState.isGameActive && (target === 'setup' || target === 'history' || target === 'teams')) {
        showAlert('試合中はセットアップや履歴、チーム登録画面には移動できません。');
        return;
      }
      if(!appState.isGameActive && (target === 'score' || target === 'plays' || target === 'fouls')) {
        showAlert('試合が開始されていません。');
        return;
      }
      
      switchTab(target);
    };
  });
}

function switchTab(t) {
  appState.activeTab = t;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${t}"]`).classList.add('active');
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`tab-content-${t}`).classList.add('active');
  
  if(t === 'setup') renderSetup();
  if(t === 'score') renderScore();
  if(t === 'history') renderHistory();
  if(t === 'teams') renderTeamsTab();
  if(t === 'plays' || t === 'fouls') renderLogs();
}


// --- 1. SETUP LOGIC ---
function renderSetup() {
  const g = appState.game;
  document.getElementById('setup-home-name').value = g.home.name;
  document.getElementById('setup-away-name').value = g.away.name;
  
  ['home', 'away'].forEach(tm => {
    const pnl = document.getElementById(`setup-${tm}-color`);
    pnl.querySelectorAll('.ts-btn').forEach(b => b.classList.remove('active', 'ts-orange', 'ts-blue'));
    pnl.querySelector(`[data-val="${g[tm].color}"]`).classList.add('active', tm==='home'?'ts-orange':'ts-blue');
  });
}

// Toggle uniform colors
document.querySelectorAll('.toggle-switch .ts-btn').forEach(btn => {
  btn.onclick = e => {
    const parent = e.target.closest('.toggle-switch');
    const tm = parent.id.includes('home') ? 'home' : 'away';
    appState.game[tm].color = e.target.dataset.val;
    renderSetup();
  };
});

// Load DB Team to Setup
let actTeamTarget = 'home';
window.openTeamLoadModal = function(team) {
  actTeamTarget = team;
  document.getElementById('mlt-search').value = '';
  document.getElementById('modal-load-team').parentElement.classList.add('open');
  renderLoadList('');
};

document.getElementById('mlt-search').oninput = e => renderLoadList(e.target.value.toLowerCase());

function renderLoadList(q) {
  const list = document.getElementById('mlt-list');
  list.innerHTML = '';
  const filtered = appState.teamsDB.filter(x => x.name.toLowerCase().includes(q));
  if(filtered.length === 0) { list.innerHTML = '<div style="color:var(--text-secondary)">登録チームがありません</div>'; return; }
  
  filtered.forEach(dbT => {
    const el = document.createElement('div');
    el.className = 'sl-item text-primary';
    el.innerHTML = `<span>${dbT.name}</span> <span class="text-secondary">${dbT.players.length}名</span>`;
    el.onclick = () => {
      appState.game[actTeamTarget].name = dbT.name;
      // Deep copy + reset stats
      appState.game[actTeamTarget].players = JSON.parse(JSON.stringify(dbT.players)).map(p => ({...p, pts:0, p3:0, p2:0, pt:0, pf:0}));
      document.getElementById('modal-load-team').parentElement.classList.remove('open');
      renderSetup();
      showPop(`${dbT.name}をロード`);
    };
    list.appendChild(el);
  });
}

// Start Match
document.getElementById('btn-start-match').onclick = () => {
  const g = appState.game;
  g.home.name = document.getElementById('setup-home-name').value.trim() || 'HOME TEAM';
  g.away.name = document.getElementById('setup-away-name').value.trim() || 'AWAY TEAM';
  
  // reset state
  g.score = { home:0, away:0 };
  g.quarter = 1; g.isOT = false;
  g.teamFouls = { home:0, away:0 };
  g.timeouts = { home: {h1:0, h2:0, ot:0}, away: {h1:0, h2:0, ot:0} };
  g.logs = [];
  
  appState.isGameActive = true;
  document.querySelectorAll('.tab-btn[data-tab="setup"], .tab-btn[data-tab="history"]').forEach(b => b.disabled = true);
  
  showPop('TIP OFF! 🏀');
  switchTab('score');
};


// --- 2. SCOREBOARD LOGIC ---
const TO_LIMS = { h1: 2, h2: 3, ot: 3 };
function getQHalf(q, isOT) { return isOT ? 'ot' : (q<=2 ? 'h1' : 'h2'); }
function getQStr() { return appState.game.isOT ? 'OT' : `Q${appState.game.quarter}`; }

function renderScore() {
  const g = appState.game;
  
  document.getElementById('disp-home-name').textContent = g.home.name;
  document.getElementById('disp-away-name').textContent = g.away.name;
  document.getElementById('roster-home-name').textContent = g.home.name;
  document.getElementById('roster-away-name').textContent = g.away.name;
  
  document.getElementById('home-score').textContent = g.score.home;
  document.getElementById('away-score').textContent = g.score.away;
  
  document.getElementById('quarter-label').textContent = getQStr();
  const plabels = ['1st QUARTER', '2nd QUARTER', '3rd QUARTER', '4th QUARTER'];
  document.getElementById('period-info').textContent = g.isOT ? 'OVERTIME' : plabels[g.quarter-1];
  
  // Fouls
  ['home', 'away'].forEach(t => {
    document.getElementById(`tf-${t}-val`).textContent = g.teamFouls[t];
    if(g.teamFouls[t] >= 5) document.getElementById(`tf-${t}-val`).classList.add('danger');
    else document.getElementById(`tf-${t}-val`).classList.remove('danger');
    
    const pips = document.getElementById(`tf-${t}-pips`);
    pips.innerHTML = '';
    for(let i=1; i<=5; i++) {
        const p = document.createElement('div');
        p.className = 'tf-pip';
        if(i <= g.teamFouls[t]) { p.classList.add('on'); if(g.teamFouls[t]>=5) p.classList.add('danger'); }
        pips.appendChild(p);
    }
    
    // Timeouts
    const hf = getQHalf(g.quarter, g.isOT);
    const use = g.timeouts[t][hf];
    const max = TO_LIMS[hf];
    const rem = max - use;
    
    let lbl = 'TIMEOUT (延長)';
    if(hf==='h1') lbl = 'TIMEOUT (前半: Q1-Q2)';
    if(hf==='h2') lbl = 'TIMEOUT (後半: Q3-Q4)';
    document.getElementById(`to-${t}-label`).textContent = lbl;
    document.getElementById(`to-${t}-rem`).textContent = Math.max(0, rem);
    
    const tpips = document.getElementById(`to-${t}-pips`);
    tpips.innerHTML = '';
    for(let i=1; i<=max; i++) {
      const p = document.createElement('div');
      p.className = 'to-pip';
      if(i > rem) p.classList.add('used');
      tpips.appendChild(p);
    }
  });
  
  renderTableRoster('home');
  renderTableRoster('away');
}

// Quarter buttons
document.getElementById('q-prev').onclick = () => {
    const g = appState.game;
    if(g.isOT) { g.isOT = false; g.quarter = 4; }
    else if(g.quarter > 1) g.quarter--;
    g.teamFouls = {home:0, away:0};
    renderScore();
};
document.getElementById('q-next').onclick = () => {
    const g = appState.game;
    if(!g.isOT && g.quarter < 4) g.quarter++;
    else if(g.quarter === 4 && !g.isOT) g.isOT = true;
    g.teamFouls = {home:0, away:0};
    renderScore();
};

window.useTimeout = function(t) {
  const g = appState.game;
  const hf = getQHalf(g.quarter, g.isOT);
  if(g.timeouts[t][hf] >= TO_LIMS[hf]) { showAlert('このハーフ(延長)でのタイムアウト上限です。'); return; }
  
  g.timeouts[t][hf]++;
  g.logs.unshift({ id: Date.now(), tstamp: Date.now(), qStr: getQStr(), team: t, pid: 'TO', type: 'TO', detail: 'TIMEOUT', val: 0 });
  
  showPop('TIMEOUT!');
  renderScore();
};

// Player Rosters
function renderTableRoster(tm) {
  const tbody = document.getElementById(`roster-${tm}-table`).querySelector('tbody');
  tbody.innerHTML = '';
  appState.game[tm].players.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-num">${p.num}</td>
      <td style="text-align:left;">${p.name}</td>
      <td class="td-pts">${p.pts}</td>
      <td class="hover-cell cell-3p" style="color:var(--text-secondary);"><span class="cell-bg">${p.p3}</span></td>
      <td class="hover-cell cell-2p" style="color:var(--text-secondary);"><span class="cell-bg">${p.p2}</span></td>
      <td class="hover-cell cell-ft" style="color:var(--text-secondary);"><span class="cell-bg">${p.pt}</span></td>
      <td class="hover-cell cell-pf ${p.pf >= 5 ? 'text-red' : (p.pf >= 4 ? 'text-orange' : '')}"><span class="cell-bg">${p.pf}</span></td>
    `;
    
    // Direct Score Actions
    tr.querySelector('.cell-3p').onclick = () => { if(p.pf < 5) addScore(tm, p.id, 3, '3P'); else showAlert('退場しています'); };
    tr.querySelector('.cell-2p').onclick = () => { if(p.pf < 5) addScore(tm, p.id, 2, '2P'); else showAlert('退場しています'); };
    tr.querySelector('.cell-ft').onclick = () => { if(p.pf < 5) addScore(tm, p.id, 1, '1P'); else showAlert('退場しています'); };
    
    // Direct Foul Action
    tr.querySelector('.cell-pf').onclick = () => { if(p.pf < 5) openActionSheet(p.id, tm); else showAlert('退場しています'); };
    
    tbody.appendChild(tr);
  });
}

// Add/Edit Players (In match)
window.openPlayerModal = function(t) {
  actTeamTarget = t;
  document.getElementById('mmp-num').value = '';
  document.getElementById('mmp-name').value = '';
  document.getElementById('modal-manage-players').parentElement.classList.add('open');
  redrawPlayerEditList();
};

document.getElementById('mmp-add-btn').onclick = () => {
  const num = document.getElementById('mmp-num').value.trim();
  const name = document.getElementById('mmp-name').value.trim();
  if(!num || !name) return;
  appState.game[actTeamTarget].players.push({
    id: Date.now()+Math.random(), num, name, pts:0, p3:0, p2:0, pt:0, pf:0
  });
  redrawPlayerEditList();
  renderScore();
  document.getElementById('mmp-num').value = '';
  document.getElementById('mmp-name').value = '';
};

function redrawPlayerEditList() {
  const list = document.getElementById('mmp-list');
  list.innerHTML = '';
  appState.game[actTeamTarget].players.forEach(p => {
    const el = document.createElement('div');
    el.className = 'pel-item';
    el.innerHTML = `<span>#${p.num} ${p.name}</span><button class="pel-del">削除</button>`;
    el.querySelector('.pel-del').onclick = () => {
      appState.game[actTeamTarget].players = appState.game[actTeamTarget].players.filter(x => x.id !== p.id);
      redrawPlayerEditList(); renderScore();
    };
    list.appendChild(el);
  });
}

document.getElementById('mmp-save-team').onclick = () => {
  const gTm = appState.game[actTeamTarget];
  let ix = appState.teamsDB.findIndex(x => x.name === gTm.name);
  // Deep clone players and drop stats
  const dbPs = JSON.parse(JSON.stringify(gTm.players)).map(p => ({...p, pts:0, p3:0, p2:0, pt:0, pf:0}));
  
  if(ix >= 0) { appState.teamsDB[ix].players = dbPs; }
  else { appState.teamsDB.push({ id: Date.now(), name: gTm.name, players: dbPs }); }
  
  saveData();
  document.getElementById('modal-manage-players').parentElement.classList.remove('open');
  showPop('DBに保存しました');
};


// --- ACTIONS ---
function addScore(tm, pid, val, type) {
  const g = appState.game;
  const p = g[tm].players.find(x => x.id === pid);
  
  p.pts += val;
  g.score[tm] += val;
  if(type==='1P') p.pt++;
  if(type==='2P') p.p2++;
  if(type==='3P') p.p3++;
  
  // Create cumulative detail string (e.g., "15点目 / 3P")
  const cumulativePts = g.score[tm];
  const newDetail = `${cumulativePts}点目 / ${type}`;

  g.logs.unshift({ id: Date.now(), tstamp: Date.now(), qStr: getQStr(), team: tm, pid: p.id, type: 'SCORE', detail: newDetail, val, rawType: type });
  
  showPop(`+${val} PTS! (#${p.num} ${p.name})`);
  renderScore();
}

let sheetTarget = null;
function openActionSheet(pid, team) {
  sheetTarget = {pid, team};
  const p = appState.game[team].players.find(x => x.id === pid);
  document.getElementById('mact-title').textContent = `#${p.num} ${p.name}`;
  document.getElementById('mact-title').className = `modal-title player-action-title ${team==='home'?'text-orange':'text-blue'}`;
  document.getElementById('modal-foul-action').parentElement.classList.add('open');
}



// Foul Add
document.querySelectorAll('.foul-play').forEach(btn => {
  btn.onclick = () => {
    if(!sheetTarget) return;
    const g = appState.game;
    const tm = sheetTarget.team;
    const p = g[tm].players.find(x => x.id === sheetTarget.pid);
    const type = btn.dataset.type;
    
    p.pf++;
    g.teamFouls[tm]++;
    
    let fn = type === 'P' ? 'Personal Foul' : (type === 'T' ? 'Tech Foul' : (type === 'U' ? 'Unsports Foul' : 'Disqualifying'));
    g.logs.unshift({ id: Date.now(), tstamp: Date.now(), qStr: getQStr(), team: tm, pid: p.id, type: 'FOUL', detail: fn, val: 0 });
    
    document.getElementById('modal-foul-action').parentElement.classList.remove('open');
    if(p.pf >= 5) setTimeout(() => showAlert(`🚫 ${p.name} (#${p.num}) が退場しました！`), 200);
    renderScore();
  };
});


// --- 3, 4. PLAY LOG & FOUL LOG ---
function renderLogs() {
  if (document.getElementById('log-home-title-s')) document.getElementById('log-home-title-s').textContent = appState.game.home.name;
  if (document.getElementById('log-away-title-s')) document.getElementById('log-away-title-s').textContent = appState.game.away.name;
  if (document.getElementById('log-home-title-f')) document.getElementById('log-home-title-f').textContent = appState.game.home.name;
  if (document.getElementById('log-away-title-f')) document.getElementById('log-away-title-f').textContent = appState.game.away.name;

  const sH = document.getElementById('score-home-list');
  const sA = document.getElementById('score-away-list');
  const fH = document.getElementById('foul-home-list');
  const fA = document.getElementById('foul-away-list');
  if(!sH || !sA || !fH || !fA) return;
  sH.innerHTML = ''; sA.innerHTML = ''; fH.innerHTML = ''; fA.innerHTML = '';
  
  const g = appState.game;
  
  g.logs.forEach(l => {
    const isS = l.type === 'SCORE' || l.type === 'TO';
    const isF = l.type === 'FOUL';
    if(appState.activeTab === 'plays' && !isS) return;
    if(appState.activeTab === 'fouls' && !isF) return;
    
    const p = l.pid !== 'TO' ? g[l.team].players.find(x=>x.id===l.pid) : null;
    const pName = p ? `#${p.num} ${p.name}` : '(TEAM)';
    const el = document.createElement('div');
    el.className = `tl-item ${l.team==='home'?'tl-home':'tl-away'}`;
    
    let valStr = l.type==='SCORE' ? `<span class="tl-val text-orange">+${l.val}</span>` : `<span class="tl-val text-secondary" style="font-size:24px;">-</span>`;
    if(l.type==='FOUL') valStr = `<span class="tl-val text-red">F</span>`;
    
    // Make detail text span blue if away for visual identity
    const metaClass = l.team === 'home' ? 'text-orange' : 'text-blue';
    
    el.innerHTML = `
      <div class="tl-q">${l.qStr}</div>
      <div class="tl-pinfo">
        <span class="tl-player">${pName} <span class="tl-meta ${metaClass}">${l.detail}</span></span>
        <div style="display:flex; gap:8px; margin-top:6px;">
          <button class="edit-log" data-id="${l.id}">変更</button>
          <button class="del-log" data-id="${l.id}">取消</button>
        </div>
      </div>
      ${valStr}
    `;
    
    if(l.type !== 'TO') {
        el.querySelector('.edit-log').onclick = () => openEditLogPlayerModal(l);
    } else {
        el.querySelector('.edit-log').style.display = 'none';
    }
    el.querySelector('.del-log').onclick = () => {
      showConfirm('記録を取り消しますか？').then(res => { if(res) revertLog(l.id); });
    };
    
    if(isS && appState.activeTab==='plays') {
        if(l.team === 'home') sH.appendChild(el); else sA.appendChild(el);
    }
    if(isF && appState.activeTab==='fouls') {
        if(l.team === 'home') fH.appendChild(el); else fA.appendChild(el);
    }
  });
}

function revertLog(logId) {
  const g = appState.game;
  const i = g.logs.findIndex(x => x.id === logId);
  if(i < 0) return;
  const l = g.logs[i];
  g.logs.splice(i, 1);
  
  if(l.type === 'SCORE') {
    const p = g[l.team].players.find(x => x.id === l.pid);
    if(p) {
      p.pts -= l.val;
      if(l.rawType==='1P') p.pt--; if(l.rawType==='2P') p.p2--; if(l.rawType==='3P') p.p3--;
    }
    g.score[l.team] -= l.val;
  } else if(l.type === 'FOUL') {
    const p = g[l.team].players.find(x => x.id === l.pid);
    if(p) {
       p.pf--;
       if(l.fType==='P' || l.fType==='O') p.po = Math.max(0, (p.po||0) - 1);
       if(l.fType==='T' || l.fType==='U' || l.fType==='D') p.tud = Math.max(0, (p.tud||0) - 1);
       if(l.fType==='T') p.tf--; 
       if(l.fType==='U') p.uf--; 
       if(l.fType==='D') p.df--;
    }
    g.teamFouls[l.team]--;
  } else if(l.type === 'TO') {
    const hf = getQHalf(parseInt(l.qStr.replace('Q',''))||4, l.qStr==='OT');
    g.timeouts[l.team][hf]--;
  }
  
  renderScore(); renderLogs();
}

// End Game
document.getElementById('btn-end-match').onclick = () => {
  showConfirm('試合を終了し、結果を履歴に保存しますか？').then(res => {
    if(res) {
    const g = appState.game;
    appState.historyDB.unshift({
      id: Date.now(),
      date: new Date().toLocaleString('ja-JP'),
      home: JSON.parse(JSON.stringify(g.home)),
      away: JSON.parse(JSON.stringify(g.away)),
      score: { home: g.score.home, away: g.score.away },
      logs: JSON.parse(JSON.stringify(g.logs))
    });
    // Auto update team roster stats in DB
    ['home','away'].forEach(t => {
      if(g[t].name === 'HOME TEAM' || g[t].name === 'AWAY TEAM') return; // Do not save defaults to DB
      
      const idx = appState.teamsDB.findIndex(x => x.name === g[t].name);
      const cls = JSON.parse(JSON.stringify(g[t].players)).map(p => ({...p, pts:0, p3:0, p2:0, pt:0, pf:0}));
      if(idx >= 0) appState.teamsDB[idx].players = cls;
      else appState.teamsDB.push({ id: Date.now()+Math.random(), name: g[t].name, players: cls });
    });
    saveData();
    appState.isGameActive = false;
    document.querySelectorAll('.tab-btn').forEach(b => b.disabled = false);
    switchTab('setup');
    showPop('MATCH SAVED!');
      }
  })
};


// --- 6. TEAMS DB (NEW TAB) ---
function renderTeamsTab() {
  const g = document.getElementById('teams-db-list');
  g.innerHTML = '';
  if(appState.teamsDB.length === 0) {
    g.innerHTML = '<div style="color:var(--text-muted); text-align:center;">学校・チームが登録されていません。</div>'; return;
  }
  
  appState.teamsDB.forEach((t, idx) => {
    const el = document.createElement('div');
    el.className = 'hist-card';
    el.innerHTML = `
      <div>
        <div class="hc-tname text-primary" style="font-size:24px; margin-bottom:8px;">${t.name}</div>
        <div class="text-secondary" style="font-size:14px;">登録選手: <span class="text-orange" style="font-weight:700;">${t.players.length}</span> 名</div>
      </div>
      <div class="hc-acts">
        <button class="btn-sm btn-outline-glow" data-idx="${idx}">✏️ 編集</button>
        <button class="btn-sm btn-danger hist-del" data-idx="${idx}">削除</button>
      </div>
    `;
    el.querySelector('.hist-del').onclick = () => {
      showConfirm('このチームを削除しますか？').then(res => { if(res) {
        appState.teamsDB.splice(idx, 1);
        saveData(); renderTeamsTab();
      } })
    };
    el.querySelector('.btn-outline-glow').onclick = () => openTeamEditor(idx);
    g.appendChild(el);
  });
}

document.getElementById('btn-create-team').onclick = () => openTeamEditor(-1);

let activeEditTeamIdx = -1;
let activeEditTeamData = null;

function openTeamEditor(idx) {
  activeEditTeamIdx = idx;
  if(idx === -1) {
    activeEditTeamData = { name: '', players: [] };
  } else {
    activeEditTeamData = JSON.parse(JSON.stringify(appState.teamsDB[idx])); // deep copy
  }
  
  document.getElementById('mte-name').value = activeEditTeamData.name;
  document.getElementById('mte-pnum').value = '';
  document.getElementById('mte-pname').value = '';
  renderTeamEditorPlayers();
  
  document.getElementById('modal-team-editor').parentElement.classList.add('open');
}

function renderTeamEditorPlayers() {
  const list = document.getElementById('mte-list');
  list.innerHTML = '';
  activeEditTeamData.players.forEach(p => {
    const el = document.createElement('div');
    el.className = 'pel-item';
    el.innerHTML = `<span>#${p.num} ${p.name}</span><button class="pel-del">削除</button>`;
    el.querySelector('.pel-del').onclick = () => {
      activeEditTeamData.players = activeEditTeamData.players.filter(x => x.id !== p.id);
      renderTeamEditorPlayers();
    };
    list.appendChild(el);
  });
}

document.getElementById('mte-add-btn').onclick = () => {
  const num = document.getElementById('mte-pnum').value.trim();
  const name = document.getElementById('mte-pname').value.trim();
  if(!num || !name) return;
  activeEditTeamData.players.push({
    id: Date.now()+Math.random(), num, name, pts:0, p3:0, p2:0, pt:0, pf:0
  });
  renderTeamEditorPlayers();
  document.getElementById('mte-pnum').value = '';
  document.getElementById('mte-pname').value = '';
};

document.getElementById('mte-save-team').onclick = () => {
  activeEditTeamData.name = document.getElementById('mte-name').value.trim() || '未定チーム';
  
  if(activeEditTeamIdx === -1) {
    activeEditTeamData.id = Date.now();
    appState.teamsDB.push(activeEditTeamData);
  } else {
    appState.teamsDB[activeEditTeamIdx] = activeEditTeamData;
  }
  saveData();
  document.getElementById('modal-team-editor').parentElement.classList.remove('open');
  renderTeamsTab();
  showPop('チームを保存しました');
};

// --- 5. HISTORY & AI ---
function renderHistory() {
  const g = document.getElementById('history-list');
  g.innerHTML = '';
  if(appState.historyDB.length === 0) {
    g.innerHTML = '<div style="color:var(--text-muted); text-align:center;">保存された履歴がありません。</div>'; return;
  }
  
  appState.historyDB.forEach((h, idx) => {
    const el = document.createElement('div');
    el.className = 'hist-card';
    el.innerHTML = `
      <div>
        <div class="hc-date">${h.date}</div>
        <div class="hc-row">
          <span class="hc-tname text-orange">${h.home.name}</span>
          <span class="hc-score text-orange">${h.score.home}</span>
          <span class="hc-vs">-</span>
          <span class="hc-score text-blue">${h.score.away}</span>
          <span class="hc-tname text-blue" style="text-align:right;">${h.away.name}</span>
        </div>
      </div>
      <div class="hc-acts">
        <button class="btn-sm btn-outline-glow" data-idx="${idx}">🤖 分析</button>
        <button class="btn-sm btn-danger hist-del" data-idx="${idx}">削除</button>
      </div>
    `;
    el.querySelector('.hist-del').onclick = () => {
      showConfirm('試合記録を削除しますか？').then(res => { if(res) {
        appState.historyDB.splice(idx, 1);
        saveData(); renderHistory();
      } })
    };
    el.querySelector('.btn-outline-glow').onclick = () => openAI(h);
    g.appendChild(el);
  });
}

document.getElementById('btn-clear-history').onclick = () => {
  showConfirm('本当に全履歴を削除しますか？').then(res => { if(res) {
    appState.historyDB = []; saveData(); renderHistory();
  } })
};

// AI GRAPHICS
function openAI(h) {
  const box = document.getElementById('ai-content-box');
  
  const hP = h.score.home, aP = h.score.away;
  const hF = h.home.players.reduce((s,p)=>s+p.pf,0), aF = h.away.players.reduce((s,p)=>s+p.pf,0);
  const h3 = h.home.players.reduce((s,p)=>s+(p.p3*3),0), a3 = h.away.players.reduce((s,p)=>s+(p.p3*3),0);
  const h2 = h.home.players.reduce((s,p)=>s+(p.p2*2),0), a2 = h.away.players.reduce((s,p)=>s+(p.p2*2),0);
  const hFT = h.home.players.reduce((s,p)=>s+p.pt,0), aFT = h.away.players.reduce((s,p)=>s+p.pt,0);
  
  const wT = (hP > aP) ? `<span class="text-orange">${h.home.name}</span>` : (aP > hP ? `<span class="text-blue">${h.away.name}</span>` : '引き分け');
  const txt = `総得点 ${hP+aP} 点のゲームは、${wT} の勝利で幕を閉じました。グラフを見てチームスタッツを比較しましょう。`;
  
  const uiBar = (title, vH, vA) => {
    const tot = (vH+vA)||1; const wH = (vH/tot)*100; const wA = (vA/tot)*100;
    return `
      <div class="ai-stat-row">
        <div class="ai-stat-label">
          <span class="text-orange">${vH}</span>
          <span class="ai-stat-lbl-txt">${title}</span>
          <span class="text-blue">${vA}</span>
        </div>
        <div class="ai-bar-bg">
          <div class="ai-bar-fill-h" style="width:${wH}%;"></div>
          <div class="ai-bar-fill-a" style="width:${wA}%;"></div>
        </div>
      </div>
    `;
  };
  
  box.innerHTML = `
    <div class="ai-summary">${txt}</div>
    <div style="display:flex; justify-content:space-between; margin-bottom:20px;">
      <div class="text-orange" style="font-weight:900; font-size:20px;">${h.home.name}</div>
      <div class="text-blue" style="font-weight:900; font-size:20px;">${h.away.name}</div>
    </div>
    <div class="ai-bar-title">TEAM STATS COMPARISON</div>
    ${uiBar('TOTAL SCORE', hP, aP)}
    ${uiBar('3-POINTS', h3, a3)}
    ${uiBar('2-POINTS', h2, a2)}
    ${uiBar('FREE THROWS', hFT, aFT)}
    ${uiBar('FOULS', hF, aF)}
  `;
  
  document.getElementById('modal-ai-analysis').parentElement.classList.add('open');
}

// Global modal close bind
document.querySelectorAll('.modal-close').forEach(b => {
  b.addEventListener('click', e => { e.target.closest('.modal-overlay').classList.remove('open'); });
});

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupPassword();
  setupRimlyCanvas();
  setupTabs();
});

// --- CUSTOM DIALOGS ---
function showAlert(msg) {
  return new Promise(resolve => {
    document.getElementById('dialog-title').textContent = 'お知らせ';
    document.getElementById('dialog-msg').textContent = msg;
    document.getElementById('dialog-btn-cancel').style.display = 'none';
    const okBtn = document.getElementById('dialog-btn-ok');
    okBtn.onclick = () => { closeDialog(); resolve(); };
    document.getElementById('overlay-custom-dialog').classList.add('open');
  });
}
function showConfirm(msg) {
  return new Promise(resolve => {
    document.getElementById('dialog-title').textContent = '確認';
    document.getElementById('dialog-msg').textContent = msg;
    document.getElementById('dialog-btn-cancel').style.display = 'block';
    document.getElementById('dialog-btn-cancel').onclick = () => { closeDialog(); resolve(false); };
    const okBtn = document.getElementById('dialog-btn-ok');
    okBtn.onclick = () => { closeDialog(); resolve(true); };
    document.getElementById('overlay-custom-dialog').classList.add('open');
  });
}
function closeDialog() {
  document.getElementById('overlay-custom-dialog').classList.remove('open');
}
function isFoulOut(p) {
  // P/O (Personal type) = p.pf - (p.tf + p.uf + p.df) if we were strictly counting, BUT
  // The simplest is: total personal type (P+O) = p.pf (since we increment it for everything?)
  // Wait, let's track p.po (Personal/Offensive) separately from p.tud (Tech/Unsports/Disqualifying)
  const po = (p.po || 0);
  const tud = (p.tud || 0);
  return po >= 5 || tud >= 2 || (p.df||0) >= 1;
}

// --- Log Editing ---
let editLogTarget = null;
function openEditLogPlayerModal(logItem) {
   editLogTarget = logItem;
   const tm = logItem.team;
   const pList = appState.game[tm].players;
   
   const grid = document.getElementById('edit-log-player-list');
   grid.innerHTML = '';
   pList.forEach(p => {
       const b = document.createElement('button');
       b.className = 'play-btn';
       if(p.id === logItem.pid) b.style.borderColor = 'var(--orange)';
       b.textContent = `#${p.num} ${p.name}`;
       b.onclick = () => { changeLogPlayer(logItem, p.id); };
       grid.appendChild(b);
   });
   document.getElementById('overlay-edit-log').classList.add('open');
}

function changeLogPlayer(logItem, newPid) {
   if(logItem.pid === newPid) { 
      document.getElementById('overlay-edit-log').classList.remove('open');
      return; 
   }
   
   const tm = logItem.team;
   const oldP = appState.game[tm].players.find(x => x.id === logItem.pid);
   const newP = appState.game[tm].players.find(x => x.id === newPid);
   
   if(logItem.type === 'SCORE') {
      if(oldP) {
         oldP.pts -= logItem.val;
         if(logItem.rawType==='1P') oldP.pt--; if(logItem.rawType==='2P') oldP.p2--; if(logItem.rawType==='3P') oldP.p3--;
      }
      if(newP) {
         newP.pts += logItem.val;
         if(logItem.rawType==='1P') newP.pt++; if(logItem.rawType==='2P') newP.p2++; if(logItem.rawType==='3P') newP.p3++;
      }
   } else if (logItem.type === 'FOUL') {
      if(oldP) {
         oldP.pf--;
         if(logItem.fType==='P' || logItem.fType==='O') oldP.po = Math.max(0, (oldP.po||0) - 1);
         if(logItem.fType==='T' || logItem.fType==='U' || logItem.fType==='D') oldP.tud = Math.max(0, (oldP.tud||0) - 1);
         if(logItem.fType==='T') oldP.tf = Math.max(0, (oldP.tf||0)-1); if(logItem.fType==='U') oldP.uf = Math.max(0, (oldP.uf||0)-1); if(logItem.fType==='D') oldP.df = Math.max(0, (oldP.df||0)-1);
      }
      if(newP) {
         newP.pf++;
         if(logItem.fType==='P' || logItem.fType==='O') newP.po = (newP.po||0) + 1;
         if(logItem.fType==='T' || logItem.fType==='U' || logItem.fType==='D') newP.tud = (newP.tud||0) + 1;
         if(logItem.fType==='T') newP.tf = (newP.tf||0)+1; if(logItem.fType==='U') newP.uf = (newP.uf||0)+1; if(logItem.fType==='D') newP.df = (newP.df||0)+1;
      }
   }
   
   logItem.pid = newPid;
   document.getElementById('overlay-edit-log').classList.remove('open');
   renderScore(); renderLogs();
   if(newP && isFoulOut(newP)) setTimeout(() => showAlert(`🚫 ${newP.name} (#${newP.num}) が退場しました！`), 200);
   showPop('記録を変更しました');
}

// --- Team Share / Import ---
document.addEventListener('DOMContentLoaded', () => {
  // Share button
  const btnShare = document.getElementById('btn-share-teams');
  if(btnShare) btnShare.onclick = () => {
    const data = JSON.stringify(appState.teamsDB);
    const encoded = btoa(unescape(encodeURIComponent(data)));
    const shareText = 'RIMLY_TEAMS:' + encoded;
    document.getElementById('share-teams-text').value = shareText;
    document.getElementById('overlay-share-teams').classList.add('open');
  };

  // Copy button
  const btnCopy = document.getElementById('btn-copy-share');
  if(btnCopy) btnCopy.onclick = () => {
    const ta = document.getElementById('share-teams-text');
    ta.select();
    ta.setSelectionRange(0, 999999);
    navigator.clipboard.writeText(ta.value).then(() => {
      showPop('📋 コピーしました！');
    }).catch(() => {
      document.execCommand('copy');
      showPop('📋 コピーしました！');
    });
  };

  // Import button (open modal)
  const btnImport = document.getElementById('btn-import-teams');
  if(btnImport) btnImport.onclick = () => {
    document.getElementById('import-teams-text').value = '';
    document.getElementById('overlay-import-teams').classList.add('open');
  };

  // Do Import
  const btnDoImport = document.getElementById('btn-do-import');
  if(btnDoImport) btnDoImport.onclick = () => {
    const raw = document.getElementById('import-teams-text').value.trim();
    if(!raw) { showAlert('テキストを貼り付けてください。'); return; }
    
    let jsonStr = raw;
    if(raw.startsWith('RIMLY_TEAMS:')) {
      try {
        jsonStr = decodeURIComponent(escape(atob(raw.replace('RIMLY_TEAMS:', ''))));
      } catch(e) {
        showAlert('❌ データの形式が正しくありません。コピーし直してもらってください。');
        return;
      }
    }
    
    try {
      const imported = JSON.parse(jsonStr);
      if(!Array.isArray(imported)) throw new Error('not array');
      
      let addedCount = 0;
      imported.forEach(t => {
        if(!t.name) return;
        // Skip if team with same name already exists
        const exists = appState.teamsDB.find(x => x.name === t.name);
        if(!exists) {
          appState.teamsDB.push({ id: Date.now() + Math.random(), name: t.name, players: t.players || [] });
          addedCount++;
        }
      });
      
      saveData();
      renderTeamsDB();
      document.getElementById('overlay-import-teams').classList.remove('open');
      showAlert(`✅ ${addedCount}チームを取り込みました！${imported.length - addedCount > 0 ? `（${imported.length - addedCount}チームは既に登録済み）` : ''}`);
    } catch(e) {
      showAlert('❌ データの形式が正しくありません。コピーし直してもらってください。');
    }
  };

  // Close buttons for share/import modals
  document.querySelectorAll('#overlay-share-teams .modal-close, #overlay-import-teams .modal-close').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('overlay-share-teams').classList.remove('open');
      document.getElementById('overlay-import-teams').classList.remove('open');
    };
  });
});
