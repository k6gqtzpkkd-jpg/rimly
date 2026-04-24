/* ==========================================================
   Rimly Face Auth + Liveness Detection Engine
   顔認証 + 8方向生体検知によるロック解除システム
   ========================================================== */

class RimlyFaceAuth {
  constructor() {
    this.db = null;
    this.videoEl = null;
    this.canvasEl = null;
    this.isModelLoaded = false;
    this.failCount = 0;
    this.MAX_FAILS = 3;
    this.registeredFaces = [];
    this.baselineLandmarks = null;
    this.isRunning = false;
    this.currentStream = null;
    this.matchedUser = null;
    this.livenessTimer = null;
    this.detectionLoop = null;

    // 検知設定
    this.CONFIG = {
      MATCH_THRESHOLD: 0.6,
      LIVENESS_TIMEOUT: 6000,
      DIRECTION_THRESHOLD: 12,
      DETECTION_INTERVAL: 100,
      MIN_CONFIDENCE: 0.35,
      MODEL_URL: 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights'
    };

    // 8方向定義
    this.DIRECTIONS = [
      { key: 'up',         label: '上',     emoji: '⬆️',  dx: 0,  dy: -1 },
      { key: 'up-right',   label: '右上',   emoji: '↗️',  dx: 1,  dy: -1 },
      { key: 'right',      label: '右',     emoji: '➡️',  dx: 1,  dy: 0  },
      { key: 'down-right', label: '右下',   emoji: '↘️',  dx: 1,  dy: 1  },
      { key: 'down',       label: '下',     emoji: '⬇️',  dx: 0,  dy: 1  },
      { key: 'down-left',  label: '左下',   emoji: '↙️',  dx: -1, dy: 1  },
      { key: 'left',       label: '左',     emoji: '⬅️',  dx: -1, dy: 0  },
      { key: 'up-left',    label: '左上',   emoji: '↖️',  dx: -1, dy: -1 }
    ];
  }

