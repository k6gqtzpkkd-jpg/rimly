/* ==========================================================
   RIMLY v4 CLASSIC GLOW - Logic & State Handling
   ========================================================== */

let pwInput = '';

let appState = {
  isGameActive: false,
  activeTab: 'setup',
  settings: { storageMode: 'local', dbKey: '' },
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

// --- Storage System, Settings, OS Checking ---
const DB_API = '/api/db';

async function loadData() {
  // Load settings first
  try {
    appState.settings = JSON.parse(localStorage.getItem('rimly_settings')) || { storageMode: 'local', dbKey: '', statsMode: 'basic', autoCopy: 'false' };
  } catch (e) { }
  if (!appState.settings.dbKey) {
    appState.settings.dbKey = 'USER_' + Math.random().toString(36).substr(2, 9).toUpperCase();
    localStorage.setItem('rimly_settings', JSON.stringify(appState.settings));
  }

  const mode = appState.settings.storageMode;

  // チームデータはオフラインでも絶対に消えないよう【常に完全本体保存】で即座に読み込む
  try {
    const profileKey = appState.settings.dbKey || 'default';
    let scopedTeams = localStorage.getItem(`rimly_teams_${profileKey}`);

    // セキュリティ対策：全く新しい他人がログインした場合は空（[]）からスタートさせる。
    // ただしアップデート直後の「最初の人（あなた）」だけは、過去のデータを引き継ぐ。
    if (!scopedTeams) {
      if (localStorage.getItem('rimly_v4_teams') && !localStorage.getItem('legacy_teams_migrated')) {
        scopedTeams = localStorage.getItem('rimly_v4_teams');
        localStorage.setItem('legacy_teams_migrated', 'true');
      } else {
        scopedTeams = '[]';
      }
    }

    appState.teamsDB = JSON.parse(scopedTeams);
    appState.teamsDB = appState.teamsDB.filter(t => t.name !== 'HOME TEAM' && t.name !== 'AWAY TEAM' && t.name !== 'HOME' && t.name !== 'AWAY');
  } catch (e) { appState.teamsDB = []; }

  try {
    const savedMatch = localStorage.getItem('rimly_v4_active_match');
    if (savedMatch) {
      const parsedMatch = JSON.parse(savedMatch);
      if (parsedMatch.isGameActive) {
        appState.game = parsedMatch.game;
        appState.isGameActive = parsedMatch.isGameActive;
        appState.activeTab = parsedMatch.activeTab || 'score';
        document.querySelectorAll('.tab-btn[data-tab="setup"], .tab-btn[data-tab="history"], .tab-btn[data-tab="teams"]').forEach(b => b.disabled = true);
        setTimeout(() => switchTab(appState.activeTab), 50);
      }
    }
  } catch (e) { }

  // 待たせずにまずチーム画面を描画してしまう（白紙防止）
  if (appState.activeTab === 'teams') renderTeamsTab();

  if (mode === 'local' || mode === 'hybrid') {
    try {
      const profileKey = appState.settings.dbKey || 'default';
      let scopedHistory = localStorage.getItem(`rimly_history_${profileKey}`);

      if (!scopedHistory) {
        if (localStorage.getItem('rimly_v4_history') && !localStorage.getItem('legacy_history_migrated')) {
          scopedHistory = localStorage.getItem('rimly_v4_history');
          localStorage.setItem('legacy_history_migrated', 'true');
        } else {
          scopedHistory = '[]';
        }
      }
      appState.historyDB = JSON.parse(scopedHistory);
    } catch (e) { }
  } else {
    appState.historyDB = [];
  }

  // Cloud Load for DB / Hybrid
  if (mode === 'db' || mode === 'hybrid') {
    // hybridモード：localStorageにデータがあればDBを読まない
    if (mode === 'hybrid' && appState.historyDB.length > 0) {
      showPop('📱 ローカルデータ使用中');
    } else {
      try {
        showPop('☁️ クラウド同期中...');

        const res = await fetch(DB_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'load', user_key: appState.settings.dbKey }) });
        const json = await res.json();
        if (json.success && json.data) {
          if (json.data.history) appState.historyDB = json.data.history;
          if (mode === 'hybrid') {
            localStorage.setItem('rimly_v4_history', JSON.stringify(appState.historyDB));
          }
          showPop('✅ クラウド同期完了');
        } else if (json.error) {
          if (mode === 'db') showAlert('DBエラー: ' + json.error + '\\n※Neon DBが未設定の可能性があります');
        }
      } catch (e) {
        console.error(e);
        if (mode === 'db') showAlert('クラウド同期に失敗しました。オフラインかDB連携が構成されていません。');
        else showPop('❌ 同期エラー (ローカル使用中)');
      }
    }
    appState.teamsDB.forEach(t => { if (!t.players) t.players = []; });

    if (appState.activeTab === 'teams') renderTeamsTab();
    if (appState.activeTab === 'history') renderHistory();
  }
}

async function saveData() {
  const mode = appState.settings.storageMode;
  const profileKey = appState.settings.dbKey || 'default';

  // チームはどんな設定でも常に本体を最優先で安全保存
  localStorage.setItem(`rimly_teams_${profileKey}`, JSON.stringify(appState.teamsDB));
  // 念のため旧型式にもバックアップ保存しておく（互換性維持）
  localStorage.setItem('rimly_v4_teams', JSON.stringify(appState.teamsDB));

  if (mode === 'local' || mode === 'hybrid') {
    localStorage.setItem(`rimly_history_${profileKey}`, JSON.stringify(appState.historyDB));
  }

  // DB保存は試合履歴（History）のみに特化させる
  if (mode === 'db' || mode === 'hybrid') {
    try {
      await fetch(DB_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          user_key: appState.settings.dbKey,
          history: appState.historyDB.slice(-30)  // DBには最新30件のみ
        })

      });
    } catch (e) {
      console.error('Cloud save failed');
    }
  }
}

function saveActiveMatchState() {
  if (appState.isGameActive) {
    localStorage.setItem('rimly_v4_active_match', JSON.stringify({
      game: appState.game,
      isGameActive: appState.isGameActive,
      activeTab: appState.activeTab
    }));
  } else {
    localStorage.removeItem('rimly_v4_active_match');
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveActiveMatchState();
});
window.addEventListener('pagehide', () => saveActiveMatchState());

function checkOSUpdate() {
  const currentUA = navigator.userAgent;
  let osVersion = 'Unknown';
  if (/android/i.test(currentUA)) {
    const match = currentUA.match(/Android\s([0-9\.]*)/i);
    if (match) osVersion = `Android ${match[1]}`;
  } else if (/iPad|iPhone|iPod/.test(currentUA) && !window.MSStream) {
    const match = currentUA.match(/OS\s([0-9_]*)/i);
    if (match) osVersion = `iOS ${match[1].replace(/_/g, '.')}`;
  } else if (/Mac OS X/.test(currentUA)) {
    const match = currentUA.match(/Mac OS X\s([0-9_]*)/i);
    if (match) osVersion = `macOS ${match[1].replace(/_/g, '.')}`;
  }

  const lastOS = localStorage.getItem('rimly_os_version');
  if (lastOS && lastOS !== osVersion && lastOS !== 'Unknown') {
    showAlert(`OSが【${lastOS}】から【${osVersion}】にアップデートされたことを検知しました。\n\n【トラブル解決マニュアル】\nアップデート直後はブラウザの仕様変更等により、文字化けやレイアウト崩れ等の動作不良が起きる可能性があります。\n不具合を感じた場合は「ブラウザのキャッシュ削除」もしくは「ホーム画面アイコンの作り直し(アプリ再インストール)」を行うことで直ります。`);
  }
  localStorage.setItem('rimly_os_version', osVersion);
}


// --- PASSWORD SCREEN ---
function setupPassword() {
  const ds = Array.from({ length: 6 }, (_, i) => document.getElementById(`dot-${i}`));

  const updateDots = (err = false) => {
    ds.forEach((d, i) => {
      d.className = 'dot';
      if (i < pwInput.length) d.classList.add('filled');
      if (err) d.classList.add('error');
    });
  };

  const checkPw = () => {
    const correctPw = localStorage.getItem('rimly_app_pw') || '082655';
    if (pwInput === correctPw) {
      document.getElementById('password-screen').classList.remove('active');
      document.getElementById('app-screen').classList.add('active');
    } else {
      document.getElementById('pw-error').textContent = 'パスワードが一致しません';
      updateDots(true);
      setTimeout(() => { pwInput = ''; updateDots(); document.getElementById('pw-error').textContent = ''; }, 1200);
    }
  };

  document.querySelectorAll('.num-btn[data-n]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (pwInput.length < 6) {
        pwInput += btn.dataset.n;
        updateDots();
        if (pwInput.length === 6) setTimeout(checkPw, 100);
      }
    });
  });

  document.getElementById('pw-clear').addEventListener('click', () => {
    pwInput = pwInput.slice(0, -1);
    updateDots();
    document.getElementById('pw-error').textContent = '';
  });

  // KB Support
  document.addEventListener('keydown', e => {
    if (!document.getElementById('password-screen').classList.contains('active')) return;
    if (e.key >= '0' && e.key <= '9' && pwInput.length < 6) { pwInput += e.key; updateDots(); if (pwInput.length === 6) setTimeout(checkPw, 100); }
    else if (e.key === 'Backspace') { pwInput = pwInput.slice(0, -1); updateDots(); document.getElementById('pw-error').textContent = ''; }
  });

  // 🌍 ▼ iPhone(NFC)からの遠隔ロック解除を監視（ポーリング）する機能 ▼ 🌍
  let pollInterval = setInterval(async () => {
    // 既にパスワード画面が消えていれば監視終了
    if (!document.getElementById('password-screen').classList.contains('active')) {
      clearInterval(pollInterval);
      return;
    }

    try {
      // 設定されているキーでのみ監視。複数キー対応
      const sessionStr = appState?.settings?.authKey;
      if (!sessionStr) return;

      const sessionKeys = sessionStr.split(',').map(k => k.trim()).filter(Boolean);
      if (sessionKeys.length === 0) return;

      for (const sk of sessionKeys) {
        const res = await fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_auth', session_id: sk })
        });
        const json = await res.json();

        if (json.success && json.is_unlocked) {
          // iPhone側で解除が行われた！
          clearInterval(pollInterval);

          // 💡 ここがマルチユーザーの切り替えの要！
          // 解除に使ったキーをそのままこの端末のアクティブなユーザーとしてセットし、そのユーザーのデータを読み込む
          appState.settings.dbKey = sk;
          localStorage.setItem('rimly_settings', JSON.stringify(appState.settings));
          await loadData(); // その人のチーム情報や履歴に画面を切り替える

          document.getElementById('pw-error').style.color = '#00e676';
          document.getElementById('pw-error').textContent = `✅ 解除完了 (ユーザー: ${sk.substring(0, 8)})`;

          // パスワードのドットを全部緑にする演出
          ds.forEach(d => { d.classList.add('filled'); d.style.background = '#00e676'; d.style.boxShadow = '0 0 10px #00e676'; });

          setTimeout(() => {
            document.getElementById('password-screen').classList.remove('active');
            document.getElementById('app-screen').classList.add('active');
          }, 1000);
          break; // 1つ解除されたらもう十分なのでfor文抜ける
        }
      }
    } catch (e) {
      // ネットワークがない場合などは無視してポーリングを続ける
    }
  }, 2000); // 2秒ごとに確認
}


// Canvas DB draw
function setupRimlyCanvas() {
  const canvas = document.getElementById('rimly-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = 360; canvas.height = 100;
  let drawn = 0; const speed = 8;

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = Math.min(drawn / 600, 1);
    ctx.shadowColor = '#FF6B00'; ctx.shadowBlur = 25 * t;
    const g = ctx.createLinearGradient(60, 0, 300, 0);
    g.addColorStop(0, '#FF8C35'); g.addColorStop(0.5, '#FF6B00'); g.addColorStop(1, '#E05000');
    ctx.fillStyle = g;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, canvas.width * t, canvas.height); ctx.clip();

    ctx.font = 'bold 74px "Outfit"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Rimly', canvas.width / 2, canvas.height / 2 + 5);
    ctx.restore();
    drawn += speed;
    if (t < 1) requestAnimationFrame(render);
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
      if (appState.isGameActive && (target === 'setup' || target === 'history' || target === 'teams')) {
        showAlert('試合中はセットアップや履歴、チーム登録画面には移動できません。');
        return;
      }
      if (!appState.isGameActive && (target === 'score' || target === 'plays' || target === 'fouls')) {
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

  if (t === 'setup') renderSetup();
  if (t === 'score') renderScore();
  if (t === 'history') renderHistory();
  if (t === 'teams') renderTeamsTab();
  if (t === 'plays' || t === 'fouls') renderLogs();
  if (t === 'settings') renderSettings();

  if (typeof saveActiveMatchState === 'function') saveActiveMatchState();
}

function renderSettings() {
  document.getElementById('setting-storage-mode').value = appState.settings.storageMode || 'local';
  document.getElementById('setting-db-key').value = appState.settings.dbKey || '';
  document.getElementById('setting-stats-mode').value = appState.settings.statsMode || 'basic';
  document.getElementById('setting-auto-copy').value = appState.settings.autoCopy || 'false';
  document.getElementById('setting-app-pw').value = localStorage.getItem('rimly_app_pw') || '082655';

  const authKeyEl = document.getElementById('setting-auth-key');
  if (authKeyEl) authKeyEl.value = appState.settings.authKey || '';

  const btnPw = document.getElementById('btn-save-pw');
  if (btnPw) {
    btnPw.onclick = () => {
      const newPw = document.getElementById('setting-app-pw').value.trim();
      if (!/^\d{6}$/.test(newPw)) {
        showAlert('パスワードは6桁の数字で指定してください。'); return;
      }
      localStorage.setItem('rimly_app_pw', newPw);
      showAlert('パスワードを「' + newPw + '」に変更しました！次回の起動時から有効になります。');
    };
  }

  const btnAuthKey = document.getElementById('btn-save-auth-key');
  if (btnAuthKey) {
    btnAuthKey.onclick = () => {
      const authKeyEl = document.getElementById('setting-auth-key');
      appState.settings.authKey = authKeyEl.value.trim().toUpperCase();
      localStorage.setItem('rimly_settings', JSON.stringify(appState.settings));
      document.getElementById('auth-key-status-msg').textContent = '連携キーを適用しました！';
      setTimeout(() => { document.getElementById('auth-key-status-msg').textContent = ''; }, 3000);
    };
  }

  document.getElementById('btn-save-settings').onclick = async () => {
    const btn = document.getElementById('btn-save-settings');
    btn.disabled = true;
    btn.textContent = '同期中...';

    appState.settings.storageMode = document.getElementById('setting-storage-mode').value;
    appState.settings.dbKey = document.getElementById('setting-db-key').value.trim();
    appState.settings.statsMode = document.getElementById('setting-stats-mode').value;
    appState.settings.autoCopy = document.getElementById('setting-auto-copy').value;

    const authKeyEl = document.getElementById('setting-auth-key');
    if (authKeyEl) appState.settings.authKey = authKeyEl.value.trim().toUpperCase();

    localStorage.setItem('rimly_settings', JSON.stringify(appState.settings));

    await loadData();
    if (appState.settings.storageMode !== 'local') await saveData();

    document.getElementById('settings-status-msg').textContent = '設定を保存しました。';
    setTimeout(() => { document.getElementById('settings-status-msg').textContent = ''; }, 3000);
    btn.disabled = false;
    btn.textContent = '適用 / クラウド同期';
  };
}


