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
      DETECTION_INTERVAL: 80,
      MIN_CONFIDENCE: 0.25,
      INPUT_SIZE: 128,
      ENABLE_SCAN_EFFECT: true,
      ENABLE_CENTER_FRAME: true, // センターフレーム機能を有効化
      CENTER_TOLERANCE: 0.15, // フレーム中央からの許容ズレ（比率）

      MODEL_URL: 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights'
    };

    this.lastDetection = null;
    this.renderLoopId = null;
    this.faceCenteringStatus = 'centered'; // 'centered', 'left', 'right', 'top', 'bottom'
    this.orientationChangeListener = null;
    this.attentionCanvas = null;
    this.attentionContext = null;
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
    this.lastDetection = null;
    try {
      this.currentStream = await navigator.mediaDevices.getUserMedia({
        // 【軽量化】カメラ解像度を下げてブラウザの負荷を減らす
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }
      });
      this.videoEl.srcObject = this.currentStream;
      await new Promise(r => { this.videoEl.onloadedmetadata = r; });
      await this.videoEl.play();
      
      this.startRenderLoop();
      
      return true;
    } catch (e) {
      console.error('Camera error:', e);
      return false;
    }
  }

  stopCamera() {
    this.stopRenderLoop();
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(t => t.stop());
      this.currentStream = null;
    }
    if (this.videoEl) this.videoEl.srcObject = null;
    this.stopDetectionLoop();
    if (this.orientationChangeListener) {
      window.removeEventListener('orientationchange', this.orientationChangeListener);
      this.orientationChangeListener = null;
    }
  }

  startRenderLoop() {
    this.stopRenderLoop();
    const loop = () => {
      if (this.lastDetection && this.isRunning) {
        this.drawDetection(this.lastDetection);
      } else if (this.canvasEl) {
        const ctx = this.canvasEl.getContext('2d');
        ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
      }
      this.renderLoopId = requestAnimationFrame(loop);
    };
    this.renderLoopId = requestAnimationFrame(loop);
  }

  stopRenderLoop() {
    if (this.renderLoopId) {
      cancelAnimationFrame(this.renderLoopId);
      this.renderLoopId = null;
    }
    if (this.canvasEl) {
      const ctx = this.canvasEl.getContext('2d');
      ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    }
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
        .detectSingleFace(this.videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: this.CONFIG.INPUT_SIZE, scoreThreshold: this.CONFIG.MIN_CONFIDENCE }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (detection) {
        descriptors.push(detection.descriptor);
        
        let statusMsg = `顔をスキャン中... (${descriptors.length}/${SAMPLES})`;
        
        // センタリングステータスを表示
        if (this.CONFIG.ENABLE_CENTER_FRAME) {
          const displaySize = { width: this.videoEl.videoWidth, height: this.videoEl.videoHeight };
          this.faceCenteringStatus = this.calculateFaceCenteringStatus(detection, displaySize);
          if (this.faceCenteringStatus !== 'centered') {
            const centeringHints = {
              'left': '← 右へ移動してください',
              'right': '右へ → 移動してください',
              'top': '↓ 下へ移動してください',
              'bottom': '↑ 上へ移動してください'
            };
            statusMsg += ` (${centeringHints[this.faceCenteringStatus]})`;
          }
        }
        
        if (onStatus) onStatus(statusMsg);
      } else {
        let statusMsg = '顔が見つかりません...';
        if (this.CONFIG.ENABLE_CENTER_FRAME) {
          statusMsg += ' 顔をカメラの中央に置いてください';
        }
        if (onStatus) onStatus(statusMsg);
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

  async authenticate(onStatus, onSuccess, onFail, onForcePIN, options = {}) {
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

    const startTime = Date.now();

    let detectionInFlight = false;
    const scan = async () => {
      if (!this.isRunning) return;
      if (detectionInFlight) return;
      detectionInFlight = true;

      try {
        const detection = await faceapi
          .detectSingleFace(this.videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: this.CONFIG.INPUT_SIZE, scoreThreshold: this.CONFIG.MIN_CONFIDENCE }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();

        if (!detection) {
          if (onStatus) onStatus('顔が見つかりません... カメラを見てください');
          this.lastDetection = null;
          return;
        }

        // 検出結果を保持して、アニメーションループに任せる
        this.lastDetection = detection;

        const match = this.findBestMatch(detection.descriptor);
        
        // 認証にかかった時間を計算
        const elapsed = Date.now() - startTime;

        // センタリングステータスを更新
        if (this.CONFIG.ENABLE_CENTER_FRAME) {
          const displaySize = { width: this.videoEl.videoWidth, height: this.videoEl.videoHeight };
          this.faceCenteringStatus = this.calculateFaceCenteringStatus(detection, displaySize);
        }
        
        if (match) {
          if (options.requireAttention && !this.isLookingAtScreen(detection)) {
            if (onStatus) onStatus('画面を注視してください');
            return;
          }
          if (elapsed < 180) {
            if (onStatus) onStatus('スキャン中...');
            return;
          }
          
          // マッチ成功！ロック解除
          this.matchedUser = match.face;
          this.stopDetectionLoop();
          if (onStatus) onStatus(`✅ ${match.face.name} さんの顔を認識しました！`);
          
          if (onSuccess) onSuccess(this.matchedUser);
        } else {
          let statusMsg = '認識中... (一致する顔が見つかりません)';
          if (this.CONFIG.ENABLE_CENTER_FRAME && this.faceCenteringStatus !== 'centered') {
            const centeringHints = {
              'left': '← 右へ移動してください',
              'right': '右へ → 移動してください',
              'top': '↓ 下へ移動してください',
              'bottom': '↑ 上へ移動してください'
            };
            statusMsg += ` | ${centeringHints[this.faceCenteringStatus] || ''}`;
          }
          if (onStatus) onStatus(statusMsg);
        }
      } catch (e) {
        console.error('Detection error:', e);
      } finally {
        detectionInFlight = false;
      }
    };
    scan();
    this.detectionLoop = setInterval(scan, this.CONFIG.DETECTION_INTERVAL);

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
  // 顔のセンタリング判定（センターフレーム機能）
  // =========================================================
  calculateFaceCenteringStatus(detection, displaySize) {
    if (!detection) return 'centered';

    // resizeResults後のオブジェクトか、元のdetectionか判定
    const box = detection.detection?.box || detection.box;
    const faceCenter = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    };

    const frameCenter = {
      x: displaySize.width / 2,
      y: displaySize.height / 2
    };

    const toleranceX = displaySize.width * this.CONFIG.CENTER_TOLERANCE;
    const toleranceY = displaySize.height * this.CONFIG.CENTER_TOLERANCE;

    const deltaX = faceCenter.x - frameCenter.x;
    const deltaY = faceCenter.y - frameCenter.y;

    // 縦・横の外れ方を判定
    if (Math.abs(deltaY) > toleranceY) {
      return deltaY > 0 ? 'bottom' : 'top';
    }
    if (Math.abs(deltaX) > toleranceX) {
      return deltaX > 0 ? 'right' : 'left';
    }

    return 'centered';
  }

  isLookingAtScreen(detection) {
    const landmarks = detection?.landmarks;
    if (!landmarks) return true;
    const leftEye = landmarks.getLeftEye?.() || [];
    const rightEye = landmarks.getRightEye?.() || [];
    const nose = landmarks.getNose?.() || [];
    if (leftEye.length === 0 || rightEye.length === 0 || nose.length === 0) return true;

    const avg = points => points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    const left = avg(leftEye);
    left.x /= leftEye.length; left.y /= leftEye.length;
    const right = avg(rightEye);
    right.x /= rightEye.length; right.y /= rightEye.length;
    const eyeCenter = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
    const noseTip = nose[nose.length - 1];
    const eyeDistance = Math.max(1, Math.hypot(right.x - left.x, right.y - left.y));
    const horizontalOffset = Math.abs(noseTip.x - eyeCenter.x) / eyeDistance;
    const verticalOffset = Math.abs(noseTip.y - eyeCenter.y) / eyeDistance;

    const faceLooksForward = horizontalOffset < 0.22 && verticalOffset < 0.95;
    if (!faceLooksForward) return false;

    const gaze = this.estimateEyeGaze(leftEye, rightEye);
    if (!gaze) return faceLooksForward;

    return Math.abs(gaze.x) < 0.34 && Math.abs(gaze.y) < 0.42 && gaze.confidence > 0.18;
  }

  estimateEyeGaze(leftEye, rightEye) {
    if (!this.videoEl || !this.videoEl.videoWidth || !this.videoEl.videoHeight) return null;
    if (!this.attentionCanvas) {
      this.attentionCanvas = document.createElement('canvas');
      this.attentionContext = this.attentionCanvas.getContext('2d', { willReadFrequently: true });
    }
    const canvas = this.attentionCanvas;
    const ctx = this.attentionContext;
    canvas.width = this.videoEl.videoWidth;
    canvas.height = this.videoEl.videoHeight;
    ctx.drawImage(this.videoEl, 0, 0, canvas.width, canvas.height);

    const left = this.estimateSingleEyeGaze(ctx, leftEye);
    const right = this.estimateSingleEyeGaze(ctx, rightEye);
    const valid = [left, right].filter(Boolean);
    if (valid.length === 0) return null;

    const avg = valid.reduce((acc, eye) => ({
      x: acc.x + eye.x,
      y: acc.y + eye.y,
      confidence: acc.confidence + eye.confidence
    }), { x: 0, y: 0, confidence: 0 });

    return {
      x: avg.x / valid.length,
      y: avg.y / valid.length,
      confidence: avg.confidence / valid.length
    };
  }

  estimateSingleEyeGaze(ctx, eye) {
    if (!Array.isArray(eye) || eye.length < 6) return null;
    const xs = eye.map(p => p.x);
    const ys = eye.map(p => p.y);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const maxX = Math.min(this.videoEl.videoWidth - 1, Math.ceil(Math.max(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(this.videoEl.videoHeight - 1, Math.ceil(Math.max(...ys)));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    if (width < 6 || height < 3 || height / width < 0.10) return null;

    const padX = Math.max(2, Math.round(width * 0.08));
    const padY = Math.max(1, Math.round(height * 0.20));
    const sx = Math.max(0, minX - padX);
    const sy = Math.max(0, minY - padY);
    const sw = Math.min(this.videoEl.videoWidth - sx, width + padX * 2);
    const sh = Math.min(this.videoEl.videoHeight - sy, height + padY * 2);
    const data = ctx.getImageData(sx, sy, sw, sh).data;

    const centerX = sw / 2;
    const centerY = sh / 2;
    const radiusX = Math.max(1, sw * 0.46);
    const radiusY = Math.max(1, sh * 0.42);
    let weightSum = 0;
    let xSum = 0;
    let ySum = 0;

    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        const nx = (x - centerX) / radiusX;
        const ny = (y - centerY) / radiusY;
        if ((nx * nx + ny * ny) > 1) continue;
        const i = (y * sw + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        const darkness = Math.max(0, 168 - luminance);
        if (darkness < 24) continue;
        const centerBias = Math.max(0.35, 1 - Math.abs(ny) * 0.55);
        const weight = darkness * darkness * centerBias;
        weightSum += weight;
        xSum += x * weight;
        ySum += y * weight;
      }
    }

    if (weightSum <= 0) return null;
    const pupilX = xSum / weightSum;
    const pupilY = ySum / weightSum;
    return {
      x: (pupilX - centerX) / radiusX,
      y: (pupilY - centerY) / radiusY,
      confidence: Math.min(1, weightSum / (sw * sh * 900))
    };
  }

  // =========================================================
  drawDetection(detection) {
    if (!this.canvasEl || !this.videoEl) {
      console.warn('drawDetection: canvas or video missing', { canvasEl: !!this.canvasEl, videoEl: !!this.videoEl });
      return;
    }
    const canvas = this.canvasEl;
    const displaySize = { width: this.videoEl.videoWidth, height: this.videoEl.videoHeight };
    
    if (displaySize.width === 0 || displaySize.height === 0) {
      console.warn('drawDetection: video dimensions are 0', displaySize);
      return;
    }
    
    faceapi.matchDimensions(canvas, displaySize);
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const resized = faceapi.resizeResults(detection, displaySize);
    const box = resized.detection.box;

    if (!this.CONFIG.ENABLE_SCAN_EFFECT) {
      // 軽量化モード：シンプルなオレンジの枠
      ctx.strokeStyle = '#FF6B00';
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      
      // 軽量化モード時もガイダンス表示
      if (this.CONFIG.ENABLE_CENTER_FRAME) {
        this.faceCenteringStatus = this.calculateFaceCenteringStatus(resized, displaySize);
        this.drawCenteringGuide(ctx, displaySize, this.faceCenteringStatus, box);
      }
      return;
    }

    // リッチモード：顔の形（輪郭）に合わせてクリップし、スキャンドットを走らせる
    ctx.save();
    
    // 顔の輪郭を取得
    if (resized.landmarks) {
      const jaw = resized.landmarks.getJawOutline();
      const leftBrow = resized.landmarks.getLeftEyeBrow();
      const rightBrow = resized.landmarks.getRightEyeBrow();
      
      // パスを作成（アゴのライン → 右眉 → 左眉 → アゴの始点）
      ctx.beginPath();
      ctx.moveTo(jaw[0].x, jaw[0].y);
      for(let i=1; i<jaw.length; i++) ctx.lineTo(jaw[i].x, jaw[i].y);
      
      // アゴの右端から右眉の右端へ
      ctx.lineTo(rightBrow[rightBrow.length-1].x, rightBrow[rightBrow.length-1].y);
      for(let i=rightBrow.length-2; i>=0; i--) ctx.lineTo(rightBrow[i].x, rightBrow[i].y);
      
      // 左眉へ
      for(let i=leftBrow.length-1; i>=0; i--) ctx.lineTo(leftBrow[i].x, leftBrow[i].y);
      
      ctx.closePath();

      // 薄いオレンジの輪郭線を描画
      ctx.strokeStyle = 'rgba(255, 107, 0, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // ここから先は顔の内部だけを描画領域（クリップ）にする
      ctx.clip();
    }

    // ドットのスキャンライン
    const time = Date.now();
    const speed = 6; // スキャンスピード
    
    // 縦のドット列（左から右へ）
    const scanX = (time / speed) % box.width + box.x;
    
    // 横のドット列（上から下へ）
    const scanY = (time / speed) % box.height + box.y;

    ctx.fillStyle = '#FF6B00';
    ctx.shadowColor = '#FF6B00';
    ctx.shadowBlur = 8; // 発光効果

    const dotSpacing = 12; // ドットの間隔
    const dotRadius = 2.5;

    // 縦ラインを描画
    for(let y = box.y; y < box.y + box.height; y += dotSpacing) {
      ctx.beginPath();
      ctx.arc(scanX, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 横ラインを描画
    for(let x = box.x; x < box.x + box.width; x += dotSpacing) {
      ctx.beginPath();
      ctx.arc(x, scanY, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // ガイダンスは最後に描画（最前面に表示）
    if (this.CONFIG.ENABLE_CENTER_FRAME) {
      this.faceCenteringStatus = this.calculateFaceCenteringStatus(resized, displaySize);
      this.drawCenteringGuide(ctx, displaySize, this.faceCenteringStatus, box);
    }
  }

  drawCenteringGuide(ctx, displaySize, status, faceBox) {
    console.log('drawCenteringGuide called:', status, displaySize);
    const centerX = displaySize.width / 2;
    const centerY = displaySize.height / 2;
    const guideRadius = 60;

    // 中央ターゲット円（薄い背景で見やすく）
    ctx.strokeStyle = 'rgba(255, 107, 0, 0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(centerX, centerY, guideRadius, 0, Math.PI * 2);
    ctx.stroke();

    // 十字マーク
    ctx.strokeStyle = 'rgba(255, 107, 0, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - 20, centerY);
    ctx.lineTo(centerX + 20, centerY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - 20);
    ctx.lineTo(centerX, centerY + 20);
    ctx.stroke();

    // ステータステキスト
    ctx.fillStyle = status === 'centered' ? 'rgba(76, 175, 80, 1)' : 'rgba(255, 107, 0, 1)';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let guidanceText = '';

    if (status === 'centered') {
      guidanceText = '✓ 中央';
      ctx.fillStyle = 'rgba(76, 175, 80, 1)';
    } else if (status === 'left') {
      guidanceText = '← 右へ移動';
    } else if (status === 'right') {
      guidanceText = '右へ移動 →';
    } else if (status === 'top') {
      guidanceText = '↓ 下へ移動';
    } else if (status === 'bottom') {
      guidanceText = '↑ 上へ移動';
    }

    // ガイダンステキスト（フレーム下部に表示）
    ctx.fillText(guidanceText, centerX, displaySize.height - 40);

    // 方向矢印を大きく表示
    if (status !== 'centered') {
      this.drawDirectionArrow(ctx, centerX, centerY, status);
    }
  }

  drawDirectionArrow(ctx, centerX, centerY, direction) {
    const arrowSize = 40;
    const offset = 50;

    ctx.fillStyle = 'rgba(255, 107, 0, 0.8)';
    ctx.strokeStyle = 'rgba(255, 107, 0, 1)';
    ctx.lineWidth = 2;

    if (direction === 'left') {
      // 左矢印
      ctx.beginPath();
      ctx.moveTo(centerX - offset, centerY);
      ctx.lineTo(centerX - offset - arrowSize, centerY - arrowSize / 2);
      ctx.lineTo(centerX - offset - arrowSize / 2, centerY);
      ctx.lineTo(centerX - offset - arrowSize, centerY + arrowSize / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (direction === 'right') {
      // 右矢印
      ctx.beginPath();
      ctx.moveTo(centerX + offset, centerY);
      ctx.lineTo(centerX + offset + arrowSize, centerY - arrowSize / 2);
      ctx.lineTo(centerX + offset + arrowSize / 2, centerY);
      ctx.lineTo(centerX + offset + arrowSize, centerY + arrowSize / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (direction === 'top') {
      // 上矢印
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - offset);
      ctx.lineTo(centerX - arrowSize / 2, centerY - offset - arrowSize);
      ctx.lineTo(centerX, centerY - offset - arrowSize / 2);
      ctx.lineTo(centerX + arrowSize / 2, centerY - offset - arrowSize);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (direction === 'bottom') {
      // 下矢印
      ctx.beginPath();
      ctx.moveTo(centerX, centerY + offset);
      ctx.lineTo(centerX - arrowSize / 2, centerY + offset + arrowSize);
      ctx.lineTo(centerX, centerY + offset + arrowSize / 2);
      ctx.lineTo(centerX + arrowSize / 2, centerY + offset + arrowSize);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
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
window.rimlyFaceAuth = rimlyFaceAuth;
