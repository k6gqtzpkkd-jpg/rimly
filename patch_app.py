import os

file_path = "app.js"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Replace tab button selectors
content = content.replace(".tab-btn", ".bottom-tab-item")
content = content.replace("renderTableRoster('home');", "renderGridRoster('home');")
content = content.replace("renderTableRoster('away');", "renderGridRoster('away');")

# 2. Add the new Action Sheet & Grid Roster logic at the end
NEW_LOGIC = """

// ================================================================
// ★ APPLE-LIKE UI NEW LOGIC
// ================================================================

function renderGridRoster(tm) {
  const container = document.getElementById(`roster-${tm}-grid`);
  if (!container) return;
  container.innerHTML = '';
  
  appState.game[tm].players.forEach(p => {
    const card = document.createElement('div');
    card.className = `player-card ${tm}`;
    card.innerHTML = `
      <div class="p-num">#${p.num}</div>
      <div class="p-name">${p.name || 'Unknown'}</div>
      <div class="p-pts">${p.pts || 0} pts</div>
      <div class="p-foul">${p.pf || 0}F</div>
    `;
    card.onclick = () => openActionSheet(tm, p.id);
    container.appendChild(card);
  });
}

let activeSheetTarget = null;

function openActionSheet(team, pid) {
  const g = appState.game;
  const p = g[team].players.find(x => x.id === pid);
  activeSheetTarget = { team, pid };
  document.getElementById('as-player-title').textContent = `#${p.num} ${p.name || 'Unknown'}`;
  document.getElementById('action-sheet-overlay').classList.add('show');
}

function closeActionSheet() {
  document.getElementById('action-sheet-overlay').classList.remove('show');
  activeSheetTarget = null;
}

document.getElementById('as-btn-cancel').onclick = closeActionSheet;
document.getElementById('action-sheet-overlay').onclick = (e) => {
  if (e.target === document.getElementById('action-sheet-overlay')) {
    closeActionSheet();
  }
};

document.getElementById('as-btn-2p').onclick = () => {
  if (!activeSheetTarget) return;
  addScore(activeSheetTarget.team, activeSheetTarget.pid, 2, '2P');
  closeActionSheet();
};

document.getElementById('as-btn-3p').onclick = () => {
  if (!activeSheetTarget) return;
  addScore(activeSheetTarget.team, activeSheetTarget.pid, 3, '3P');
  closeActionSheet();
};

document.getElementById('as-btn-ft').onclick = () => {
  if (!activeSheetTarget) return;
  addScore(activeSheetTarget.team, activeSheetTarget.pid, 1, 'FT');
  closeActionSheet();
};

document.getElementById('as-btn-foul').onclick = () => {
  if (!activeSheetTarget) return;
  // Trigger foul modal (existing logic in app.js opens the foul modal)
  actTeamTarget = activeSheetTarget.team;
  actPlayerTarget = activeSheetTarget.pid;
  document.getElementById('mact-title').textContent = document.getElementById('as-player-title').textContent;
  document.getElementById('modal-foul-action').parentElement.classList.add('open');
  closeActionSheet();
};

document.getElementById('as-btn-to').onclick = () => {
  if (!activeSheetTarget) return;
  useTimeout(activeSheetTarget.team);
  closeActionSheet();
};

"""

# Append the new logic
if "APPLE-LIKE UI NEW LOGIC" not in content:
    content += NEW_LOGIC

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("app.js patched successfully.")