// --- 1. SETUP LOGIC ---
function renderSetup() {
  const g = appState.game;
  document.getElementById('setup-home-name').value = g.home.name;
  document.getElementById('setup-away-name').value = g.away.name;

  ['home', 'away'].forEach(tm => {
    const pnl = document.getElementById(`setup-${tm}-color`);
    pnl.querySelectorAll('.ts-btn').forEach(b => b.classList.remove('active', 'ts-orange', 'ts-blue'));
    pnl.querySelector(`[data-val="${g[tm].color}"]`).classList.add('active', tm === 'home' ? 'ts-orange' : 'ts-blue');
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
window.openTeamLoadModal = function (team) {
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
  if (filtered.length === 0) { list.innerHTML = '<div style="color:var(--text-secondary)">登録チームがありません</div>'; return; }

  filtered.forEach(dbT => {
    const el = document.createElement('div');
    el.className = 'sl-item text-primary';
    el.innerHTML = `<span>${dbT.name}</span> <span class="text-secondary">${dbT.players.length}名</span>`;
    el.onclick = () => {
      appState.game[actTeamTarget].name = dbT.name;
      // Deep copy + reset stats
      appState.game[actTeamTarget].players = JSON.parse(JSON.stringify(dbT.players)).map(p => ({ ...p, pts: 0, p3: 0, p2: 0, pt: 0, pf: 0 }));
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

  // 1. チームの成績をリセット
  g.score = { home: 0, away: 0 };
  g.quarter = 1; g.isOT = false;
  g.teamFouls = { home: 0, away: 0 };
  g.timeouts = { home: { h1: 0, h2: 0, ot: 0 }, away: { h1: 0, h2: 0, ot: 0 } };
  g.logs = [];

  // 2. ★追加：選手個人のスタッツ（得点やファウル）を全員「0」にリセットする
  const resetStats = (players) => {
    if (!players || !Array.isArray(players)) return;
    players.forEach(p => {
      // 基本スタッツ
      p.pts = 0; p.p2 = 0; p.p3 = 0; p.pt = 0; p.pf = 0; p.halfPts = 0;
      // 詳細モード用スタッツ（もしあれば）
      p.ast = 0; p.reb = 0; p.stl = 0; p.blk = 0; p.turnover = 0;
    });
  };
  resetStats(g.home.players);
  resetStats(g.away.players);

  appState.isGameActive = true;
  document.querySelectorAll('.tab-btn[data-tab="setup"], .tab-btn[data-tab="history"]').forEach(b => b.disabled = true);

  // 3. ★追加：画面の表示も問答無用で「0」や「初期状態」に戻す
  const hs = document.getElementById('home-score');
  const as = document.getElementById('away-score');
  if (hs) hs.textContent = '0';
  if (as) as.textContent = '0';

  const pInfo = document.getElementById('period-info');
  const qLabel = document.getElementById('quarter-label');
  if (pInfo) pInfo.textContent = '1st QUARTER';
  if (qLabel) qLabel.textContent = 'Q1';

  showPop('TIP OFF! 🏀');
  switchTab('score');

  // もし各種表示を更新する関数があれば、このタイミングで再描画させて画面を空っぽにする
  if (typeof renderScore === 'function') renderScore();
  if (typeof renderLogs === 'function') renderLogs();
  if (typeof renderFouls === 'function') renderFouls();
  if (typeof renderPlayers === 'function') { renderPlayers('home'); renderPlayers('away'); }
};


// --- 2. SCOREBOARD LOGIC ---
const TO_LIMS = { h1: 2, h2: 3, ot: 3 };
function getQHalf(q, isOT) { return isOT ? 'ot' : (q <= 2 ? 'h1' : 'h2'); }
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
  document.getElementById('period-info').textContent = g.isOT ? 'OVERTIME' : plabels[g.quarter - 1];

  // Fouls
  ['home', 'away'].forEach(t => {
    document.getElementById(`tf-${t}-val`).textContent = g.teamFouls[t];
    if (g.teamFouls[t] >= 5) document.getElementById(`tf-${t}-val`).classList.add('danger');
    else document.getElementById(`tf-${t}-val`).classList.remove('danger');

    const pips = document.getElementById(`tf-${t}-pips`);
    pips.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const p = document.createElement('div');
      p.className = 'tf-pip';
      if (i <= g.teamFouls[t]) { p.classList.add('on'); if (g.teamFouls[t] >= 5) p.classList.add('danger'); }
      pips.appendChild(p);
    }

    // Timeouts
    const hf = getQHalf(g.quarter, g.isOT);
    const use = g.timeouts[t][hf];
    const max = TO_LIMS[hf];
    const rem = max - use;

    let lbl = 'TIMEOUT (延長)';
    if (hf === 'h1') lbl = 'TIMEOUT (前半: Q1-Q2)';
    if (hf === 'h2') lbl = 'TIMEOUT (後半: Q3-Q4)';
    document.getElementById(`to-${t}-label`).textContent = lbl;
    document.getElementById(`to-${t}-rem`).textContent = Math.max(0, rem);

    const tpips = document.getElementById(`to-${t}-pips`);
    tpips.innerHTML = '';
    for (let i = 1; i <= max; i++) {
      const p = document.createElement('div');
      p.className = 'to-pip';
      if (i > rem) p.classList.add('used');
      tpips.appendChild(p);
    }
  });

  // Team foul warning banners
  ['home', 'away'].forEach(t => {
    const panel = document.querySelector(`.stat-panel.border-left-${t === 'home' ? 'orange' : 'blue'}`);
    if (!panel) return;
    const existBanner = panel.querySelector('.team-foul-warning-banner');
    if (existBanner) existBanner.remove();
    if (g.teamFouls[t] >= 5) {
      const banner = document.createElement('div');
      banner.className = `team-foul-warning-banner warn-${t === 'home' ? 'orange' : 'red'}`;
      banner.textContent = `⚠️ チームファウル ${g.teamFouls[t]} — フリースロー対象`;
      panel.querySelector('.split-stats').after(banner);
    }
  });

  renderTableRoster('home');
  renderTableRoster('away');
  renderQuarterScores();
  renderQuickUndo();

  if (typeof saveActiveMatchState === 'function') saveActiveMatchState();
}

// Quarter buttons
document.getElementById('q-prev').onclick = () => {
  const g = appState.game;
  if (g.isOT) { g.isOT = false; g.quarter = 4; }
  else if (g.quarter > 1) g.quarter--;
  g.teamFouls = { home: 0, away: 0 };
  renderScore();
};
document.getElementById('q-next').onclick = () => {
  const g = appState.game;
  const prevQ = g.quarter;
  const wasOT = g.isOT;
  if (!g.isOT && g.quarter < 4) g.quarter++;
  else if (g.quarter === 4 && !g.isOT) g.isOT = true;
  g.teamFouls = { home: 0, away: 0 };
  renderScore();
  // Show halftime report when moving from Q2 to Q3
  if (!wasOT && prevQ === 2 && g.quarter === 3) {
    setTimeout(() => showHalftimeReport(), 300);
  }
};

window.useTimeout = function (t) {
  const g = appState.game;
  const hf = getQHalf(g.quarter, g.isOT);
  if (g.timeouts[t][hf] >= TO_LIMS[hf]) { showAlert('このハーフ(延長)でのタイムアウト上限です。'); return; }

  g.timeouts[t][hf]++;
  g.logs.unshift({ id: Date.now(), tstamp: Date.now(), qStr: getQStr(), team: t, pid: 'TO', type: 'TO', detail: 'TIMEOUT', val: 0 });

  showPop('TIMEOUT!');
  renderScore();
};

// Player Rosters
function addStat(tm, pid, statKey, statLabel) {
  const g = appState.game;
  const p = g[tm].players.find(x => x.id === pid);
  p[statKey] = (p[statKey] || 0) + 1;
  g.logs.unshift({ id: Date.now(), tstamp: Date.now(), qStr: getQStr(), team: tm, pid: p.id, type: 'STAT', detail: statLabel, val: 0, statKey: statKey });
  showPop(`+1 ${statLabel.split(' ')[0]}! (#${p.num} ${p.name})`);
  renderScore();
}

function renderTableRoster(tm) {
  const table = document.getElementById(`roster-${tm}-table`);
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  const isAdv = appState.settings.statsMode === 'advanced';

  // 🔽 追加：テーブルの上に自動で「🔄選手交代ボタン」を作る
  const rosterHeader = table.parentElement.previousElementSibling;
  if (rosterHeader && !rosterHeader.querySelector('.btn-sub')) {
    const subBtn = document.createElement('button');
    subBtn.className = 'btn-sm btn-outline-glow btn-sub';
    subBtn.style.marginRight = '8px';
    subBtn.innerHTML = '🔄 選手交代';
    subBtn.onclick = () => openSubstitutionModal(tm);
    const addBtn = rosterHeader.querySelector('button'); // ＋選手追加ボタン
    if (addBtn) addBtn.before(subBtn);
  }

  let headHTML = `<tr><th>#</th><th>PLAYER</th><th title="得点">PTS</th><th title="3ポイント">3P</th><th title="2ポイント">2P</th><th title="フリースロー">FT</th><th title="ファウル">FOULS</th>`;
  if (isAdv) headHTML += `<th title="アシスト">AST</th><th title="オフェンスリバウンド">ORB</th><th title="ディフェンスリバウンド">DRB</th><th title="スティール">STL</th><th title="ターンオーバー">TOV</th><th title="ブロック">BLK</th>`;
  headHTML += `</tr>`;
  thead.innerHTML = headHTML;
  tbody.innerHTML = '';

  // 🔽 変更：「コートに出ている（isOnCourt === true）5人だけ」を厳選してスコアボードに描画！
  appState.game[tm].players.filter(p => p.isOnCourt).forEach(p => {
    if (typeof p.ast === 'undefined') { p.ast = 0; p.orb = 0; p.drb = 0; p.stl = 0; p.tov = 0; p.blk = 0; }
    let tdHTML = `
      <td class="td-num">${p.num}</td>
      <td class="td-player-name" style="text-align:left;">${p.name}</td>
      <td class="td-pts">${p.pts}</td>
      <td class="hover-cell cell-3p" style="color:var(--text-secondary);"><span class="cell-bg">${p.p3}</span></td>
      <td class="hover-cell cell-2p" style="color:var(--text-secondary);"><span class="cell-bg">${p.p2}</span></td>
      <td class="hover-cell cell-ft" style="color:var(--text-secondary);"><span class="cell-bg">${p.pt}</span></td>
      <td class="hover-cell cell-pf ${p.pf >= 6 ? 'text-red' : (p.pf >= 5 ? 'text-orange' : '')}">
        <span class="cell-bg">${p.pf}</span>
        ${p.pf === 4 ? '<span class="foul-warning-badge badge-orange">注意</span>' : ''}
        ${p.pf === 5 ? '<span class="foul-warning-badge badge-red">危険</span>' : ''}
        ${(typeof isFoulOut === 'function' && isFoulOut(p)) ? '<span class="foul-warning-badge badge-red">退場</span>' : ''}
      </td>
    `;
    if (isAdv) {
      tdHTML += `
      <td class="hover-cell cell-ast" style="color:var(--text-secondary);"><span class="cell-bg">${p.ast}</span></td>
      <td class="hover-cell cell-orb" style="color:var(--text-secondary);"><span class="cell-bg">${p.orb}</span></td>
      <td class="hover-cell cell-drb" style="color:var(--text-secondary);"><span class="cell-bg">${p.drb}</span></td>
      <td class="hover-cell cell-stl" style="color:var(--text-secondary);"><span class="cell-bg">${p.stl}</span></td>
      <td class="hover-cell cell-tov" style="color:var(--text-secondary);"><span class="cell-bg">${p.tov}</span></td>
      <td class="hover-cell cell-blk" style="color:var(--text-secondary);"><span class="cell-bg">${p.blk}</span></td>
      `;
    }
    const tr = document.createElement('tr');
    tr.innerHTML = tdHTML;

    tr.querySelector('.td-player-name').onclick = () => openPlayerStatsModal(p, tm);
    tr.querySelector('.cell-3p').onclick = () => { if (typeof isFoulOut === 'function' && isFoulOut(p)) { showAlert('退場しています'); return; } addScore(tm, p.id, 3, '3P'); };
    tr.querySelector('.cell-2p').onclick = () => { if (typeof isFoulOut === 'function' && isFoulOut(p)) { showAlert('退場しています'); return; } addScore(tm, p.id, 2, '2P'); };
    tr.querySelector('.cell-ft').onclick = () => { if (typeof isFoulOut === 'function' && isFoulOut(p)) { showAlert('退場しています'); return; } addScore(tm, p.id, 1, '1P'); };
    tr.querySelector('.cell-pf').onclick = () => { if (typeof isFoulOut === 'function' && isFoulOut(p)) { showAlert('退場しています'); return; } openActionSheet(p.id, tm); };

    if (isAdv) {
      tr.querySelector('.cell-ast').onclick = () => { if (typeof isFoulOut === 'function' && isFoulOut(p)) { showAlert('退場しています'); return; } addStat(tm, p.id, 'ast', 'AST (アシスト)'); };
      tr.querySelector('.cell-orb').onclick = () => { if (typeof isFoulOut === 'function' && isFoulOut(p)) { showAlert('退場しています'); return; } addStat(tm, p.id, 'orb', 'ORB (Oリバウンド)'); };
      tr.querySelector('.cell-drb').onclick = () => { if (typeof isFoulOut === 'function' && isFoulOut(p)) { showAlert('退場しています'); return; } addStat(tm, p.id, 'drb', 'DRB (Dリバウンド)'); };
      tr.querySelector('.cell-stl').onclick = () => { if (typeof isFoulOut === 'function' && isFoulOut(p)) { showAlert('退場しています'); return; } addStat(tm, p.id, 'stl', 'STL (スティール)'); };
      tr.querySelector('.cell-tov').onclick = () => { if (typeof isFoulOut === 'function' && isFoulOut(p)) { showAlert('退場しています'); return; } addStat(tm, p.id, 'tov', 'TOV (ターンオーバー)'); };
      tr.querySelector('.cell-blk').onclick = () => { if (typeof isFoulOut === 'function' && isFoulOut(p)) { showAlert('退場しています'); return; } addStat(tm, p.id, 'blk', 'BLK (ブロック)'); };
    }

    if (p.pf === 4 || p.pf === 5) tr.classList.add('foul-warning-row');
    if (p.pf >= 6 || (typeof isFoulOut === 'function' && isFoulOut(p))) tr.classList.add('foul-danger-row');
    tbody.appendChild(tr);
  });
}

// -------------------------------------------------------------
// ▼ ここから下が スタメン・選手交代システム一式 ▼
// -------------------------------------------------------------
let subModalTeam = 'home';

function openSubstitutionModal(mode) {
  subModalTeam = mode;
  const g = appState.game;
  const existing = document.getElementById('overlay-substitution');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'overlay-substitution';
  overlay.className = 'modal-overlay active';
  overlay.style.zIndex = '99999';

  const target = (mode === 'both') ? 'home' : mode;

  // 開始前、もし誰もコートに出ていなければ上から最大5名自動選択しておく
  const onCourtCount = g[target].players.filter(p => p.isOnCourt).length;
  if (onCourtCount === 0) {
    for (let i = 0; i < Math.min(5, g[target].players.length); i++) { g[target].players[i].isOnCourt = true; }
  }

  overlay.innerHTML = `
    <div class="modal-box modal-lg" style="max-height:80vh; display:flex; flex-direction:column;">
      <div class="modal-header">
        <h3 class="modal-title" id="sub-modal-title" style="color:var(--${target === 'home' ? 'orange' : 'blue'})">
          ${mode === 'both' ? '🏀 スタメン選択 (HOME)' : '🔄 選手交代'}
        </h3>
        <button class="modal-close" id="btn-close-sub">✕</button>
      </div>
      <div class="modal-body" style="overflow-y:auto; flex:1; padding-bottom:120px;">
        <p style="color:var(--text-secondary); margin-bottom:10px; font-weight:bold;">コートに出る選手を（1〜5名）選択してください</p>
        <div id="sub-player-list" style="display:flex; flex-direction:column; gap:8px;"></div>
      </div>
      <div class="modal-footer" style="position:absolute; bottom:0; left:0; width:100%; background:#1c1e22; padding:15px; border-top:1px solid rgba(255,255,255,0.1);">
        <button class="ctrl-btn btn-mega-glow" id="btn-sub-confirm" style="width:100%; font-size:18px; padding:15px;">
          ${mode === 'both' ? '次へ (AWAY選択) →' : '決定して交代する'}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // 閉じるボタン
  document.getElementById('btn-close-sub').onclick = () => overlay.remove();

  // リストの描画処理
  const renderList = (tm) => {
    const listEl = document.getElementById('sub-player-list');
    listEl.innerHTML = '';

    g[tm].players.forEach(p => {
      const div = document.createElement('div');
      if (typeof p.isOnCourt === 'undefined') p.isOnCourt = false;
      const isOut = typeof isFoulOut === 'function' ? isFoulOut(p) : false;

      div.style.cssText = `padding: 12px; border-radius: 8px; border: 2px solid ${p.isOnCourt ? 'var(--orange)' : 'rgba(255,255,255,0.1)'}; background: ${p.isOnCourt ? 'rgba(255,100,0,0.1)' : (isOut ? 'rgba(255,0,0,0.1)' : 'transparent')}; display:flex; align-items:center; gap:10px; cursor:pointer; opacity: ${isOut ? '0.5' : '1'}; transition: 0.2s;`;

      div.innerHTML = `
        <div style="width:24px; height:24px; border-radius:50%; border:2px solid ${p.isOnCourt ? 'var(--orange)' : '#555'}; background:${p.isOnCourt ? 'var(--orange)' : 'transparent'}; flex-shrink:0;"></div>
        <div style="font-weight:900; font-size:18px; width:40px; color:${p.isOnCourt ? 'var(--text-primary)' : 'var(--text-secondary)'}">#${p.num}</div>
        <div style="flex:1; font-size:16px; font-weight:bold; color:${p.isOnCourt ? 'var(--text-primary)' : 'var(--text-secondary)'}">${p.name}</div>
        <div style="font-size:12px; font-weight:bold; color:${isOut ? 'var(--red)' : 'var(--text-secondary)'};">${p.pf} Fouls ${isOut ? '(退場)' : ''}</div>
      `;

      div.onclick = () => {
        if (isOut) return; // 退場者は交代ボタン押せない
        const currentCount = g[tm].players.filter(x => x.isOnCourt).length;
        if (!p.isOnCourt && currentCount >= 5) {
          if (typeof showPop === 'function') showPop('コートに出られるのは最大5名までです！');
          return;
        }
        p.isOnCourt = !p.isOnCourt;
        renderList(tm);
      };
      listEl.appendChild(div);
    });
  };

  renderList(target);

  // 決定ボタン
  document.getElementById('btn-sub-confirm').onclick = () => {
    const onCourtCount = g[target].players.filter(p => p.isOnCourt).length;
    // 🏀修正：5人未満（1名〜5名）でも許可する緩いルール
    if (onCourtCount === 0 || onCourtCount > 5) {
      if (typeof showPop === 'function') showPop(`現在 ${onCourtCount} 名選択されています。1名〜5名で選んでください！`);
      return;
    }

    if (subModalTeam === 'both' && target === 'home') {
      // 次にAWAYの選択へ移る
      document.getElementById('sub-modal-title').textContent = '🏀 スタメン選択 (AWAY)';
      document.getElementById('sub-modal-title').style.color = 'var(--blue)';
      document.getElementById('btn-sub-confirm').textContent = '試合開始！ 🏀';

      // AWAYの自動チェック
      const onCourtCountA = g.away.players.filter(p => p.isOnCourt).length;
      if (onCourtCountA === 0) {
        for (let i = 0; i < Math.min(5, g.away.players.length); i++) { g.away.players[i].isOnCourt = true; }
      }
      renderList('away');

      document.getElementById('btn-sub-confirm').onclick = () => {
        const checkA = g.away.players.filter(p => p.isOnCourt).length;
        if (checkA === 0 || checkA > 5) {
          if (typeof showPop === 'function') showPop(`現在 ${checkA} 名選択されています。1名〜5名で選んでください！`);
          return;
        }
        overlay.remove();
        executeActualStartMatch();
      };
    } else {
      // 通常の交代完了
      overlay.remove();
      if (typeof renderScore === 'function') renderScore(); // 画面を更新して表を再描画
    }
  };
}

// -------------------------------------------------------------
// ▼ START MATCH ボタンを押したときの動作を上書き（フック） ▼
// -------------------------------------------------------------
document.getElementById('btn-start-match').onclick = () => {
  const g = appState.game;
  g.home.name = document.getElementById('setup-home-name').value.trim() || 'HOME TEAM';
  g.away.name = document.getElementById('setup-away-name').value.trim() || 'AWAY TEAM';

  // 🏀テストや3x3などで5人未満でも開始できるように「最低1人以上」ならOK
  if (g.home.players.length < 1 || g.away.players.length < 1) {
    if (typeof showAlert === 'function') showAlert('試合を始めるには、両チームとも最低1名以上の選手を登録してください！');
    else alert('試合を始めるには、両チームとも最低1名以上の選手を登録してください！');
    return;
  }

  // スタメンを選ぶための交代画面を開く（終わったら自動で executeActualStartMatch へ）
  openSubstitutionModal('both');
};

// 元々の「リセットから試合開始まで」の処理をここに封じ込める
function executeActualStartMatch() {
  const g = appState.game;
  g.score = { home: 0, away: 0 };
  g.quarter = 1; g.isOT = false;
  g.teamFouls = { home: 0, away: 0 };
  g.timeouts = { home: { h1: 0, h2: 0, ot: 0 }, away: { h1: 0, h2: 0, ot: 0 } };
  g.logs = [];

  const resetStats = (players) => {
    if (!players || !Array.isArray(players)) return;
    players.forEach(p => {
      p.pts = 0; p.p2 = 0; p.p3 = 0; p.pt = 0; p.pf = 0; p.halfPts = 0;
      p.ast = 0; p.reb = 0; p.stl = 0; p.blk = 0; p.turnover = 0;
    });
  };
  resetStats(g.home.players);
  resetStats(g.away.players);

  appState.isGameActive = true;
  document.querySelectorAll('.tab-btn[data-tab="setup"], .tab-btn[data-tab="history"]').forEach(b => b.disabled = true);

  const hs = document.getElementById('home-score'); const as = document.getElementById('away-score');
  if (hs) hs.textContent = '0'; if (as) as.textContent = '0';
  const pInfo = document.getElementById('period-info'); const qLabel = document.getElementById('quarter-label');
  if (pInfo) pInfo.textContent = '1st QUARTER'; if (qLabel) qLabel.textContent = 'Q1';

  if (typeof showPop === 'function') showPop('TIP OFF! 🏀');
  if (typeof switchTab === 'function') switchTab('score');

  if (typeof renderScore === 'function') renderScore();
  if (typeof renderLogs === 'function') renderLogs();
  if (typeof renderFouls === 'function') renderFouls();
}



// -------------------------------------------------------------
// ▼ START MATCH ボタンを押したときの動作を上書き（フック） ▼
// -------------------------------------------------------------
document.getElementById('btn-start-match').onclick = () => {
  const g = appState.game;
  g.home.name = document.getElementById('setup-home-name').value.trim() || 'HOME TEAM';
  g.away.name = document.getElementById('setup-away-name').value.trim() || 'AWAY TEAM';

  // 人数が足りているかチェック
  if (g.home.players.length < 5 || g.away.players.length < 5) {
    if (typeof showAlert === 'function') showAlert('試合を始めるには、両チームとも最低5名以上の選手を登録してください！');
    else alert('試合を始めるには、両チームとも最低5名以上の選手を登録してください！');
    return;
  }

  // スタメンを選ぶための交代画面を開く（終わったら自動で executeActualStartMatch へ）
  openSubstitutionModal('both');
};

// 元々の「リセットから試合開始まで」の処理をここに封じ込める
/* --- 🏀 選手交代・スタメン管理システム（究極安定版） --- */

// 元々の退場判定があるかチェックし、なければ安全用の身代わりを作る
const safeIsFoulOut = (p) => {
  if (typeof isFoulOut === 'function') return isFoulOut(p);
  return p && p.pf >= 5; // 簡易判定
};

function renderTableRoster(tm) {
  try {
    setupFlipUI(tm);

    const table = document.getElementById(`roster-${tm}-table`);
    if (!table) return;
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    const isAdv = (appState.settings && appState.settings.statsMode === 'advanced');

    // テーブルの上に「🔄選手交代ボタン」を作る
    const rosterHeader = table.parentElement.previousElementSibling;
    if (rosterHeader && !rosterHeader.querySelector('.btn-sub')) {
      const subBtn = document.createElement('button');
      subBtn.className = 'btn-sm btn-outline-glow btn-sub';
      subBtn.style.marginRight = '8px';
      subBtn.innerHTML = '🔄 選手交代';
      subBtn.onclick = () => openSubstitutionModal(tm);
      const addBtn = rosterHeader.querySelector('button');
      if (addBtn) addBtn.before(subBtn);
    }

    thead.innerHTML = `<tr><th>#</th><th>PLAYER</th><th>PTS</th><th>3P</th><th>2P</th><th>FT</th><th>FOULS</th>${isAdv ? '<th>AST</th><th>ORB</th><th>DRB</th><th>STL</th><th>TOV</th><th>BLK</th>' : ''}</tr>`;
    tbody.innerHTML = '';

    // コートに出ている選手だけを描画
    (appState.game[tm].players || []).filter(p => p.isOnCourt).forEach(p => {
      const tr = document.createElement('tr');
      const fOut = safeIsFoulOut(p);

      tr.innerHTML = `
        <td class="td-num">${p.num}</td>
        <td class="td-player-name" style="text-align:left;">${p.name}</td>
        <td class="td-pts">${p.pts || 0}</td>
        <td class="hover-cell cell-3p"><span class="cell-bg">${p.p3 || 0}</span></td>
        <td class="hover-cell cell-2p"><span class="cell-bg">${p.p2 || 0}</span></td>
        <td class="hover-cell cell-ft"><span class="cell-bg">${p.pt || 0}</span></td>
        <td class="hover-cell cell-pf ${p.pf >= 5 ? 'text-orange' : ''}"><span class="cell-bg">${p.pf || 0}</span></td>
        ${isAdv ? `<td>${p.ast || 0}</td><td>${p.orb || 0}</td><td>${p.drb || 0}</td><td>${p.stl || 0}</td><td>${p.tov || 0}</td><td>${p.blk || 0}</td>` : ''}
      `;

      // クリックイベントの紐付け（安全策を強化）
      const click = (sel, fn) => { const el = tr.querySelector(sel); if (el) el.onclick = fn; };
      click('.td-player-name', () => { if (typeof openPlayerStatsModal === 'function') openPlayerStatsModal(p, tm); });
      click('.cell-3p', () => { if (fOut) return alert('退場しています'); addScore(tm, p.id, 3, '3P'); });
      click('.cell-2p', () => { if (fOut) return alert('退場しています'); addScore(tm, p.id, 2, '2P'); });
      click('.cell-ft', () => { if (fOut) return alert('退場しています'); addScore(tm, p.id, 1, '1P'); });
      click('.cell-pf', () => { if (fOut) return alert('退場しています'); if (typeof openActionSheet === 'function') openActionSheet(p.id, tm); else { p.pf++; renderScore(); } });

      tbody.appendChild(tr);
    });
  } catch (err) { console.error("renderTableRoster error:", err); }
}

function openSubstitutionModal(mode) {
  const g = appState.game;
  const target = (mode === 'both') ? 'home' : mode;

  // モーダルの作成と表示
  const overlay = document.createElement('div');
  overlay.id = 'overlay-substitution';
  overlay.className = 'modal-overlay active';
  overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:99999; display:flex; align-items:center; justify-content:center;';

  overlay.innerHTML = `
    <div class="modal-box" style="background:#1c1e22; border-radius:12px; width:90%; max-width:500px; max-height:85vh; display:flex; flex-direction:column; border:1px solid #444;">
      <div style="padding:20px; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;">
        <h3 id="sub-title" style="margin:0; color:var(--orange);">${mode === 'both' ? '🏀 スタメン選択 (HOME)' : '🔄 選手交代'}</h3>
        <button id="sub-close" style="background:none; border:none; color:white; font-size:24px; cursor:pointer;">✕</button>
      </div>
      <div id="sub-list" style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:10px;"></div>
      <div style="padding:20px; border-top:1px solid #333;">
        <button id="sub-ok" style="width:100%; padding:15px; background:var(--orange); color:white; border:none; border-radius:8px; font-weight:bold; font-size:18px;">
          ${mode === 'both' ? '次へ (AWAY) →' : '交代を確定する'}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const drawList = (tm) => {
    const listEl = document.getElementById('sub-list');
    listEl.innerHTML = '';
    const players = g[tm].players || [];
    // 初期状態で誰もいないなら5名自動チェック
    if (players.filter(p => p.isOnCourt).length === 0) {
      players.slice(0, 5).forEach(p => p.isOnCourt = true);
    }

    players.forEach(p => {
      const isOut = safeIsFoulOut(p);
      const row = document.createElement('div');
      row.style.cssText = `padding:12px; border-radius:8px; border:2px solid ${p.isOnCourt ? 'var(--orange)' : '#333'}; background:${p.isOnCourt ? 'rgba(255,100,0,0.1)' : 'transparent'}; display:flex; align-items:center; opacity:${isOut ? '0.5' : '1'};`;
      row.innerHTML = `
        <div style="width:20px; height:20px; border-radius:50%; border:2px solid ${p.isOnCourt ? 'var(--orange)' : '#666'}; background:${p.isOnCourt ? 'var(--orange)' : 'transparent'}; margin-right:15px;"></div>
        <div style="font-weight:bold; width:40px;">#${p.num}</div>
        <div style="flex:1;">${p.name}</div>
        <div style="font-size:12px; color:#aaa;">${p.pf || 0}F</div>
      `;
      if (!isOut) {
        row.onclick = () => {
          const count = players.filter(x => x.isOnCourt).length;
          if (!p.isOnCourt && count >= 5) return alert('コートに出られるのは最大5名までです');
          p.isOnCourt = !p.isOnCourt;
          drawList(tm);
        };
      }
      listEl.appendChild(row);
    });
  };

  drawList(target);
  document.getElementById('sub-close').onclick = () => overlay.remove();

  const okBtn = document.getElementById('sub-ok');
  okBtn.onclick = () => {
    const count = g[target].players.filter(p => p.isOnCourt).length;
    if (count === 0 || count > 5) return alert('1名〜5名の選手を選択してください');

    if (mode === 'both' && target === 'home') {
      document.getElementById('sub-title').textContent = '🏀 スタメン選択 (AWAY)';
      document.getElementById('sub-title').style.color = 'var(--blue)';
      okBtn.textContent = '試合開始！ 🏀';
      okBtn.style.background = 'var(--blue)';
      okBtn.onclick = () => {
        const countA = g.away.players.filter(p => p.isOnCourt).length;
        if (countA === 0 || countA > 5) return alert('1名〜5名の選手を選択してください');
        overlay.remove();
        executeActualStartMatch();
      };
      drawList('away');
    } else {
      overlay.remove();
      renderScore();
    }
  };
}

document.getElementById('btn-start-match').onclick = () => {
  const g = appState.game;
  g.home.name = (document.getElementById('setup-home-name').value || '').trim() || 'HOME';
  g.away.name = (document.getElementById('setup-away-name').value || '').trim() || 'AWAY';
  if (!g.home.players || g.home.players.length === 0 || !g.away.players || g.away.players.length === 0) {
    return alert('両方のチームに選手を登録（または読み込み）してください');
  }
  openSubstitutionModal('both');
};

function executeActualStartMatch() {
  try {
    const g = appState.game;
    g.score = { home: 0, away: 0 };
    g.quarter = 1; g.isOT = false;
    g.teamFouls = { home: 0, away: 0 };
    g.timeouts = { home: { h1: 0, h2: 0, ot: 0 }, away: { h1: 0, h2: 0, ot: 0 } };
    g.logs = [];

    [g.home.players, g.away.players].forEach(list => {
      if (list) list.forEach(p => { p.pts = 0; p.p2 = 0; p.p3 = 0; p.pt = 0; p.pf = 0; p.ast = 0; p.orb = 0; p.drb = 0; p.stl = 0; p.tov = 0; p.blk = 0; });
    });

    appState.isGameActive = true;
    document.querySelectorAll('.tab-btn[data-tab="setup"], .tab-btn[data-tab="history"]').forEach(b => b.disabled = true);

    // 画面表示のリセット
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('home-score', '0'); set('away-score', '0');
    set('period-info', '1st QUARTER'); set('quarter-label', 'Q1');

    if (typeof showPop === 'function') showPop('TIP OFF! 🏀');
    if (typeof switchTab === 'function') switchTab('score');
    renderScore();
  } catch (e) { alert("試合開始エラー: " + e.message); }
}


// Add/Edit Players (In match)
window.openPlayerModal = function (t) {
  actTeamTarget = t;
  document.getElementById('mmp-num').value = '';
  document.getElementById('mmp-name').value = '';
  document.getElementById('modal-manage-players').parentElement.classList.add('open');
  redrawPlayerEditList();
};

document.getElementById('mmp-add-btn').onclick = () => {
  const num = document.getElementById('mmp-num').value.trim();
  const name = document.getElementById('mmp-name').value.trim();
  if (!num) { showAlert('背番号を入力してください'); return; }
  appState.game[actTeamTarget].players.push({
    id: Date.now() + Math.random(), num, name, pts: 0, p3: 0, p2: 0, pt: 0, pf: 0
  });
  redrawPlayerEditList();
  renderScore();
  document.getElementById('mmp-num').value = '';
  document.getElementById('mmp-name').value = '';
};

// 📷 写真から自動登録 (Tesseract OCR)
const btnCameraOcr = document.getElementById('btn-camera-ocr');
const ocrFileInput = document.getElementById('ocr-file-input');

if (btnCameraOcr && ocrFileInput) {
  btnCameraOcr.onclick = () => ocrFileInput.click();
  ocrFileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Loading UI
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.style.zIndex = '999999';
    overlay.innerHTML = '<div class="modal-box" style="text-align:center; padding:30px;"><div class="spinner" style="margin: 0 auto; margin-bottom:20px; border-top-color:#00e676;"></div><p id="ocr-status" style="color:var(--text-primary); font-size:16px; font-weight:bold;">AIで文字を解析中...<br/><span style="font-size:12px; font-weight:normal; color:var(--text-secondary);">※端末の性能によっては10秒〜20秒かかります</span></p></div>';
    document.body.appendChild(overlay);

    try {
      // 1. 画像を読み込んでリサイズする（ペイロード制限回避と速度向上のため）
      const base64Image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1600; // OCRには十分な解像度
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8)); // 画質を少し落として軽量化
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      if (document.getElementById('ocr-status')) {
        document.getElementById('ocr-status').innerHTML = 'Gemini AI が名簿を解析中...<br/><span style="font-size:12px; font-weight:normal; color:var(--text-secondary);">※画像サイズを最適化して送信中</span>';
      }

      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        let fullMsg = errorData.error || 'Server error';
        if (errorData.details) fullMsg += `\n詳細: ${errorData.details}`;
        throw new Error(fullMsg);
      }

      const data = await response.json();
      let extractedCount = 0;

      if (data.players && Array.isArray(data.players)) {
        data.players.forEach(p => {
          appState.game[actTeamTarget].players.push({
            id: Date.now() + Math.random(),
            num: p.num || "",
            name: p.name || "不明選手",
            pts: 0, p3: 0, p2: 0, pt: 0, pf: 0
          });
          extractedCount++;
        });
      }

      if (data.coaches && Array.isArray(data.coaches)) {
        data.coaches.forEach(c => {
          appState.game[actTeamTarget].players.push({
            id: Date.now() + Math.random(),
            num: c.num || "コーチ",
            name: c.name || "先生",
            pts: 0, p3: 0, p2: 0, pt: 0, pf: 0, isCoach: true
          });
          extractedCount++;
        });
      }

      overlay.remove();
      redrawPlayerEditList();
      renderScore();

      if (extractedCount > 0) {
        showAlert(`✅ Gemini AIにより ${extractedCount} 名の選手を検出し、自動登録しました！`);
      } else {
        showAlert('選手を検出できませんでした。画像を確認してください。');
      }

    } catch (err) {
      overlay.remove();
      console.error(err);
      if (err.message.includes('GOOGLE_API_KEY')) {
        showAlert('エラー: Gemini APIキーが設定されていません。Vercelの環境変数に GOOGLE_API_KEY を設定してください。設定後、反映には再デプロイが必要な場合があります。');
      } else {
        showAlert(`Gemini AIでの解析に失敗しました。\n理由: ${err.message}`);
      }
    }
    ocrFileInput.value = '';
  };
}

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
  const dbPs = JSON.parse(JSON.stringify(gTm.players)).map(p => ({ ...p, pts: 0, p3: 0, p2: 0, pt: 0, pf: 0 }));

  if (ix >= 0) { appState.teamsDB[ix].players = dbPs; }
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
  if (type === '1P') p.pt++;
  if (type === '2P') p.p2++;
  if (type === '3P') p.p3++;

  // Create cumulative detail string (e.g., "15点目 / 3P")
  const cumulativePts = g.score[tm];
  const newDetail = `${cumulativePts}点目 / ${type}`;

  g.logs.unshift({ id: Date.now(), tstamp: Date.now(), qStr: getQStr(), team: tm, pid: p.id, type: 'SCORE', detail: newDetail, val, rawType: type });

  showPop(`+${val} PTS! (#${p.num} ${p.name})`);
  renderScore();
}

let sheetTarget = null;
function openActionSheet(pid, team) {
  sheetTarget = { pid, team };
  const p = appState.game[team].players.find(x => x.id === pid);
  document.getElementById('mact-title').textContent = `#${p.num} ${p.name}`;
  document.getElementById('mact-title').className = `modal-title player-action-title ${team === 'home' ? 'text-orange' : 'text-blue'}`;
  document.getElementById('modal-foul-action').parentElement.classList.add('open');
}



// Foul Add
document.querySelectorAll('.foul-play').forEach(btn => {
  btn.onclick = () => {
    if (!sheetTarget) return;
    const g = appState.game;
    const tm = sheetTarget.team;
    const p = g[tm].players.find(x => x.id === sheetTarget.pid);
    const type = btn.dataset.type;

    p.pf++;
    g.teamFouls[tm]++;

    // Track individual foul type counters
    if (type === 'P' || type === 'O') {
      p.po = (p.po || 0) + 1;
    }
    if (type === 'T' || type === 'U' || type === 'D') {
      p.tud = (p.tud || 0) + 1;
    }
    if (type === 'T') p.tf = (p.tf || 0) + 1;
    if (type === 'U') p.uf = (p.uf || 0) + 1;
    if (type === 'D') p.df = (p.df || 0) + 1;

    let fn = type === 'P' ? 'Personal Foul' : (type === 'O' ? 'Offensive Foul' : (type === 'T' ? 'Tech Foul' : (type === 'U' ? 'Unsports Foul' : 'Disqualifying')));
    g.logs.unshift({ id: Date.now(), tstamp: Date.now(), qStr: getQStr(), team: tm, pid: p.id, type: 'FOUL', detail: fn, val: 0, fType: type });

    document.getElementById('modal-foul-action').parentElement.classList.remove('open');
    // Foul warnings
    if (isFoulOut(p)) {
      setTimeout(() => showAlert(`🚫 ${p.name} (#${p.num}) が退場処分となりました！`), 200);
    } else if (p.isCoach || p.num === 'コーチ' || p.num === 'A.コーチ') {
      if (p.pf === 1 || (p.tf || 0) === 1) {
        setTimeout(() => showAlert(`⚠️ ${p.name} がファウル1回目！あと1回で退場（ディスクォリファイング）です`), 200);
      }
    } else if (type === 'T' && (p.tf || 0) === 1) {
      setTimeout(() => showAlert(`⚠️ ${p.name} (#${p.num}) がテクニカルファウル1回目！あと1回で退場です`), 200);
    } else if (p.pf === 4) {
      setTimeout(() => showAlert(`⚠️ ${p.name} (#${p.num}) がファウル4個目！注意喚起（まだ余裕あり）`), 200);
    } else if (p.pf === 5) {
      setTimeout(() => showAlert(`🔴 ${p.name} (#${p.num}) がファウル5個目！あと1回で退場です`), 200);
    }
    // Team foul 5 warning
    if (g.teamFouls[tm] === 5) {
      setTimeout(() => showAlert(`🏀 ${g[tm].name} のチームファウルが5個に達しました！以降のファウルはフリースロー対象です。`), isFoulOut(p) || p.pf >= 4 ? 1500 : 200);
    }
    renderScore();
  };
});

// --- QUARTER SCORE BREAKDOWN ---
function renderQuarterScores() {
  const row = document.getElementById('quarter-score-row');
  if (!row) return;
  row.innerHTML = '';
  const g = appState.game;
  const qLabels = ['Q1', 'Q2', 'Q3', 'Q4', 'OT'];
  const maxQ = g.isOT ? 5 : g.quarter;

  for (let qi = 1; qi <= maxQ; qi++) {
    const isOT = qi === 5;
    const qStr = isOT ? 'OT' : `Q${qi}`;
    let hPts = 0, aPts = 0;
    g.logs.forEach(l => {
      if (l.type === 'SCORE' && l.qStr === qStr) {
        if (l.team === 'home') hPts += l.val;
        else aPts += l.val;
      }
    });
    const chip = document.createElement('div');
    chip.className = 'qs-chip';
    chip.innerHTML = `
      <div class="qs-chip-label">${qLabels[qi - 1]}</div>
      <div class="qs-chip-score"><span class="qs-home">${hPts}</span><span class="qs-sep">-</span><span class="qs-away">${aPts}</span></div>
    `;
    row.appendChild(chip);
  }
}

// --- QUICK UNDO ---
function renderQuickUndo() {
  const btn = document.getElementById('btn-quick-undo');
  const preview = document.getElementById('undo-preview');
  if (!btn || !preview) return;
  const g = appState.game;

  if (g.logs.length === 0) {
    btn.disabled = true;
    preview.textContent = '';
    return;
  }

  btn.disabled = false;
  const last = g.logs[0];
  const p = last.pid !== 'TO' ? g[last.team].players.find(x => x.id === last.pid) : null;
  const pName = p ? `#${p.num} ${p.name}` : '';

  if (last.type === 'SCORE') {
    preview.textContent = `${last.team === 'home' ? '🟠' : '🔵'} ${pName} ${last.detail}`;
  } else if (last.type === 'FOUL') {
    preview.textContent = `${last.team === 'home' ? '🟠' : '🔵'} ${pName} ${last.detail}`;
  } else if (last.type === 'STAT') {
    preview.textContent = `${last.team === 'home' ? '🟠' : '🔵'} ${pName} +1 ${last.detail.split(' ')[0]}`;
  } else if (last.type === 'TO') {
    preview.textContent = `${last.team === 'home' ? '🟠' : '🔵'} TIMEOUT`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-quick-undo');
  if (btn) btn.onclick = () => {
    const g = appState.game;
    if (g.logs.length === 0) return;
    revertLog(g.logs[0].id);
    showPop('⏪ 取り消しました');
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
  if (!sH || !sA || !fH || !fA) return;
  sH.innerHTML = ''; sA.innerHTML = ''; fH.innerHTML = ''; fA.innerHTML = '';

  const g = appState.game;

  g.logs.forEach(l => {
    const isS = l.type === 'SCORE' || l.type === 'TO';
    const isF = l.type === 'FOUL';
    if (appState.activeTab === 'plays' && !isS) return;
    if (appState.activeTab === 'fouls' && !isF) return;

    const p = l.pid !== 'TO' ? g[l.team].players.find(x => x.id === l.pid) : null;
    const pName = p ? `#${p.num} ${p.name}` : '(TEAM)';
    const el = document.createElement('div');
    el.className = `tl-item ${l.team === 'home' ? 'tl-home' : 'tl-away'}`;

    let valStr = l.type === 'SCORE' ? `<span class="tl-val text-orange">+${l.val}</span>` : `<span class="tl-val text-secondary" style="font-size:24px;">-</span>`;
    if (l.type === 'FOUL') valStr = `<span class="tl-val text-red">F</span>`;
    if (l.type === 'STAT') valStr = `<span class="tl-val text-green" style="color:#00e676;">+1</span>`;

    // Make detail text span blue if away for visual identity
    const metaClass = l.team === 'home' ? 'text-orange' : 'text-blue';

    el.innerHTML = `
      <div class="tl-q">${l.qStr}</div>
      <div class="tl-pinfo">
        <span class="tl-player"><span class="tl-player-name">${pName}</span><span class="tl-meta ${metaClass}">${l.detail}</span></span>
        <div style="display:flex; gap:8px; margin-top:6px;">
          <button class="edit-log" data-id="${l.id}">変更</button>
          <button class="del-log" data-id="${l.id}">取消</button>
        </div>
      </div>
      ${valStr}
    `;

    if (l.type !== 'TO') {
      el.querySelector('.edit-log').onclick = () => openEditLogPlayerModal(l);
    } else {
      el.querySelector('.edit-log').style.display = 'none';
    }
    el.querySelector('.del-log').onclick = () => {
      showConfirm('記録を取り消しますか？').then(res => { if (res) revertLog(l.id); });
    };

    if (isS && appState.activeTab === 'plays') {
      if (l.team === 'home') sH.appendChild(el); else sA.appendChild(el);
    }
    if (isF && appState.activeTab === 'fouls') {
      if (l.team === 'home') fH.appendChild(el); else fA.appendChild(el);
    }
  });
}

function revertLog(logId) {
  const g = appState.game;
  const i = g.logs.findIndex(x => x.id === logId);
  if (i < 0) return;
  const l = g.logs[i];
  g.logs.splice(i, 1);

  if (l.type === 'SCORE') {
    const p = g[l.team].players.find(x => x.id === l.pid);
    if (p) {
      p.pts -= l.val;
      if (l.rawType === '1P') p.pt--; if (l.rawType === '2P') p.p2--; if (l.rawType === '3P') p.p3--;
    }
    g.score[l.team] -= l.val;
  } else if (l.type === 'FOUL') {
    const p = g[l.team].players.find(x => x.id === l.pid);
    if (p) {
      p.pf--;
      if (l.fType === 'P' || l.fType === 'O') p.po = Math.max(0, (p.po || 0) - 1);
      if (l.fType === 'T' || l.fType === 'U' || l.fType === 'D') p.tud = Math.max(0, (p.tud || 0) - 1);
      if (l.fType === 'T') p.tf--;
      if (l.fType === 'U') p.uf--;
      if (l.fType === 'D') p.df--;
    }
    g.teamFouls[l.team]--;
  } else if (l.type === 'TO') {
    const hf = getQHalf(parseInt(l.qStr.replace('Q', '')) || 4, l.qStr === 'OT');
    g.timeouts[l.team][hf]--;
  } else if (l.type === 'STAT') {
    const p = g[l.team].players.find(x => x.id === l.pid);
    if (p) { p[l.statKey] = Math.max(0, (p[l.statKey] || 0) - 1); }
  }

  renderScore(); renderLogs();
}

// End Game
document.getElementById('btn-end-match').onclick = () => {
  showConfirm('試合を終了し、結果を履歴に保存しますか？').then(res => {
    if (res) {
      const g = appState.game;
      const h = {
        id: Date.now(),
        date: new Date().toLocaleString('ja-JP'),
        home: JSON.parse(JSON.stringify(g.home)),
        away: JSON.parse(JSON.stringify(g.away)),
        score: { home: g.score.home, away: g.score.away },
        logs: JSON.parse(JSON.stringify(g.logs))
      };
      appState.historyDB.unshift(h);
      // Auto update team roster stats in DB
      ['home', 'away'].forEach(t => {
        if (g[t].name === 'HOME TEAM' || g[t].name === 'AWAY TEAM') return; // Do not save defaults to DB

        const idx = appState.teamsDB.findIndex(x => x.name === g[t].name);
        // Clean stats to standard 0
        const cls = JSON.parse(JSON.stringify(g[t].players)).map(p => ({ ...p, pts: 0, p3: 0, p2: 0, pt: 0, pf: 0, ast: 0, orb: 0, drb: 0, stl: 0, tov: 0, blk: 0 }));
        if (idx >= 0) appState.teamsDB[idx].players = cls;
        else appState.teamsDB.push({ id: Date.now() + Math.random(), name: g[t].name, players: cls });
      });
      saveData();
      appState.isGameActive = false;
      document.querySelectorAll('.tab-btn').forEach(b => b.disabled = false);
      switchTab('setup');
      showPop('MATCH SAVED!');

      if (appState.settings.autoCopy === 'true') {
        const text = generateMatchExportText(h);
        navigator.clipboard.writeText(text).then(() => {
          setTimeout(() => showAlert('試合が終了しました！\\n設定に基づき、試合結果をクリップボードに自動コピーしました。LINEやメモ帳等にそのまま貼り付け可能です。'), 300);
        }).catch(() => {
          setTimeout(() => showAlert('自動コピーに失敗しました。履歴タブから手動でエクスポートしてください。'), 300);
        });
      }
    }
  })
};


// --- 6. TEAMS DB (NEW TAB) ---
function renderTeamsTab() {
  const g = document.getElementById('teams-db-list');
  g.innerHTML = '';
  if (appState.teamsDB.length === 0) {
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
      showConfirm('このチームを削除しますか？').then(res => {
        if (res) {
          appState.teamsDB.splice(idx, 1);
          saveData(); renderTeamsTab();
        }
      })
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
  if (idx === -1) {
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
  if (!num) { showAlert('背番号を入力してください'); return; }
  activeEditTeamData.players.push({
    id: Date.now() + Math.random(), num, name, pts: 0, p3: 0, p2: 0, pt: 0, pf: 0
  });
  renderTeamEditorPlayers();
  document.getElementById('mte-pnum').value = '';
  document.getElementById('mte-pname').value = '';
};

// 📷 写真から自動登録 (チーム登録エディタ用)
const btnCameraOcrEdit = document.getElementById('btn-camera-ocr-edit');
const ocrFileInputEdit = document.getElementById('ocr-file-input-edit');

if (btnCameraOcrEdit && ocrFileInputEdit) {
  btnCameraOcrEdit.onclick = () => ocrFileInputEdit.click();
  ocrFileInputEdit.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.style.zIndex = '999999';
    overlay.innerHTML = '<div class="modal-box" style="text-align:center; padding:30px;"><div class="spinner" style="margin: 0 auto; margin-bottom:20px; border-top-color:#00e676;"></div><p id="ocr-status-edit" style="color:var(--text-primary); font-size:16px; font-weight:bold;">AIで文字を解析中...<br/><span style="font-size:12px; font-weight:normal; color:var(--text-secondary);">※端末の性能によっては10秒〜20秒かかります</span></p></div>';
    document.body.appendChild(overlay);

    document.body.appendChild(overlay);

    try {
      const base64Image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1600;
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      if (document.getElementById('ocr-status-edit')) {
        document.getElementById('ocr-status-edit').innerHTML = 'Gemini AI が名簿を解析中...<br/><span style="font-size:12px; font-weight:normal; color:var(--text-secondary);">※画像サイズを最適化して送信中</span>';
      }

      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        let fullMsg = errorData.error || 'Server error';
        if (errorData.details) fullMsg += `\n詳細: ${errorData.details}`;
        throw new Error(fullMsg);
      }

      const data = await response.json();
      let extractedCount = 0;

      if (data.teamName && (!document.getElementById('mte-name').value || document.getElementById('mte-name').value === '新規チーム')) {
        document.getElementById('mte-name').value = data.teamName;
      }

      if (data.players && Array.isArray(data.players)) {
        data.players.forEach(p => {
          activeEditTeamData.players.push({
            id: Date.now() + Math.random(),
            num: p.num || "",
            name: p.name || "不明選手",
            pts: 0, p3: 0, p2: 0, pt: 0, pf: 0
          });
          extractedCount++;
        });
      }

      if (data.coaches && Array.isArray(data.coaches)) {
        data.coaches.forEach(c => {
          activeEditTeamData.players.push({
            id: Date.now() + Math.random(),
            num: c.num || "コーチ",
            name: c.name || "先生",
            pts: 0, p3: 0, p2: 0, pt: 0, pf: 0, isCoach: true
          });
          extractedCount++;
        });
      }

      overlay.remove();
      renderTeamEditorPlayers();

      if (extractedCount > 0) {
        showAlert(`✅ Gemini AIにより ${extractedCount} 名の選手を検出し、自動登録しました！`);
      } else {
        showAlert('選手を検出できませんでした。画像を確認してください。');
      }

    } catch (err) {
      overlay.remove();
      console.error(err);
      if (err.message.includes('GOOGLE_API_KEY')) {
        showAlert('エラー: Gemini APIキーが設定されていません。Vercelの環境変数に GOOGLE_API_KEY を設定してください。');
      } else {
        showAlert(`Gemini AIでの解析に失敗しました。\n理由: ${err.message}`);
      }
    }
    ocrFileInputEdit.value = '';
  };
}

document.getElementById('mte-save-team').onclick = () => {
  activeEditTeamData.name = document.getElementById('mte-name').value.trim() || '未定チーム';

  if (activeEditTeamIdx === -1) {
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
  if (appState.historyDB.length === 0) {
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
        <button class="btn-sm btn-outline-glow hist-export" data-idx="${idx}">📤 エクスポート</button>
        <button class="btn-sm btn-outline-glow hist-ai" data-idx="${idx}">🤖 分析</button>
        <button class="btn-sm btn-danger hist-del" data-idx="${idx}">削除</button>
      </div>
    `;
    el.querySelector('.hist-del').onclick = () => {
      showConfirm('試合記録を削除しますか？').then(res => {
        if (res) {
          appState.historyDB.splice(idx, 1);
          saveData(); renderHistory();
        }
      })
    };
    el.querySelector('.hist-ai').onclick = () => openAI(h);
    el.querySelector('.hist-export').onclick = () => openMatchExport(h);
    g.appendChild(el);
  });
}

document.getElementById('btn-clear-history').onclick = () => {
  showConfirm('本当に全履歴を削除しますか？').then(res => {
    if (res) {
      appState.historyDB = []; saveData(); renderHistory();
    }
  })
};

// AI GRAPHICS
async function openAI(h) {
  const box = document.getElementById('ai-content-box');

  const hP = h.score.home, aP = h.score.away;
  const hF = h.home.players.reduce((s, p) => s + p.pf, 0), aF = h.away.players.reduce((s, p) => s + p.pf, 0);
  const h3 = h.home.players.reduce((s, p) => s + (p.p3 * 3), 0), a3 = h.away.players.reduce((s, p) => s + (p.p3 * 3), 0);
  const h2 = h.home.players.reduce((s, p) => s + (p.p2 * 2), 0), a2 = h.away.players.reduce((s, p) => s + (p.p2 * 2), 0);
  const hFT = h.home.players.reduce((s, p) => s + p.pt, 0), aFT = h.away.players.reduce((s, p) => s + p.pt, 0);

  const wT = (hP > aP) ? `<span class="text-orange">${h.home.name}</span>` : (aP > hP ? `<span class="text-blue">${h.away.name}</span>` : '引き分け');
  const txt = `総得点 ${hP + aP} 点のゲームは、${wT} の勝利で幕を閉じました。スタッツ比較とAIの分析を見てみましょう。`;

  const uiBar = (title, vH, vA) => {
    const tot = (vH + vA) || 1; const wH = (vH / tot) * 100; const wA = (vA / tot) * 100;
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
    
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--border);">
      <div class="ai-bar-title" style="margin-bottom: 15px;">✨ GEMINI MATCH ANALYSIS</div>
      <div id="gemini-analysis-result">
        <div style="text-align:center; padding: 20px;">
          <div style="color: var(--text-secondary); font-size: 13px;">Gemini AI が試合データを分析中です...</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-ai-analysis').parentElement.classList.add('open');

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchData: h })
    });

    const data = await res.json();
    const resultBox = document.getElementById('gemini-analysis-result');
    if (!resultBox) return; // モーダルが閉じられた場合

    if (!res.ok) throw new Error(data.details || data.error || '解析に失敗しました');

    resultBox.innerHTML = `
      <div style="line-height: 1.6; font-size: 14px; color: var(--text-primary);">
        ${data.analysis}
      </div>
    `;
  } catch (err) {
    const resultBox = document.getElementById('gemini-analysis-result');
    if (resultBox) {
      resultBox.innerHTML = `
        <div style="color: var(--red); padding: 10px; text-align: center; border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; background: rgba(239,68,68,0.05);">
          ⚠️ 分析エラー<br>
          <span style="font-size:12px; opacity:0.8;">${err.message}</span>
        </div>
      `;
    }
  }
}


// Global modal close bind
document.querySelectorAll('.modal-close').forEach(b => {
  b.addEventListener('click', e => { e.target.closest('.modal-overlay').classList.remove('open'); });
});

document.addEventListener('DOMContentLoaded', () => {
  checkOSUpdate();
  loadData();

  // URL Import check (for QR codes)
  const urlParams = new URLSearchParams(window.location.search);
  const importData = urlParams.get('import');
  if (importData) {
    setTimeout(async () => { await processImportData(importData); }, 500);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  setupPassword();
  setupRimlyCanvas();
  setupTabs();
});

async function processImportData(rawData) {
  let raw = rawData.replace(/[\s\n\r]+/g, '');
  if (raw.includes('?import=')) { raw = decodeURIComponent(raw.split('?import=')[1] || ''); }

  if (raw.startsWith('RIMLY_SHARE:')) {
    const shareId = raw.replace('RIMLY_SHARE:', '');
    try {
      showPop('クラウドからデータを取得中...');
      const res = await fetch(DB_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_share', shareId }) });
      const json = await res.json();
      if (json.success && json.data && json.data.type === 'teams') {
        processTeamDataArray(json.data.data);
        return true;
      } else {
        showAlert('クラウドデータの共有期限が切れているか、IDが無効です。'); return false;
      }
    } catch (e) {
      showAlert('通信エラーのためクラウドデータを取得できません。'); return false;
    }
  }

  let jsonStr = raw;
  if (raw.startsWith('RIMLY_TEAMS:')) {
    try {
      const b64str = raw.replace('RIMLY_TEAMS:', '');
      jsonStr = decodeURIComponent(escape(atob(b64str)));
    } catch (e) {
      showAlert('❌ データの形式が正しくありません。'); return false;
    }
  }

  try {
    const imported = JSON.parse(jsonStr);
    if (!Array.isArray(imported)) throw new Error('not array');
    processTeamDataArray(imported);
    return true;
  } catch (e) {
    showAlert('❌ データ形式が正しくありません。'); return false;
  }
}

function processTeamDataArray(imported) {
  let addedCount = 0;
  imported.forEach(t => {
    const tName = t.name || t.n;
    if (!tName) return;
    const exists = appState.teamsDB.find(x => x.name === tName);
    if (!exists) {
      let cleanPlayers = [];
      if (t.p) cleanPlayers = t.p.map(pl => ({ id: Date.now() + Math.random(), num: pl[0], name: pl[1], pts: 0, p3: 0, p2: 0, pt: 0, pf: 0 }));
      else if (t.players) cleanPlayers = t.players;
      appState.teamsDB.push({ id: Date.now() + Math.random(), name: tName, players: cleanPlayers });
      addedCount++;
    }
  });

  saveData();
  if (typeof renderTeamsTab === 'function' && appState.activeTab === 'teams') renderTeamsTab();
  showAlert(`✅ ${addedCount}チームを取り込みました！${imported.length - addedCount > 0 ? `（${imported.length - addedCount}チームは既に登録済み）` : ''}`);
}

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
  const tud = (p.tud || 0);
  const tf = (p.tf || 0);
  if (p.isCoach || p.num === 'コーチ' || p.num === 'A.コーチ' || p.num === '監督') {
    return p.pf >= 2 || tf >= 2 || tud >= 2 || (p.df || 0) >= 1;
  }
  return p.pf >= 6 || tf >= 2 || tud >= 2 || (p.df || 0) >= 1;
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
    if (p.id === logItem.pid) b.style.borderColor = 'var(--orange)';
    b.textContent = `#${p.num} ${p.name}`;
    b.onclick = () => { changeLogPlayer(logItem, p.id); };
    grid.appendChild(b);
  });
  document.getElementById('overlay-edit-log').classList.add('open');
}

function changeLogPlayer(logItem, newPid) {
  if (logItem.pid === newPid) {
    document.getElementById('overlay-edit-log').classList.remove('open');
    return;
  }

  const tm = logItem.team;
  const oldP = appState.game[tm].players.find(x => x.id === logItem.pid);
  const newP = appState.game[tm].players.find(x => x.id === newPid);

  if (logItem.type === 'SCORE') {
    if (oldP) {
      oldP.pts -= logItem.val;
      if (logItem.rawType === '1P') oldP.pt--; if (logItem.rawType === '2P') oldP.p2--; if (logItem.rawType === '3P') oldP.p3--;
    }
    if (newP) {
      newP.pts += logItem.val;
      if (logItem.rawType === '1P') newP.pt++; if (logItem.rawType === '2P') newP.p2++; if (logItem.rawType === '3P') newP.p3++;
    }
  } else if (logItem.type === 'FOUL') {
    if (oldP) {
      oldP.pf--;
      if (logItem.fType === 'P' || logItem.fType === 'O') oldP.po = Math.max(0, (oldP.po || 0) - 1);
      if (logItem.fType === 'T' || logItem.fType === 'U' || logItem.fType === 'D') oldP.tud = Math.max(0, (oldP.tud || 0) - 1);
      if (logItem.fType === 'T') oldP.tf = Math.max(0, (oldP.tf || 0) - 1); if (logItem.fType === 'U') oldP.uf = Math.max(0, (oldP.uf || 0) - 1); if (logItem.fType === 'D') oldP.df = Math.max(0, (oldP.df || 0) - 1);
    }
    if (newP) {
      newP.pf++;
      if (logItem.fType === 'P' || logItem.fType === 'O') newP.po = (newP.po || 0) + 1;
      if (logItem.fType === 'T' || logItem.fType === 'U' || logItem.fType === 'D') newP.tud = (newP.tud || 0) + 1;
      if (logItem.fType === 'T') newP.tf = (newP.tf || 0) + 1; if (logItem.fType === 'U') newP.uf = (newP.uf || 0) + 1; if (logItem.fType === 'D') newP.df = (newP.df || 0) + 1;
    }
  } else if (logItem.type === 'STAT') {
    if (oldP) oldP[logItem.statKey] = Math.max(0, (oldP[logItem.statKey] || 0) - 1);
    if (newP) newP[logItem.statKey] = (newP[logItem.statKey] || 0) + 1;
  }

  logItem.pid = newPid;
  document.getElementById('overlay-edit-log').classList.remove('open');
  renderScore(); renderLogs();
  if (newP && isFoulOut(newP)) setTimeout(() => showAlert(`🚫 ${newP.name} (#${newP.num}) が退場しました！`), 200);
  showPop('記録を変更しました');
}

// --- Team Share / Import ---
document.addEventListener('DOMContentLoaded', () => {
  // Share button
  const btnShare = document.getElementById('btn-share-teams');
  if (btnShare) btnShare.onclick = async () => {
    btnShare.disabled = true;
    const qrContainer = document.getElementById('share-qr-container');
    const shareTextEl = document.getElementById('share-teams-text');
    let shareText = '';

    try {
      const res = await fetch(DB_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_share', type: 'teams', data: appState.teamsDB }) });
      const json = await res.json();
      if (json.success && json.shareId) shareText = 'RIMLY_SHARE:' + json.shareId;
      else throw new Error();
    } catch (e) {
      const optimizedTeams = appState.teamsDB.map(t => ({ n: t.name, p: t.players.map(pl => [pl.num, pl.name]) }));
      shareText = 'RIMLY_TEAMS:' + btoa(unescape(encodeURIComponent(JSON.stringify(optimizedTeams))));
    }

    btnShare.disabled = false;
    shareTextEl.value = shareText;

    if (qrContainer) {
      qrContainer.innerHTML = '<div id="qr-code-wrapper"></div>';
      const shareUrl = window.location.href.split('?')[0] + '?import=' + encodeURIComponent(shareText);
      try {
        new QRCode(document.getElementById('qr-code-wrapper'), {
          text: shareUrl,
          width: 160,
          height: 160,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.L
        });
        qrContainer.style.display = 'block';
      } catch (e) {
        qrContainer.innerHTML = '<div style="color:var(--text-secondary); font-size:12px; font-weight:bold; max-width:160px; text-align:center; padding:10px;">データが大きすぎるためQRコードは生成できません。<br>下のテキストをコピーしてください。</div>';
        qrContainer.style.display = 'block';
      }
    }
    document.getElementById('overlay-share-teams').classList.add('open');
  };

  // Copy button
  const btnCopy = document.getElementById('btn-copy-share');
  if (btnCopy) btnCopy.onclick = () => {
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
  if (btnImport) btnImport.onclick = () => {
    document.getElementById('import-teams-text').value = '';
    document.getElementById('overlay-import-teams').classList.add('open');
  };

  // Do Import text manually
  const btnDoImport = document.getElementById('btn-do-import');
  if (btnDoImport) btnDoImport.onclick = async () => {
    let raw = document.getElementById('import-teams-text').value.trim();
    if (!raw) { showAlert('テキストを貼り付けてください。'); return; }

    const success = await processImportData(raw);
    if (success) {
      document.getElementById('import-teams-text').value = '';
      document.getElementById('overlay-import-teams').classList.remove('open');
    }
  };

  // In-App QR Scanner
  let html5QrCode = null;
  const btnStartScan = document.getElementById('btn-start-qr-scan');
  if (btnStartScan) {
    btnStartScan.onclick = () => {
      btnStartScan.style.display = 'none';
      const qrReaderDiv = document.getElementById('qr-reader');
      qrReaderDiv.style.display = 'block';
      qrReaderDiv.innerHTML = '<div style="color:var(--text-secondary); text-align:center; padding: 20px;">カメラを起動中...<br>権限ダイアログが出たら許可してください</div>';

      if (typeof Html5Qrcode !== "undefined") {
        html5QrCode = new Html5Qrcode("qr-reader");
        html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            // on success
            const success = await processImportData(decodedText);
            if (success) {
              html5QrCode.stop().then(() => { html5QrCode.clear(); }).catch(() => { });
              html5QrCode = null;
              qrReaderDiv.style.display = 'none';
              btnStartScan.style.display = 'block';
              document.getElementById('overlay-import-teams').classList.remove('open');
            }
          },
          (errorMessage) => {
            // ignore scan failures (keeps looking)
          }
        ).catch((err) => {
          showAlert('カメラの起動に失敗しました。ブラウザのカメラ権限が許可されているか確認してください。');
          qrReaderDiv.style.display = 'none';
          btnStartScan.style.display = 'block';
        });
      } else {
        showAlert('カメラモジュールが読み込めませんでした。再読み込みしてください。');
        btnStartScan.style.display = 'block';
        qrReaderDiv.style.display = 'none';
      }
    };
  }

  // Cleanup scanner on modal close
  document.querySelectorAll('#overlay-import-teams .modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      if (html5QrCode) {
        html5QrCode.stop().then(() => { html5QrCode.clear(); }).catch(() => { });
        html5QrCode = null;
      }
      const qrReaderDiv = document.getElementById('qr-reader');
      if (qrReaderDiv) qrReaderDiv.style.display = 'none';
      if (btnStartScan) btnStartScan.style.display = 'block';
      document.getElementById('overlay-import-teams').classList.remove('open');
    });
  });

  // Close buttons for share/import modals
  document.querySelectorAll('#overlay-share-teams .modal-close, #overlay-import-teams .modal-close').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('overlay-share-teams').classList.remove('open');
      document.getElementById('overlay-import-teams').classList.remove('open');
    };
  });

  // Match export copy button
  const btnCopyExport = document.getElementById('btn-copy-match-export');
  if (btnCopyExport) btnCopyExport.onclick = () => {
    const ta = document.getElementById('match-export-text');
    ta.select();
    ta.setSelectionRange(0, 999999);
    navigator.clipboard.writeText(ta.value).then(() => {
      showPop('📋 コピーしました！');
    }).catch(() => {
      document.execCommand('copy');
      showPop('📋 コピーしました！');
    });
  };

  // Close export modal
  document.querySelectorAll('#overlay-match-export .modal-close').forEach(btn => {
    btn.onclick = () => document.getElementById('overlay-match-export').classList.remove('open');
  });
});

