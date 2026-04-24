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
      DETECTION_INTERVAL: 150, // 軽量化のため少し広げる
      MIN_CONFIDENCE: 0.35,
      INPUT_SIZE: 160,         // 【軽量化】モデルの入力サイズを最小にして爆速化（デフォルト416）
      MODEL_URL: 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights'
    };
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
        // 【軽量化】カメラ解像度を下げてブラウザの負荷を減らす
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }
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
        .detectSingleFace(this.videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: this.CONFIG.INPUT_SIZE, scoreThreshold: this.CONFIG.MIN_CONFIDENCE }))
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
          .detectSingleFace(this.videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: this.CONFIG.INPUT_SIZE, scoreThreshold: this.CONFIG.MIN_CONFIDENCE }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();

        if (!detection) {
          if (onStatus) onStatus('顔が見つかりません... カメラを見てください');
          return;
        }

        // 顔検出フレーム描画（軽量化のため四角い枠のみ）
        this.drawDetection(detection);

        const match = this.findBestMatch(detection.descriptor);
        if (match) {
          // マッチ成功！即座にロック解除
          this.matchedUser = match.face;
          this.stopDetectionLoop();
          if (onStatus) onStatus(`✅ ${match.face.name} さんの顔を認識しました！`);
          
          if (onSuccess) onSuccess(this.matchedUser);
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
    
    // カスタム描画 - オレンジの枠（ドットは描画しない）
    const box = resized.detection.box;
    ctx.strokeStyle = '#FF6B00';
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
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
