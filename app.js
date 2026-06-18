(() => {
  // roundRect polyfill for older browsers
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
      if (typeof r === 'number') r = [r, r, r, r];
      const [tl, tr, br, bl] = r;
      this.moveTo(x + tl, y);
      this.lineTo(x + w - tr, y);
      this.quadraticCurveTo(x + w, y, x + w, y + tr);
      this.lineTo(x + w, y + h - br);
      this.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
      this.lineTo(x + bl, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - bl);
      this.lineTo(x, y + tl);
      this.quadraticCurveTo(x, y, x + tl, y);
      this.closePath();
      return this;
    };
  }

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const promptEl = document.getElementById('prompt');
  const overlayEl = document.getElementById('overlay');

  // --- Safe localStorage helpers ---
  function safeGetItem(key, fallback) {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? val : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // Storage full or disabled — silently fail
    }
  }

  // --- Firebase ---
  const firebaseConfig = {
    apiKey: "AIzaSyCIC4Kl9lAVLs--h5Dxv8ozECh3cKgvcvY",
    authDomain: "puff-8bdb8.firebaseapp.com",
    projectId: "puff-8bdb8",
    storageBucket: "puff-8bdb8.firebasestorage.app",
    messagingSenderId: "864452569584",
    appId: "1:864452569584:web:9895a41dc9b42f877b1535"
  };

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  const provider = new firebase.auth.GoogleAuthProvider();
  let currentUser = null;

  // Reset sign-in button to default state
  function resetSigninButton() {
    const signinBtn = document.getElementById('signin-google');
    if (signinBtn) {
      signinBtn.textContent = 'Sign in with Google';
      signinBtn.disabled = false;
    }
  }

  // Show error on sign-in screen
  function showSigninError(message) {
    const signinScreen = document.getElementById('signin-screen');
    const signinBtn = document.getElementById('signin-google');
    resetSigninButton();
    let errorDiv = signinScreen.querySelector('.signin-error');
    if (!errorDiv) {
      errorDiv = document.createElement('div');
      errorDiv.className = 'signin-error';
      signinBtn.parentNode.insertBefore(errorDiv, signinBtn.nextSibling);
    }
    errorDiv.textContent = message;
  }

  // Set auth persistence on load (not during sign-in click)
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

  // Google sign-in — always use popup
  async function signInWithGoogle() {
    logEvent('sign_in_started');
    try {
      const result = await auth.signInWithPopup(provider);
      currentUser = result.user;
      logEvent('sign_in_completed', { uid: result.user.uid });
      return result.user;
    } catch (e) {
      console.warn('Auth failed:', e.message);
      logEvent('sign_in_failed', { error: e.code });
      if (e.code === 'auth/popup-blocked') {
        showSigninError('Popup blocked. Please allow popups and try again.');
      } else if (e.code === 'auth/popup-closed-by-user') {
        showSigninError('Sign-in cancelled. Tap to try again.');
      } else {
        showSigninError('Sign-in failed. Tap to try again.');
      }
      throw e;
    }
  }

  // Sign out
  async function signOut() {
    await auth.signOut();
    currentUser = null;
  }

  // Consent screen
  const consentScreen = document.getElementById('consent-screen');
  const consentAccept = document.getElementById('consent-accept');
  const consentOffline = document.getElementById('consent-offline');

  // Check if consent has been given
  const consentGiven = safeGetItem('consentGiven', 'false');
  const offlineMode = safeGetItem('offlineMode', 'false');

  // Show consent screen if not given yet
  if (consentGiven === 'false') {
    consentScreen.classList.add('visible');
  }

  // Accept consent — show sign-in
  consentAccept.addEventListener('click', (e) => {
    e.stopPropagation();
    safeSetItem('consentGiven', 'true');
    safeSetItem('offlineMode', 'false');
    consentScreen.classList.remove('visible');
    signinScreen.classList.remove('hidden');
  });

  // Offline mode — skip sign-in, go straight to app
  consentOffline.addEventListener('click', (e) => {
    e.stopPropagation();
    safeSetItem('consentGiven', 'true');
    safeSetItem('offlineMode', 'true');
    consentScreen.classList.remove('visible');
    // Skip sign-in, show idle screen directly
    checkSlipUp();
  });

  // Listen for auth state changes
  auth.onAuthStateChanged((user) => {
    currentUser = user;
    const signinScreen = document.getElementById('signin-screen');
    const offlineMode = safeGetItem('offlineMode', 'false');

    // Skip auth if offline mode
    if (offlineMode === 'true') {
      signinScreen.classList.add('hidden');
      return;
    }

    if (user) {
      signinScreen.classList.add('hidden');
      resetSigninButton();
      loadFromCloud();
      // Auto-populate name from Google if not set
      if (!safeGetItem('userName', '') && user.displayName) {
        const firstName = user.displayName.split(' ')[0];
        safeSetItem('userName', firstName);
      }
      checkSlipUp();
    } else {
      // Only show sign-in if consent was given (not offline mode)
      if (consentGiven === 'true') {
        signinScreen.classList.remove('hidden');
      }
      resetSigninButton();
    }
  });

  // Save to Firestore (also saves to localStorage as offline cache)
  async function saveToCloud(data) {
    // Always save locally first
    Object.entries(data).forEach(([key, value]) => {
      safeSetItem(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    });

    // Skip cloud save if no consent or offline mode
    const consent = safeGetItem('consentGiven', 'false');
    const offline = safeGetItem('offlineMode', 'false');
    if (!currentUser || consent !== 'true' || offline === 'true') return;

    try {
      await db.collection('user_data').doc(currentUser.uid).set({
        data: data,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn('Cloud save failed:', e.message);
    }
  }

  // Event logging — track user actions in Firebase
  async function logEvent(eventName, props = {}) {
    // Skip logging if no consent or offline mode
    const consent = safeGetItem('consentGiven', 'false');
    const offline = safeGetItem('offlineMode', 'false');
    if (!currentUser || consent !== 'true' || offline === 'true') return;
    try {
      await db.collection('events').add({
        uid: currentUser.uid,
        event: eventName,
        props: props,
        ts: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      // Silently fail — don't interrupt user experience
    }
  }

  // Load from Firestore — merge with local, don't blindly overwrite
  async function loadFromCloud() {
    if (!currentUser) return;
    try {
      const doc = await db.collection('user_data').doc(currentUser.uid).get();
      if (doc.exists) {
        const cloudData = doc.data().data;

        // Use cloud data as source of truth (no merging)
        if (cloudData.quitStreak !== undefined) sessionCount = parseInt(cloudData.quitStreak) || 0;
        if (cloudData.moneySaved !== undefined) totalMoneySaved = parseFloat(cloudData.moneySaved) || 0;
        if (cloudData.cigarettesAvoided !== undefined) totalCigarettesAvoided = parseInt(cloudData.cigarettesAvoided) || 0;
        if (cloudData.quitStartDate !== undefined) quitStartDate = parseInt(cloudData.quitStartDate) || 0;
        if (cloudData.cigPrice !== undefined) cigPrice = parseFloat(cloudData.cigPrice) || 1;
        if (cloudData.cravingLogs) {
          cravingLogs = cloudData.cravingLogs;
          safeSetItem('cravingLogs', JSON.stringify(cravingLogs));
        }
        if (cloudData.lastSessionDate !== undefined) lastSessionDate = parseInt(cloudData.lastSessionDate) || 0;
        if (cloudData.darkMode !== undefined) {
          isDark = cloudData.darkMode !== 'false';
          applyTheme();
        }
        // Save other fields to localStorage
        safeSetItem('userName', cloudData.userName || '');
        safeSetItem('cigPrice', String(cigPrice));
        safeSetItem('darkMode', String(isDark));
        updateStatsDisplay();
      }
    } catch (e) {
      console.warn('Cloud load failed:', e.message);
    }
  }

  // --- State ---
  let dpr = window.devicePixelRatio || 1;
  let W, H;
  let H_REF = 0; // fixed reference height for cigarette dimensions
  let micStarted = false;
  let micStream = null; // store stream for cleanup
  let audioCtx, analyser, dataArray, crackleGain, dragGain;
  let blowIntensity = 0;
  let blowFrames = 0;
  let burnProgress = 0; // 0 = full, 1 = gone
  let puffing = false;
  let gameOver = false;
  let cooldownUntil = 0;
  let started = false;

  // Game flow state
  let gameState = 'idle'; // 'idle' | 'trigger-select' | 'smoking' | 'end'
  let currentTriggerId = null; // trigger selected before smoking

  // Hold + Blow mechanic
  let holding = false;           // is user holding the screen?
  let holdStartTime = 0;        // when hold started
  let puffCompleting = false;    // is a puff completing after release?
  let puffCompleteUntil = 0;     // when puff finishes
  const PUFF_COMPLETE_DURATION = 1.0; // seconds to complete puff after release

  // Auto-burn (~5 min full length at idle)
  const BASE_BURN_RATE = 0.0033; // per second
  const BLOW_BOOST = 0.04;       // per second when blowing (~8-12 puffs to finish)
  let lastFrameTime = 0;
  const ASH_REGROW_SPEED = 0.5; // px per second (~5mm/min, realistic ash growth)

  // Ash — grows downward from a fixed ceiling toward the ember
  let ashHeight = 0;
  let ashCeilingY = 0; // fixed Y position of ash top (set when burning starts)
  let ashCeilingSet = false;
  let ashDropping = false;
  let ashDropStartTime = 0;
  let ashDropFrom = 0;
  let ashDropTo = 0;
  const ASH_DROP_DURATION = 500;
  let ashPieces = [];
  let ashRings = [];

  // Tap cooldown for ash drop
  let tapCooldown = false;
  let lastTapTime = 0;
  const DOUBLE_TAP_DELAY = 250; // ms

  // Screen shake effect
  let shakeAmount = 0;
  let shakeDecay = 0.85;

  // Cigarette dimensions
  const CIG = { fullWidth: 0, filterHeight: 0, bodyLength: 0, tipRadius: 0 };

  // Smoke particles
  const particles = [];
  const MAX_PARTICLES = 120;
  let currentSpawnRate = 0.8;

  // Loop control
  let loopRunning = true;

  // Gradient cache — avoid recreating every frame
  const _gradCache = {};
  let _gradCacheFrame = 0;
  function _getCachedGrad(key, createFn) {
    if (!_gradCache[key]) {
      _gradCache[key] = createFn();
    }
    return _gradCache[key];
  }
  // Clear cache every 100 frames to prevent memory leaks
  function _maybeCleanGradCache() {
    _gradCacheFrame++;
    if (_gradCacheFrame >= 100) {
      _gradCacheFrame = 0;
      Object.keys(_gradCache).forEach(k => delete _gradCache[k]);
    }
  }

  // Streak persistence
  let sessionCount = parseInt(safeGetItem('quitStreak', '0'));
  let gameStartTime = 0;
  // Money saved tracking (loaded from settings, default $1)
  let cigPrice = parseFloat(safeGetItem('cigPrice', '1'));
  const CIG_PRICE = () => cigPrice; // getter for backward compat
  let totalMoneySaved = parseFloat(safeGetItem('moneySaved', '0'));
  let sessionMoneySaved = 0;
  let totalCigarettesAvoided = parseInt(safeGetItem('cigarettesAvoided', '0'));

  // Health milestones
  let quitStartDate = parseInt(safeGetItem('quitStartDate', '0'));
  const HEALTH_MILESTONES = [
    { time: 20 * 60,           icon: '❤️', title: 'Heart rate normalised', desc: 'Your pulse dropped to a healthy resting rate.' },
    { time: 12 * 3600,         icon: '🫁', title: 'Carbon monoxide clearing', desc: 'CO levels dropping. Oxygen transport improving.' },
    { time: 48 * 3600,         icon: '👃', title: 'Taste and smell return', desc: 'Nerve endings regenerating. Food will taste better.' },
    { time: 7 * 24 * 3600,     icon: '⚡', title: 'Energy increases', desc: 'Lung function improving. Walking feels easier.' },
    { time: 30 * 24 * 3600,    icon: '🌿', title: 'Lungs regenerating', desc: 'Cilia regrowing. Lungs cleaning themselves.' },
    { time: 90 * 24 * 3600,    icon: '🩸', title: 'Circulation restored', desc: 'Blood flow normalised. Hands and feet warmer.' },
    { time: 365 * 24 * 3600,   icon: '💪', title: 'Heart disease risk halved', desc: 'Major risk reduction achieved.' },
    { time: 5 * 365 * 24 * 3600, icon: '🧠', title: 'Stroke risk = non-smoker', desc: 'Your body has reset.' },
  ];

  // Slip-up handling
  let lastSessionDate = parseInt(safeGetItem('lastSessionDate', '0'));
  let slipUpShown = false;

  // Track last app open for "last seen" display
  let lastAppOpen = parseInt(safeGetItem('lastAppOpen', '0'));
  if (!lastAppOpen) lastAppOpen = Date.now();
  // Update AFTER reading — so "last seen" shows the previous visit, not this one
  setTimeout(() => safeSetItem('lastAppOpen', String(Date.now())), 1000);

  // Craving logs (kept for backwards compatibility with existing users)
  let cravingLogs = [];
  try {
    cravingLogs = JSON.parse(safeGetItem('cravingLogs', '[]'));
    // Prune entries older than 90 days to prevent localStorage bloat
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
    const beforeCount = cravingLogs.length;
    cravingLogs = cravingLogs.filter(log => log.time > ninetyDaysAgo);
    if (cravingLogs.length < beforeCount) {
      safeSetItem('cravingLogs', JSON.stringify(cravingLogs));
    }
  } catch (e) {
    cravingLogs = [];
  }

  // Pre-rendered particle sprite (avoids per-frame gradient creation)
  const _particleCanvas = document.createElement('canvas');
  const _particleSize = 64;
  _particleCanvas.width = _particleSize;
  _particleCanvas.height = _particleSize;
  const _pctx = _particleCanvas.getContext('2d');
  const _pg = _pctx.createRadialGradient(_particleSize/2, _particleSize/2, 0, _particleSize/2, _particleSize/2, _particleSize/2);
  _pg.addColorStop(0, 'rgba(255,255,255,1)');
  _pg.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  _pg.addColorStop(1, 'rgba(255,255,255,0)');
  _pctx.fillStyle = _pg;
  _pctx.beginPath();
  _pctx.arc(_particleSize/2, _particleSize/2, _particleSize/2, 0, Math.PI * 2);
  _pctx.fill();

  class Particle {
    constructor(x, y, intensity, type = 'main') {
      this.x = x;
      this.y = y;
      this.type = type;
      this.vx = 0;
      // Sidestream: slower, more vertical. Main: faster, more reactive to puff
      if (type === 'sidestream') {
        this.vy = -(0.6 + Math.random() * 0.4);
        this.size = 1.5 + Math.random() * 2;
        this.maxSize = 12 + Math.random() * 10;
        this.decay = 0.002 + Math.random() * 0.002;
        this.spiralSpeed = 0.03 + Math.random() * 0.02;
        this.spiralRadius = 0.2 + Math.random() * 0.15;
      } else {
        this.vy = -(1.2 + Math.random() * 0.8) * (0.5 + intensity * 0.5);
        this.size = 2 + Math.random() * 3;
        this.maxSize = 15 + Math.random() * 20;
        this.decay = 0.003 + Math.random() * 0.004;
        this.spiralSpeed = 0.06 + Math.random() * 0.04;
        this.spiralRadius = 0.5 + Math.random() * 0.3;
      }
      this.life = 1;
      this.angle = Math.random() * Math.PI * 2;
      // Sidestream is slightly more blue, main is whiter
      if (type === 'sidestream') {
        this.r = 175 + Math.random() * 20;
        this.g = 175 + Math.random() * 20;
        this.b = 190 + Math.random() * 20;
      } else {
        this.r = 190 + Math.random() * 30;
        this.g = 190 + Math.random() * 30;
        this.b = 200 + Math.random() * 25;
      }
    }
    update() {
      this.angle += this.spiralSpeed;
      // Tight spiral curl
      this.vx = Math.sin(this.angle) * this.spiralRadius;
      this.x += this.vx;
      this.y += this.vy;
      // Buoyancy: accelerate up for first 30% of life, then decelerate
      if (this.life > 0.7) {
        this.vy -= 0.03; // hot air rises faster
      } else {
        this.vy *= 0.993; // cool and slow
      }
      this.size += (this.maxSize - this.size) * 0.01;
      this.life -= this.decay;
    }
    draw(ctx) {
      if (this.life <= 0) return;
      const alpha = this.life * 0.4;
      const sz = this.size * 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(_particleCanvas, this.x - this.size, this.y - this.size, sz, sz);
      ctx.restore();
    }
  }

  class AshPiece {
    constructor(x, y, vx, vy, type = 'chunk') {
      this.x = x;
      this.y = y;
      this.vx = vx;
      this.vy = vy;
      this.type = type;
      this.gravity = type === 'dust' ? 0.02 : type === 'glitter' ? 0.03 : 0.1;
      this.size = type === 'dust' ? 1 + Math.random() * 1.5 : type === 'glitter' ? 1 + Math.random() * 2 : 1.5 + Math.random() * 3;
      this.rotation = Math.random() * Math.PI * 2;
      this.rotSpeed = (Math.random() - 0.5) * 0.15;
      this.life = 1;
      this.decay = type === 'dust' ? 0.02 + Math.random() * 0.02 : type === 'glitter' ? 0.01 + Math.random() * 0.015 : 0.01 + Math.random() * 0.01;
      this.sparkle = Math.random() * Math.PI * 2;
      this.brightness = 0.5 + Math.random() * 0.5;
    }
    update() {
      this.vy += this.gravity;
      this.x += this.vx;
      this.y += this.vy;
      this.vx *= 0.97;
      this.vy *= 0.97;
      this.rotation += this.rotSpeed;
      this.sparkle += 0.2;
      this.life -= this.decay;
    }
    draw(ctx) {
      const alpha = this.life * (this.type === 'glitter' ? (Math.sin(this.sparkle) + 1) / 2 * this.brightness : this.type === 'dust' ? 0.5 : 0.7);

      if (this.type === 'glitter') {
        // Sparkling particle
        const glow = (Math.sin(this.sparkle) + 1) / 2;
        ctx.fillStyle = `rgba(220, 215, 200, ${alpha})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * (0.5 + glow * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (this.type === 'dust') {
        // Small circular dust
        ctx.fillStyle = `rgba(170, 165, 158, ${alpha})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Square chunk that tumbles
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.fillStyle = `rgba(150, 145, 138, ${alpha})`;
        ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
        ctx.restore();
      }
    }
  }

  class AshRing {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.radius = 5;
      this.maxRadius = 50 + Math.random() * 30;
      this.life = 1;
      this.speed = 1.5 + Math.random();
    }
    update() {
      this.radius += this.speed;
      this.life = 1 - (this.radius / this.maxRadius);
    }
    draw(ctx) {
      ctx.strokeStyle = `rgba(170, 165, 158, ${this.life * 0.4})`;
      ctx.lineWidth = 2 * this.life;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // --- Resize ---
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Set reference height once (use largest observed height for consistency)
    if (H > H_REF) H_REF = H;

    // Position stats just above menu pill
    const menuPill = document.getElementById('menu-pill');
    if (menuPill) {
      const pillRect = menuPill.getBoundingClientRect();
      const statsEl = document.getElementById('filter-stats');
      if (statsEl) {
        const gap = 10;
        const statsBottom = H - pillRect.top + gap;
        statsEl.style.bottom = statsBottom + 'px';
      }
    }

    // Realistic proportions: total ~85mm, filter ~30mm (35%), paper ~55mm (65%)
    // Use H_REF (fixed) instead of H (variable) for consistent cigarette size
    CIG.bodyLength = H_REF * 0.38;                    // paper section
    CIG.filterHeight = CIG.bodyLength * 0.38;     // filter = 38% of paper (realistic)
    CIG.fullWidth = Math.min(W * 0.075, 28);      // slender diameter
    CIG.tipRadius = CIG.fullWidth / 2;
  }
  window.addEventListener('resize', resize);
  resize();

  // --- Mic ---
  async function startMic() {
    if (micStarted) return true;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create new audio context or resume existing one
      if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } else if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      micStarted = true;
      cooldownUntil = performance.now() + 1500;
      promptEl.classList.add('hidden');
      document.getElementById('overlay').style.pointerEvents = 'none';
      document.getElementById('filter-stats').classList.add('visible');

      // White noise — gentle bandpass-filtered noise for hold
      try {
        const bufferSize = audioCtx.sampleRate * 2;
        const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noiseSource = audioCtx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;
        const noiseFilter = audioCtx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 1000;
        noiseFilter.Q.value = 0.5;
        crackleGain = audioCtx.createGain();
        crackleGain.gain.value = 0;
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(crackleGain);
        crackleGain.connect(audioCtx.destination);
        noiseSource.start();

        // Drag/whoosh sound — low rumble when blowing
        const dragOsc = audioCtx.createOscillator();
        dragOsc.type = 'sawtooth';
        dragOsc.frequency.value = 60;
        const dragFilter = audioCtx.createBiquadFilter();
        dragFilter.type = 'lowpass';
        dragFilter.frequency.value = 200;
        dragGain = audioCtx.createGain();
        dragGain.gain.value = 0;
        dragOsc.connect(dragFilter);
        dragFilter.connect(dragGain);
        dragGain.connect(audioCtx.destination);
        dragOsc.start();
      } catch (e) {}
      return true;
    } catch (err) {
      promptEl.textContent = 'Microphone access denied. Tap to retry.';
      promptEl.style.opacity = '1';
      promptEl.style.pointerEvents = 'auto';
      document.getElementById('overlay').style.pointerEvents = 'auto';
      return false;
    }
  }

  // Retry mic on overlay tap
  overlayEl.addEventListener('click', async () => {
    if (!micStarted) {
      // Hide the error message
      promptEl.style.opacity = '0';
      promptEl.style.pointerEvents = 'none';
      overlayEl.style.pointerEvents = 'none';
      // Retry mic
      const ok = await startMic();
      if (ok) {
        started = true;
        gameStartTime = performance.now();
        loopFrameId = requestAnimationFrame(loop);
      }
    }
  });

  // Cleanup mic and audio when game ends or page unloads
  function cleanupMic() {
    // Only stop the mic stream, keep audio context open for reuse
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    // Don't close audioCtx — it can be reused for next session
    micStarted = false;
    analyser = null;
    dataArray = null;
  }

  // Full cleanup on page unload
  function fullCleanup() {
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    micStarted = false;
    analyser = null;
    dataArray = null;
  }

  // --- Drop ash ---
  function dropAsh() {
    ashDropping = true;
    tapCooldown = true;
    ashDropStartTime = performance.now();
    ashDropFrom = ashHeight;
    ashDropTo = 0; // ash completely gone

    // Haptic feedback — vibration on Android, low thump on iOS
    try {
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    } catch (e) {}
    // Low-frequency thump for iOS (works everywhere)
    if (audioCtx) {
      try {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 80;
        g.gain.setValueAtTime(0.3, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
      } catch (e) {}
    }

    // Trigger screen shake
    shakeAmount = 6;

    // After drop completes, reset ceiling to new ember position
    if (ashDropTimeout) clearTimeout(ashDropTimeout);
    ashDropTimeout = setTimeout(() => {
      ashCeilingY = getCigTopY();
      tapCooldown = false;
    }, ASH_DROP_DURATION + 50);

    // Spawn combo burst from bottom of ash (near ember)
    const cigTopY = getCigTopY();
    const burstX = W / 2;
    const burstY = cigTopY; // bottom of ash, at the ember

    // 1. Expanding ring
    ashRings.push(new AshRing(burstX, burstY));

    // 2. Chunks — square particles that tumble, spawn from bottom of ash
    const chunkCount = 8 + Math.floor(ashHeight / 10);
    for (let i = 0; i < chunkCount; i++) {
      const angle = -Math.PI/2 + (Math.random()-0.5)*Math.PI; // upward bias
      const speed = 2 + Math.random() * 4;
      ashPieces.push(new AshPiece(
        burstX + (Math.random() - 0.5) * CIG.fullWidth,
        burstY - Math.random() * 5, // near ember
        Math.cos(angle) * speed, Math.sin(angle) * speed, 'chunk'
      ));
    }

    // 3. Dust — small circles, spread from bottom
    const dustCount = 12 + Math.floor(ashHeight / 5);
    for (let i = 0; i < dustCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      ashPieces.push(new AshPiece(
        burstX + (Math.random() - 0.5) * CIG.fullWidth * 0.6,
        burstY - Math.random() * 8,
        Math.cos(angle) * speed, Math.sin(angle) * speed, 'dust'
      ));
    }

    // 4. Glitter — sparkling particles from break point
    const glitterCount = 10 + Math.floor(ashHeight / 8);
    for (let i = 0; i < glitterCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      ashPieces.push(new AshPiece(
        burstX + (Math.random()-0.5) * 10,
        burstY - Math.random() * 3,
        Math.cos(angle) * speed, Math.sin(angle) * speed, 'glitter'
      ));
    }
  }

  // --- Blow detection (only when holding) ---
  function detectBlow() {
    if (!analyser || !holding) return 0; // mic only listens when holding
    analyser.getByteFrequencyData(dataArray);
    // Weight low-frequency bins (blow energy is 100-500Hz)
    const lowBins = Math.min(20, dataArray.length);
    let total = 0;
    for (let i = 0; i < lowBins; i++) total += dataArray[i];
    const avg = total / lowBins / 255;
    const wasBelow = blowFrames < 3;
    if (avg > 0.05) {
      blowFrames++;
    } else {
      blowFrames = Math.max(0, blowFrames - 2);
    }
    if (blowFrames >= 3) {
      // Haptic feedback on first frame of blow detection
      if (wasBelow && navigator.vibrate) navigator.vibrate(15);
      return Math.min(1, avg * 3);
    }
    return 0;
  }

  // --- Helpers ---
  // Filter stays fixed, paper burns from the top down
  const FILTER_Y = () => H_REF * 0.617; // fixed filter position (uses reference height)
  function getCigTopY() {
    const burnHeight = CIG.bodyLength * (1 - burnProgress);
    return FILTER_Y() - burnHeight;
  }
  function getCigFilterY() {
    return FILTER_Y();
  }

  // --- Draw ---
  function drawCigarette(cigY) {
    const burnHeight = CIG.bodyLength * (1 - burnProgress);
    const x = W / 2;
    const filterY = cigY + burnHeight;

    // Hold glow effect — subtle pulse on filter when holding
    if (holding && started && !gameOver) {
      const glowBase = 0.15 + Math.sin(performance.now() / 200) * 0.05;
      const filterCenterY = filterY + CIG.filterHeight / 2;
      const glowRadius = CIG.fullWidth * (1.2 + blowIntensity * 1.5);
      const glowGrad = ctx.createRadialGradient(x, filterCenterY, 0, x, filterCenterY, glowRadius);
      glowGrad.addColorStop(0, `rgba(255, 200, 100, ${glowBase + 0.1})`);
      glowGrad.addColorStop(1, 'rgba(255, 200, 100, 0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(x - glowRadius * 1.2, filterCenterY - glowRadius, glowRadius * 2.4, glowRadius * 2);
    }
    const filterGradKey = `filter_${Math.round(filterY)}`;
    const grad = _getCachedGrad(filterGradKey, () => {
      const g = ctx.createLinearGradient(x - CIG.tipRadius, filterY, x + CIG.tipRadius, filterY);
      g.addColorStop(0, '#a06820');
      g.addColorStop(0.3, '#c87a2a');
      g.addColorStop(0.5, '#d4943a');
      g.addColorStop(0.7, '#c87a2a');
      g.addColorStop(1, '#a06820');
      return g;
    });
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x - CIG.tipRadius, filterY, CIG.fullWidth, CIG.filterHeight, [0, 0, 5, 5]);
    ctx.fill();

    // Filter texture — fibrous cork streaks
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x - CIG.tipRadius, filterY, CIG.fullWidth, CIG.filterHeight, [0, 0, 5, 5]);
    ctx.clip();
    for (let i = 0; i < 30; i++) {
      const seed = i * 7 + 13;
      const fx = x - CIG.tipRadius + ((seed * 31) % 100) / 100 * CIG.fullWidth;
      const fy = filterY + ((seed * 47) % 100) / 100 * CIG.filterHeight;
      const fw = CIG.fullWidth * (0.1 + ((seed * 23) % 100) / 100 * 0.3);
      ctx.strokeStyle = `rgba(80,50,20,${0.06 + ((seed * 11) % 100) / 100 * 0.1})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + fw, fy + Math.sin(seed) * 1.5);
      ctx.stroke();
    }
    ctx.restore();

    // Crimp line — indentation where filter meets paper
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - CIG.tipRadius, filterY + 3);
    ctx.lineTo(x + CIG.tipRadius, filterY + 3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,160,0.3)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x - CIG.tipRadius, filterY + 4);
    ctx.lineTo(x + CIG.tipRadius, filterY + 4);
    ctx.stroke();

    // Paper
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - CIG.tipRadius, cigY, CIG.fullWidth, burnHeight);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - CIG.tipRadius, cigY, CIG.fullWidth, burnHeight);

    // Paper texture — fine horizontal marks + wrapping seam
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - CIG.tipRadius, cigY, CIG.fullWidth, burnHeight);
    ctx.clip();
    // Horizontal manufacturing lines (batched into single path)
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let ty = cigY; ty < cigY + burnHeight; ty += 2.5) {
      ctx.moveTo(x - CIG.tipRadius, ty);
      ctx.lineTo(x + CIG.tipRadius, ty);
    }
    ctx.stroke();
    // Paper wrapping seam — vertical line slightly left of centre
    const seamX = x - 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(seamX, cigY);
    ctx.lineTo(seamX, cigY + burnHeight);
    ctx.stroke();
    // Highlight next to seam
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(seamX + 1, cigY);
    ctx.lineTo(seamX + 1, cigY + burnHeight);
    ctx.stroke();
    ctx.restore();

    // Transition zone — scorched paper + charred edge (only when burning)
    if (burnProgress > 0 && burnProgress < 1) {
      const tzHeight = Math.min(8, burnHeight); // clamp to paper height

      // Scorched paper — yellowed/browned edge
      const scorchedGrad = ctx.createLinearGradient(x, cigY, x, cigY + tzHeight);
      scorchedGrad.addColorStop(0, 'rgba(180,150,100,0.6)');
      scorchedGrad.addColorStop(0.5, 'rgba(160,130,80,0.4)');
      scorchedGrad.addColorStop(1, 'rgba(140,110,60,0.2)');
      ctx.fillStyle = scorchedGrad;
      ctx.fillRect(x - CIG.tipRadius, cigY, CIG.fullWidth, tzHeight);

      // Charred edge — thin dark line at the burn front
      ctx.fillStyle = 'rgba(60,40,20,0.7)';
      ctx.fillRect(x - CIG.tipRadius, cigY, CIG.fullWidth, 1.5);

      // Dark transition band
      ctx.fillStyle = 'rgba(80,50,25,0.4)';
      ctx.fillRect(x - CIG.tipRadius, cigY + 1.5, CIG.fullWidth, 2);
    }

    // Unlit tip
    if (burnProgress === 0) {
      ctx.fillStyle = '#e8e4dc';
      ctx.beginPath();
      ctx.ellipse(x, cigY, CIG.tipRadius, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }

  // Ember pulse tracking
  let emberPulse = 0; // 0-1, smooth pulse value
  let emberPulseTarget = 0;

  function drawEmber(cigY) {
    if (burnProgress <= 0 || burnProgress >= 1) return;
    const x = W / 2;
    const emberY = cigY;

    // Smooth pulse — ember brightens proportionally to blow strength
    emberPulseTarget = blowIntensity;
    const pulseSpeed = 6; // per second
    const dt = lastFrameTime ? (performance.now() - lastFrameTime) / 1000 : 1/60;
    emberPulse += (emberPulseTarget - emberPulse) * Math.min(1, pulseSpeed * dt);

    // Update sound volumes based on ember intensity
    if (crackleGain) {
      crackleGain.gain.value = emberPulse * 0.04;
    }
    if (dragGain) {
      dragGain.gain.value = blowIntensity * 0.12;
    }

    // Add subtle natural flicker
    const now = performance.now();
    const flicker = Math.sin(now * 0.008) * 0.08 + Math.sin(now * 0.013) * 0.05;
    const intensity = 0.4 + emberPulse * 0.6 + flicker;

    // Outer glow — soft radial gradient bloom
    const glowRadius = CIG.tipRadius * (2 + emberPulse * 1);
    const glowGrad = ctx.createRadialGradient(x, emberY, 0, x, emberY, glowRadius);
    glowGrad.addColorStop(0, `rgba(255,60,0,${0.25 * intensity})`);
    glowGrad.addColorStop(0.4, `rgba(255,30,0,${0.1 * intensity})`);
    glowGrad.addColorStop(1, 'rgba(255,30,0,0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(x, emberY, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // Ember ring — outer dark red
    const ringBright = 0.5 + emberPulse * 0.5;
    const r = Math.floor(180 + ringBright * 75);
    const g = Math.floor(30 + ringBright * 40);
    const b = Math.floor(10 + ringBright * 10);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.ellipse(x, emberY, CIG.tipRadius, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Inner ember — bright orange
    const innerBright = 0.4 + emberPulse * 0.6;
    const ir = Math.floor(200 + innerBright * 55);
    const ig = Math.floor(80 + innerBright * 80);
    ctx.fillStyle = `rgb(${ir},${ig},0)`;
    ctx.beginPath();
    ctx.ellipse(x, emberY, CIG.tipRadius * 0.65, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hot center — brightest yellow-orange-white during puff
    const centerBright = 0.3 + emberPulse * 0.7;
    const cr = Math.floor(220 + centerBright * 35);
    const cg = Math.floor(120 + centerBright * 100);
    const cb = Math.floor(centerBright * 50);
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    ctx.beginPath();
    ctx.ellipse(x, emberY, CIG.tipRadius * 0.35, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawAsh(cigY) {
    if (ashHeight < 0.5 || !ashCeilingSet) return;
    const x = W / 2;
    const r = CIG.tipRadius;

    // Ash extends DOWNWARD from fixed ceiling to ember (always connect to ember)
    const ashBottom = cigY; // ash always reaches the ember
    const ashTop = ashCeilingY;
    const totalHeight = ashBottom - ashTop;
    if (totalHeight <= 0) return;

    const segs = 14;
    const leftEdge = [];
    const rightEdge = [];

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      // t=0 is top (at ceiling), t=1 is bottom (at ember)
      const y = ashTop + totalHeight * t;

      // Wispy edges — soft irregular wobble (mockup 8)
      const wobble = Math.sin(t * 23.7) * 0.5 + Math.cos(t * 31.3) * 0.3;
      const hw = r + wobble * (0.3 + t * 0.2);

      leftEdge.push({ x: x - hw, y });
      rightEdge.push({ x: x + hw, y });
    }

    // --- Main ash body with wispy edges ---
    ctx.beginPath();
    ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
    for (let i = 1; i <= segs; i++) {
      const p = leftEdge[i - 1];
      const c = leftEdge[i];
      const mx = (p.x + c.x) / 2 + Math.sin(i * 1.7) * 0.2;
      const my = (p.y + c.y) / 2;
      ctx.quadraticCurveTo(mx, my, c.x, c.y);
    }
    ctx.lineTo(rightEdge[segs].x, rightEdge[segs].y);
    for (let i = segs - 1; i >= 0; i--) {
      const p = rightEdge[i + 1];
      const c = rightEdge[i];
      const mx = (p.x + c.x) / 2 + Math.cos(i * 2.1) * 0.2;
      const my = (p.y + c.y) / 2;
      ctx.quadraticCurveTo(mx, my, c.x, c.y);
    }
    ctx.closePath();

    // Ash gradient — gradient bands from light top to dark bottom
    const ashGrad = ctx.createLinearGradient(x, ashTop, x, ashBottom);
    ashGrad.addColorStop(0, '#e2ddd4');
    ashGrad.addColorStop(0.2, '#d0c8bc');
    ashGrad.addColorStop(0.5, '#c8c0b4');
    ashGrad.addColorStop(0.8, '#a8a098');
    ashGrad.addColorStop(1, '#928a80');
    ctx.fillStyle = ashGrad;
    ctx.fill();

    // Cylindrical shading
    const cylGrad = ctx.createLinearGradient(x - r, ashTop, x + r, ashTop);
    cylGrad.addColorStop(0, 'rgba(0,0,0,0.06)');
    cylGrad.addColorStop(0.3, 'rgba(255,255,255,0.05)');
    cylGrad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    cylGrad.addColorStop(0.7, 'rgba(255,255,255,0.05)');
    cylGrad.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = cylGrad;
    ctx.fill();

    // Heat tint near ember — responds to ember pulse
    const heatZone = Math.min(totalHeight * 0.2, 10);
    const heatAlpha = 0.15 + emberPulse * 0.25;
    const heatGrad = ctx.createLinearGradient(x, ashBottom - heatZone, x, ashBottom);
    heatGrad.addColorStop(0, 'rgba(180,140,70,0)');
    heatGrad.addColorStop(0.5, `rgba(200,150,80,${heatAlpha * 0.6})`);
    heatGrad.addColorStop(1, `rgba(220,160,80,${heatAlpha})`);
    ctx.fillStyle = heatGrad;
    ctx.fill();

    // --- Layer lines ---
    ctx.strokeStyle = 'rgba(160,155,148,0.3)';
    ctx.lineWidth = 0.6;
    const layerCount = Math.min(6, Math.floor(totalHeight / 10));
    for (let i = 1; i <= layerCount; i++) {
      const t = i / layerCount;
      const y = ashTop + totalHeight * t;
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.stroke();
    }

    // --- Speckled debris ---
    for (let i = 0; i < 35; i++) {
      const seed = i * 17 + 7;
      const sx = x - r + ((seed * 31) % 100) / 100 * (r * 2);
      const sy = ashTop + ((seed * 47) % 100) / 100 * totalHeight;
      const sr = 0.3 + ((seed * 13) % 100) / 100 * 0.6;
      const dark = ((seed * 29) % 100) > 50;
      ctx.fillStyle = dark
        ? `rgba(80,70,60,${0.08 + ((seed * 11) % 100) / 100 * 0.1})`
        : `rgba(240,235,228,${0.1 + ((seed * 19) % 100) / 100 * 0.12})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Vertical cracks (mockup 3) ---
    ctx.strokeStyle = 'rgba(140,135,128,0.25)';
    ctx.lineWidth = 0.5;
    const crackCount = Math.min(3, Math.floor(totalHeight / 18));
    for (let c = 0; c < crackCount; c++) {
      const offsetX = (c - (crackCount - 1) / 2) * (r * 0.5);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= 15; i++) {
        const t = i / 15;
        const y = ashTop + totalHeight * t;
        const wobble = Math.sin(t * 15 + c * 3) * 1;
        const px = x + offsetX + wobble;
        if (!started) { ctx.moveTo(px, y); started = true; }
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }

    // --- Top ragged edge ---
    ctx.strokeStyle = 'rgba(120, 115, 108, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftEdge[0].x + 0.5, ashTop);
    for (let i = 0; i <= 5; i++) {
      const jt = i / 5;
      const tx = leftEdge[0].x + (rightEdge[0].x - leftEdge[0].x) * jt;
      const ty = ashTop + Math.sin(jt * Math.PI * 3 + 0.5) * 1.2;
      ctx.lineTo(tx, ty);
    }
    ctx.stroke();

    // --- Flaky bits on top ---
    if (totalHeight > 12) {
      const flakeCount = Math.min(4, Math.floor(totalHeight / 15));
      for (let i = 0; i < flakeCount; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const fx = x + side * (r + 1);
        const fy = ashTop - 1 - i * 1.5;
        const fsize = 1.5 + Math.sin(i * 2.7) * 0.8;
        ctx.fillStyle = `rgba(180,175,168,${0.3 + Math.sin(i * 1.9) * 0.1})`;
        ctx.beginPath();
        ctx.ellipse(fx, fy, fsize, fsize * 0.5, side * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // --- Bottom junction — where ash meets ember, responds to pulse ---
    const junctionAlpha = 0.15 + emberPulse * 0.2;
    ctx.strokeStyle = `rgba(100,95,85,${junctionAlpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftEdge[segs].x + 0.5, ashBottom - 0.5);
    ctx.lineTo(rightEdge[segs].x - 0.5, ashBottom - 0.5);
    ctx.stroke();
  }

  // Trigger categories for end-of-session screen
  const TRIGGER_OPTIONS = [
    { id: 'stress', emoji: '😰', label: 'Stress' },
    { id: 'drinking', emoji: '🍺', label: 'Drinking' },
    { id: 'coffee', emoji: '☕', label: 'Coffee' },
    { id: 'meals', emoji: '🍽️', label: 'After meals' },
    { id: 'boredom', emoji: '😑', label: 'Boredom' },
    { id: 'driving', emoji: '🚗', label: 'Driving' },
    { id: 'aftersex', emoji: '❤️', label: 'After sex' },
    { id: 'workbreak', emoji: '💼', label: 'Work break' },
    { id: 'scrolling', emoji: '📱', label: 'Scrolling' },
    { id: 'walking', emoji: '🚶', label: 'Walking' },
    { id: 'social', emoji: '🍻', label: 'Social pressure' },
    { id: 'morning', emoji: '🌅', label: 'Morning routine' },
  ];
  let selectedTrigger = null;
  let triggerSubmitted = false;

  // HTML trigger screen elements
  const triggerScreen = document.getElementById('trigger-screen');
  const triggerGrid = document.getElementById('trigger-grid');
  const triggerDone = document.getElementById('trigger-done');

  // HTML idle screen elements
  const idleScreen = document.getElementById('idle-screen');
  const idleMoney = document.getElementById('idle-money');
  const idleStreak = document.getElementById('idle-streak');
  const idleMessage = document.getElementById('idle-message');
  const idleStart = document.getElementById('idle-start');
  const idleOffline = document.getElementById('idle-offline');

  // HTML end screen elements
  const endScreen = document.getElementById('end-screen');
  const endSession = document.getElementById('end-session');
  const endTotalStat = document.getElementById('end-total-stat');
  const endCigsStat = document.getElementById('end-cigs-stat');
  const endDaysStat = document.getElementById('end-days-stat');
  const endTriggersBars = document.getElementById('end-triggers-bars');
  const endDone = document.getElementById('end-done');
  const endAnother = document.getElementById('end-another');

  // Onboarding
  const onboardingScreen = document.getElementById('onboarding-screen');
  const onboardingIcon = document.getElementById('onboarding-icon');
  const onboardingTitle = document.getElementById('onboarding-title');
  const onboardingDesc = document.getElementById('onboarding-desc');
  const onboardingDots = document.getElementById('onboarding-dots');
  const onboardingNext = document.getElementById('onboarding-next');
  const ONBOARDING_STEPS = [
    { icon: '👆', title: 'Hold to puff', desc: 'Press and hold anywhere on the screen to take a drag.' },
    { icon: '🌬️', title: 'Blow to burn', desc: 'Blow into the mic to burn the cigarette faster.' },
    { icon: '👆👆', title: 'Double-tap to flick', desc: 'Tap twice to flick the ash off.' },
  ];
  let onboardingStep = 0;

  function showOnboarding() {
    onboardingStep = 0;
    updateOnboardingCard();
    onboardingScreen.classList.add('visible');
  }

  function updateOnboardingCard() {
    const step = ONBOARDING_STEPS[onboardingStep];
    onboardingIcon.textContent = step.icon;
    onboardingTitle.textContent = step.title;
    onboardingDesc.textContent = step.desc;
    // Update dots
    const dots = onboardingDots.querySelectorAll('.onboarding-dot');
    dots.forEach((dot, i) => dot.classList.toggle('active', i === onboardingStep));
    // Update button text
    onboardingNext.textContent = onboardingStep < ONBOARDING_STEPS.length - 1 ? 'Next' : 'Get started';
  }

  onboardingNext.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onboardingStep < ONBOARDING_STEPS.length - 1) {
      onboardingStep++;
      updateOnboardingCard();
    } else {
      // Complete onboarding
      onboardingScreen.classList.remove('visible');
      safeSetItem('onboardingComplete', 'true');
      logEvent('onboarding_completed');
    }
  });

  // Build trigger buttons
  TRIGGER_OPTIONS.forEach(trigger => {
    const btn = document.createElement('button');
    btn.className = 'trigger-btn';
    btn.dataset.trigger = trigger.id;
    btn.textContent = trigger.emoji + ' ' + trigger.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedTrigger = trigger.id;
      // Update selected state
      triggerGrid.querySelectorAll('.trigger-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      triggerDone.classList.add('visible');
    });
    triggerGrid.appendChild(btn);
  });

  // Done button handler (now "Continue" — starts smoking session)
  triggerDone.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!selectedTrigger) return;
    // Save trigger to temp variable (will be saved to logs after session)
    currentTriggerId = selectedTrigger;
    logEvent('trigger_selected', { trigger: selectedTrigger });
    // Hide trigger screen and start smoking
    triggerScreen.classList.remove('visible');
    gameState = 'smoking';
    // Start mic and loop
    startSmokingSession();
  });

  // Show trigger selection screen (before smoking)
  function showTriggerScreen() {
    selectedTrigger = null;
    currentTriggerId = null;
    triggerGrid.querySelectorAll('.trigger-btn').forEach(b => b.classList.remove('selected'));
    triggerDone.classList.remove('visible');
    triggerScreen.classList.add('visible');
    gameState = 'trigger-select';
  }

  // Start smoking session
  async function startSmokingSession() {
    // Reset smoking state
    burnProgress = 0;
    gameOver = false;
    started = false;
    particles.length = 0;
    ashPieces.length = 0;
    ashRings.length = 0;
    ashHeight = 0;
    ashDropping = false;
    ashDropTo = 0;
    ashCeilingSet = false;
    blowFrames = 0;
    blowIntensity = 0;
    cooldownUntil = performance.now() + 800;
    sessionMoneySaved = 0;
    // Recalculate dimensions in case window size changed
    resize();
    // Start mic and loop
    if (loopFrameId) cancelAnimationFrame(loopFrameId);
    if (ashDropTimeout) { clearTimeout(ashDropTimeout); ashDropTimeout = null; }
    loopRunning = true;

    // Check if mic needs to be restarted
    if (!micStarted) {
      const ok = await startMic();
      if (ok) {
        started = true;
        gameStartTime = performance.now();
      }
    } else {
      // Mic already started, just restart the game
      started = true;
      gameStartTime = performance.now();
    }
    loopFrameId = requestAnimationFrame(loop);
  }

  // Get trigger insight
  function getTriggerInsight(triggerId) {
    const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));
    const triggerLogs = logs.filter(l => l.trigger === triggerId);
    const count = triggerLogs.length;
    const trigger = TRIGGER_OPTIONS.find(t => t.id === triggerId);
    if (!trigger) return '';

    if (count <= 1) return `Your first ${trigger.label.toLowerCase()} session`;
    if (count >= 5) return `Your ${count}th ${trigger.label.toLowerCase()} trigger — consider alternatives`;
    return `Your ${count}${ordinal(count)} ${trigger.label.toLowerCase()} trigger`;
  }

  // Ordinal suffix helper
  function ordinal(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return 'th';
    const s = ['th', 'st', 'nd', 'rd'];
    return s[v % 10] || s[0];
  }

  // Show end screen
  function showEndScreen() {
    // Save trigger to logs
    const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));
    logs.push({ time: Date.now(), trigger: currentTriggerId });
    safeSetItem('cravingLogs', JSON.stringify(logs));

    // Sync craving logs to cloud
    saveToCloud({
      cravingLogs: logs,
      moneySaved: totalMoneySaved,
      quitStreak: sessionCount,
      cigarettesAvoided: totalCigarettesAvoided,
      quitStartDate: quitStartDate,
      lastSessionDate: Date.now()
    });

    // Update end screen content
    endSession.textContent = '$' + sessionMoneySaved.toFixed(2);
    endTotalStat.textContent = '$' + Math.floor(totalMoneySaved);
    endCigsStat.textContent = totalCigarettesAvoided;

    // Calculate days since quit start
    const daysSinceStart = quitStartDate ? Math.floor((Date.now() - quitStartDate) / (24 * 60 * 60 * 1000)) : 0;
    endDaysStat.textContent = daysSinceStart;

    // Build trigger bars
    buildEndTriggerBars();

    endScreen.classList.add('visible');
    gameState = 'end';
  }

  // Build trigger bars for end screen
  function buildEndTriggerBars() {
    const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));

    // Count triggers
    const triggerCounts = {};
    logs.forEach(log => {
      const trigger = log.trigger || 'Unknown';
      triggerCounts[trigger] = (triggerCounts[trigger] || 0) + 1;
    });

    // Sort by count descending
    const sorted = Object.entries(triggerCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxCount = sorted.length > 0 ? sorted[0][1] : 1;

    // Trigger icons mapping
    const triggerIcons = {
      'stress': '😰',
      'drinking': '🍺',
      'coffee': '☕',
      'meals': '🍽️',
      'boredom': '😑',
      'driving': '🚗',
      'aftersex': '❤️',
      'workbreak': '💼',
      'scrolling': '📱',
      'walking': '🚶',
      'social': '🍻',
      'morning': '🌅',
      'other': '💭'
    };

    // Trigger labels mapping
    const triggerLabels = {
      'stress': 'Stress',
      'drinking': 'Drinking',
      'coffee': 'Coffee',
      'meals': 'After meals',
      'boredom': 'Boredom',
      'driving': 'Driving',
      'aftersex': 'After sex',
      'workbreak': 'Work break',
      'scrolling': 'Scrolling',
      'walking': 'Walking',
      'social': 'Social pressure',
      'morning': 'Morning routine',
      'other': 'Other'
    };

    // Bar colors
    const barColors = ['amber', 'blue', 'green', 'pink', 'gray'];

    // Build bars
    endTriggersBars.innerHTML = '';
    sorted.forEach(([trigger, count], i) => {
      const pct = (count / maxCount) * 100;
      const icon = triggerIcons[trigger] || '📊';
      const label = triggerLabels[trigger] || trigger;
      const color = barColors[i] || 'gray';

      const bar = document.createElement('div');
      bar.className = 'end-trigger-bar';
      bar.innerHTML = `
        <div class="end-trigger-bar-icon">${icon}</div>
        <div class="end-trigger-bar-info">
          <div class="end-trigger-bar-name">${label}</div>
          <div class="end-trigger-bar-track">
            <div class="end-trigger-bar-fill ${color}" style="width:0%"></div>
          </div>
        </div>
        <div class="end-trigger-bar-count">${count}</div>
      `;
      endTriggersBars.appendChild(bar);

      // Animate bar fill
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          bar.querySelector('.end-trigger-bar-fill').style.width = pct + '%';
        });
      });
    });
  }

  // Show idle screen
  function showIdleScreen() {
    // Check if onboarding is complete
    const onboardingComplete = safeGetItem('onboardingComplete', 'false');
    if (onboardingComplete !== 'true') {
      showOnboarding();
      return;
    }

    idleMoney.textContent = '$' + totalMoneySaved.toFixed(2);

    // Calculate days since last session (smoke-free streak)
    const lastSession = parseInt(safeGetItem('lastSessionDate', '0'));
    if (lastSession) {
      const daysSinceLastSession = Math.floor((Date.now() - lastSession) / (24 * 60 * 60 * 1000));
      if (daysSinceLastSession === 0) {
        idleStreak.textContent = 'Today';
      } else if (daysSinceLastSession === 1) {
        idleStreak.textContent = '1 day smoke-free';
      } else {
        idleStreak.textContent = daysSinceLastSession + ' days smoke-free';
      }
    } else {
      idleStreak.textContent = '';
    }

    // Different messages for new vs returning users
    if (totalMoneySaved === 0) {
      idleMessage.textContent = 'Your journey starts here';
    } else {
      const messages = [
        "You're doing great",
        "Keep going",
        "Every cigarette counts",
        "Stay strong",
        "You've got this",
      ];
      idleMessage.textContent = messages[Math.floor(Math.random() * messages.length)];
    }

    // Show offline indicator if needed
    idleOffline.classList.toggle('visible', !navigator.onLine);

    idleScreen.classList.add('visible');
    gameState = 'idle';
  }

  // Idle screen start button
  idleStart.addEventListener('click', (e) => {
    e.stopPropagation();
    idleScreen.classList.remove('visible');
    showTriggerScreen();
  });

  // End screen buttons
  endDone.addEventListener('click', (e) => {
    e.stopPropagation();
    logEvent('done_tapped', { trigger: currentTriggerId, sessionMoney: sessionMoneySaved });
    endScreen.classList.remove('visible');
    showIdleScreen();
  });

  endAnother.addEventListener('click', (e) => {
    e.stopPropagation();
    logEvent('smoke_another_tapped', { trigger: currentTriggerId, sessionMoney: sessionMoneySaved });
    endScreen.classList.remove('visible');
    showTriggerScreen();
  });

  // Helper: format elapsed time for health timeline
  function formatQuitDuration() {
    if (!quitStartDate) return '0:00:00';
    const elapsed = Math.floor((Date.now() - quitStartDate) / 1000);
    const days = Math.floor(elapsed / 86400);
    const hours = Math.floor((elapsed % 86400) / 3600);
    const mins = Math.floor((elapsed % 3600) / 60);
    const secs = elapsed % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  // Helper: get next milestone
  function getNextMilestone() {
    if (!quitStartDate) return HEALTH_MILESTONES[0];
    const elapsed = (Date.now() - quitStartDate) / 1000;
    for (const m of HEALTH_MILESTONES) {
      if (elapsed < m.time) return m;
    }
    return null; // all milestones reached
  }

  // --- Stats Display ---
  const barStats = document.getElementById('filter-stats');
  const statsMoney = document.getElementById('stats-money');
  const statsLastseen = document.getElementById('stats-lastseen');
  let _lastMoney = '', _lastSeen = '', _lastVisible = false;
  let _lastStatsUpdate = 0;

  function formatLastSeen(ms) {
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  function updateStatsDisplay() {
    const now = performance.now();
    if (now - _lastStatsUpdate < 50) return; // throttle to ~20fps
    _lastStatsUpdate = now;
    if (started && !gameOver && burnProgress > 0) {
      if (!_lastVisible) { barStats.classList.add('visible'); _lastVisible = true; }
      const sessionCost = burnProgress * CIG_PRICE();
      const session = '$' + sessionCost.toFixed(2);
      const total = '$' + (totalMoneySaved + sessionCost).toFixed(2);
      const m = session + ' → ' + total;
      if (m !== _lastMoney) { statsMoney.textContent = m; _lastMoney = m; }
      const seen = formatLastSeen(Date.now() - lastAppOpen);
      if (seen !== _lastSeen) { statsLastseen.textContent = seen; _lastSeen = seen; }
    } else if (!started) {
      if (!_lastVisible) { barStats.classList.add('visible'); _lastVisible = true; }
      const m = '$' + totalMoneySaved.toFixed(2) + ' saved';
      if (m !== _lastMoney) { statsMoney.textContent = m; _lastMoney = m; }
      const seen = formatLastSeen(Date.now() - lastAppOpen);
      if (seen !== _lastSeen) { statsLastseen.textContent = seen; _lastSeen = seen; }
    } else {
      if (_lastVisible) { barStats.classList.remove('visible'); _lastVisible = false; }
    }
  }

  // --- Game loop ---
  let loopFrameId = null;
  let ashDropTimeout = null;
  let _lastAutoSave = 0;
  function loop() {
    try {
      const now = performance.now();
      const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 1/60; // delta time in seconds
      lastFrameTime = now;

      // Clean gradient cache periodically
      _maybeCleanGradCache();

      // Auto-save to localStorage every 10 seconds during gameplay
      if (started && !gameOver && now - _lastAutoSave > 10000) {
        _lastAutoSave = now;
        const sessionCost = burnProgress * CIG_PRICE();
        safeSetItem('moneySaved', String(totalMoneySaved + sessionCost));
      }

      ctx.fillStyle = isDark ? bgDark : bgLight;
      ctx.fillRect(0, 0, W, H);

      // Apply screen shake
      ctx.save();
      if (shakeAmount > 0.5) {
        const sx = (Math.random() - 0.5) * shakeAmount;
        const sy = (Math.random() - 0.5) * shakeAmount;
        ctx.translate(sx, sy);
        shakeAmount *= shakeDecay;
      } else {
        shakeAmount = 0;
      }

      if (started && !gameOver) {
        const onCooldown = now < cooldownUntil;

        // Check if puff is completing after release
        if (puffCompleting && now >= puffCompleteUntil) {
          puffCompleting = false;
        }

        // Blow detection (only when holding)
        if (onCooldown) {
          blowIntensity = 0;
          puffing = false;
        } else if (holding) {
          blowIntensity = detectBlow();
          puffing = blowIntensity > 0;
        } else if (puffCompleting) {
          // Puff completing after release — maintain current burn rate
          puffing = true;
          // blowIntensity fades from captured intensity to 0
          const elapsed = (now - (puffCompleteUntil - PUFF_COMPLETE_DURATION * 1000)) / 1000;
          const progress = Math.min(1, elapsed / PUFF_COMPLETE_DURATION);
          blowIntensity = Math.max(0, puffCompleteFromIntensity * (1 - progress));
        } else {
          blowIntensity = 0;
          puffing = false;
        }

        // Auto-burn + blow boost (delta-time based)
        const burnRate = BASE_BURN_RATE + (puffing ? BLOW_BOOST * blowIntensity : 0);
        burnProgress = Math.min(1, burnProgress + burnRate * dt);

        // Set fixed ceiling when cigarette starts burning
        if (!ashCeilingSet && burnProgress > 0) {
          ashCeilingY = getCigTopY(); // lock ceiling at first burn position
          ashCeilingSet = true;
        }

        // Ash grows downward from fixed ceiling toward ember
        if (ashDropping) {
          const dropElapsed = now - ashDropStartTime;
          const dropT = Math.min(1, dropElapsed / ASH_DROP_DURATION);
          // Ash stays in place during animation — pieces break off from bottom
          // Only reduce height at the very end
          if (dropT >= 1) {
            ashHeight = ashDropTo;
            ashDropping = false;
          }
        } else if (ashCeilingSet) {
          // Ash height = distance from ceiling to ember (grows as ember moves down)
          const cigY = getCigTopY();
          const targetHeight = cigY - ashCeilingY; // positive when ember is below ceiling
          if (ashHeight < targetHeight) {
            ashHeight = Math.min(targetHeight, ashHeight + ASH_REGROW_SPEED * dt);
          }
        }

        // Smoke particles — from ember tip AND from paper near burn zone
        if (particles.length < MAX_PARTICLES && burnProgress > 0 && burnProgress < 1) {
          const cigTopY = getCigTopY();
          const spawnRate = puffing ? 4 : 0.8;
          currentSpawnRate += (spawnRate - currentSpawnRate) * 0.12;

          // Main smoke from ember tip
          if (Math.random() < currentSpawnRate) {
            particles.push(new Particle(
              W / 2 + (Math.random() - 0.5) * CIG.fullWidth * 0.4,
              cigTopY - 2,
              puffing ? blowIntensity : 0.3,
              'main'
            ));
          }

          // Sidestream smoke — rises from ember tip (idle plume)
          if (Math.random() < currentSpawnRate * 0.5) {
            particles.push(new Particle(
              W / 2 + (Math.random() - 0.5) * CIG.fullWidth * 0.3,
              cigTopY - 1,
              0.15,
              'sidestream'
            ));
          }
        }

        if (burnProgress >= 1) {
          endSessionAndSave();
          showEndScreen();
        }
      }

      const cigTopY = getCigTopY();

      // Draw
      drawCigarette(cigTopY);
      drawAsh(cigTopY);
      drawEmber(cigTopY);

      // Update HTML stats display
      updateStatsDisplay();

      // Particles — swap-and-pop for O(1) removal
      for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        if (particles[i].life <= 0) {
          particles[i] = particles[particles.length - 1];
          particles.pop();
        } else {
          particles[i].draw(ctx);
        }
      }

      // Ash rings — swap-and-pop
      for (let i = ashRings.length - 1; i >= 0; i--) {
        ashRings[i].update();
        if (ashRings[i].life <= 0) {
          ashRings[i] = ashRings[ashRings.length - 1];
          ashRings.pop();
        } else {
          ashRings[i].draw(ctx);
        }
      }

      // Ash pieces — swap-and-pop
      for (let i = ashPieces.length - 1; i >= 0; i--) {
        ashPieces[i].update();
        if (ashPieces[i].life <= 0 || ashPieces[i].y > H) {
          ashPieces[i] = ashPieces[ashPieces.length - 1];
          ashPieces.pop();
        } else {
          ashPieces[i].draw(ctx);
        }
      }

      ctx.restore(); // undo shake translation

    } catch (e) {
      console.error(e);
    }
    // Stop loop when game is over (end screen handles the flow)
    if (gameOver) {
      loopRunning = false;
    }
    if (loopRunning) loopFrameId = requestAnimationFrame(loop);
  }

  // --- Tap handler ---
  async function handleTap(e) {
    try {
      // Bail if tapping app bar or menu pill
      if (e && e.target && e.target.closest && (
        e.target.closest('.filter-stats') ||
        e.target.closest('.menu-pill') ||
        e.target.closest('.signin-screen') ||
        e.target.closest('.idle-screen') ||
        e.target.closest('.end-screen') ||
        e.target.closest('.trigger-screen')
      )) return;

      // Game over — end screen handles the flow
      if (gameOver) return;

      // Double tap to flick ash while smoking (need visible ash)
      if (started && !gameOver && ashHeight > 2 && !ashDropping && !tapCooldown) {
        const now = Date.now();
        if (now - lastTapTime < DOUBLE_TAP_DELAY) {
          dropAsh();
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;
      }
    } catch (e) {
      console.error('TAP ERROR', e);
    }
  }

  // --- Hold detection (anywhere on screen) ---
  function handleHoldStart(e) {
    // Bail if tapping UI elements
    if (e && e.target && e.target.closest && (
      e.target.closest('.filter-stats') ||
      e.target.closest('.menu-pill') ||
      e.target.closest('.signin-screen') ||
      e.target.closest('#overlay') ||
      e.target.closest('.menu-overlay') ||
      e.target.closest('.slipup-screen') ||
      e.target.closest('.settings-screen') ||
      e.target.closest('.triggers-screen') ||
      e.target.closest('.idle-screen') ||
      e.target.closest('.end-screen') ||
      e.target.closest('.trigger-screen')
    )) return;

    // Only start hold when game is running
    if (started && !gameOver && micStarted) {
      holding = true;
      holdStartTime = performance.now();
      puffCompleting = false;
    }
  }

  let puffCompleteFromIntensity = 0; // capture intensity at release

  function handleHoldEnd(e) {
    if (holding) {
      holding = false;
      // Start completing the puff (Option B: finish the puff)
      if (puffing || blowIntensity > 0) {
        puffCompleting = true;
        puffCompleteFromIntensity = blowIntensity; // capture current intensity
        puffCompleteUntil = performance.now() + PUFF_COMPLETE_DURATION * 1000;

        // Exhale smoke burst — wider spread, slower rise
        if (blowIntensity > 0.1) {
          const cigTopY = getCigTopY();
          const count = Math.floor(10 + blowIntensity * 10);
          for (let i = 0; i < count; i++) {
            const p = new Particle(
              W / 2 + (Math.random() - 0.5) * CIG.fullWidth * 1.5,
              cigTopY - 4 - Math.random() * 6,
              blowIntensity * 0.7,
              'main'
            );
            p.vy = -(0.4 + Math.random() * 0.4); // slower rise
            p.vx = (Math.random() - 0.5) * 0.8; // wider horizontal drift
            particles.push(p);
          }
        }
      }
    }
  }

  // Touch events for hold detection
  let touchHandled = false; // prevent click from double-firing handleTap
  document.body.addEventListener('touchstart', (e) => {
    // Only prevent default on canvas when game is running (for hold mechanic)
    // Don't prevent default when game hasn't started (mic needs user gesture)
    const isUI = e.target.closest && (
      e.target.closest('.filter-stats') ||
      e.target.closest('.menu-pill') ||
      e.target.closest('.signin-screen') ||
      e.target.closest('.menu-overlay') ||
      e.target.closest('.slipup-screen') ||
      e.target.closest('.settings-screen')
    );
    handleHoldStart(e);
    handleTap(e);
    touchHandled = true;
    setTimeout(() => { touchHandled = false; }, 400);
  }, { passive: true });

  document.body.addEventListener('touchend', (e) => {
    handleHoldEnd(e);
  }, { passive: true });

  document.body.addEventListener('touchcancel', (e) => {
    handleHoldEnd(e);
  }, { passive: true });

  // Mouse events for desktop testing
  document.body.addEventListener('mousedown', (e) => {
    handleHoldStart(e);
  });

  document.body.addEventListener('mouseup', (e) => {
    handleHoldEnd(e);
  });

  // Click for desktop — skip if touch already handled
  document.body.addEventListener('click', (e) => {
    if (touchHandled) return;
    handleTap(e);
  });

  // --- Theme Toggle ---
  let isDark = safeGetItem('darkMode', 'true') === 'true';
  const bgDark = '#1a1a1a';
  const bgLight = '#faf9f7';

  function applyTheme() {
    document.body.classList.toggle('light', !isDark);
    document.body.classList.toggle('dark', isDark);
    const settingsDarkMode = document.getElementById('settings-dark-mode');
    if (settingsDarkMode) {
      settingsDarkMode.classList.toggle('active', isDark);
    }
    // Update theme-color meta tag for browser chrome
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = isDark ? '#1a1a1a' : '#faf9f7';
  }

  // Apply theme on load
  applyTheme();

  // Cleanup on page unload
  window.addEventListener('beforeunload', fullCleanup);



  // --- Slip-up Handling ---
  const slipupWelcome = document.getElementById('slipup-welcome');
  const slipupRelapse = document.getElementById('slipup-relapse');
  const slipupWelcomeTitle = document.getElementById('slipup-welcome-title');
  const slipupWelcomeSubtitle = document.getElementById('slipup-welcome-subtitle');
  const slipupStreak = document.getElementById('slipup-streak');
  const slipupMoney = document.getElementById('slipup-money');
  const slipupCigs = document.getElementById('slipup-cigs');
  const slipupRelapseSubtitle = document.getElementById('slipup-relapse-subtitle');
  const slipupRelapseDays = document.getElementById('slipup-relapse-days');
  const slipupRelapseMoney = document.getElementById('slipup-relapse-money');
  const slipupContinue = document.getElementById('slipup-continue');
  const slipupStartFresh = document.getElementById('slipup-start-fresh');
  const slipupStartAgain = document.getElementById('slipup-start-again');
  const slipupReset = document.getElementById('slipup-reset');

  // Format gap duration for display
  function formatGap(gapHours) {
    if (gapHours < 24) return `${Math.floor(gapHours)} hour${Math.floor(gapHours) !== 1 ? 's' : ''}`;
    const days = Math.floor(gapHours / 24);
    if (days < 7) return `${days} day${days !== 1 ? 's' : ''}`;
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''}`;
  }

  // Format streak for display
  function formatStreak(days) {
    if (days === 0) return '0 days';
    if (days === 1) return '1 day';
    if (days < 7) return `${days} days`;
    const weeks = Math.floor(days / 7);
    const remaining = days % 7;
    if (remaining === 0) return `${weeks} week${weeks !== 1 ? 's' : ''}`;
    return `${weeks}w ${remaining}d`;
  }

  // Check for slip-up on app load
  function checkSlipUp() {
    if (slipUpShown) return;
    if (!lastSessionDate) {
      // First time user — no slip-up check needed
      lastSessionDate = Date.now();
      saveToCloud({ lastSessionDate: lastSessionDate });
      showIdleScreen();
      return;
    }

    const now = Date.now();
    const gapMs = now - lastSessionDate;
    const gapHours = gapMs / (1000 * 60 * 60);

    // Update last session date
    lastSessionDate = now;
    saveToCloud({ lastSessionDate: lastSessionDate });

    // No gap — show idle screen
    if (gapHours < 24) {
      showIdleScreen();
      return;
    }

    // Calculate streak in days (based on quitStartDate)
    const streakDays = quitStartDate ? Math.floor((now - quitStartDate) / (1000 * 60 * 60 * 24)) : 0;

    slipUpShown = true;

    if (gapHours < 72) {
      // Short gap (1-3 days) — encouraging
      const userName = safeGetItem('userName', '');
      slipupWelcomeTitle.textContent = userName ? `Welcome back, ${userName}` : 'Welcome back';
      slipupWelcomeSubtitle.textContent = `You've been away for ${formatGap(gapHours)}. Your progress is still here.`;
      slipupStreak.textContent = formatStreak(streakDays);
      slipupMoney.textContent = '$' + totalMoneySaved.toFixed(2);
      slipupCigs.textContent = totalCigarettesAvoided;
      slipupWelcome.classList.add('active');
    } else {
      // Long gap (3+ days) — supportive relapse message
      slipupRelapseSubtitle.textContent = `It's been ${formatGap(gapHours)}. Slipping up doesn't erase your progress.`;
      slipupRelapseDays.textContent = streakDays;
      slipupRelapseMoney.textContent = '$' + Math.floor(totalMoneySaved);
      slipupRelapse.classList.add('active');
    }
  }

  // Close slip-up screens
  slipupContinue.addEventListener('click', (e) => {
    e.stopPropagation();
    logEvent('slipup_action', { action: 'continue_streak', type: 'welcome' });
    slipupWelcome.classList.remove('active');
    showIdleScreen();
  });
  slipupStartFresh.addEventListener('click', (e) => {
    e.stopPropagation();
    logEvent('slipup_action', { action: 'start_fresh', type: 'welcome' });
    // Reset streak but keep money and cigarettes
    sessionCount = 0;
    quitStartDate = Date.now();
    saveToCloud({ quitStreak: 0, quitStartDate: quitStartDate });
    slipupWelcome.classList.remove('active');
    showIdleScreen();
  });
  slipupStartAgain.addEventListener('click', (e) => {
    e.stopPropagation();
    logEvent('slipup_action', { action: 'start_again', type: 'relapse' });
    slipupRelapse.classList.remove('active');
    showIdleScreen();
  });
  slipupReset.addEventListener('click', (e) => {
    e.stopPropagation();
    logEvent('slipup_action', { action: 'reset_everything', type: 'relapse' });
    // Reset everything
    sessionCount = 0;
    totalMoneySaved = 0;
    totalCigarettesAvoided = 0;
    quitStartDate = Date.now();
    saveToCloud({
      quitStreak: 0,
      moneySaved: 0,
      cigarettesAvoided: 0,
      quitStartDate: quitStartDate
    });
    slipupRelapse.classList.remove('active');
  });

  // Prevent slip-up screen taps from propagating
  slipupWelcome.addEventListener('click', (e) => e.stopPropagation());
  slipupWelcome.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  slipupRelapse.addEventListener('click', (e) => e.stopPropagation());
  slipupRelapse.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

  // Sign-in button
  const signinBtn = document.getElementById('signin-google');
  signinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    signinBtn.textContent = 'Signing in...';
    signinBtn.disabled = true;
    // Clear any previous error
    const errorDiv = document.querySelector('.signin-error');
    if (errorDiv) errorDiv.remove();
    signInWithGoogle().catch(() => {
      resetSigninButton();
    });
  });
  signinBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });


  // --- Menu ---
  const menuOverlay = document.getElementById('menu-overlay');

  function closeMenu() {
    menuOverlay.classList.remove('active');
    menuContent.style.transform = '';
  }

  // Menu pill below cigarette opens menu
  const menuPill = document.getElementById('menu-pill');
  menuPill.addEventListener('click', (e) => {
    e.stopPropagation();
    updateMenuUserInfo();
    history.pushState({screen:'menu'}, '');
    menuOverlay.classList.add('active');
  });

  menuOverlay.addEventListener('click', (e) => {
    if (e.target === menuOverlay) closeMenu();
  });

  // Swipe-down to dismiss menu
  let menuDragStartY = 0;
  let menuDragging = false;
  const menuContent = document.querySelector('.menu-content');
  // Tap drag handle to dismiss
  document.querySelector('.menu-drag-handle').addEventListener('click', closeMenu);
  menuContent.addEventListener('touchstart', (e) => {
    menuDragStartY = e.touches[0].clientY;
    menuDragging = false;
  }, { passive: true });
  menuContent.addEventListener('touchmove', (e) => {
    const dy = e.touches[0].clientY - menuDragStartY;
    if (dy > 0) {
      menuDragging = true;
      menuContent.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: true });
  menuContent.addEventListener('touchend', (e) => {
    if (menuDragging) {
      const dy = e.changedTouches[0].clientY - menuDragStartY;
      if (dy > 100) {
        closeMenu();
      } else {
        menuContent.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        menuContent.style.transform = '';
        setTimeout(() => { menuContent.style.transition = ''; }, 300);
      }
    }
    menuDragging = false;
  }, { passive: true });

  // Scroll dots for horizontal menu
  const menuScrollWrap = document.getElementById('menu-scroll-wrap');
  const menuDots = document.querySelectorAll('#menu-dots .menu-dot');
  if (menuScrollWrap && menuDots.length) {
    menuScrollWrap.addEventListener('scroll', () => {
      const scrollLeft = menuScrollWrap.scrollLeft;
      const cardWidth = 172; // card width + gap
      const activeIndex = Math.round(scrollLeft / cardWidth);
      menuDots.forEach((dot, i) => {
        dot.classList.toggle('active', i === activeIndex);
      });
    }, { passive: true });
  }

  // --- Settings Screen ---
  const settingsScreen = document.getElementById('settings-screen');
  const settingsBack = document.getElementById('settings-back');
  const settingsName = document.getElementById('settings-name');
  const settingsPrice = document.getElementById('settings-price');
  const settingsReset = document.getElementById('settings-reset');
  const settingsSignout = document.getElementById('settings-signout');
  const settingsTotalSaved = document.getElementById('settings-total-saved');
  const settingsPriceDisplay = document.getElementById('settings-price-display');
  const settingsNameDisplay = document.getElementById('settings-name-display');
  const menuSettings = document.getElementById('menu-settings');

  // Edit modal elements
  const settingsEditModal = document.getElementById('settings-edit-modal');
  const settingsEditTitle = document.getElementById('settings-edit-title');
  const settingsEditInput = document.getElementById('settings-edit-input');
  const settingsEditCancel = document.getElementById('settings-edit-cancel');
  const settingsEditSave = document.getElementById('settings-edit-save');
  let currentEditField = null;

  // Load settings from localStorage
  function loadSettings() {
    settingsName.value = safeGetItem('userName', '');
    settingsPrice.value = cigPrice;
    settingsDarkMode.classList.toggle('active', isDark);
    settingsTotalSaved.textContent = '$' + totalMoneySaved.toFixed(2);
    settingsPriceDisplay.textContent = '$' + cigPrice.toFixed(2);

    // Update name display
    const userName = safeGetItem('userName', '');
    settingsNameDisplay.textContent = userName || 'Set name';
  }

  // Save settings to cloud + localStorage
  function saveSettings() {
    cigPrice = parseFloat(settingsPrice.value) || 1;
    const userName = settingsName.value.trim();
    saveToCloud({
      userName: userName,
      cigPrice: cigPrice,
      darkMode: isDark
    });
    settingsPriceDisplay.textContent = '$' + cigPrice.toFixed(2);
    settingsNameDisplay.textContent = userName || 'Set name';
    // Update menu greeting immediately
    updateMenuUserInfo();
  }

  // Open edit modal
  function openEditModal(field) {
    currentEditField = field;
    if (field === 'name') {
      settingsEditTitle.textContent = 'Your name';
      settingsEditInput.type = 'text';
      settingsEditInput.value = settingsName.value;
      settingsEditInput.placeholder = 'Optional';
      settingsEditInput.maxLength = 20;
    } else if (field === 'price') {
      settingsEditTitle.textContent = 'Cigarette price';
      settingsEditInput.type = 'number';
      settingsEditInput.value = cigPrice;
      settingsEditInput.placeholder = '1.00';
      settingsEditInput.step = '0.01';
      settingsEditInput.min = '0.01';
      settingsEditInput.max = '10';
      settingsEditInput.removeAttribute('maxlength');
    }
    settingsEditModal.classList.add('active');
    setTimeout(() => settingsEditInput.focus(), 100);
  }

  // Close edit modal
  function closeEditModal() {
    settingsEditModal.classList.remove('active');
    currentEditField = null;
  }

  // Edit modal handlers
  settingsEditCancel.addEventListener('click', (e) => {
    e.stopPropagation();
    closeEditModal();
  });

  settingsEditSave.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentEditField === 'name') {
      settingsName.value = settingsEditInput.value.trim();
    } else if (currentEditField === 'price') {
      settingsPrice.value = settingsEditInput.value;
    }
    saveSettings();
    logEvent('setting_changed', { field: currentEditField });
    closeEditModal();
  });

  settingsEditModal.addEventListener('click', (e) => {
    if (e.target === settingsEditModal) closeEditModal();
  });

  // Enter key saves, Escape key cancels
  settingsEditInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      settingsEditSave.click();
    } else if (e.key === 'Escape') {
      closeEditModal();
    }
  });

  // Card stack click handlers
  document.getElementById('settings-name-card').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal('name');
  });

  document.getElementById('settings-price-card').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal('price');
  });

  // Open settings from menu
  menuSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenu();
    loadSettings();
    history.pushState({screen:'settings'}, '');
    settingsScreen.classList.add('visible');
  });

  // --- Trigger Analytics Screen ---
  const triggersScreen = document.getElementById('triggers-screen');
  const triggersBack = document.getElementById('triggers-back');

  function buildTriggerHeatmap() {
    const triggersBars = document.getElementById('triggers-bars');
    const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));

    if (!logs.length) {
      triggersBars.innerHTML = '<div class="triggers-empty">No data yet. Complete a session to see patterns.</div>';
      return;
    }

    // Count triggers
    const triggerCounts = {};
    logs.forEach(log => {
      const trigger = log.trigger || 'Unknown';
      triggerCounts[trigger] = (triggerCounts[trigger] || 0) + 1;
    });

    // Sort by count descending
    const sorted = Object.entries(triggerCounts).sort((a, b) => b[1] - a[1]);
    const maxCount = sorted[0][1];

    // Trigger icons mapping (by ID)
    const triggerIcons = {
      'stress': '😰',
      'drinking': '🍺',
      'coffee': '☕',
      'meals': '🍽️',
      'boredom': '😑',
      'driving': '🚗',
      'aftersex': '❤️',
      'workbreak': '💼',
      'scrolling': '📱',
      'walking': '🚶',
      'social': '🍻',
      'morning': '🌅',
      'other': '💭'
    };

    // Trigger labels mapping (by ID)
    const triggerLabels = {
      'stress': 'Stress',
      'drinking': 'Drinking',
      'coffee': 'Coffee',
      'meals': 'After meals',
      'boredom': 'Boredom',
      'driving': 'Driving',
      'aftersex': 'After sex',
      'workbreak': 'Work break',
      'scrolling': 'Scrolling',
      'walking': 'Walking',
      'social': 'Social pressure',
      'morning': 'Morning routine',
      'other': 'Other'
    };

    // Bar colors
    const barColors = ['amber', 'blue', 'green', 'pink', 'gray', 'gray'];

    // Build bars
    triggersBars.innerHTML = '';
    sorted.forEach(([trigger, count], i) => {
      const pct = (count / maxCount) * 100;
      const icon = triggerIcons[trigger] || '📊';
      const label = triggerLabels[trigger] || trigger;
      const color = barColors[i] || 'gray';

      const group = document.createElement('div');
      group.className = 'trigger-bar-group';
      group.innerHTML = `
        <div class="trigger-bar-header">
          <div class="trigger-bar-name"><span class="trigger-bar-icon">${icon}</span>${label}</div>
          <div class="trigger-bar-count">${count}</div>
        </div>
        <div class="trigger-bar-track">
          <div class="trigger-bar-fill ${color}" style="width:0%"></div>
        </div>
      `;
      triggersBars.appendChild(group);

      // Animate bar fill
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          group.querySelector('.trigger-bar-fill').style.width = pct + '%';
        });
      });
    });

    // Build time-of-day heatmap
    buildTimeHeatmap(logs);
  }

  // Build time-of-day heatmap
  function buildTimeHeatmap(logs) {
    const heatmapGrid = document.getElementById('triggers-heatmap-grid');
    const heatmapInsight = document.getElementById('triggers-heatmap-insight');

    // Count sessions by day of week (0=Sun) and hour (0-23)
    const counts = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let peakDay = 0;
    let peakHour = 0;
    let peakCount = 0;

    logs.forEach(log => {
      const date = new Date(log.time);
      const day = date.getDay();
      const hour = date.getHours();
      counts[day][hour]++;
      if (counts[day][hour] > peakCount) {
        peakCount = counts[day][hour];
        peakDay = day;
        peakHour = hour;
      }
    });

    // Find max count for scaling
    const maxCount = Math.max(...counts.flat(), 1);

    // Day labels
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build heatmap grid
    heatmapGrid.innerHTML = '';
    for (let d = 0; d < 7; d++) {
      const row = document.createElement('div');
      row.className = 'triggers-heatmap-row';
      for (let h = 0; h < 24; h++) {
        const cell = document.createElement('div');
        cell.className = 'triggers-heatmap-cell';
        const count = counts[d][h];
        if (count > 0) {
          const level = Math.min(4, Math.ceil((count / maxCount) * 4));
          cell.classList.add('l' + level);
        }
        cell.title = `${dayLabels[d]} ${h}:00 - ${count} session${count !== 1 ? 's' : ''}`;
        row.appendChild(cell);
      }
      heatmapGrid.appendChild(row);
    }

    // Build insight message
    if (peakCount > 0) {
      const dayName = dayLabels[peakDay];
      const hourStr = peakHour === 0 ? '12am' : peakHour < 12 ? peakHour + 'am' : peakHour === 12 ? '12pm' : (peakHour - 12) + 'pm';
      heatmapInsight.textContent = `Your peak time: ${dayName} ${hourStr}`;
    } else {
      heatmapInsight.textContent = '';
    }
  }

  // Open triggers from menu
  const menuTriggers = document.getElementById('menu-triggers');
  menuTriggers.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenu();
    buildTriggerHeatmap();
    history.pushState({screen:'triggers'}, '');
    triggersScreen.classList.add('visible');
  });

  // Back button
  triggersBack.addEventListener('click', (e) => {
    e.stopPropagation();
    triggersScreen.classList.remove('visible');
  });

  // Prevent taps propagating
  triggersScreen.addEventListener('click', (e) => e.stopPropagation());
  triggersScreen.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

  // Menu greeting
  const menuGreeting = document.getElementById('menu-greeting');

  // Sign out from settings
  settingsSignout.addEventListener('click', (e) => {
    e.stopPropagation();
    signOut();
  });

  // Update user info when menu opens
  function updateMenuUserInfo() {
    if (currentUser) {
      // Use manually set name from localStorage first, fall back to Google name
      const manualName = safeGetItem('userName', '');
      const googleName = currentUser.displayName || '';
      const firstName = manualName || (googleName ? googleName.split(' ')[0] : '');
      const email = currentUser.email || '';

      if (firstName) {
        menuGreeting.innerHTML = '<div class="menu-greeting-text">Hi, ' + firstName + ' 👋</div>' +
          (email ? '<div class="menu-greeting-sub">' + email + '</div>' : '');
      } else if (email) {
        menuGreeting.innerHTML = '<div class="menu-greeting-text">' + email + '</div>';
      } else {
        menuGreeting.innerHTML = '';
      }
    } else {
      menuGreeting.innerHTML = '';
    }
  }

  // Back button
  settingsBack.addEventListener('click', (e) => {
    e.stopPropagation();
    saveSettings();
    settingsScreen.classList.remove('visible');
  });

  // Toggle dark mode (in settings)
  const settingsDarkMode = document.getElementById('settings-dark-mode');
  settingsDarkMode.addEventListener('click', (e) => {
    e.stopPropagation();
    isDark = !isDark;
    applyTheme();
    saveToCloud({ darkMode: isDark });
    logEvent('dark_mode_toggled', { enabled: isDark });
  });

  // Reset all data
  settingsReset.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm('This will erase all your progress, streak, and data. Are you sure?')) {
      localStorage.clear();
      location.reload();
    }
  });

  // Delete cloud data
  const settingsDeleteCloud = document.getElementById('settings-delete-cloud');
  settingsDeleteCloud.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentUser) {
      alert('You need to be signed in to delete cloud data.');
      return;
    }
    if (confirm('This will delete your data from Firebase. Local data will remain. Are you sure?')) {
      try {
        await db.collection('user_data').doc(currentUser.uid).delete();
        // Also delete events
        const eventsSnapshot = await db.collection('events').where('uid', '==', currentUser.uid).get();
        const batch = db.batch();
        eventsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        alert('Cloud data deleted successfully.');
      } catch (e) {
        alert('Failed to delete cloud data: ' + e.message);
      }
    }
  });

  // Auto-save on input change
  [settingsName, settingsPrice].forEach(el => {
    el.addEventListener('change', saveSettings);
  });

  // Prevent settings taps from propagating
  settingsScreen.addEventListener('click', (e) => e.stopPropagation());
  settingsScreen.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

  // Prevent menu taps from propagating
  menuOverlay.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

  // Update tap handler to bail on menu button
  // (Already handled in the existing bail check)

  // Save partial progress when app goes to background or unloads
  // End session and save money (handles both full and partial)
  function endSessionAndSave() {
    if (gameOver) return; // Already ended

    gameOver = true;
    cleanupMic();

    // Calculate money based on how much was smoked
    sessionMoneySaved = burnProgress * CIG_PRICE();
    const isFullSession = burnProgress >= 1;
    if (sessionMoneySaved > 0) {
      totalMoneySaved += sessionMoneySaved;
      totalCigarettesAvoided++;
      sessionCount++;
    }

    // Set quit start date if not already set
    if (!quitStartDate) {
      quitStartDate = Date.now();
    }

    // Log session event with duration
    const sessionDuration = gameStartTime ? Math.round((performance.now() - gameStartTime) / 1000) : 0;
    logEvent('session_completed', {
      trigger: currentTriggerId,
      burnProgress: Math.round(burnProgress * 100),
      money: sessionMoneySaved,
      isFullSession: isFullSession,
      durationSeconds: sessionDuration
    });

    // Save to cloud + localStorage
    saveToCloud({
      quitStreak: sessionCount,
      moneySaved: totalMoneySaved,
      cigarettesAvoided: totalCigarettesAvoided,
      quitStartDate: quitStartDate,
      lastSessionDate: Date.now()
    });
  }

  function savePartialProgress() {
    if (started && !gameOver && burnProgress > 0 && burnProgress < 1) {
      endSessionAndSave();
    }
  }

  window.addEventListener('beforeunload', savePartialProgress);

  // Online/offline status
  window.addEventListener('online', () => {
    idleOffline.classList.remove('visible');
  });
  window.addEventListener('offline', () => {
    if (gameState === 'idle') {
      idleOffline.classList.add('visible');
    }
  });

  // Pause loop when app is in background
  let hiddenAt = 0; // timestamp when tab became hidden
  let backgroundInterval = null; // interval for burning while hidden

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      savePartialProgress();
      // Sync all state to cloud when leaving
      if (currentUser) {
        const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));
        saveToCloud({
          cravingLogs: logs,
          moneySaved: totalMoneySaved,
          quitStreak: sessionCount,
          cigarettesAvoided: totalCigarettesAvoided,
          quitStartDate: quitStartDate,
          lastSessionDate: Date.now()
        });
      }
      // Stop the animation loop
      loopRunning = false;
      if (loopFrameId) cancelAnimationFrame(loopFrameId);

      // Start background interval to keep burning while hidden
      if (started && !gameOver) {
        backgroundInterval = setInterval(() => {
          burnProgress = Math.min(1, burnProgress + BASE_BURN_RATE);
          if (burnProgress >= 1) {
            clearInterval(backgroundInterval);
            backgroundInterval = null;
            endSessionAndSave();
          }
        }, 1000);
      }
    } else {
      // Clear background interval
      if (backgroundInterval) {
        clearInterval(backgroundInterval);
        backgroundInterval = null;
      }

      if (!gameOver && started) {
        // Calculate elapsed time while hidden and advance burn progress
        if (hiddenAt > 0) {
          const elapsed = (Date.now() - hiddenAt) / 1000; // seconds
          burnProgress = Math.min(1, burnProgress + BASE_BURN_RATE * elapsed);
          hiddenAt = 0;

          // Check if cigarette finished while away
          if (burnProgress >= 1) {
            endSessionAndSave();
            showEndScreen();
            return;
          }
        }
        loopRunning = true;
        lastFrameTime = 0;
        loopFrameId = requestAnimationFrame(loop);
      } else if (gameOver && started) {
        // Cigarette finished while hidden, show end screen
        showEndScreen();
      }
    }
  });

  // --- History management for iOS swipe-back ---
  function closeActiveScreen() {
    if (settingsScreen.classList.contains('visible')) {
      settingsScreen.classList.remove('visible');
      return true;
    }
    if (triggersScreen.classList.contains('visible')) {
      triggersScreen.classList.remove('visible');
      return true;
    }
    if (menuOverlay.classList.contains('active')) {
      menuOverlay.classList.remove('active');
      return true;
    }
    return false;
  }

  window.addEventListener('popstate', () => {
    closeActiveScreen();
  });

  // Push state when opening screens (via menu items)

  loop();
})();