// ================================================================
// FEATURE: Player Stats Detail Popup
// ================================================================
function openPlayerStatsModal(player, team) {
  const g = appState.game;
  const teamName = g[team].name;
  const colorClass = team === 'home' ? 'stat-orange' : 'stat-blue';
  const numBorderColor = team === 'home' ? 'var(--orange)' : 'var(--blue)';
  const numBgColor = team === 'home' ? 'var(--orange-dim)' : 'var(--blue-dim)';
  const numTextColor = team === 'home' ? 'var(--orange)' : 'var(--blue)';

  document.getElementById('pstats-title').textContent = `#${player.num} ${player.name}`;
  document.getElementById('pstats-title').className = `modal-title ${team === 'home' ? 'text-orange' : 'text-blue'}`;

  const foulStatus = isFoulOut(player) ? '<span class="foul-warning-badge badge-red" style="font-size:14px; padding:4px 10px;">退場</span>'
    : (player.pf >= 4 ? `<span class="foul-warning-badge ${player.pf >= 5 ? 'badge-red' : 'badge-orange'}" style="font-size:14px; padding:4px 10px;">${player.pf >= 5 ? '危険' : '注意'}</span>` : '');

  const content = document.getElementById('pstats-content');
  content.innerHTML = `
    <div class="pstats-card">
      <div class="pstats-header">
        <div class="pstats-num" style="border-color:${numBorderColor}; background:${numBgColor}; color:${numTextColor};">${player.num}</div>
        <div class="pstats-info">
          <div class="pstats-name">${player.name} ${foulStatus}</div>
          <div class="pstats-team">${teamName}</div>
        </div>
      </div>
      <div class="pstats-grid">
        <div class="pstats-stat">
          <div class="pstats-stat-label">TOTAL PTS</div>
          <div class="pstats-stat-val ${colorClass}">${player.pts}</div>
        </div>
        <div class="pstats-stat">
          <div class="pstats-stat-label">3-POINT</div>
          <div class="pstats-stat-val">${player.p3}</div>
        </div>
        <div class="pstats-stat">
          <div class="pstats-stat-label">2-POINT</div>
          <div class="pstats-stat-val">${player.p2}</div>
        </div>
        <div class="pstats-stat">
          <div class="pstats-stat-label">FREE THROW</div>
          <div class="pstats-stat-val">${player.pt}</div>
        </div>
        <div class="pstats-stat">
          <div class="pstats-stat-label">FOULS</div>
          <div class="pstats-stat-val stat-red">${player.pf}</div>
        </div>
        <div class="pstats-stat">
          <div class="pstats-stat-label">3P得点</div>
          <div class="pstats-stat-val">${player.p3 * 3}</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('overlay-player-stats').classList.add('open');
}

// ================================================================
// FEATURE: Halftime Report
// ================================================================
function showHalftimeReport() {
  const g = appState.game;
  let hPts = 0, aPts = 0;

  // Calculate Q1+Q2 points
  g.logs.forEach(l => {
    if (l.type === 'SCORE' && (l.qStr === 'Q1' || l.qStr === 'Q2')) {
      if (l.team === 'home') hPts += l.val;
      else aPts += l.val;
    }
  });

  const content = document.getElementById('halftime-content');

  // Build players sorted by pts in first half
  const getHalfPts = (tm) => {
    const pts = {};
    g[tm].players.forEach(p => pts[p.id] = { ...p, halfPts: 0, half3: 0, half2: 0, halfFT: 0 });
    g.logs.forEach(l => {
      if (l.type === 'SCORE' && l.team === tm && (l.qStr === 'Q1' || l.qStr === 'Q2')) {
        if (pts[l.pid]) {
          pts[l.pid].halfPts += l.val;
          if (l.rawType === '3P') pts[l.pid].half3++;
          if (l.rawType === '2P') pts[l.pid].half2++;
          if (l.rawType === '1P') pts[l.pid].halfFT++;
        }
      }
    });
    return Object.values(pts).sort((a, b) => b.halfPts - a.halfPts);
  };

  const homePlayers = getHalfPts('home');
  const awayPlayers = getHalfPts('away');

  const playerRows = (players, color) => {
    if (players.length === 0) return '<div style="color:var(--text-muted); text-align:center; padding:10px;">選手なし</div>';
    return players.map(p => `
      <div class="ht-player-row">
        <div class="ht-player-num">#${p.num}</div>
        <div class="ht-player-name">${p.name}</div>
        <div class="ht-player-pts" style="color:var(--${color});">${p.halfPts}</div>
      </div>
    `).join('');
  };

  const leader = hPts > aPts ? `<span class="text-orange">${g.home.name}</span>`
    : (aPts > hPts ? `<span class="text-blue">${g.away.name}</span>` : '同点');

  content.innerHTML = `
    <div class="ai-summary">前半終了！${hPts === aPts ? '現在<strong>同点</strong>です。' : `${leader} が ${Math.abs(hPts - aPts)} 点リードしています。`}</div>
    <div class="ht-score-row">
      <div class="ht-team-block">
        <div class="ht-team-name text-orange">${g.home.name}</div>
        <div class="ht-team-score text-orange">${hPts}</div>
      </div>
      <div class="ht-vs">VS</div>
      <div class="ht-team-block">
        <div class="ht-team-name text-blue">${g.away.name}</div>
        <div class="ht-team-score text-blue">${aPts}</div>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
      <div>
        <div class="ht-section-title text-orange">🟠 ${g.home.name} 前半スタッツ</div>
        ${playerRows(homePlayers, 'orange')}
      </div>
      <div>
        <div class="ht-section-title text-blue">🔵 ${g.away.name} 前半スタッツ</div>
        ${playerRows(awayPlayers, 'blue')}
      </div>
    </div>
  `;

  document.getElementById('overlay-halftime-report').classList.add('open');
}

// ================================================================
// FEATURE: Match Record Text Export
// ================================================================
function generateMatchExportText(h) {
  const lines = [];
  const divider = '━'.repeat(30);

  lines.push('🏀 RIMLY 試合記録');
  lines.push(divider);
  lines.push(`📅 ${h.date}`);
  lines.push('');
  lines.push(`${h.home.name}  ${h.score.home} - ${h.score.away}  ${h.away.name}`);
  lines.push(divider);

  const qLabels = ['Q1', 'Q2', 'Q3', 'Q4', 'OT'];
  const qScores = {};
  (h.logs || []).forEach(l => {
    if (l.type === 'SCORE') {
      if (!qScores[l.qStr]) qScores[l.qStr] = { home: 0, away: 0 };
      qScores[l.qStr][l.team] += l.val;
    }
  });
  if (Object.keys(qScores).length > 0) {
    lines.push('');
    lines.push('【クォーター別得点】');
    qLabels.forEach(q => {
      if (qScores[q]) {
        lines.push(`  ${q}: ${h.home.name} ${qScores[q].home} - ${qScores[q].away} ${h.away.name}`);
      }
    });
  }

  ['home', 'away'].forEach(tm => {
    const teamData = h[tm];
    if (!teamData.players || teamData.players.length === 0) return;
    lines.push('');
    lines.push(divider);
    lines.push(`【${teamData.name}】 合計: ${h.score[tm]}点`);

    // Check if advanced stats exist
    const isAdv = teamData.players.some(p => p.ast > 0 || p.orb > 0 || p.drb > 0 || p.stl > 0 || p.tov > 0 || p.blk > 0) || (appState.settings && appState.settings.statsMode === 'advanced');

    if (isAdv) {
      lines.push('  #   選手名      PTS 3P 2P FT PF AS OR DR ST TO BK');
      lines.push('  ' + '-'.repeat(56));
    } else {
      lines.push('  #   選手名          PTS  3P  2P  FT  PF');
      lines.push('  ' + '-'.repeat(44));
    }

    teamData.players.forEach(p => {
      const num = String(p.num).padStart(3);
      const name = (p.name + '　'.repeat(5)).slice(0, 5);
      const pts = String(p.pts).padStart(4);
      const p3 = String(p.p3 || 0).padStart(2);
      const p2 = String(p.p2 || 0).padStart(2);
      const ft = String(p.pt || 0).padStart(2);
      const pf = String(p.pf || 0).padStart(2);

      if (isAdv) {
        const ast = String(p.ast || 0).padStart(2);
        const orb = String(p.orb || 0).padStart(2);
        const drb = String(p.drb || 0).padStart(2);
        const stl = String(p.stl || 0).padStart(2);
        const tov = String(p.tov || 0).padStart(2);
        const blk = String(p.blk || 0).padStart(2);
        lines.push(`  ${num}  ${name} ${pts} ${p3} ${p2} ${ft} ${pf} ${ast} ${orb} ${drb} ${stl} ${tov} ${blk}`);
      } else {
        lines.push(`  ${num}  ${name}  ${pts}  ${p3}  ${p2}  ${ft}  ${pf}`);
      }
    });
  });

  const hFouls = h.home.players.reduce((s, p) => s + (p.pf || 0), 0);
  const aFouls = h.away.players.reduce((s, p) => s + (p.pf || 0), 0);
  lines.push('');
  lines.push(divider);
  lines.push('【チームスタッツ】');
  lines.push(`  総ファウル: ${h.home.name} ${hFouls} / ${h.away.name} ${aFouls}`);

  const h3pts = h.home.players.reduce((s, p) => s + (p.p3 || 0) * 3, 0);
  const a3pts = h.away.players.reduce((s, p) => s + (p.p3 || 0) * 3, 0);
  lines.push(`  3P得点: ${h.home.name} ${h3pts} / ${h.away.name} ${a3pts}`);

  lines.push('');
  lines.push('Powered by Rimly 🏀');
  return lines.join('\n');
}

function openMatchExport(h) {
  document.getElementById('match-export-text').value = generateMatchExportText(h);
  document.getElementById('overlay-match-export').classList.add('open');
}
// (旧 生体認証ログインセクションは顔認証に統合済みのため削除)


// --- 🎤 音声入力アシスタント機能（完全版） ---
window.addEventListener('DOMContentLoaded', () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.continuous = true;
  recognition.interimResults = false;

  let isListening = false;

  // ボタンの作成
  const qBarActions = document.querySelector('.qbar-actions');
  if (!qBarActions) return;

  const voiceBtn = document.createElement('button');
  voiceBtn.className = 'ctrl-btn btn-outline-glow';
  voiceBtn.style.marginRight = '10px';
  voiceBtn.innerHTML = '🎤 音声AI: OFF';
  qBarActions.prepend(voiceBtn);

  voiceBtn.onclick = () => {
    if (isListening) { recognition.stop(); } else { try { recognition.start(); } catch (e) { } }
  };

  recognition.onstart = () => {
    isListening = true;
    voiceBtn.innerHTML = '🔴 待機中 (声で記録)...';
    voiceBtn.style.borderColor = 'red'; voiceBtn.style.color = 'red';
    if (typeof showPop === 'function') showPop('🤖「4番、2点」や「ホームの8番、3点」など話しかけてください');
  };

  recognition.onend = () => {
    isListening = false;
    voiceBtn.innerHTML = '🎤 音声AI: OFF';
    voiceBtn.style.borderColor = ''; voiceBtn.style.color = '';
  };

  // 音声解析と addScore への流し込み
  recognition.onresult = (event) => {
    const last = event.results.length - 1;
    const text = event.results[last][0].transcript.trim();

    // 数字（背番号）の抽出
    const numMatch = text.match(/([0-9０-９]+)番/);
    let playerNum = null;
    if (numMatch) {
      playerNum = numMatch[1].replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    }

    // 点数の抽出
    let action = null;
    if (text.includes('2点') || text.includes('シュート')) action = '+2';
    else if (text.includes('3点') || text.includes('スリー')) action = '+3';
    else if (text.includes('フリースロー') || text.includes('1点')) action = '+1';

    if (playerNum && action) {
      const g = typeof appState !== 'undefined' ? appState.game : null;
      if (!g) return;

      let targetTeam = null;
      let targetPlayer = null;

      // 両チームから背番号を検索する
      const homeMatch = g.home.players.find(p => String(p.num) === String(playerNum));
      const awayMatch = g.away.players.find(p => String(p.num) === String(playerNum));

      // チームの判定（言葉に含まれているか、片方にしかその番号がいないか）
      if ((text.includes('ホーム') || text.includes('白')) && homeMatch) {
        targetTeam = 'home'; targetPlayer = homeMatch;
      } else if ((text.includes('アウェイ') || text.includes('黒') || text.includes('色')) && awayMatch) {
        targetTeam = 'away'; targetPlayer = awayMatch;
      } else if (homeMatch && awayMatch) {
        if (typeof showPop === 'function') showPop(`🤖 警告: 両チームに${playerNum}番がいます！「ホームの${playerNum}番」と教えてください`);
        return;
      } else if (homeMatch) {
        targetTeam = 'home'; targetPlayer = homeMatch;
      } else if (awayMatch) {
        targetTeam = 'away'; targetPlayer = awayMatch;
      }

      if (!targetTeam || !targetPlayer) {
        if (typeof showPop === 'function') showPop(`🤖 警告: コート上に${playerNum}番の選手が見つかりません`);
        return;
      }

      // 得点を実際に加算する処理（先ほどいただいた addScore を実行！）
      const val = parseInt(action.replace('+', ''), 10);
      let type = '2P';
      if (val === 3) type = '3P';
      if (val === 1) type = '1P';

      if (typeof addScore === 'function') {
        addScore(targetTeam, targetPlayer.id, val, type);
        // showPop は addScore 内で呼ばれるのでここでは呼ばない
      }
    } else if (text.includes('ファウル')) {
      if (typeof showPop === 'function') showPop(`🤖 ファウルは現在「声での記録」準備中です`);
    } else {
      if (typeof showPop === 'function') showPop('🎤 聞き取り: ' + text + '（点数が分かりませんでした）');
    }
  };
});
// ================================================================
// ボタンとフリップ構造を自動で差し込む
// ================================================================
function setupFlipUI(tm) {
  const table = document.getElementById(`roster-${tm}-table`);
  if (!table) return;

  // すでにセットアップ済みなら何もしない
  if (table.closest('.roster-flip-inner')) return;

  const scrollDiv = table.parentElement; // overflow-x:auto のdiv
  const rosterHeader = scrollDiv.previousElementSibling; // roster-header div
  if (!rosterHeader) return;

  // ─── フリップボタンを追加 ───
  if (!rosterHeader.querySelector('.btn-flip-view')) {
    const flipBtn = document.createElement('button');
    flipBtn.className = 'btn-flip-view';
    flipBtn.id = `flip-btn-${tm}`;
    flipBtn.style.marginRight = '8px';
    flipBtn.innerHTML = '<span id="flip-icon-' + tm + '">👕</span> <span id="flip-label-' + tm + '">ユニフォーム</span>';
    flipBtn.onclick = () => flipRosterView(tm);

    // 先頭のボタンの前に挿入
    const firstBtn = rosterHeader.querySelector('button');
    if (firstBtn) firstBtn.before(flipBtn);
  }

  // ─── フリップ構造を組み立て ───
  const wrapper = document.createElement('div');
  wrapper.className = 'roster-flip-wrapper';

  const inner = document.createElement('div');
  inner.className = 'roster-flip-inner';
  inner.id = `flip-inner-${tm}`;

  const front = document.createElement('div');
  front.className = 'roster-flip-front';
  front.style.cssText = 'overflow-x:auto; overflow-y:auto; max-height:60vh;';

  const back = document.createElement('div');
  back.className = 'roster-flip-back';
  back.innerHTML = `<div class="uniform-grid" id="uniform-grid-${tm}"></div>`;

  // scrollDivをfrontの中に移動
  const parent = scrollDiv.parentElement;
  parent.insertBefore(wrapper, scrollDiv);
  front.appendChild(scrollDiv);
  inner.appendChild(front);
  inner.appendChild(back);
  wrapper.appendChild(inner);
}


function renderUniformGrid(tm) {
  const grid = document.getElementById(`uniform-grid-${tm}`);
  if (!grid) return;
  grid.innerHTML = '';

  const g = appState.game;
  if (!g || !g[tm] || !g[tm].players) return;

  const isHome = (tm === 'home');
  const colorMode = g[tm].colorMode || 'dark'; // 'dark' or 'light'

  g[tm].players.filter(p => p.isOnCourt).forEach(p => {
    const card = document.createElement('div');
    let cardClass = isHome ? 'home-card' : 'away-card';
    // ユニフォームの濃淡に応じてクラスを変える
    if (colorMode === 'light') cardClass = 'light-card';
    else if (colorMode === 'dark') cardClass = 'dark-card';

    card.className = `uniform-card ${cardClass}`;

    // ファウル警告ドット
    let dotClass = '';
    if (p.pf >= 5) dotClass = 'danger';
    else if (p.pf >= 4) dotClass = 'warn';

    card.innerHTML = `
      <div class="uniform-num">${p.num}</div>
      <div class="uniform-name">${p.name}</div>
      ${p.pts > 0 ? `<div class="uniform-pts-badge">${p.pts}pts</div>` : ''}
      ${dotClass ? `<div class="uniform-foul-dot ${dotClass}"></div>` : ''}
    `;

    // タップで得点入力（フリップ中でも使える）
    card.onclick = () => {
      if (typeof isFoulOut === 'function' && isFoulOut(p)) {
        showPop('退場しています');
        return;
      }
      // 簡易アクションシート
      const choice = window.confirm(`#${p.num} ${p.name}\n\nOK → 2P　キャンセル → 3P`);
      if (choice) {
        addScore(tm, p.id, 2, '2P');
      } else {
        addScore(tm, p.id, 3, '3P');
      }
      // グリッドを更新
      if (_flipState[tm]) renderUniformGrid(tm);
    };

    grid.appendChild(card);
  });
}
// ================================================================
// カードフリップ – ゼッケン / ユニフォーム切替（完全修正版）
// ================================================================
const _flipState = { home: false, away: false };

