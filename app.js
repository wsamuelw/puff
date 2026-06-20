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

  let storageWarningShown = false;
  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (!storageWarningShown && e.name === 'QuotaExceededError') {
        storageWarningShown = true;
        console.warn('Storage full — some data may not be saved. Try clearing old data in Settings.');
      }
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
      signinBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Sign in with Google';
      signinBtn.disabled = false;
      signinBtn.style.background = '';
      signinBtn.style.color = '';
      signinBtn.style.borderColor = '';
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

  // Splash screen (value proposition)
  const splashScreen = document.getElementById('splash-screen');
  const splashStart = document.getElementById('splash-start');

  // Check if onboarding and consent are complete
  const onboardingDone = safeGetItem('onboardingComplete', 'false');
  const consentGiven = safeGetItem('consentGiven', 'false');

  // Show splash screen first for new users
  if (onboardingDone === 'false' || consentGiven === 'false') {
    splashScreen.classList.add('visible');
  }

  // Splash "Get Started" → show onboarding
  splashStart.addEventListener('click', (e) => {
    e.stopPropagation();
    splashScreen.classList.remove('visible');
    setTimeout(() => {
      showOnboarding();
    }, 300);
  });

  // Listen for auth state changes
  auth.onAuthStateChanged((user) => {
    currentUser = user;

    if (user) {
      // Already signed in — show confirmed state
      markSignedIn();
      loadFromCloud();
      if (!safeGetItem('userName', '') && user.displayName) {
        const firstName = user.displayName.split(' ')[0];
        safeSetItem('userName', firstName);
      }
    } else {
      resetSigninButton();
    }

    // If consent given and onboarding done, go to trigger selection
    // Read fresh from localStorage (consentGiven may have been set during sign-in)
    if (safeGetItem('consentGiven', 'false') === 'true' && safeGetItem('onboardingComplete', 'false') === 'true') {
      // Small delay to let signin screen hide
      setTimeout(() => checkSlipUp(), 100);
    }
  });

  // Save to Firestore (also saves to localStorage as offline cache)
  async function saveToCloud(data) {
    // Skip if reset is in progress
    if (isResetting) return;

    // Always save locally first
    Object.entries(data).forEach(([key, value]) => {
      safeSetItem(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    });

    // Skip cloud save if no consent or no user
    const consent = safeGetItem('consentGiven', 'false');
    if (!currentUser || consent !== 'true') return;

    try {
      // Use dot notation to merge nested fields without replacing the whole data object
      const update = { updated_at: firebase.firestore.FieldValue.serverTimestamp() };
      for (const [key, value] of Object.entries(data)) {
        update['data.' + key] = value;
      }
      await db.collection('user_data').doc(currentUser.uid).set(update, { merge: true });
    } catch (e) {
      console.warn('Cloud save failed:', e.message);
    }
  }

  // Event logging — track user actions in Firebase
  async function logEvent(eventName, props = {}) {
    // Skip logging if no consent or no user
    const consent = safeGetItem('consentGiven', 'false');
    if (!currentUser || consent !== 'true') return;
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
        if (cloudData.cigPrice !== undefined) cigPrice = parseFloat(cloudData.cigPrice) || 0.50;
        if (cloudData.cravingLogs) {
          cravingLogs = cloudData.cravingLogs;
          safeSetItem('cravingLogs', JSON.stringify(cravingLogs));
        }
        if (cloudData.lastSessionDate !== undefined) lastSessionDate = parseInt(cloudData.lastSessionDate) || 0;
        if (cloudData.darkMode !== undefined) {
          isDark = cloudData.darkMode === true || cloudData.darkMode === 'true';
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
  let micStarted = false;
  let touchOnlyMode = false;
  let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let micStream = null; // store stream for cleanup
  let audioCtx, analyser, dataArray, crackleGain, dragGain;
  let blowIntensity = 0;
  let blowFrames = 0;
  let burnProgress = 0; // 0 = full, 1 = gone
  let puffing = false;
  let gameOver = false;
  let cooldownUntil = 0;
  let started = false;
  let endScreenShown = false;

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
  let cigPrice = parseFloat(safeGetItem('cigPrice', '0.50'));
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

      // Cigarette dimensions scale with current viewport
    CIG.bodyLength = H * 0.38;                    // paper section
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
      // Show retry + skip options
      promptEl.innerHTML = 'Microphone access denied.<br><span style="font-size:14px;opacity:0.7">Tap to retry · <span id="mic-skip" style="text-decoration:underline;cursor:pointer">Continue without mic</span></span>';
      promptEl.style.opacity = '1';
      promptEl.style.pointerEvents = 'auto';
      document.getElementById('overlay').style.pointerEvents = 'auto';
      // Skip button handler
      const skipBtn = document.getElementById('mic-skip');
      if (skipBtn) {
        skipBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          touchOnlyMode = true;
          promptEl.style.opacity = '0';
          promptEl.style.pointerEvents = 'none';
          overlayEl.style.pointerEvents = 'none';
          started = true;
          gameStartTime = performance.now();
          loopFrameId = requestAnimationFrame(loop);
        });
      }
      return false;
    }
  }

  // Retry mic on overlay tap
  overlayEl.addEventListener('click', async () => {
    if (!micStarted && !touchOnlyMode) {
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
    if (!reducedMotion) shakeAmount = 6;

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
  const FILTER_Y = () => H * 0.617;
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
    { id: 'anxiety', emoji: '😬', label: 'Anxiety' },
    { id: 'sadness', emoji: '😔', label: 'Sadness' },
    { id: 'anger', emoji: '😤', label: 'Anger' },
    { id: 'tired', emoji: '😴', label: 'Tired' },
    { id: 'drinking', emoji: '🍺', label: 'Drinking' },
    { id: 'coffee', emoji: '☕', label: 'Coffee' },
    { id: 'meals', emoji: '🍽️', label: 'After meals' },
    { id: 'social', emoji: '🍻', label: 'Social drinking' },
    { id: 'workbreak', emoji: '💼', label: 'Work break' },
    { id: 'toilet', emoji: '🚽', label: 'Toilet' },
    { id: 'aftersex', emoji: '❤️', label: 'After sex' },
    { id: 'boredom', emoji: '😑', label: 'Boredom' },
    { id: 'morning', emoji: '🌅', label: 'Morning routine' },
    { id: 'latenight', emoji: '🌙', label: 'Late night' },
  ];
  let triggerSubmitted = false;

  // Badge definitions
  const BADGES = [
    // Streak
    { id: 'first_step', emoji: '🌱', name: 'First Step', desc: 'Complete your first session', category: 'streak', check: () => sessionCount >= 1 },
    { id: '3_day', emoji: '🔥', name: '3-Day Streak', desc: 'Stay smoke-free for 3 days', category: 'streak', check: () => getDaysSinceLastSession() >= 3 },
    { id: '1_week', emoji: '💪', name: 'One Week', desc: '7 days smoke-free', category: 'streak', check: () => getDaysSinceLastSession() >= 7 },
    { id: '2_weeks', emoji: '🏆', name: 'Two Weeks', desc: '14 days smoke-free', category: 'streak', check: () => getDaysSinceLastSession() >= 14 },
    { id: '1_month', emoji: '👑', name: 'One Month', desc: '30 days smoke-free', category: 'streak', check: () => getDaysSinceLastSession() >= 30 },
    { id: '3_months', emoji: '💎', name: '3 Months', desc: '90 days smoke-free', category: 'streak', check: () => getDaysSinceLastSession() >= 90 },
    { id: '6_months', emoji: '🌟', name: '6 Months', desc: '180 days smoke-free', category: 'streak', check: () => getDaysSinceLastSession() >= 180 },
    { id: '1_year', emoji: '🧠', name: '1 Year', desc: '365 days smoke-free', category: 'streak', check: () => getDaysSinceLastSession() >= 365 },
    // Savings
    { id: 'save_10', emoji: '💰', name: '$10 Saved', desc: 'Save $10 in total', category: 'savings', check: () => totalMoneySaved >= 10 },
    { id: 'save_50', emoji: '💵', name: '$50 Saved', desc: 'Save $50 in total', category: 'savings', check: () => totalMoneySaved >= 50 },
    { id: 'save_100', emoji: '💳', name: '$100 Saved', desc: 'Save $100 in total', category: 'savings', check: () => totalMoneySaved >= 100 },
    { id: 'save_500', emoji: '🏦', name: '$500 Saved', desc: 'Save $500 in total', category: 'savings', check: () => totalMoneySaved >= 500 },
    // Cigarettes avoided
    { id: 'cig_10', emoji: '🚭', name: '10 Real Cigs', desc: 'Avoid 10 real cigarettes', category: 'cigarettes', check: () => totalCigarettesAvoided >= 10 },
    { id: 'cig_50', emoji: '🚭', name: '50 Real Cigs', desc: 'Avoid 50 real cigarettes', category: 'cigarettes', check: () => totalCigarettesAvoided >= 50 },
    { id: 'cig_100', emoji: '🚭', name: '100 Real Cigs', desc: 'Avoid 100 real cigarettes', category: 'cigarettes', check: () => totalCigarettesAvoided >= 100 },
    { id: 'cig_500', emoji: '🚭', name: '500 Real Cigs', desc: 'Avoid 500 real cigarettes', category: 'cigarettes', check: () => totalCigarettesAvoided >= 500 },
    // Sessions
    { id: 'sess_10', emoji: '🎯', name: '10 Sessions', desc: 'Complete 10 sessions', category: 'sessions', check: () => sessionCount >= 10 },
    { id: 'sess_50', emoji: '🎯', name: '50 Sessions', desc: 'Complete 50 sessions', category: 'sessions', check: () => sessionCount >= 50 },
    { id: 'sess_100', emoji: '🎯', name: '100 Sessions', desc: 'Complete 100 sessions', category: 'sessions', check: () => sessionCount >= 100 },
    { id: 'sess_500', emoji: '🎯', name: '500 Sessions', desc: 'Complete 500 sessions', category: 'sessions', check: () => sessionCount >= 500 },
    // Special
    { id: 'calm', emoji: '🧘', name: 'Calm', desc: '5 sessions without stress trigger', category: 'special', check: () => getNonStressSessions() >= 5 },
    { id: 'early_bird', emoji: '🌅', name: 'Early Bird', desc: '5 sessions before 9am', category: 'special', check: () => getEarlySessions() >= 5 },
    { id: 'night_owl', emoji: '🦉', name: 'Night Owl', desc: '5 sessions after 10pm', category: 'special', check: () => getLateSessions() >= 5 },
    { id: 'weekend', emoji: '⚔️', name: 'Weekend Warrior', desc: '7 sessions on weekends', category: 'special', check: () => getWeekendSessions() >= 7 },
  ];

  // Badge helper functions
  function getDaysSinceLastSession() {
    const lastSession = parseInt(safeGetItem('lastSessionDate', '0'));
    if (!lastSession) return 0;
    return Math.floor((Date.now() - lastSession) / (24 * 60 * 60 * 1000));
  }

  function getNonStressSessions() {
    const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));
    return logs.filter(l => l.trigger && l.trigger !== 'stress').length;
  }

  function getEarlySessions() {
    const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));
    return logs.filter(l => {
      const hour = new Date(l.time).getHours();
      return hour < 9;
    }).length;
  }

  function getLateSessions() {
    const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));
    return logs.filter(l => {
      const hour = new Date(l.time).getHours();
      return hour >= 22;
    }).length;
  }

  function getWeekendSessions() {
    const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));
    return logs.filter(l => {
      const day = new Date(l.time).getDay();
      return day === 0 || day === 6;
    }).length;
  }

  // Check for new badges after session
  function checkBadges() {
    const earned = JSON.parse(safeGetItem('earnedBadges', '[]'));
    const newBadges = [];

    BADGES.forEach(badge => {
      if (!earned.includes(badge.id) && badge.check()) {
        earned.push(badge.id);
        newBadges.push(badge);
      }
    });

    if (newBadges.length > 0) {
      safeSetItem('earnedBadges', JSON.stringify(earned));
      // Show notification for first new badge
      showBadgeNotification(newBadges[0]);
    }
  }

  // Show badge notification
  function showBadgeNotification(badge) {
    const notification = document.createElement('div');
    notification.className = 'badge-notification';
    notification.innerHTML = `
      <div class="badge-notification-content">
        <div class="badge-notification-icon">🎉</div>
        <div class="badge-notification-title">Badge Earned!</div>
        <div class="badge-notification-badge">
          <span class="badge-notification-emoji">${badge.emoji}</span>
          <span class="badge-notification-name">${badge.name}</span>
        </div>
        <button class="badge-notification-close" onclick="this.parentElement.parentElement.remove()">Nice!</button>
      </div>
    `;
    document.body.appendChild(notification);
  }

  // HTML trigger screen elements
  const triggerScreen = document.getElementById('trigger-screen');
  const triggerGrid = document.getElementById('trigger-grid');

  // HTML idle screen elements

  // HTML end screen elements
  const endScreen = document.getElementById('end-screen');
  const endTotalStat = document.getElementById('end-total-stat');
  const endCigsStat = document.getElementById('end-cigs-stat');
  const endTriggerList = document.getElementById('end-trigger-list');
  const endAnother = document.getElementById('end-another');

  // Onboarding
  const onboardingScreen = document.getElementById('onboarding-screen');
  const onboardingIcon = document.getElementById('onboarding-icon');
  const onboardingTitle = document.getElementById('onboarding-title');
  const onboardingDesc = document.getElementById('onboarding-desc');
  const onboardingDots = document.getElementById('onboarding-dots');
  const onboardingNext = document.getElementById('onboarding-next');
  const ONBOARDING_STEPS = [
    { icon: '🫁', title: 'Quit by simulating', desc: 'Each session you complete means a cigarette you didn\'t smoke in real life. Track your savings and understand your triggers.' },
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
    onboardingNext.textContent = onboardingStep < ONBOARDING_STEPS.length - 1 ? 'Next' : 'Continue';
  }

  let onboardingDebounce = false;
  onboardingNext.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onboardingDebounce) return;
    onboardingDebounce = true;
    setTimeout(() => { onboardingDebounce = false; }, 400);

    if (onboardingStep < ONBOARDING_STEPS.length - 1) {
      onboardingStep++;
      updateOnboardingCard();
    } else {
      // Onboarding done — show consent + signin
      onboardingScreen.classList.remove('visible');
      safeSetItem('onboardingComplete', 'true');
      logEvent('onboarding_completed');
      setTimeout(() => {
        document.getElementById('signin-screen').classList.remove('hidden');
      }, 300);
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
      startSessionWithTrigger(trigger.id);
    });
    triggerGrid.appendChild(btn);
  });

  // Add "Not sure" skip option
  const skipBtn = document.createElement('button');
  skipBtn.className = 'trigger-btn trigger-skip';
  skipBtn.dataset.trigger = 'unknown';
  skipBtn.textContent = '🤷 Not sure';
  skipBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startSessionWithTrigger('unknown');
  });
  triggerGrid.appendChild(skipBtn);

  // Start session with selected trigger
  function startSessionWithTrigger(triggerId) {
    currentTriggerId = triggerId;
    logEvent('trigger_selected', { trigger: triggerId });
    triggerScreen.classList.remove('visible');
    gameState = 'smoking';
    startSmokingSession();
  }

  // Show trigger selection screen (before smoking)
  function showTriggerScreen() {
    currentTriggerId = null;
    triggerGrid.querySelectorAll('.trigger-btn').forEach(b => b.classList.remove('selected'));
    triggerScreen.classList.add('visible');
    gameState = 'trigger-select';
  }

  // Start smoking session
  let sessionStarting = false;
  async function startSmokingSession() {
    if (sessionStarting) return; // Prevent re-entrancy
    sessionStarting = true;

    // Reset smoking state
    burnProgress = 0;
    gameOver = false;
    endScreenShown = false;
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
    sessionStarting = false;
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

  // Coping suggestions by trigger
  const COPING_SUGGESTIONS = {
    'stress': 'Try 3 slow breaths — in for 4, hold for 4, out for 4. The craving usually passes in a few minutes.',
    'anxiety': 'Ground yourself: name 5 things you can see, 4 you can touch, 3 you can hear. The feeling will pass.',
    'sadness': 'Call or text someone you trust. You don\'t have to explain — just connect.',
    'anger': 'Do 10 jumping jacks or walk around the block. Physical movement helps release the tension.',
    'tired': 'Have a glass of water and stretch for 30 seconds. Fatigue cravings are your body asking for a reset.',
    'drinking': 'Hold your drink in your smoking hand. Next round, try alternating with water.',
    'coffee': 'Next coffee, try switching to tea or changing where you sit. Break the routine link.',
    'meals': 'Brush your teeth or go for a short walk right after eating. The craving fades fast.',
    'social': 'Have a ready phrase: "I\'m good, thanks." Step away for a minute if you need to.',
    'workbreak': 'Take your break outside for a short walk. Change the scenery, not the habit.',
    'toilet': 'Leave your phone in another room. Read something or just sit with the quiet.',
    'aftersex': 'Grab a glass of water, cuddle, or hop in the shower. The moment passes quickly.',
    'boredom': 'Do something with your hands — call someone, stretch, or play a quick game.',
    'morning': 'Delay your first cigarette by 10 minutes each week. Change the order of your morning.',
    'latenight': 'Go to bed 30 minutes earlier. Tired cravings are your body asking for sleep, not nicotine.'
  };

  // Show end screen
  function showEndScreen() {
    if (endScreenShown) return; // Prevent duplicate calls
    endScreenShown = true;

    // Save trigger to logs with money saved, prune entries older than 90 days
    const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));
    logs.push({ time: Date.now(), trigger: currentTriggerId, money: sessionMoneySaved });
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
    const pruned = logs.filter(log => log.time > ninetyDaysAgo);
    safeSetItem('cravingLogs', JSON.stringify(pruned));

    // Sync craving logs to cloud
    saveToCloud({
      cravingLogs: logs,
      moneySaved: totalMoneySaved,
      quitStreak: sessionCount,
      cigarettesAvoided: totalCigarettesAvoided,
      quitStartDate: quitStartDate,
      lastSessionDate: Date.now()
    });

    // Update end screen stats
    endTotalStat.textContent = '$' + Math.floor(totalMoneySaved);
    endCigsStat.textContent = totalCigarettesAvoided;

    // Build trigger list with time context
    buildEndTriggerList();

    // Show coping suggestion based on current trigger
    const copingEl = document.getElementById('end-coping');
    const copingTextEl = document.getElementById('end-coping-text');
    const copingTip = COPING_SUGGESTIONS[currentTriggerId];
    if (copingTip) {
      copingTextEl.textContent = copingTip;
      copingEl.style.display = 'block';
    } else {
      copingEl.style.display = 'none';
    }

    // Check for milestones
    const daysSinceStart = quitStartDate ? Math.floor((Date.now() - quitStartDate) / (24 * 60 * 60 * 1000)) : 0;
    checkMilestones(daysSinceStart);

    endScreen.classList.add('visible');
    gameState = 'end';
  }

  // Milestone definitions
  const MILESTONES = [
    { days: 1, title: '1 Day Smoke-Free!', desc: 'The hardest day is behind you.' },
    { days: 3, title: '3 Days Smoke-Free!', desc: 'Nicotine is leaving your body.' },
    { days: 7, title: '1 Week Smoke-Free!', desc: 'Your lungs are starting to heal.' },
    { days: 14, title: '2 Weeks Smoke-Free!', desc: 'Circulation improving.' },
    { days: 30, title: '1 Month Smoke-Free!', desc: 'Lung function increasing.' },
    { days: 90, title: '3 Months Smoke-Free!', desc: 'Heart disease risk dropping.' },
    { days: 365, title: '1 Year Smoke-Free!', desc: 'Heart disease risk halved.' },
  ];

  // Check and show milestones
  function checkMilestones(daysSinceStart) {
    const milestone = MILESTONES.find(m => m.days === daysSinceStart);
    if (!milestone) return;

    // Check if already shown
    const shown = safeGetItem('milestonesShown', '[]');
    const shownList = JSON.parse(shown);
    if (shownList.includes(milestone.days)) return;

    // Mark as shown
    shownList.push(milestone.days);
    safeSetItem('milestonesShown', JSON.stringify(shownList));

    // Show share card
    showMilestoneCard(milestone);
  }

  // Show milestone share card
  function showMilestoneCard(milestone) {
    const card = document.createElement('div');
    card.className = 'milestone-card-overlay';
    card.innerHTML = `
      <div class="milestone-card">
        <div class="milestone-emoji">🎉</div>
        <div class="milestone-title">${milestone.title}</div>
        <div class="milestone-desc">${milestone.desc}</div>
        <div class="milestone-stats">
          <div class="milestone-stat">
            <div class="milestone-stat-num">$${Math.floor(totalMoneySaved)}</div>
            <div class="milestone-stat-label">Saved</div>
          </div>
          <div class="milestone-stat">
            <div class="milestone-stat-num">${totalCigarettesAvoided}</div>
            <div class="milestone-stat-label">Real Cigs</div>
          </div>
        </div>
        <div class="milestone-brand">puff — your quit companion</div>
        <div class="milestone-actions">
          <button class="milestone-share" id="milestone-share">Share</button>
          <button class="milestone-close" id="milestone-close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(card);

    // Share button
    document.getElementById('milestone-share').addEventListener('click', async () => {
      try {
        // Generate share text
        const shareText = `${milestone.title}\n\n💰 $${Math.floor(totalMoneySaved)} saved\n🚬 ${totalCigarettesAvoided} real cigarettes avoided\n\npuff — your quit companion`;

        // Use Web Share API if available
        if (navigator.share) {
          await navigator.share({
            title: milestone.title,
            text: shareText,
          });
        } else {
          // Fallback: copy to clipboard
          await navigator.clipboard.writeText(shareText);
          alert('Copied to clipboard!');
        }
      } catch (e) {
        // User cancelled share
      }
    });

    // Close button
    document.getElementById('milestone-close').addEventListener('click', () => {
      card.remove();
    });
  }

  // Build trigger list with time context for end screen
  function buildEndTriggerList() {
    const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));

    // Count triggers and track time patterns
    const triggerData = {};
    logs.forEach(log => {
      const trigger = log.trigger || 'unknown';
      if (!triggerData[trigger]) {
        triggerData[trigger] = { count: 0, hours: [] };
      }
      triggerData[trigger].count++;
      if (log.time) {
        const hour = new Date(log.time).getHours();
        triggerData[trigger].hours.push(hour);
      }
    });

    // Sort by count descending
    const sorted = Object.entries(triggerData).sort((a, b) => b[1].count - a[1].count).slice(0, 5);

    // Trigger icons/labels
    const triggerIcons = {
      'stress': '😰', 'anxiety': '😬', 'sadness': '😔', 'anger': '😤', 'tired': '😴',
      'drinking': '🍺', 'coffee': '☕', 'meals': '🍽️', 'social': '🍻', 'workbreak': '💼',
      'toilet': '🚽', 'aftersex': '❤️', 'boredom': '😑',
      'morning': '🌅', 'latenight': '🌙', 'unknown': '🤷', 'other': '💭'
    };
    const triggerLabels = {
      'stress': 'Stress', 'anxiety': 'Anxiety', 'sadness': 'Sadness', 'anger': 'Anger', 'tired': 'Tired',
      'drinking': 'Drinking', 'coffee': 'Coffee', 'meals': 'After meals', 'social': 'Social drinking',
      'workbreak': 'Work break', 'toilet': 'Toilet', 'aftersex': 'After sex',
      'boredom': 'Boredom', 'morning': 'Morning routine', 'latenight': 'Late night',
      'unknown': 'Not sure', 'other': 'Other'
    };

    // Get time context from hour array
    function getTimeContext(hours) {
      if (!hours.length) return '';
      const avg = hours.reduce((a, b) => a + b, 0) / hours.length;
      if (avg >= 5 && avg < 9) return 'Early morning';
      if (avg >= 9 && avg < 12) return 'Mornings';
      if (avg >= 12 && avg < 14) return 'Lunch';
      if (avg >= 14 && avg < 18) return 'Afternoons';
      if (avg >= 18 && avg < 21) return 'Evenings';
      if (avg >= 21 || avg < 2) return 'Late night';
      return 'Nights';
    }

    // Build trigger rows
    endTriggerList.innerHTML = '';
    sorted.forEach(([trigger, data]) => {
      const icon = triggerIcons[trigger] || '📊';
      const label = triggerLabels[trigger] || trigger;
      const time = getTimeContext(data.hours);

      const row = document.createElement('div');
      row.className = 'end-trigger-row';
      row.innerHTML = `
        <span class="end-trigger-icon">${icon}</span>
        <span class="end-trigger-name">${label}</span>
        <span class="end-trigger-count">${data.count}</span>
        <span class="end-trigger-time">${time}</span>
      `;
      endTriggerList.appendChild(row);
    });
  }

  // Show idle screen
  // Idle screen removed — go directly to trigger selection
  function showIdleScreen() {
    const onboardingComplete = safeGetItem('onboardingComplete', 'false');
    if (onboardingComplete !== 'true') {
      showOnboarding();
      return;
    }
    gameState = 'idle';
  }

  // End screen button — go to trigger selection
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
  let _frameSkip = 0;
  function loop() {
    try {
      const now = performance.now();
      const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 1/60; // delta time in seconds
      lastFrameTime = now;

      // Throttle to 60fps on 120Hz+ displays when idle (not puffing)
      _frameSkip++;
      if (!holding && !ashDropping && _frameSkip % 2 !== 0) {
        if (loopRunning) loopFrameId = requestAnimationFrame(loop);
        return;
      }

      // Clean gradient cache periodically
      _maybeCleanGradCache();

      // Auto-save to localStorage every 10 seconds during gameplay
      // Only save confirmed totalMoneySaved (not partial session cost)
      if (started && !gameOver && now - _lastAutoSave > 10000) {
        _lastAutoSave = now;
        safeSetItem('moneySaved', String(totalMoneySaved));
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

        // Auto-burn + blow boost (delta-time based) — pause when menu is open
        const menuOpen = document.getElementById('menu-overlay').classList.contains('active');
        if (!menuOpen) {
          const burnRate = BASE_BURN_RATE + (puffing ? BLOW_BOOST * blowIntensity : 0);
          burnProgress = Math.min(1, burnProgress + burnRate * dt);
        }

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
        e.target.closest('.end-screen') ||
        e.target.closest('.trigger-screen')
      )) return;

      // Idle state — tap to start session
      if (gameState === 'idle' && !started) {
        showTriggerScreen();
        return;
      }

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
      e.target.closest('.end-screen') ||
      e.target.closest('.trigger-screen')
    )) return;

    // Only start hold when game is running
    if (started && !gameOver && (micStarted || touchOnlyMode)) {
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
      e.target.closest('.settings-screen') ||
      e.target.closest('.end-screen') ||
      e.target.closest('.trigger-screen')
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
    safeSetItem('quitStreak', '0');
    safeSetItem('moneySaved', '0');
    safeSetItem('cigarettesAvoided', '0');
    safeSetItem('quitStartDate', String(quitStartDate));
    safeSetItem('cravingLogs', '[]');
    safeSetItem('earnedBadges', '[]');
    saveToCloud({
      quitStreak: 0,
      moneySaved: 0,
      cigarettesAvoided: 0,
      quitStartDate: quitStartDate,
      cravingLogs: [],
      earnedBadges: []
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
    signinBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Signing in...';
    signinBtn.disabled = true;
    // Clear any previous error
    const errorDiv = document.querySelector('.signin-error');
    if (errorDiv) errorDiv.remove();
    signInWithGoogle().then(() => {
      // Success — mark consent, hide signin, go to trigger selection
      safeSetItem('consentGiven', 'true');
      markSignedIn();
      setTimeout(() => {
        document.getElementById('signin-screen').classList.add('hidden');
        showTriggerScreen();
      }, 800);
    }).catch(() => {
      // Error already displayed by showSigninError() — don't overwrite it
    });
  });

  // Mark Google button as signed in
  function markSignedIn() {
    const signinBtn = document.getElementById('signin-google');
    if (signinBtn) {
      signinBtn.innerHTML = '✓ Signed in with Google';
      signinBtn.disabled = true;
      signinBtn.style.background = 'rgba(52,168,83,0.1)';
      signinBtn.style.color = '#34A853';
      signinBtn.style.borderColor = 'rgba(52,168,83,0.2)';
    }
  }
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

    // Mouse drag to scroll on desktop
    let isDragging = false;
    let startX = 0;
    let scrollStart = 0;
    menuScrollWrap.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.pageX;
      scrollStart = menuScrollWrap.scrollLeft;
      menuScrollWrap.style.cursor = 'grabbing';
    });
    menuScrollWrap.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const dx = e.pageX - startX;
      menuScrollWrap.scrollLeft = scrollStart - dx;
    });
    menuScrollWrap.addEventListener('mouseup', () => {
      isDragging = false;
      menuScrollWrap.style.cursor = 'grab';
    });
    menuScrollWrap.addEventListener('mouseleave', () => {
      isDragging = false;
      menuScrollWrap.style.cursor = 'grab';
    });
    menuScrollWrap.style.cursor = 'grab';
  }

  // --- Settings Screen ---
  const settingsScreen = document.getElementById('settings-screen');
  const settingsBack = document.getElementById('settings-back');
  const settingsName = document.getElementById('settings-name');
  const settingsPrice = document.getElementById('settings-price');
  const settingsReset = document.getElementById('settings-reset');
  const settingsSignout = document.getElementById('settings-signout');
  const settingsPriceDisplay = document.getElementById('settings-price-display');
  const settingsNameDisplay = document.getElementById('settings-name-display');
  const menuSettings = document.getElementById('menu-settings');

  // Badges screen elements
  const badgesScreen = document.getElementById('badges-screen');
  const badgesBack = document.getElementById('badges-back');
  const badgesGrid = document.getElementById('badges-grid');
  const badgesSub = document.getElementById('badges-sub');

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
    settingsPriceDisplay.textContent = '$' + cigPrice.toFixed(2);

    // Update name display — check localStorage first, then Google account
    let userName = safeGetItem('userName', '');
    if (!userName && currentUser && currentUser.displayName) {
      userName = currentUser.displayName.split(' ')[0];
    }
    settingsNameDisplay.textContent = userName || 'Set name';
  }

  // Save settings to cloud + localStorage
  function saveSettings() {
    cigPrice = parseFloat(settingsPrice.value) || 0.50;
    const userName = settingsName.value.trim();
    saveToCloud({
      userName: userName,
      cigPrice: cigPrice,
      darkMode: isDark
    });
    settingsPriceDisplay.textContent = '$' + cigPrice.toFixed(2);
    // Show name or Google name or fallback
    const displayName = userName || (currentUser ? currentUser.displayName?.split(' ')[0] : '') || 'Set name';
    settingsNameDisplay.textContent = displayName;
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

  // Build badges grid
  function buildBadgesGrid() {
    const earned = JSON.parse(safeGetItem('earnedBadges', '[]'));
    badgesSub.textContent = earned.length + ' of ' + BADGES.length + ' earned';

    badgesGrid.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'badges-grid';

    BADGES.forEach(badge => {
      const isEarned = earned.includes(badge.id);
      const item = document.createElement('div');
      item.className = 'badge-item';
      item.innerHTML = `
        <div class="badge-item-icon ${isEarned ? 'earned' : ''}">${badge.emoji}</div>
        <div class="badge-item-name ${isEarned ? 'earned' : ''}">${badge.name}</div>
      `;
      item.addEventListener('click', () => {
        showBadgeDetail(badge, isEarned);
      });
      grid.appendChild(item);
    });

    badgesGrid.appendChild(grid);
  }

  // Show badge detail modal
  function showBadgeDetail(badge, isEarned) {
    const modal = document.createElement('div');
    modal.className = 'badge-modal visible';
    modal.innerHTML = `
      <div class="badge-modal-content">
        <div class="badge-modal-icon">${badge.emoji}</div>
        <div class="badge-modal-name">${badge.name}</div>
        <div class="badge-modal-desc">${badge.desc}</div>
        <div class="badge-modal-status ${isEarned ? 'earned' : ''}">${isEarned ? '✓ Earned' : '🔒 Locked'}</div>
        <button class="badge-modal-close">Close</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.badge-modal-close').addEventListener('click', () => {
      modal.remove();
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  // Back button for badges screen
  badgesBack.addEventListener('click', (e) => {
    e.stopPropagation();
    badgesScreen.classList.remove('visible');
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

  // Build weekly summary card
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

    // Trigger icons mapping
    const triggerIcons = {
      'stress': '😰', 'anxiety': '😬', 'sadness': '😔', 'anger': '😤', 'tired': '😴',
      'drinking': '🍺', 'coffee': '☕', 'meals': '🍽️', 'social': '🍻', 'workbreak': '💼',
      'toilet': '🚽', 'aftersex': '❤️', 'boredom': '😑',
      'morning': '🌅', 'latenight': '🌙', 'unknown': '🤷', 'other': '💭'
    };

    // Trigger labels mapping
    const triggerLabels = {
      'stress': 'Stress', 'anxiety': 'Anxiety', 'sadness': 'Sadness', 'anger': 'Anger', 'tired': 'Tired',
      'drinking': 'Drinking', 'coffee': 'Coffee', 'meals': 'After meals', 'social': 'Social drinking',
      'workbreak': 'Work break', 'toilet': 'Toilet', 'aftersex': 'After sex',
      'boredom': 'Boredom', 'morning': 'Morning routine', 'latenight': 'Late night',
      'unknown': 'Not sure', 'other': 'Other'
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

  // Open badges from menu
  const menuBadges = document.getElementById('menu-badges');
  menuBadges.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenu();
    buildBadgesGrid();
    history.pushState({screen:'badges'}, '');
    badgesScreen.classList.add('visible');
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
      const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

      if (firstName) {
        menuGreeting.innerHTML = '<div class="menu-greeting-text">Hi, ' + esc(firstName) + ' 👋</div>' +
          (email ? '<div class="menu-greeting-sub">' + esc(email) + '</div>' : '');
      } else if (email) {
        menuGreeting.innerHTML = '<div class="menu-greeting-text">' + esc(email) + '</div>';
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
  let isResetting = false;
  settingsReset.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm('This will erase all your progress, streak, and data. Are you sure?')) {
      isResetting = true;

      // Delete cloud data first if signed in
      if (currentUser) {
        try {
          await db.collection('user_data').doc(currentUser.uid).delete();
          // Also delete events
          const eventsSnapshot = await db.collection('events').where('uid', '==', currentUser.uid).get();
          const batch = db.batch();
          eventsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        } catch (err) {
          console.warn('Failed to delete cloud data:', err.message);
        }
      }

      // Clear app data keys only (preserve Firebase auth token)
      const appKeys = ['moneySaved', 'cigarettesAvoided', 'quitStreak', 'quitStartDate',
        'cravingLogs', 'earnedBadges', 'lastSessionDate', 'userName', 'cigPrice',
        'darkMode', 'onboardingComplete', 'consentGiven', 'offlineMode', 'lastAppOpen'];
      appKeys.forEach(key => localStorage.removeItem(key));
      location.reload();
    }
  });

  // Export data as CSV
  const settingsExport = document.getElementById('settings-export');
  settingsExport.addEventListener('click', (e) => {
    e.stopPropagation();

    const logs = JSON.parse(safeGetItem('cravingLogs', '[]'));
    const totalMoney = parseFloat(safeGetItem('moneySaved', '0'));
    const totalCigs = parseInt(safeGetItem('cigarettesAvoided', '0'));
    const sessions = parseInt(safeGetItem('quitStreak', '0'));
    const quitStart = parseInt(safeGetItem('quitStartDate', '0'));
    const earnedBadges = JSON.parse(safeGetItem('earnedBadges', '[]'));
    const price = parseFloat(safeGetItem('cigPrice', '0.50'));

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const triggerLabels = {
      'stress': 'Stress', 'anxiety': 'Anxiety', 'sadness': 'Sadness', 'anger': 'Anger', 'tired': 'Tired',
      'drinking': 'Drinking', 'coffee': 'Coffee', 'meals': 'After meals', 'social': 'Social drinking',
      'workbreak': 'Work break', 'toilet': 'Toilet', 'aftersex': 'After sex', 'boredom': 'Boredom',
      'morning': 'Morning routine', 'latenight': 'Late night', 'unknown': 'Not sure', 'other': 'Other'
    };

    // Summary section
    const summary = [
      '# Puff Export',
      '# Exported: ' + new Date().toISOString(),
      '# Cigarette Price: $' + price.toFixed(2),
      '# Total Saved: $' + totalMoney.toFixed(2),
      '# Real Cigarettes Avoided: ' + totalCigs,
      '# Total Sessions: ' + sessions,
      '# Quit Start: ' + (quitStart ? new Date(quitStart).toISOString() : 'N/A'),
      '# Badges Earned: ' + (earnedBadges.length ? earnedBadges.join(', ') : 'None'),
      ''
    ];

    // CSV header
    const header = 'date,time,day,hour,trigger_id,trigger_label,money_saved,session_number,cumulative_money,cumulative_cigs';

    // CSV rows
    let cumulativeMoney = 0;
    let cumulativeCigs = 0;
    const rows = logs.map((log, i) => {
      const d = new Date(log.time);
      const date = d.toISOString().split('T')[0];
      const time = d.toTimeString().slice(0, 5);
      const day = dayNames[d.getDay()];
      const hour = d.getHours();
      const triggerId = log.trigger || 'unknown';
      const triggerLabel = triggerLabels[triggerId] || triggerId;
      const money = (log.money || 0).toFixed(2);
      cumulativeMoney += log.money || 0;
      cumulativeCigs++;

      return `${date},${time},${day},${hour},${triggerId},${triggerLabel},${money},${i + 1},${cumulativeMoney.toFixed(2)},${cumulativeCigs}`;
    });

    const csv = summary.join('\n') + header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'puff-data-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
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
    touchOnlyMode = false;
    cleanupMic();

    // Calculate money based on how much was smoked
    sessionMoneySaved = burnProgress * CIG_PRICE();
    const isFullSession = burnProgress >= 1;
    if (sessionMoneySaved > 0) {
      totalMoneySaved += sessionMoneySaved;
      sessionCount++;
      if (isFullSession) totalCigarettesAvoided++;
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
      lastSessionDate: Date.now(),
      earnedBadges: JSON.parse(safeGetItem('earnedBadges', '[]'))
    });

    // Check for new badges
    checkBadges();
  }

  function savePartialProgress() {
    if (started && !gameOver && burnProgress > 0 && burnProgress < 1) {
      endSessionAndSave();
    }
  }

  window.addEventListener('beforeunload', savePartialProgress);

  // Online/offline status — idle screen removed, no indicator needed
  window.addEventListener('online', () => {});
  window.addEventListener('offline', () => {});

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

      // Resume AudioContext if suspended (iOS backgrounding)
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
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
