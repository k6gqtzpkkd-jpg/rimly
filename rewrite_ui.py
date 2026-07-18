import os
import re

CSS_CONTENT = """
/* ================================================================
   RIMLY – Apple-like UI Style
   ================================================================ */
:root {
  --orange: #FF9500;
  --blue: #007AFF;
  --bg-base: #F2F2F7; /* iOS System Gray 6 */
  --bg-card: #FFFFFF;
  --bg-panel: rgba(255, 255, 255, 0.85);
  --border: rgba(60, 60, 67, 0.1);
  --text-primary: #000000;
  --text-secondary: rgba(60, 60, 67, 0.6);
  --text-muted: rgba(60, 60, 67, 0.3);
  --red: #FF3B30;
  --green: #34C759;
  --radius-lg: 20px;
  --radius-md: 14px;
  --radius-sm: 10px;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Helvetica Neue", sans-serif;
  overflow-x: hidden;
  padding-bottom: 90px; /* Space for bottom tab bar */
  font-size: 16px;
  line-height: 1.5;
}

/* Typography */
h1, h2, h3 { font-weight: 700; letter-spacing: -0.5px; }
.title-large { font-size: 34px; margin: 20px 16px; }
.title-medium { font-size: 22px; margin-bottom: 12px; }
.title-small { font-size: 17px; font-weight: 600; }
.text-body { font-size: 17px; }
.text-caption { font-size: 13px; color: var(--text-secondary); }

/* Colors */
.text-orange { color: var(--orange) !important; }
.text-blue { color: var(--blue) !important; }
.text-red { color: var(--red) !important; }

/* Buttons */
button {
  font-family: inherit;
  cursor: pointer;
  border: none;
  background: transparent;
  transition: opacity 0.15s, transform 0.15s;
}
button:active { opacity: 0.7; transform: scale(0.97); }

.btn-primary {
  background: var(--blue);
  color: white;
  font-size: 17px;
  font-weight: 600;
  border-radius: var(--radius-sm);
  padding: 14px 20px;
  width: 100%;
  text-align: center;
}
.btn-primary.orange { background: var(--orange); }
.btn-primary.red { background: var(--red); }

.btn-secondary {
  background: rgba(0, 122, 255, 0.1);
  color: var(--blue);
  font-size: 17px;
  font-weight: 600;
  border-radius: var(--radius-sm);
  padding: 14px 20px;
  width: 100%;
}
.btn-secondary.orange { background: rgba(255, 149, 0, 0.1); color: var(--orange); }

/* Layouts */
.screen { display: none; }
.screen.active { display: block; animation: fadeIn 0.3s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.tab-content { display: none; padding: 16px; max-width: 800px; margin: 0 auto; }
.tab-content.active { display: block; animation: slideUpFade 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); }
@keyframes slideUpFade {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Cards (iOS Style) */
.card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.03);
}

.list-group {
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-bottom: 20px;
}
.list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 0.5px solid var(--border);
}
.list-item:last-child { border-bottom: none; }

/* Inputs */
input[type="text"], input[type="number"], select {
  font-family: inherit;
  font-size: 17px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  width: 100%;
  background: var(--bg-base);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.2s;
}
input:focus, select:focus { border-color: var(--blue); }

/* Setup & Toggles */
.toggle-group {
  display: flex;
  background: var(--bg-base);
  border-radius: 8px;
  padding: 2px;
}
.toggle-btn {
  flex: 1;
  padding: 8px;
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  border-radius: 6px;
  color: var(--text-secondary);
}
.toggle-btn.active.ts-orange { background: white; color: var(--orange); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.toggle-btn.active.ts-blue { background: white; color: var(--blue); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

/* Scoreboard */
.score-hero {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 30px 0;
}
.team-score {
  flex: 1;
  text-align: center;
}
.score-number {
  font-family: "Bebas Neue", -apple-system, sans-serif;
  font-size: 110px;
  line-height: 1;
  font-weight: bold;
}
.score-divider {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-muted);
  padding: 0 20px;
}
.team-name-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 20px;
  margin-bottom: 8px;
  display: inline-block;
}
.badge-home { background: rgba(255, 149, 0, 0.15); color: var(--orange); }
.badge-away { background: rgba(0, 122, 255, 0.15); color: var(--blue); }
.team-name { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }

/* Period info */
.period-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  margin-bottom: 30px;
}
.period-text { font-size: 17px; font-weight: 700; }
.btn-round {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-card);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: var(--text-secondary);
}

/* Roster Cards (Tap to Score) */
.roster-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 12px;
}
.player-card {
  background: var(--bg-card);
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  padding: 12px;
  text-align: center;
  box-shadow: 0 2px 10px rgba(0,0,0,0.04);
  transition: transform 0.1s, box-shadow 0.1s;
}
.player-card:active { transform: scale(0.95); }
.player-card.home { border-color: rgba(255, 149, 0, 0.1); }
.player-card.away { border-color: rgba(0, 122, 255, 0.1); }
.player-card .p-num { font-size: 22px; font-weight: 800; }
.player-card .p-name { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.player-card .p-pts { font-size: 14px; font-weight: 700; margin-top: 4px; color: var(--text-primary); }
.player-card .p-foul { font-size: 12px; color: var(--red); font-weight: 600; }

/* Stats rows */
.stats-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 20px;
}
.stat-box {
  background: var(--bg-card);
  padding: 16px;
  border-radius: var(--radius-md);
  flex: 1;
  text-align: center;
  margin: 0 8px;
}
.stat-box:first-child { margin-left: 0; }
.stat-box:last-child { margin-right: 0; }
.stat-title { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
.stat-val { font-size: 24px; font-weight: 700; }

/* Bottom Tab Bar */
.bottom-tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 85px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 0.5px solid var(--border);
  display: flex;
  justify-content: space-around;
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 900;
}
.bottom-tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  width: 60px;
  padding-top: 8px;
}
.bottom-tab-item svg { width: 26px; height: 26px; margin-bottom: 4px; fill: currentColor; }
.bottom-tab-item span { font-size: 10px; font-weight: 600; }
.bottom-tab-item.active { color: var(--blue); }

/* Action Sheet (iOS style bottom menu) */
.action-sheet-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s;
}
.action-sheet-overlay.show { opacity: 1; visibility: visible; }
.action-sheet {
  background: transparent;
  padding: 16px;
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.action-sheet-overlay.show .action-sheet { transform: translateY(0); }

.as-group {
  background: var(--bg-card);
  border-radius: 14px;
  margin-bottom: 10px;
  overflow: hidden;
}
.as-title {
  padding: 14px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 600;
  border-bottom: 0.5px solid var(--border);
}
.as-btn {
  width: 100%;
  padding: 18px;
  background: white;
  border-bottom: 0.5px solid var(--border);
  font-size: 20px;
  font-weight: 500;
  color: var(--blue);
  text-align: center;
}
.as-btn:last-child { border-bottom: none; }
.as-btn.text-orange { color: var(--orange); }
.as-btn.text-red { color: var(--red); }
.as-cancel {
  width: 100%;
  padding: 18px;
  background: white;
  border-radius: 14px;
  font-size: 20px;
  font-weight: 600;
  color: var(--blue);
  text-align: center;
}

/* Modals */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0; visibility: hidden;
  transition: 0.2s;
}
.modal-overlay.open { opacity: 1; visibility: visible; }
.modal-box {
  background: var(--bg-base);
  width: 90%;
  max-width: 400px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  transform: scale(0.95);
  transition: 0.2s;
}
.modal-overlay.open .modal-box { transform: scale(1); }
.modal-header {
  padding: 16px;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  background: var(--bg-card);
  border-bottom: 0.5px solid var(--border);
  position: relative;
}
.modal-close {
  position: absolute;
  right: 16px;
  top: 16px;
  font-size: 20px;
  color: var(--text-secondary);
}
.modal-body { padding: 16px; background: var(--bg-base); }
.action-grid { display: grid; gap: 10px; }

/* Password Screen iOS Setup Style */
#password-screen { background: var(--bg-base); justify-content: center; }
.pw-numpad { display: grid; grid-template-columns: repeat(3, 80px); gap: 16px; margin-top: 30px; }
.num-btn {
  width: 80px; height: 80px;
  border-radius: 40px;
  background: white;
  font-size: 28px;
  font-weight: 500;
  color: black;
  box-shadow: 0 1px 5px rgba(0,0,0,0.05);
}
.pw-dots { display: flex; gap: 16px; margin-top: 20px; }
.dot { width: 16px; height: 16px; border-radius: 8px; border: 1.5px solid var(--blue); }
.dot.filled { background: var(--blue); }
.dot.error { background: var(--red); border-color: var(--red); }
"""

with open('style.css', 'w') as f:
    f.write(CSS_CONTENT)

print("Overwrote style.css completely.")
