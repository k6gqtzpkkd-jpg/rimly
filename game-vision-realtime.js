// ================================================================
// REALTIME GAME VISION - リアルタイム動画解析システム
// ================================================================
let gameVisionState = {
  isRecording: false,
  stream: null,
  captureTimer: null,
  sendQueue: [],
  isSending: false,
  recordedEvents: [],
  lastEventTime: {},  // 重複排除用
  sessionEvents: []   // セッション中に検出されたイベント
};

async function startRealtimeRecording(video, canvas) {
  console.log('Starting realtime recording...');
  gameVisionState.isRecording = true;
  gameVisionState.recordedEvents = [];
  gameVisionState.lastEventTime = {};
  gameVisionState.sessionEvents = [];

  // 1秒ごとにフレームをキャプチャして送信
  gameVisionState.captureTimer = setInterval(async () => {
    if (!gameVisionState.isRecording) return;

    try {
      const frame = captureFrame(video, canvas);
      if (frame) {
        // キューに追加
        gameVisionState.sendQueue.push(frame);
        // 非同期で送信（ブロッキングしない）
        processSendQueue();
      }
    } catch (e) {
      console.error('Frame capture error:', e);
    }
  }, 1000); // 1秒ごと
}

async function stopRealtimeRecording() {
  console.log('Stopping realtime recording...');
  gameVisionState.isRecording = false;
  
  if (gameVisionState.captureTimer) {
    clearInterval(gameVisionState.captureTimer);
    gameVisionState.captureTimer = null;
  }

  // 残りの送信キューを処理
  while (gameVisionState.sendQueue.length > 0) {
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log('Recording stopped. Detected events:', gameVisionState.sessionEvents);
  return gameVisionState.sessionEvents;
}

async function processSendQueue() {
  if (gameVisionState.isSending || gameVisionState.sendQueue.length === 0) return;

  gameVisionState.isSending = true;
  const frame = gameVisionState.sendQueue.shift();

  try {
    const analysis = await analyzeFrameAI(frame);
    if (analysis && analysis.events && analysis.events.length > 0) {
      // イベント検出！重複排除ロジック適用
      for (const event of analysis.events) {
        if (isValidNewEvent(event)) {
          console.log('New event detected:', event);
          gameVisionState.sessionEvents.push({
            ...event,
            detectedAt: Date.now()
          });
          // UI更新：検出イベントを表示
          displayDetectedEvent(event);
          // 自動記録
          await autoRecordEvent(event);
        }
      }
    }
  } catch (e) {
    console.error('AI analysis error:', e);
  } finally {
    gameVisionState.isSending = false;
    // 次のフレームを処理
    if (gameVisionState.sendQueue.length > 0) {
      setTimeout(processSendQueue, 100);
    }
  }
}

function isValidNewEvent(event) {
  // 確信度が高い(>=0.7)ことを確認
  if (!event.confidence || event.confidence < 0.7) return false;

  // 重複排除：同じイベント（チーム・プレイヤー・タイプ）が3秒以内にないか確認
  const eventKey = `${event.team}_${event.playerNum}_${event.type}`;
  const lastTime = gameVisionState.lastEventTime[eventKey] || 0;
  const now = Date.now();

  if (now - lastTime < 3000) {
    console.log('Duplicate event ignored:', eventKey);
    return false;
  }

  gameVisionState.lastEventTime[eventKey] = now;
  return true;
}

async function autoRecordEvent(event) {
  if (event.type === 'SCORE') {
    const points = event.scoreType === '3P' ? 3 : event.scoreType === '2P' ? 2 : 1;
    const team = event.team === 'home' ? 'home' : 'away';
    console.log(`Recording ${points}P for ${team} team, player #${event.playerNum}`);
    if (typeof addScore === 'function') {
      addScore(team, event.playerNum, points, event.scoreType);
    }
  } else if (event.type === 'FOUL') {
    const team = event.team === 'home' ? 'home' : 'away';
    console.log(`Recording foul for ${team} team, player #${event.playerNum}, type: ${event.foulType}`);
    if (typeof useFoul === 'function') {
      useFoul(team, event.playerNum, event.foulType);
    } else if (typeof addFoul === 'function') {
      addFoul(team, event.playerNum, event.foulType);
    }
  }
}

function displayDetectedEvent(event) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${event.type === 'SCORE' ? '#4CAF50' : '#FF9800'};
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: bold;
    z-index: 99999;
    animation: slideIn 0.3s ease;
  `;
  
  const typeLabel = event.type === 'SCORE' 
    ? `${event.scoreType || ''}得点` 
    : `${event.foulType || ''}ファウル`;
  
  notification.textContent = `🎯 ${event.team === 'home' ? 'ホーム' : 'アウェイ'} #${event.playerNum} ${typeLabel}`;
  
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

async function analyzeFrameAI(frameData) {
  try {
    const payload = {
      image: frameData,
      homePlayers: Array.from(document.querySelectorAll('#roster-home-table tbody tr')).map(tr => ({
        num: tr.querySelector('.td-num')?.textContent?.trim()?.replace('#', '') || '',
        name: tr.querySelector('.td-name')?.textContent?.trim() || ''
      })),
      awayPlayers: Array.from(document.querySelectorAll('#roster-away-table tbody tr')).map(tr => ({
        num: tr.querySelector('.td-num')?.textContent?.trim()?.replace('#', '') || '',
        name: tr.querySelector('.td-name')?.textContent?.trim() || ''
      })),
      homeName: document.getElementById('disp-home-name')?.textContent?.trim(),
      awayName: document.getElementById('disp-away-name')?.textContent?.trim(),
      quarter: document.getElementById('period-info')?.textContent?.trim(),
      homeScore: document.getElementById('home-score')?.textContent?.trim(),
      awayScore: document.getElementById('away-score')?.textContent?.trim()
    };

    const resp = await fetch('/api/game-vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('API error:', resp.status, errText);
      return null;
    }

    return await resp.json();
  } catch (e) {
    console.error('Analysis error:', e);
    return null;
  }
}

function captureFrame(video, canvas) {
  try {
    if (!video || !canvas) return null;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    
    // より軽量な圧縮率
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch (e) {
    console.error('Capture error:', e);
    return null;
  }
}