function setupFlipUI(tm) {
  const table = document.getElementById(`roster-${tm}-table`);
  if (!table) return;
  const rosterPanel = table.closest('.player-roster');
  if (!rosterPanel) return;
  const rosterHeader = rosterPanel.querySelector('.roster-header');
  if (!rosterHeader) return;

  // 古いフリップ構造をクリーンアップ
  const oldFlipWrap = document.getElementById(`flip-wrap-${tm}`);
  if (oldFlipWrap) {
    const children = [...oldFlipWrap.children];
    const parent = oldFlipWrap.parentElement;
    children.forEach(child => parent.insertBefore(child, oldFlipWrap));
    oldFlipWrap.remove();
  }
  const oldGrid = document.getElementById(`uniform-grid-wrap-${tm}`);
  if (oldGrid) oldGrid.remove();

  // フリップボタン追加（1度だけ・既存ボタンと同じスタイル）
  if (!rosterHeader.querySelector('.btn-flip-view')) {
    const isHome = (tm === 'home');
    const flipBtn = document.createElement('button');
    flipBtn.className = `btn-sm ${isHome ? 'btn-outline-orange' : 'btn-outline-blue'} btn-flip-view`;
    flipBtn.id = `flip-btn-${tm}`;
    flipBtn.textContent = '👕 ユニフォーム';
    flipBtn.style.marginRight = '6px';
    flipBtn.onclick = () => flipRosterView(tm);

    // 既存ボタンの前に挿入
    const existingBtns = rosterHeader.querySelectorAll('button:not(.btn-flip-view)');
    if (existingBtns.length > 0) existingBtns[0].before(flipBtn);
    else rosterHeader.appendChild(flipBtn);
  }
}

