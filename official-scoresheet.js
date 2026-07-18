function generateOfficialScoresheet() {
  const s = document.getElementById('sheet');
  s.innerHTML = ''; // clear

  const g = appState.game;
  if (!g) return;

  // Helper to create absolute div
  function addDiv(x, y, w, h, text, customClass = '') {
    const d = document.createElement('div');
    d.className = 'abs ' + customClass;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.style.width = w + 'px';
    d.style.height = h + 'px';
    d.innerHTML = text;
    s.appendChild(d);
  }

  // Helper to draw an 'X'
  function addCross(x, y, w, h) {
    addDiv(x, y, w, h, '×', 'cross');
  }

  // 1. GAME INFO (Header)
  addDiv(100, 60, 200, 20, g.competition || '', 'left-align'); // Competition
  addDiv(100, 80, 200, 20, g.date || '', 'left-align');        // Date
  addDiv(350, 80, 100, 20, g.time || '', 'left-align');        // Time
  addDiv(100, 100, 200, 20, g.chiefUmpire || '', 'left-align');// Chief Umpire
  addDiv(350, 100, 200, 20, g.firstUmpire || '', 'left-align');// First Umpire

  // TEAM NAMES
  addDiv(50, 125, 200, 30, `<b>${g.home.name}</b>`, 'left-align'); // Team A Name
  addDiv(50, 545, 200, 30, `<b>${g.away.name}</b>`, 'left-align'); // Team B Name

  // 2. TIMEOUTS (Using 8 - remaining_minutes rule)
  // Find timeouts in g.logs
  const toLogs = g.logs.filter(l => l.type === 'TO').reverse(); // oldest first
  const homeTOs = toLogs.filter(l => l.team === 'home');
  const awayTOs = toLogs.filter(l => l.team === 'away');

  function getTimeoutMinute(log) {
    // log.detail is "TIMEOUT (3:44)"
    const match = log.detail.match(/TIMEOUT\s*\(\s*(\d+):/);
    if (match) {
      const remainingMinutes = parseInt(match[1], 10);
      // user rule: 8 - remaining_time (seconds truncated)
      let elapsed = 8 - remainingMinutes;
      // If elapsed becomes negative or invalid, default to something
      if (elapsed < 0) elapsed = 0;
      return elapsed.toString();
    }
    return '';
  }

  // Draw timeouts for Home (Team A)
  // Assume positions: H1 box1 (160, 160), H1 box2 (190, 160)
  // H2 box1 (230, 160), H2 box2 (260, 160), H2 box3 (290, 160)
  // OT box (330, 160)
  const homeH1 = homeTOs.filter(l => l.qStr === 'Q1' || l.qStr === 'Q2');
  const homeH2 = homeTOs.filter(l => l.qStr === 'Q3' || l.qStr === 'Q4');
  const homeOT = homeTOs.filter(l => l.qStr.startsWith('OT'));

  if(homeH1[0]) addDiv(170, 160, 20, 20, getTimeoutMinute(homeH1[0]));
  if(homeH1[1]) addDiv(200, 160, 20, 20, getTimeoutMinute(homeH1[1]));
  
  if(homeH2[0]) addDiv(240, 160, 20, 20, getTimeoutMinute(homeH2[0]));
  if(homeH2[1]) addDiv(270, 160, 20, 20, getTimeoutMinute(homeH2[1]));
  if(homeH2[2]) addDiv(300, 160, 20, 20, getTimeoutMinute(homeH2[2]));

  if(homeOT[0]) addDiv(350, 160, 20, 20, getTimeoutMinute(homeOT[0]));

  // Away (Team B) Timeouts
  const awayH1 = awayTOs.filter(l => l.qStr === 'Q1' || l.qStr === 'Q2');
  const awayH2 = awayTOs.filter(l => l.qStr === 'Q3' || l.qStr === 'Q4');
  const awayOT = awayTOs.filter(l => l.qStr.startsWith('OT'));

  if(awayH1[0]) addDiv(170, 580, 20, 20, getTimeoutMinute(awayH1[0]));
  if(awayH1[1]) addDiv(200, 580, 20, 20, getTimeoutMinute(awayH1[1]));
  
  if(awayH2[0]) addDiv(240, 580, 20, 20, getTimeoutMinute(awayH2[0]));
  if(awayH2[1]) addDiv(270, 580, 20, 20, getTimeoutMinute(awayH2[1]));
  if(awayH2[2]) addDiv(300, 580, 20, 20, getTimeoutMinute(awayH2[2]));

  if(awayOT[0]) addDiv(350, 580, 20, 20, getTimeoutMinute(awayOT[0]));


  // 3. TEAM FOULS
  // X coordinates for team fouls: ~200, 230, 260, 290
  function drawTeamFouls(team, startY) {
    const q1 = g.teamFouls[team].Q1 || 0;
    const q2 = g.teamFouls[team].Q2 || 0;
    const q3 = g.teamFouls[team].Q3 || 0;
    const q4 = g.teamFouls[team].Q4 || 0;

    for(let i=0; i<Math.min(q1, 4); i++) addCross(210 + i*25, startY, 20, 20);
    for(let i=0; i<Math.min(q2, 4); i++) addCross(210 + i*25, startY + 25, 20, 20);
    for(let i=0; i<Math.min(q3, 4); i++) addCross(360 + i*25, startY, 20, 20);
    for(let i=0; i<Math.min(q4, 4); i++) addCross(360 + i*25, startY + 25, 20, 20);
  }
  drawTeamFouls('home', 200);
  drawTeamFouls('away', 620);


  // 4. PLAYERS
  function drawPlayers(team, startY) {
    const players = g[team].players || [];
    for(let i=0; i<Math.min(players.length, 15); i++) {
      const p = players[i];
      const y = startY + i * 16;
      
      // Name
      addDiv(143, y, 182, 16, p.name, 'left-align');
      
      // Number
      addDiv(325, y, 21, 16, p.num);
      
      // Participation (draw X if they played)
      // Since Rimly v4 doesn't strictly track who entered the court vs who didn't, 
      // we'll draw X for everyone who has at least 1 point or 1 foul, or just draw X for all.
      addCross(346, y, 19, 16);

      // Fouls
      let fX = 365;
      for(let f=1; f<=p.pf; f++) {
        let type = 'P'; // default personal
        // if technical or unsportsmanlike, we could check logs, but basic 'P' is standard.
        addDiv(fX, y, 20, 16, 'P');
        fX += 20;
      }
    }
  }

  drawPlayers('home', 304); // Team A players start at Y=304
  drawPlayers('away', 616); // Team B players start at Y=616


  // 5. RUNNING SCORE
  // Coordinates for 4 columns:
  // Col 1: A_num=578, A_score=598, B_score=619, B_num=639
  // Col 2: A_num=664, A_score=684, B_score=705, B_num=725
  // Col 3: A_num=750, A_score=770, B_score=794, B_num=818
  // Col 4: A_num=837... (Maybe out of bounds, but we'll approximate)
  const cols = [
    { aN: 578, aS: 598, bS: 619, bN: 639 },
    { aN: 664, aS: 684, bS: 705, bN: 725 },
    { aN: 750, aS: 770, bS: 794, bN: 818 },
    { aN: 837, aS: 857, bS: 878, bN: 898 } // Extended artificially
  ];

  const startYRunning = 145; // Approx start Y for row 1
  const rowH = 23.4; // 944 / 40 = 23.6, let's use 23.4

  // We need to trace the score progression to write the player number next to the scored point.
  // Sort score logs
  const scoreLogs = g.logs.filter(l => l.type === 'SCORE').reverse(); // oldest first

  let homeScore = 0;
  let awayScore = 0;

  scoreLogs.forEach(l => {
    // Add to score
    let points = l.val;
    const team = l.team;
    
    for(let pt=1; pt<=points; pt++) {
      if(team === 'home') homeScore++;
      if(team === 'away') awayScore++;

      let currentScore = team === 'home' ? homeScore : awayScore;
      
      // Determine column and row
      let colIdx = Math.floor((currentScore - 1) / 40);
      if (colIdx > 3) colIdx = 3; // max 160 points
      
      let rowIdx = (currentScore - 1) % 40;
      let y = startYRunning + (rowIdx * rowH);

      let col = cols[colIdx];

      // Draw the cross/circle over the score number
      if (team === 'home') {
        // Draw strike on score (or we can just put a dark overlay)
        // Officially, you strike out the number and write the player num.
        if (pt === points) { // Only write player number on the LAST point of this scoring event
          addDiv(col.aN, y, 20, rowH, l.pid || '');
        }
        // Draw a circle or cross on the score
        addDiv(col.aS, y, 21, rowH, '/', 'cross'); 
      } else {
        if (pt === points) {
          addDiv(col.bN, y, 20, rowH, l.pid || '');
        }
        addDiv(col.bS, y, 20, rowH, '/', 'cross');
      }
    }
  });

  // Write final scores at the bottom
  addDiv(200, 950, 100, 30, g.home.score, 'left-align');
  addDiv(350, 950, 100, 30, g.away.score, 'left-align');

  addDiv(200, 1000, 200, 30, g.home.score > g.away.score ? g.home.name : (g.away.score > g.home.score ? g.away.name : 'Draw'), 'left-align');
}
