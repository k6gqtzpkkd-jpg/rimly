function openOfficialScoresheet() {
  const modal = document.getElementById('modal-official-scoresheet');
  if (modal) {
    modal.classList.add('open');
  }
  generateOfficialScoresheet();
}

function generateOfficialScoresheet() {
  const container = document.getElementById('scoresheet-container');
  const g = appState.game;

  // Render left side (Teams, Rosters, Fouls, Timeouts)
  let leftHtml = `<div class="ss-left">`;

  ['home', 'away'].forEach(tm => {
    const isA = tm === 'home'; // Assume Home is Team A, Away is Team B
    const teamName = g[tm].name;
    
    let qFouls = {1:0, 2:0, 3:0, 4:0};
    g.logs.forEach(l => {
      if (l.type === 'FOUL' && l.team === tm) {
        let q = l.qStr;
        if (q === 'Q1') qFouls[1]++;
        if (q === 'Q2') qFouls[2]++;
        if (q === 'Q3') qFouls[3]++;
        if (q === 'Q4' || q === 'OT') qFouls[4]++;
      }
    });

    const toFirst = g.timeouts && g.timeouts[tm] ? (g.timeouts[tm].first || g.timeouts[tm].h1 || 0) : 0;
    const toSecond = g.timeouts && g.timeouts[tm] ? (g.timeouts[tm].second || g.timeouts[tm].h2 || 0) : 0;

    leftHtml += `
      <div class="ss-header-box">
        <div class="ss-team-name">チーム${isA ? 'A' : 'B'}: ${teamName || ''}</div>
        
        <div style="display:flex; justify-content:space-between; margin-top:10px;">
          <div>
            <strong>タイムアウト</strong><br>
            前半: <div class="foul-box">${toFirst >= 1 ? 'X' : ''}</div> <div class="foul-box">${toFirst >= 2 ? 'X' : ''}</div><br>
            後半: <div class="foul-box">${toSecond >= 1 ? 'X' : ''}</div> <div class="foul-box">${toSecond >= 2 ? 'X' : ''}</div> <div class="foul-box">${toSecond >= 3 ? 'X' : ''}</div>
          </div>
          <div>
            <strong>チームファウル</strong><br>
            Q1: ${[1,2,3,4].map(i => `<div class="foul-box ${qFouls[1] >= i ? 'foul-x' : ''}"></div>`).join('')}<br>
            Q2: ${[1,2,3,4].map(i => `<div class="foul-box ${qFouls[2] >= i ? 'foul-x' : ''}"></div>`).join('')}<br>
            Q3: ${[1,2,3,4].map(i => `<div class="foul-box ${qFouls[3] >= i ? 'foul-x' : ''}"></div>`).join('')}<br>
            Q4: ${[1,2,3,4].map(i => `<div class="foul-box ${qFouls[4] >= i ? 'foul-x' : ''}"></div>`).join('')}
          </div>
        </div>

        <table class="ss-table" style="margin-top:10px;">
          <tr>
            <th width="10%">No.</th>
            <th width="50%">選手氏名 Players</th>
            <th width="40%">ファウル Fouls (1-5)</th>
          </tr>
    `;

    // Process player fouls from logs to get exact types
    let playerFouls = {};
    if (g[tm] && g[tm].players) {
      g[tm].players.forEach(p => playerFouls[p.id] = []);
    }
    
    if (g.logs) {
      [...g.logs].reverse().forEach(l => {
        if (l.type === 'FOUL' && l.team === tm && playerFouls[l.pid]) {
          playerFouls[l.pid].push(l.fType || 'P');
        }
      });
    }

    if (g[tm] && g[tm].players) {
      g[tm].players.forEach(p => {
        if (p.num === 'コーチ' || p.num === 'A.コーチ') return;
        let fList = playerFouls[p.id] || [];
        leftHtml += `
          <tr>
            <td>${p.num}</td>
            <td style="text-align:left;">${p.name}</td>
            <td>
              ${[0,1,2,3,4].map(i => `<div class="foul-box">${fList[i] || ''}</div>`).join('')}
            </td>
          </tr>
        `;
      });
    }

    let coach = g[tm] && g[tm].players ? g[tm].players.find(p => p.num === 'コーチ') : null;
    let acoach = g[tm] && g[tm].players ? g[tm].players.find(p => p.num === 'A.コーチ') : null;
    
    leftHtml += `
          <tr>
            <td>C</td><td style="text-align:left;">${coach ? coach.name : ''}</td>
            <td>${[0,1,2].map(i => `<div class="foul-box">${(coach && playerFouls[coach.id] && playerFouls[coach.id][i]) || ''}</div>`).join('')}</td>
          </tr>
          <tr>
            <td>AC</td><td style="text-align:left;">${acoach ? acoach.name : ''}</td>
            <td>${[0,1,2].map(i => `<div class="foul-box">${(acoach && playerFouls[acoach.id] && playerFouls[acoach.id][i]) || ''}</div>`).join('')}</td>
          </tr>
        </table>
      </div>
    `;
  });
  leftHtml += `</div>`;

  let rightHtml = `<div class="ss-right" style="flex: 2; display: flex; gap: 5px;">`;

  let marksH = {}; // score => { pnum, type, isEndQ, qStr }
  let marksA = {};
  
  let curH = 0;
  let curA = 0;

  if (g.logs) {
    const logsOldestFirst = [...g.logs].reverse();
    logsOldestFirst.forEach(l => {
      if (l.type === 'SCORE') {
        const p = l.pid !== 'TO' && g[l.team] && g[l.team].players ? g[l.team].players.find(x => x.id === l.pid) : null;
        const pnum = p ? p.num : '';
        const val = parseInt(l.val, 10) || 0;
        if (l.team === 'home') {
          for(let i=1; i<=val; i++){
            curH++;
            if (i === val) marksH[curH] = { pnum, type: val, qStr: l.qStr };
          }
        } else {
          for(let i=1; i<=val; i++){
            curA++;
            if (i === val) marksA[curA] = { pnum, type: val, qStr: l.qStr };
          }
        }
      }
    });
  }

  let qMaxH = { 'Q1': 0, 'Q2': 0, 'Q3': 0, 'Q4': 0, 'OT': 0 };
  let qMaxA = { 'Q1': 0, 'Q2': 0, 'Q3': 0, 'Q4': 0, 'OT': 0 };
  
  Object.keys(marksH).forEach(s => {
    let q = marksH[s].qStr;
    if (parseInt(s) > qMaxH[q]) qMaxH[q] = parseInt(s);
  });
  Object.keys(marksA).forEach(s => {
    let q = marksA[s].qStr;
    if (parseInt(s) > qMaxA[q]) qMaxA[q] = parseInt(s);
  });

  // Convert objects to values array ignoring 0s
  const qEndsH = Object.values(qMaxH).filter(x => x > 0);
  const qEndsA = Object.values(qMaxA).filter(x => x > 0);

  for (let c = 0; c < 4; c++) {
    let startScore = c * 40 + 1;
    rightHtml += `<table class="rs-col"><tr><th class="rs-a">A</th><th class="rs-num"></th><th class="rs-b">B</th></tr>`;
    
    for (let r = 0; r < 40; r++) {
      let s = startScore + r;
      
      let hHtml = '';
      let numClass = 'rs-num';
      let bHtml = '';

      if (marksH[s]) {
        let m = marksH[s];
        numClass += m.type === 1 ? ' rs-ft' : ' rs-fg';
        let isQE = qEndsH.includes(s);
        if (isQE && s === curH) {
           hHtml = `<div class="rs-game-end" style="width:100%; height:100%;">`;
        } else if (isQE) {
           hHtml = `<div class="rs-qend-line" style="width:100%; height:100%;">`;
        }
        
        let pDisp = m.type === 3 ? `<span class="pt3-circle">${m.pnum}</span>` : m.pnum;
        hHtml += pDisp + (isQE ? '</div>' : '');
      }

      if (marksA[s]) {
        let m = marksA[s];
        numClass += m.type === 1 ? ' rs-ft' : ' rs-fg';
        let isQE = qEndsA.includes(s);
        if (isQE && s === curA) {
           bHtml = `<div class="rs-game-end" style="width:100%; height:100%;">`;
        } else if (isQE) {
           bHtml = `<div class="rs-qend-line" style="width:100%; height:100%;">`;
        }
        
        let pDisp = m.type === 3 ? `<span class="pt3-circle">${m.pnum}</span>` : m.pnum;
        bHtml += pDisp + (isQE ? '</div>' : '');
      }

      let numDisp = s;
      if (qEndsH.includes(s) || qEndsA.includes(s)) {
        numDisp = `<span class="rs-qend-circle">${s}</span>`;
      }

      rightHtml += `<tr>
        <td class="rs-a">${hHtml}</td>
        <td class="${numClass}">${numDisp}</td>
        <td class="rs-b">${bHtml}</td>
      </tr>`;
    }
    rightHtml += `</table>`;
  }
  
  rightHtml += `</div>`;

  container.innerHTML = leftHtml + rightHtml;
}