window.flipRosterView = function (tm) {
  _flipState[tm] = !_flipState[tm];
  const nowUniform = _flipState[tm];

  const table = document.getElementById(`roster-${tm}-table`);
  if (!table) return;
  const panel = table.closest('.player-roster');
  if (!panel) return;
  const btn = document.getElementById(`flip-btn-${tm}`);

  // ===== カードめくりアニメーション =====
  // ① 前半：0度 → 90度（カードが横向きに）
  panel.style.transition = 'transform 0.3s ease-in';
  panel.style.transform = 'perspective(800px) rotateY(90deg)';

  setTimeout(() => {
    // ② 90度=見えない瞬間にモード切替
    panel.classList.toggle('uniform-mode-' + tm, nowUniform);

    if (btn) btn.textContent = nowUniform ? '🏷️ ゼッケン' : '👕 ユニフォーム';

    // ③ 後半：-90度 → 0度（裏側から回って戻る）
    panel.style.transition = 'none';
    panel.style.transform = 'perspective(800px) rotateY(-90deg)';
    void panel.offsetHeight; // リフロー強制
    panel.style.transition = 'transform 0.3s ease-out';
    panel.style.transform = '';
  }, 300);
};

// ================================================================
// 🔐 FACE AUTH UI INTEGRATION
// 顔認証のUIイベント接続・画面遷移制御
// ================================================================
(function setupFaceAuthUI() {

  // --- 要素取得 ---
  const btnFaceAuth      = document.getElementById('btn-face-auth');
  const faceOverlay      = document.getElementById('face-auth-overlay');
  const btnFaceBack      = document.getElementById('btn-face-back');
  const faceVideo        = document.getElementById('face-video');
  const faceCanvas       = document.getElementById('face-canvas');
  const faceStatus       = document.getElementById('face-status');
  const progressFill     = document.getElementById('face-progress-fill');
  const faceManageLink   = document.getElementById('face-manage-link');
  const pwContainer      = document.querySelector('.pw-container');

  // 登録モーダル
  const registerOverlay  = document.getElementById('face-register-overlay');
  const registerVideo    = document.getElementById('face-register-video');
  const registerName     = document.getElementById('face-register-name');
  const btnDoRegister    = document.getElementById('btn-do-register-face');
  const btnCloseRegister = document.getElementById('btn-close-face-register');
  const registerStatus   = document.getElementById('face-register-status');

  // 設定タブ内
  const btnRegSettings   = document.getElementById('btn-register-face-settings');
  const faceUserList     = document.getElementById('face-user-list');

  // ロック画面の顔管理ボタン
  const btnFaceManagePw  = document.getElementById('btn-face-manage-pw');

  if (!btnFaceAuth || !faceOverlay) return; // 要素がなければ何もしない

  let registerStream = null; // 登録用カメラストリーム

  // --- 顔認証エンジン初期化 ---
  rimlyFaceAuth.init().then(() => {
    // 登録済みの顔がある場合、管理リンクを表示
    if (rimlyFaceAuth.hasRegisteredFaces()) {
      if (faceManageLink) faceManageLink.style.display = 'block';
      // ✅ 自動で顔認証を起動（登録済みの顔がある場合のみ）
      setTimeout(() => {
        if (document.getElementById('password-screen').classList.contains('active')) {
          btnFaceAuth.click();
        }
      }, 800);
    }
    // 設定画面のリスト描画
    renderFaceUserList();
  }).catch(e => console.error('Face auth init error:', e));

  // =========================================================
  // 顔認証ボタン → カメラ起動 → 認証開始
  // =========================================================
  btnFaceAuth.addEventListener('click', async () => {
    if (!rimlyFaceAuth.hasRegisteredFaces()) {
      // 登録がなければ登録モーダルを開く
      if (typeof showAlert === 'function') {
        await showAlert('顔が登録されていません。\n先に顔を登録してください。');
      }
      openFaceRegisterModal();
      return;
    }

    // PINパッドを隠して顔認証オーバーレイを表示
    if (pwContainer) pwContainer.style.display = 'none';
    faceOverlay.classList.add('active');
    faceOverlay.classList.add('scanning');
    faceOverlay.classList.remove('matched', 'liveness-mode');
    updateFailDots();

    // ステータス
    faceStatus.textContent = 'カメラを起動中...';
    if (progressFill) progressFill.style.width = '10%';

    // カメラ起動
    rimlyFaceAuth.canvasEl = faceCanvas;
    const cameraOk = await rimlyFaceAuth.startCamera(faceVideo);
    if (!cameraOk) {
      faceStatus.textContent = '❌ カメラの起動に失敗しました';
      if (progressFill) progressFill.style.width = '0%';
      return;
    }

    if (progressFill) progressFill.style.width = '30%';

    // 認証開始
    rimlyFaceAuth.authenticate(
      // onStatus
      (msg) => {
        faceStatus.textContent = msg;
        if (msg.includes('認識しました')) {
          faceOverlay.classList.remove('scanning');
          faceOverlay.classList.add('matched');
          if (progressFill) progressFill.style.width = '70%';
        }
        if (msg.includes('モデル')) {
          if (progressFill) progressFill.style.width = '20%';
        }
        if (msg.includes('認識しています')) {
          if (progressFill) progressFill.style.width = '50%';
        }
      },
      // onSuccess
      (matchedUser) => {
        if (progressFill) progressFill.style.width = '100%';
        faceOverlay.classList.remove('scanning');
        faceOverlay.classList.add('matched');
        faceStatus.textContent = '✅ ロック解除！';

        // 成功エフェクト表示
        showFaceUnlockSuccess(matchedUser);
      },
      // onFail
      (failCount, reason) => {
        faceOverlay.classList.remove('scanning', 'matched');
        faceStatus.textContent = `❌ ${reason} (${failCount}/${rimlyFaceAuth.MAX_FAILS})`;
        if (progressFill) progressFill.style.width = '0%';
        updateFailDots();

        // 再試行
        setTimeout(() => {
          faceOverlay.classList.add('scanning');
          rimlyFaceAuth.authenticate(
            (msg) => { faceStatus.textContent = msg; },
            (user) => {
              if (progressFill) progressFill.style.width = '100%';
              showFaceUnlockSuccess(user);
            },
            (fc, r) => {
              faceStatus.textContent = `❌ ${r} (${fc}/${rimlyFaceAuth.MAX_FAILS})`;
              updateFailDots();
              if (fc >= rimlyFaceAuth.MAX_FAILS) forcePINFallback();
            },
            () => forcePINFallback()
          );
        }, 1500);
      },
      // onForcePIN
      () => forcePINFallback()
    );
  });

  // =========================================================
  // PINに戻るボタン
  // =========================================================
  btnFaceBack.addEventListener('click', () => {
    closeFaceAuth();
  });

  function closeFaceAuth() {
    rimlyFaceAuth.stopCamera();
    faceOverlay.classList.remove('active', 'scanning', 'matched');
    if (pwContainer) pwContainer.style.display = '';
    if (progressFill) progressFill.style.width = '0%';
  }

  // =========================================================
  // PIN強制フォールバック
  // =========================================================
  function forcePINFallback() {
    closeFaceAuth();
    rimlyFaceAuth.resetFailCount();
    updateFailDots();
    const pwError = document.getElementById('pw-error');
    if (pwError) {
      pwError.style.color = '#EF4444';
      pwError.textContent = '顔認証に3回失敗しました。PINを入力してください。';
      setTimeout(() => { pwError.textContent = ''; }, 5000);
    }
  }

  // =========================================================
  // 失敗ドットの更新
  // =========================================================
  function updateFailDots() {
    for (let i = 0; i < 3; i++) {
      const dot = document.getElementById(`fail-dot-${i}`);
      if (dot) {
        if (i < rimlyFaceAuth.failCount) dot.classList.add('failed');
        else dot.classList.remove('failed');
      }
    }
  }

  // =========================================================
  // ロック解除成功エフェクト
  // =========================================================
  function showFaceUnlockSuccess(matchedUser) {
    rimlyFaceAuth.stopCamera();

    // 成功オーバーレイを作成
    const successDiv = document.createElement('div');
    successDiv.className = 'face-unlock-success';
    successDiv.innerHTML = `
      <div class="face-unlock-icon">🔓</div>
      <div class="face-unlock-text">UNLOCKED</div>
      <div class="face-unlock-user">ようこそ、${matchedUser.name} さん</div>
    `;
    faceOverlay.appendChild(successDiv);

    // 1.2秒後にメイン画面へ遷移
    setTimeout(() => {
      faceOverlay.classList.remove('active', 'scanning', 'matched');
      successDiv.remove();
      if (pwContainer) pwContainer.style.display = '';
      rimlyFaceAuth.resetFailCount();
      
      // ロック解除！
      document.getElementById('password-screen').classList.remove('active');
      document.getElementById('app-screen').classList.add('active');
    }, 1200);
  }

  // =========================================================
  // 顔登録モーダル
  // =========================================================
  function openFaceRegisterModal() {
    if (!registerOverlay) return;
    registerOverlay.classList.add('active');
    if (registerName) registerName.value = '';
    if (registerStatus) registerStatus.textContent = '';

    // 登録用カメラ起動
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    }).then(stream => {
      registerStream = stream;
      if (registerVideo) {
        registerVideo.srcObject = stream;
        registerVideo.play();
      }
    }).catch(() => {
      if (registerStatus) registerStatus.textContent = '❌ カメラの起動に失敗しました';
    });
  }

  function closeFaceRegisterModal() {
    if (registerStream) {
      registerStream.getTracks().forEach(t => t.stop());
      registerStream = null;
    }
    if (registerVideo) registerVideo.srcObject = null;
    if (registerOverlay) registerOverlay.classList.remove('active');
  }

  // 登録ボタン
  if (btnDoRegister) {
    btnDoRegister.addEventListener('click', async () => {
      const name = registerName ? registerName.value.trim() : '';
      if (!name) {
        if (registerStatus) registerStatus.textContent = 'ユーザー名を入力してください';
        return;
      }

      btnDoRegister.disabled = true;
      btnDoRegister.textContent = '登録中...';

      try {
        // face-api.jsのモデルとカメラを一時的にface-auth側で使う
        rimlyFaceAuth.videoEl = registerVideo;
        rimlyFaceAuth.canvasEl = document.getElementById('face-register-canvas');

        const record = await rimlyFaceAuth.registerFace(name, (msg) => {
          if (registerStatus) registerStatus.textContent = msg;
        });

        if (registerStatus) registerStatus.textContent = `✅ ${record.name} の顔を登録しました！`;
        if (faceManageLink) faceManageLink.style.display = 'block';
        renderFaceUserList();

        setTimeout(() => closeFaceRegisterModal(), 1200);
      } catch (e) {
        if (registerStatus) registerStatus.textContent = '❌ ' + e.message;
      } finally {
        btnDoRegister.disabled = false;
        btnDoRegister.textContent = '📸 この顔を登録する';
      }
    });
  }

  // 閉じるボタン
  if (btnCloseRegister) {
    btnCloseRegister.addEventListener('click', closeFaceRegisterModal);
  }

  // 設定タブの登録ボタン
  if (btnRegSettings) {
    btnRegSettings.addEventListener('click', () => {
      openFaceRegisterModal();
    });
  }

  // ロック画面の管理ボタン（PINを先に解除しないと触れない）
  if (btnFaceManagePw) {
    btnFaceManagePw.addEventListener('click', () => {
      openFaceRegisterModal();
    });
  }

  // =========================================================
  // 設定画面：登録済み顔リストの描画
  // =========================================================
  function renderFaceUserList() {
    if (!faceUserList) return;

    const faces = rimlyFaceAuth.getRegisteredFaces();
    if (faces.length === 0) {
      faceUserList.innerHTML = '<div class="face-user-empty">登録済みの顔はありません</div>';
      return;
    }

    faceUserList.innerHTML = '';
    faces.forEach(face => {
      const dateStr = new Date(face.createdAt).toLocaleDateString('ja-JP');
      const item = document.createElement('div');
      item.className = 'face-user-item';
      item.innerHTML = `
        <div class="face-user-info">
          <div class="face-user-avatar">😊</div>
          <div>
            <div class="face-user-name">${face.name}</div>
            <div class="face-user-date">登録日: ${dateStr}</div>
          </div>
        </div>
        <button class="face-user-delete" data-face-id="${face.id}">🗑 削除</button>
      `;
      faceUserList.appendChild(item);
    });

    // 削除ボタンのイベント
    faceUserList.querySelectorAll('.face-user-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const faceId = btn.dataset.faceId;
        const confirmed = typeof showConfirm === 'function'
          ? await showConfirm('この顔データを削除しますか？')
          : confirm('この顔データを削除しますか？');
        if (confirmed) {
          await rimlyFaceAuth.deleteFace(faceId);
          renderFaceUserList();
          if (!rimlyFaceAuth.hasRegisteredFaces() && faceManageLink) {
            faceManageLink.style.display = 'none';
          }
          if (typeof showPop === 'function') showPop('顔データを削除しました');
        }
      });
    });
  }

  // 設定タブ切替時にリストを更新
  const origRenderSettings = window.renderSettings || renderSettings;
  if (typeof origRenderSettings === 'function') {
    const _origRS = origRenderSettings;
    window.renderSettings = function() {
      _origRS.apply(this, arguments);
      renderFaceUserList();
    };
    // グローバル参照も更新
    if (typeof renderSettings !== 'undefined') {
      renderSettings = window.renderSettings;
    }
  }

})();