  // =========================================================
  // IndexedDB
  // =========================================================
  openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('rimly_face_db', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('faces')) {
          db.createObjectStore('faces', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
      req.onerror = (e) => reject(e);
    });
  }

  async saveFace(name, descriptor) {
    const id = 'face_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const record = {
      id,
      name,
      descriptor: Array.from(descriptor), // Float32Array → 通常配列で保存
      createdAt: Date.now()
    };
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('faces', 'readwrite');
      tx.objectStore('faces').put(record);
      tx.oncomplete = () => {
        this.registeredFaces.push({
          ...record,
          descriptor: new Float32Array(record.descriptor)
        });
        resolve(record);
      };
      tx.onerror = reject;
    });
  }

  async deleteFace(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('faces', 'readwrite');
      tx.objectStore('faces').delete(id);
      tx.oncomplete = () => {
        this.registeredFaces = this.registeredFaces.filter(f => f.id !== id);
        resolve();
      };
      tx.onerror = reject;
    });
  }

  async loadRegisteredFaces() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('faces', 'readonly');
      const req = tx.objectStore('faces').getAll();
      req.onsuccess = () => {
        this.registeredFaces = req.result.map(r => ({
          ...r,
          descriptor: new Float32Array(r.descriptor)
        }));
        resolve(this.registeredFaces);
      };
      req.onerror = reject;
    });
  }

  // =========================================================
  // モデル読み込み
  // =========================================================
  async loadModels() {
    if (this.isModelLoaded) return;
    const url = this.CONFIG.MODEL_URL;
    await faceapi.nets.tinyFaceDetector.loadFromUri(url);
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(url);
    await faceapi.nets.faceRecognitionNet.loadFromUri(url);
    this.isModelLoaded = true;
  }

  // =========================================================
  // 初期化
  // =========================================================
  async init() {
    await this.openDB();
    await this.loadRegisteredFaces();
    // モデルは顔認証ボタン押下時に遅延読み込み
  }

  // =========================================================
  // カメラ制御
  // =========================================================
  async startCamera(videoElement) {
    this.videoEl = videoElement;
    try {
      this.currentStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      this.videoEl.srcObject = this.currentStream;
      await new Promise(r => { this.videoEl.onloadedmetadata = r; });
      await this.videoEl.play();
      return true;
    } catch (e) {
      console.error('Camera error:', e);
      return false;
    }
  }

  stopCamera() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(t => t.stop());
      this.currentStream = null;
    }
    if (this.videoEl) this.videoEl.srcObject = null;
    this.stopDetectionLoop();
  }

  stopDetectionLoop() {
    if (this.detectionLoop) {
      clearInterval(this.detectionLoop);
      this.detectionLoop = null;
    }
    if (this.livenessTimer) {
      clearTimeout(this.livenessTimer);
      this.livenessTimer = null;
    }
    this.isRunning = false;
  }

  // =========================================================
  // 顔登録
  // =========================================================
  async registerFace(userName, onStatus) {
    if (!this.isModelLoaded) {
      if (onStatus) onStatus('モデルを読み込み中...');
      await this.loadModels();
    }

    if (onStatus) onStatus('顔を検出しています... カメラを見てください');

    // 安定した検出のために複数フレームで平均を取る
    const descriptors = [];
    const SAMPLES = 3;
    let attempts = 0;
    const MAX_ATTEMPTS = 40; // 最大試行回数

    while (descriptors.length < SAMPLES && attempts < MAX_ATTEMPTS) {
      attempts++;
      const detection = await faceapi
        .detectSingleFace(this.videoEl, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: this.CONFIG.MIN_CONFIDENCE }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (detection) {
        descriptors.push(detection.descriptor);
        if (onStatus) onStatus(`顔をスキャン中... (${descriptors.length}/${SAMPLES})`);
      }
      await new Promise(r => setTimeout(r, 100));
    }

    if (descriptors.length < SAMPLES) {
      throw new Error('顔の検出に失敗しました。明るい場所でカメラを正面から見てください。');
    }

    // 平均特徴量を計算
    const avgDescriptor = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      let sum = 0;
      for (const d of descriptors) sum += d[i];
      avgDescriptor[i] = sum / descriptors.length;
    }

    const record = await this.saveFace(userName, avgDescriptor);
    return record;
  }

  // =========================================================
  // 顔認証（マッチング）
  // =========================================================
  findBestMatch(descriptor) {
    if (this.registeredFaces.length === 0) return null;

    let bestDist = Infinity;
    let bestFace = null;

    for (const face of this.registeredFaces) {
      const dist = faceapi.euclideanDistance(descriptor, face.descriptor);
      if (dist < bestDist) {
        bestDist = dist;
        bestFace = face;
      }
    }

    if (bestDist < this.CONFIG.MATCH_THRESHOLD) {
      return { face: bestFace, distance: bestDist };
    }
    return null;
  }

  async authenticate(onStatus, onSuccess, onFail, onForcePIN) {
    if (!this.isModelLoaded) {
      if (onStatus) onStatus('AIモデルを読み込み中...');
      await this.loadModels();
    }

    if (this.registeredFaces.length === 0) {
      if (onStatus) onStatus('登録済みの顔がありません。設定から登録してください。');
      return;
    }

    this.isRunning = true;
    this.matchedUser = null;
    if (onStatus) onStatus('顔を認識しています...');

    this.detectionLoop = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        const detection = await faceapi
          .detectSingleFace(this.videoEl, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: this.CONFIG.MIN_CONFIDENCE }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();

        if (!detection) {
          if (onStatus) onStatus('顔が見つかりません... カメラを見てください');
          return;
        }

        // 顔検出フレーム描画
        this.drawDetection(detection);

        const match = this.findBestMatch(detection.descriptor);
        if (match) {
          // マッチ成功！ → Liveness Detectionへ
          this.matchedUser = match.face;
          this.stopDetectionLoop();
          if (onStatus) onStatus(`✅ ${match.face.name} さんの顔を認識しました！`);
          
          // 少し待ってからLivenessへ（高速化）
          setTimeout(() => {
            this.startLivenessCheck(onStatus, onSuccess, onFail, onForcePIN);
          }, 200);
        } else {
          if (onStatus) onStatus('認識中... (一致する顔が見つかりません)');
        }
      } catch (e) {
        console.error('Detection error:', e);
      }
    }, this.CONFIG.DETECTION_INTERVAL);

    // 15秒でタイムアウト
    setTimeout(() => {
      if (this.isRunning && !this.matchedUser) {
        this.stopDetectionLoop();
        this.failCount++;
        if (this.failCount >= this.MAX_FAILS) {
          if (onForcePIN) onForcePIN();
        } else {
          if (onFail) onFail(this.failCount, '顔認証がタイムアウトしました');
        }
      }
    }, 15000);
  }

  // =========================================================
  // 検出結果の描画
  // =========================================================
  drawDetection(detection) {
    if (!this.canvasEl || !this.videoEl) return;
    const canvas = this.canvasEl;
    const displaySize = { width: this.videoEl.videoWidth, height: this.videoEl.videoHeight };
    faceapi.matchDimensions(canvas, displaySize);
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const resized = faceapi.resizeResults(detection, displaySize);
    
    // カスタム描画 - オレンジの枠
    const box = resized.detection.box;
    ctx.strokeStyle = '#FF6B00';
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    
    // ランドマークを小さなドットで
    if (resized.landmarks) {
      const points = resized.landmarks.positions;
      ctx.fillStyle = 'rgba(255, 107, 0, 0.6)';
      for (const pt of points) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // =========================================================
  // Liveness Detection (8方向生体検知)
  // =========================================================
  async startLivenessCheck(onStatus, onSuccess, onFail, onForcePIN) {
    // ランダムに方向を選択
    const direction = this.DIRECTIONS[Math.floor(Math.random() * this.DIRECTIONS.length)];
    
    // UI更新コールバック
    const instructionEl = document.getElementById('liveness-instruction');
    const arrowEl = document.getElementById('direction-arrow');
    const textEl = document.getElementById('direction-text');
    const timerEl = document.getElementById('liveness-timer');
    const faceOverlay = document.getElementById('face-auth-overlay');
    
    if (instructionEl) instructionEl.style.display = 'block';
    if (arrowEl) arrowEl.textContent = '⏳';
    if (textEl) textEl.textContent = `準備中... 顔を動かさずにお待ちください`;
    if (faceOverlay) faceOverlay.classList.add('liveness-mode');
    
    // 1.5秒待機してから基準位置を取得・判定開始
    setTimeout(async () => {
      if (!this.isRunning) return;

      if (arrowEl) arrowEl.textContent = direction.emoji;
      if (textEl) textEl.textContent = `GO! 顔を「${direction.label}」に向けてください`;

      // 基準位置を取得
      let baseNose = null;
      let baseFaceWidth = null;
      const baseDetection = await faceapi
        .detectSingleFace(this.videoEl, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: this.CONFIG.MIN_CONFIDENCE }))
        .withFaceLandmarks(true);
      
      if (baseDetection) {
        const lm = baseDetection.landmarks;
        const nose = lm.getNose();
        const jaw = lm.getJawOutline();
        baseNose = { x: nose[3].x, y: nose[3].y };
        baseFaceWidth = Math.abs(jaw[16].x - jaw[0].x);
      }

      if (!baseNose) {
        if (onStatus) onStatus('基準位置の取得に失敗しました。もう一度お試しください。');
        this.failCount++;
        if (this.failCount >= this.MAX_FAILS) {
          if (onForcePIN) onForcePIN();
        } else {
          if (onFail) onFail(this.failCount, '生体検知に失敗しました');
        }
        return;
      }

      // カウントダウンタイマー (6秒)
      let timeLeft = 6;
      if (timerEl) timerEl.textContent = timeLeft;
      const countdown = setInterval(() => {
        timeLeft--;
        if (timerEl) timerEl.textContent = timeLeft;
        if (timeLeft <= 0) clearInterval(countdown);
      }, 1000);

      this.isRunning = true;
      let livenessSuccess = false;

      // 検出ループ
      this.detectionLoop = setInterval(async () => {
        if (!this.isRunning || livenessSuccess) return;

        try {
          const det = await faceapi
            .detectSingleFace(this.videoEl, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: this.CONFIG.MIN_CONFIDENCE }))
            .withFaceLandmarks(true);

          if (!det) return;

          this.drawDetection(det);

          const lm = det.landmarks;
          const nose = lm.getNose();
          const currentNose = { x: nose[3].x, y: nose[3].y };

          // 相対移動量を顔の幅で正規化
          const normDx = (currentNose.x - baseNose.x) / (baseFaceWidth || 1);
          const normDy = (currentNose.y - baseNose.y) / (baseFaceWidth || 1);

          const threshold = 0.08; // 正規化された閾値

          // 方向判定
          let detectedDir = null;
          if (Math.abs(normDx) > threshold || Math.abs(normDy) > threshold) {
            detectedDir = this.classifyDirection(normDx, normDy);
          }

          if (detectedDir && detectedDir.key === direction.key) {
            livenessSuccess = true;
            this.stopDetectionLoop();
            clearInterval(countdown);
            
            if (instructionEl) instructionEl.style.display = 'none';
            if (faceOverlay) faceOverlay.classList.remove('liveness-mode');
            if (onStatus) onStatus('✅ 認証成功！ロックを解除します...');
            
            setTimeout(() => {
              if (onSuccess) onSuccess(this.matchedUser);
            }, 100);
          }
        } catch (e) {
          console.error('Liveness detection error:', e);
        }
      }, this.CONFIG.DETECTION_INTERVAL);

      // タイムアウト
      this.livenessTimer = setTimeout(() => {
        if (!livenessSuccess) {
          this.stopDetectionLoop();
          clearInterval(countdown);
          
          if (instructionEl) instructionEl.style.display = 'none';
          if (faceOverlay) faceOverlay.classList.remove('liveness-mode');
          
          this.failCount++;
          if (this.failCount >= this.MAX_FAILS) {
            if (onForcePIN) onForcePIN();
          } else {
            if (onFail) onFail(this.failCount, '時間切れ - 顔の動きが検出できませんでした');
          }
        }
      }, this.CONFIG.LIVENESS_TIMEOUT);

    }, 1500); // 1.5秒待機

  }

  // 移動ベクトルを8方向に分類
  classifyDirection(dx, dy) {
    // atan2で角度を求める (右=0, 上=-90, 左=180, 下=90)
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    // 8方向の角度範囲 (各方向は45度の範囲)
    const ranges = [
      { key: 'right',      min: -22.5,  max: 22.5   },
      { key: 'down-right', min: 22.5,   max: 67.5   },
      { key: 'down',       min: 67.5,   max: 112.5  },
      { key: 'down-left',  min: 112.5,  max: 157.5  },
      { key: 'up-right',   min: -67.5,  max: -22.5  },
      { key: 'up',         min: -112.5, max: -67.5  },
      { key: 'up-left',    min: -157.5, max: -112.5 }
    ];

    for (const r of ranges) {
      if (angle >= r.min && angle < r.max) {
        return this.DIRECTIONS.find(d => d.key === r.key);
      }
    }
    // left: angle >= 157.5 or angle < -157.5
    return this.DIRECTIONS.find(d => d.key === 'left');
  }

  // =========================================================
  // ユーティリティ
  // =========================================================
  hasRegisteredFaces() {
    return this.registeredFaces.length > 0;
  }

  getRegisteredFaces() {
    return this.registeredFaces.map(f => ({
      id: f.id,
      name: f.name,
      createdAt: f.createdAt
    }));
  }

  resetFailCount() {
    this.failCount = 0;
  }
}

// グローバルインスタンス
const rimlyFaceAuth = new RimlyFaceAuth();
