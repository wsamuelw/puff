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

  // Detect mobile (unused but kept for future reference)
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

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

  // Google sign-in — always use popup
  async function signInWithGoogle() {
    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const result = await auth.signInWithPopup(provider);
      currentUser = result.user;
      return result.user;
    } catch (e) {
      console.warn('Auth failed:', e.message);
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

  // Listen for auth state changes
  auth.onAuthStateChanged((user) => {
    currentUser = user;
    const signinScreen = document.getElementById('signin-screen');
    if (user) {
      signinScreen.classList.add('hidden');
      resetSigninButton();
      loadFromCloud();
      checkSlipUp();
    } else {
      signinScreen.classList.remove('hidden');
      resetSigninButton();
    }
  });

  // Save to Firestore (also saves to localStorage as offline cache)
  async function saveToCloud(data) {
    // Always save locally first
    Object.entries(data).forEach(([key, value]) => {
      safeSetItem(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    });
    safeSetItem('lastLocalSave', String(Date.now()));

    if (!currentUser) return;
    try {
      await db.collection('user_data').doc(currentUser.uid).set({
        data: data,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn('Cloud save failed:', e.message);
    }
  }

  // Load from Firestore — merge with local, don't blindly overwrite
  async function loadFromCloud() {
    if (!currentUser) return;
    try {
      const doc = await db.collection('user_data').doc(currentUser.uid).get();
      if (doc.exists) {
        const cloudData = doc.data().data;
        const cloudTime = doc.data().updated_at?.toMillis?.() || 0;
        const localTime = parseInt(safeGetItem('lastLocalSave', '0'));

        // If local data is newer, keep it — next saveToCloud will sync it up
        if (localTime > cloudTime) {
          console.log('Local data is newer than cloud, keeping local');
          return;
        }

        // Cloud is newer — apply to state
        if (cloudData.quitStreak !== undefined) streakCount = parseInt(cloudData.quitStreak) || 0;
        if (cloudData.moneySaved !== undefined) totalMoneySaved = parseFloat(cloudData.moneySaved) || 0;
        if (cloudData.cigarettesAvoided !== undefined) totalCigarettesAvoided = parseInt(cloudData.cigarettesAvoided) || 0;
        if (cloudData.quitStartDate !== undefined) quitStartDate = parseInt(cloudData.quitStartDate) || 0;
        if (cloudData.cigPrice !== undefined) cigPrice = parseFloat(cloudData.cigPrice) || 1;
        if (cloudData.dailyHabit !== undefined) dailyHabit = parseInt(cloudData.dailyHabit) || 15;
        if (cloudData.cravingLogs) {
          // Merge craving logs — keep entries from both sources
          const localLogs = safeGetItem('cravingLogs', '[]');
          try {
            const localArr = JSON.parse(localLogs);
            const cloudArr = cloudData.cravingLogs || [];
            const merged = [...localArr, ...cloudArr];
            const seen = new Set();
            cravingLogs = merged.filter(log => {
              const key = log.time + log.trigger;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          } catch {
            cravingLogs = cloudData.cravingLogs;
          }
        }
        if (cloudData.lastSessionDate !== undefined) lastSessionDate = parseInt(cloudData.lastSessionDate) || 0;
        if (cloudData.darkMode !== undefined) {
          isDark = cloudData.darkMode !== 'false';
          applyTheme();
        }
        // Also save to localStorage for offline access
        Object.entries(cloudData).forEach(([key, value]) => {
          safeSetItem(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        });
        safeSetItem('lastLocalSave', String(Date.now()));
        updateStatsDisplay();
      }
    } catch (e) {
      console.warn('Cloud load failed, using local:', e.message);
    }
  }

  // --- State ---
  let dpr = window.devicePixelRatio || 1;
  let W, H;
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

  // Streak persistence
  let streakCount = parseInt(safeGetItem('quitStreak', '0'));
  let gameStartTime = 0;
  let completionFrame = 0;

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

  // Onboarding hints
  let ashHintShown = false;
  let ashHintAlpha = 0;

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

    // Realistic proportions: total ~85mm, filter ~30mm (35%), paper ~55mm (65%)
    CIG.bodyLength = H * 0.38;                    // paper section
    CIG.filterHeight = CIG.bodyLength * 0.38;     // filter = 38% of paper (realistic)
    CIG.fullWidth = Math.min(W * 0.075, 28);      // slender diameter
    CIG.tipRadius = CIG.fullWidth / 2;
  }
  window.addEventListener('resize', resize);
  resize();

  // --- Mic ---
  async function startMic() {
    if (micStarted) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

      // Ember hum — warm low-frequency tone
      try {
        const humOsc = audioCtx.createOscillator();
        humOsc.type = 'sine';
        humOsc.frequency.value = 120;
        const humFilter = audioCtx.createBiquadFilter();
        humFilter.type = 'lowpass';
        humFilter.frequency.value = 300;
        crackleGain = audioCtx.createGain();
        crackleGain.gain.value = 0;
        humOsc.connect(humFilter);
        humFilter.connect(crackleGain);
        crackleGain.connect(audioCtx.destination);
        humOsc.start();

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
      return false;
    }
  }

  // Cleanup mic and audio when game ends or page unloads
  function cleanupMic() {
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
  const FILTER_Y = () => H * 0.617; // fixed filter position
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
    const grad = ctx.createLinearGradient(x - CIG.tipRadius, filterY, x + CIG.tipRadius, filterY);
    grad.addColorStop(0, '#a06820');
    grad.addColorStop(0.3, '#c87a2a');
    grad.addColorStop(0.5, '#d4943a');
    grad.addColorStop(0.7, '#c87a2a');
    grad.addColorStop(1, '#a06820');
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

  function drawCompletion() {
    completionFrame++;

    // Dark overlay
    ctx.fillStyle = isDark ? 'rgba(26,26,26,0.95)' : 'rgba(250,249,247,0.95)';
    ctx.fillRect(0, 0, W, H);

    // Big animated number — cigarettes avoided
    const numScale = Math.min(1, completionFrame / 30);
    const displayCount = Math.floor(totalCigarettesAvoided * numScale);

    ctx.save();
    ctx.translate(W / 2, H * 0.22);
    ctx.scale(numScale, numScale);
    ctx.fillStyle = isDark ? '#faf9f7' : '#1a1a1a';
    ctx.font = `${Math.min(W * 0.18, 72)}px 'Libre Baskerville', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayCount, 0, 0);
    ctx.restore();

    // Label
    const labelAlpha = Math.min(1, Math.max(0, (completionFrame - 20) / 20));
    ctx.globalAlpha = labelAlpha;
    ctx.fillStyle = isDark ? 'rgba(250,249,247,0.4)' : 'rgba(26,26,26,0.4)';
    ctx.font = `${Math.min(W * 0.032, 13)}px 'Outfit', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('CIGARETTES AVOIDED', W / 2, H * 0.22 + Math.min(W * 0.1, 42) + 12);

    // Money saved card
    const cardAlpha = Math.min(1, Math.max(0, (completionFrame - 35) / 20));
    ctx.globalAlpha = cardAlpha;
    const cardW = Math.min(W * 0.75, 280);
    const cardH = 160;
    const cardX = W / 2 - cardW / 2;
    const cardY = H * 0.34;

    // Card background
    ctx.fillStyle = 'rgba(76,175,80,0.1)';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(76,175,80,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Money amount
    ctx.fillStyle = '#4caf50';
    ctx.font = `300 ${Math.min(W * 0.09, 36)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('$' + totalMoneySaved.toFixed(2), W / 2, cardY + 35);

    // Money label
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${Math.min(W * 0.028, 11)}px -apple-system, sans-serif`;
    ctx.fillText('TOTAL SAVED', W / 2, cardY + 52);

    // Divider line
    ctx.strokeStyle = 'rgba(76,175,80,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 20, cardY + 68);
    ctx.lineTo(cardX + cardW - 20, cardY + 68);
    ctx.stroke();

    // "That's enough for" label
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${Math.min(W * 0.025, 10)}px -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText("THAT'S ENOUGH FOR", cardX + 20, cardY + 84);

    // "Could buy" items
    const couldBuy = getCouldBuyItems(totalMoneySaved);
    const itemStartY = cardY + 102;
    const itemSpacing = 18;
    couldBuy.slice(0, 3).forEach((item, i) => {
      const y = itemStartY + i * itemSpacing;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `${Math.min(W * 0.03, 12)}px -apple-system, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(item.emoji + '  ', cardX + 20, y);
      ctx.fillStyle = '#4caf50';
      ctx.font = `600 ${Math.min(W * 0.03, 12)}px -apple-system, sans-serif`;
      const emojiWidth = ctx.measureText(item.emoji + '  ').width;
      ctx.fillText(item.quantity, cardX + 20 + emojiWidth, y);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `${Math.min(W * 0.03, 12)}px -apple-system, sans-serif`;
      const qtyWidth = ctx.measureText(item.quantity).width;
      ctx.fillText(' ' + item.text, cardX + 20 + emojiWidth + qtyWidth, y);
    });

    // Health status card
    const healthAlpha = Math.min(1, Math.max(0, (completionFrame - 50) / 20));
    ctx.globalAlpha = healthAlpha;
    const healthCardY = cardY + cardH + 16;
    const healthCardH = 80;

    // Health card background
    ctx.fillStyle = 'rgba(76,175,80,0.08)';
    ctx.beginPath();
    ctx.roundRect(cardX, healthCardY, cardW, healthCardH, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(76,175,80,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Health card title
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${Math.min(W * 0.025, 10)}px -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('YOUR BODY TODAY', cardX + 20, healthCardY + 18);

    // Health stats
    const healthStatus = getHealthStatus();
    if (healthStatus) {
      healthStatus.forEach((stat, i) => {
        const y = healthCardY + 38 + i * 16;
        ctx.font = `${Math.min(W * 0.035, 14)}px -apple-system, sans-serif`;
        ctx.fillText(stat.icon, cardX + 20, y);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `${Math.min(W * 0.03, 12)}px -apple-system, sans-serif`;
        ctx.fillText(stat.text + ' ', cardX + 42, y);
        ctx.fillStyle = '#4caf50';
        ctx.font = `600 ${Math.min(W * 0.03, 12)}px -apple-system, sans-serif`;
        const textWidth = ctx.measureText(stat.text + ' ').width;
        ctx.fillText(stat.state, cardX + 42 + textWidth, y);
      });
    }

    // Time survived
    const elapsed = Math.floor((performance.now() - gameStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeAlpha = Math.min(1, Math.max(0, (completionFrame - 50) / 20));
    ctx.globalAlpha = timeAlpha;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.min(W * 0.035, 14)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`Session time: ${mins}:${secs.toString().padStart(2, '0')}`, W / 2, H * 0.68);

    // Daily breakdown dots
    const daysAlpha = Math.min(1, Math.max(0, (completionFrame - 65) / 20));
    ctx.globalAlpha = daysAlpha;
    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const dayY = H * 0.74;
    days.forEach((day, i) => {
      const x = W / 2 + (i - 3) * 28;
      const destroyed = i < streakCount;
      ctx.fillStyle = destroyed ? '#4caf50' : 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.arc(x, dayY, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = destroyed ? '#fff' : 'rgba(255,255,255,0.3)';
      ctx.font = `bold ${Math.min(W * 0.025, 11)}px -apple-system, sans-serif`;
      ctx.fillText(day, x, dayY + 4);
    });

    // Button
    const btnAlpha = Math.min(1, Math.max(0, (completionFrame - 85) / 20));
    ctx.globalAlpha = btnAlpha;
    ctx.fillStyle = isDark ? '#faf9f7' : '#1a1a1a';
    ctx.beginPath();
    ctx.roundRect(W / 2 - 70, H * 0.82, 140, 44, 0);
    ctx.fill();
    ctx.fillStyle = isDark ? '#1a1a1a' : '#faf9f7';
    ctx.font = `${Math.min(W * 0.035, 14)}px 'Outfit', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('KEEP STREAK', W / 2, H * 0.82 + 27);

    ctx.globalAlpha = 1;
  }

  // Helper: "could buy" items based on total saved
  function getCouldBuyItems(amount) {
    const items = [
      { emoji: '☕', quantity: '1 coffee', text: 'at your local café', threshold: 5 },
      { emoji: '☕', quantity: '2 coffees', text: 'for you and a friend', threshold: 8 },
      { emoji: '🍕', quantity: '1 pizza', text: 'for movie night', threshold: 15 },
      { emoji: '🍕', quantity: '2 pizzas', text: 'for movie night', threshold: 25 },
      { emoji: '⛽', quantity: 'half a tank', text: 'of petrol', threshold: 35 },
      { emoji: '🎬', quantity: 'a movie ticket', text: 'at the cinema', threshold: 20 },
      { emoji: '🍺', quantity: 'a few beers', text: 'at the pub', threshold: 30 },
      { emoji: '🛒', quantity: 'a week of groceries', text: 'for one person', threshold: 50 },
      { emoji: '⛽', quantity: 'a full tank', text: 'of petrol', threshold: 70 },
      { emoji: '👟', quantity: 'a new pair of shoes', text: '', threshold: 100 },
      { emoji: '✈️', quantity: 'a weekend away', text: '', threshold: 200 },
      { emoji: '🎮', quantity: 'a new game console', text: '', threshold: 500 },
    ];
    // Return items that the user can afford, most expensive first
    const affordable = items.filter(item => amount >= item.threshold);
    return affordable.slice(-3).reverse(); // last 3 affordable, most expensive first
  }

  // Helper: get current health status based on quit duration
  function getHealthStatus() {
    if (!quitStartDate) return null;
    const elapsed = (Date.now() - quitStartDate) / 1000; // seconds
    const status = [];
    // Heart rate
    if (elapsed >= 20 * 60) status.push({ icon: '❤️', text: 'Heart rate', state: 'normal' });
    else status.push({ icon: '❤️', text: 'Heart rate', state: 'recovering' });
    // CO levels
    if (elapsed >= 12 * 3600) status.push({ icon: '🫁', text: 'CO levels', state: 'clearing' });
    else status.push({ icon: '🫁', text: 'CO levels', state: 'high' });
    // Circulation
    if (elapsed >= 90 * 24 * 3600) status.push({ icon: '🩸', text: 'Circulation', state: 'restored' });
    else if (elapsed >= 48 * 3600) status.push({ icon: '🩸', text: 'Circulation', state: 'improving' });
    else status.push({ icon: '🩸', text: 'Circulation', state: 'poor' });
    return status;
  }

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
  function loop() {
    try {
      const now = performance.now();
      const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 1/60; // delta time in seconds
      lastFrameTime = now;

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
          gameOver = true;
          cleanupMic(); // release mic and audio when cigarette finishes
          // Increment streak and save
          streakCount++;
          // Update money saved
          totalMoneySaved += CIG_PRICE();
          totalCigarettesAvoided++;
          sessionMoneySaved = CIG_PRICE();
          // Set quit start date if not already set
          if (!quitStartDate) {
            quitStartDate = Date.now();
          }
          // Save to cloud + localStorage
          saveToCloud({
            quitStreak: streakCount,
            moneySaved: totalMoneySaved,
            cigarettesAvoided: totalCigarettesAvoided,
            quitStartDate: quitStartDate,
            lastSessionDate: Date.now()
          });
          completionFrame = 0;
        }
      }

      const cigTopY = getCigTopY();

      // Draw
      drawCigarette(cigTopY);
      drawAsh(cigTopY);
      drawEmber(cigTopY);

      // Update HTML stats display
      updateStatsDisplay();

      // Onboarding hint — show when ash becomes visible
      if (ashHeight > 10 && !ashHintShown && started && !gameOver) {
        ashHintAlpha = Math.min(1, ashHintAlpha + 0.02);
        if (ashHintAlpha >= 1) {
          ashHintShown = true;
          setTimeout(() => { ashHintAlpha = 0; }, 3000);
        }
      }
      // Ash hint removed

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

      if (gameOver) drawCompletion();

      ctx.restore(); // undo shake translation

    } catch (e) {
      console.error(e);
    }
    // Stop loop when game is over and completion animation is done
    if (gameOver && completionFrame > 120) {
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
        e.target.closest('.signin-screen')
      )) return;

      // Game over → restart
      if (gameOver) {
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
        completionFrame = 0;
        ashHintShown = false;
        ashHintAlpha = 0;
        sessionMoneySaved = 0;
        // Restart mic and loop (cancel pending frame + ash timeout)
        if (loopFrameId) cancelAnimationFrame(loopFrameId);
        if (ashDropTimeout) { clearTimeout(ashDropTimeout); ashDropTimeout = null; }
        loopRunning = true;
        const ok = await startMic();
        if (ok) {
          started = true;
          gameStartTime = performance.now();
        }
        loopFrameId = requestAnimationFrame(loop);
        return;
      }

      // First tap → request mic
      if (!micStarted) {
        const ok = await startMic();
        if (ok) {
          started = true;
          gameStartTime = performance.now();
        }
        return;
      }

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
      e.target.closest('.settings-screen')
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
  }

  // Apply theme on load
  applyTheme();

  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanupMic);



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
      return;
    }

    const now = Date.now();
    const gapMs = now - lastSessionDate;
    const gapHours = gapMs / (1000 * 60 * 60);

    // Update last session date
    lastSessionDate = now;
    saveToCloud({ lastSessionDate: lastSessionDate });

    // No gap — normal flow
    if (gapHours < 24) return;

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
    slipupWelcome.classList.remove('active');
  });
  slipupStartFresh.addEventListener('click', (e) => {
    e.stopPropagation();
    // Reset streak but keep money and cigarettes
    streakCount = 0;
    quitStartDate = Date.now();
    saveToCloud({ quitStreak: 0, quitStartDate: quitStartDate });
    slipupWelcome.classList.remove('active');
  });
  slipupStartAgain.addEventListener('click', (e) => {
    e.stopPropagation();
    slipupRelapse.classList.remove('active');
  });
  slipupReset.addEventListener('click', (e) => {
    e.stopPropagation();
    // Reset everything
    streakCount = 0;
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
  const menuClose = document.getElementById('menu-close');

  function closeMenu() {
    menuOverlay.classList.remove('active');
  }

  // Menu pill below cigarette opens menu
  const menuPill = document.getElementById('menu-pill');
  menuPill.addEventListener('click', (e) => {
    e.stopPropagation();
    updateMenuUserInfo();
    history.pushState({screen:'menu'}, '');
    menuOverlay.classList.add('active');
  });

  menuClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenu();
  });

  menuOverlay.addEventListener('click', (e) => {
    if (e.target === menuOverlay) closeMenu();
  });

  // Swipe-down to dismiss menu
  let menuDragStartY = 0;
  let menuDragging = false;
  const menuContent = document.querySelector('.menu-content');
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
      }
      menuContent.style.transform = '';
    }
    menuDragging = false;
  }, { passive: true });

  // --- Settings Screen ---
  const settingsScreen = document.getElementById('settings-screen');
  const settingsBack = document.getElementById('settings-back');
  const settingsName = document.getElementById('settings-name');
  const settingsPrice = document.getElementById('settings-price');
  const settingsPackSize = document.getElementById('settings-pack-size');
  const settingsDaily = document.getElementById('settings-daily');
  const settingsShowStats = document.getElementById('settings-show-stats');
  const settingsReset = document.getElementById('settings-reset');
  const settingsTotalSaved = document.getElementById('settings-total-saved');
  const menuSettings = document.getElementById('menu-settings');

  // Load settings from localStorage
  function loadSettings() {
    settingsName.value = safeGetItem('userName', '');
    settingsPrice.value = cigPrice;
    settingsPackSize.value = safeGetItem('packSize', '20');
    settingsDaily.value = safeGetItem('dailyHabit', '15');
    settingsShowStats.classList.toggle('active', safeGetItem('showStats', 'true') === 'true');
    settingsDarkMode.classList.toggle('active', isDark);
    settingsTotalSaved.textContent = '$' + totalMoneySaved.toFixed(2);
  }

  // Save settings to cloud + localStorage
  function saveSettings() {
    cigPrice = parseFloat(settingsPrice.value) || 1;
    const showStats = settingsShowStats.classList.contains('active');
    saveToCloud({
      userName: settingsName.value.trim(),
      cigPrice: cigPrice,
      packSize: settingsPackSize.value || '20',
      dailyHabit: settingsDaily.value || '15',
      showStats: showStats,
      darkMode: isDark
    });
    // Show/hide stats display
    if (showStats && started && !gameOver) {
      barStats.classList.add('visible');
    } else {
      barStats.classList.remove('visible');
    }
  }

  // Open settings from menu
  menuSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenu();
    loadSettings();
    history.pushState({screen:'settings'}, '');
    settingsScreen.classList.add('visible');
  });

  // Sign-out button
  const menuSignout = document.getElementById('menu-signout');
  const menuUserInfo = document.getElementById('menu-user-info');
  menuSignout.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenu();
    signOut();
  });

  // Update user info when menu opens
  function updateMenuUserInfo() {
    if (currentUser) {
      const name = currentUser.displayName;
      menuUserInfo.textContent = name ? name.split(' ')[0] : currentUser.email;
      menuSignout.style.display = 'block';
    } else {
      menuUserInfo.textContent = '';
      menuSignout.style.display = 'none';
    }
  }

  // Back button
  settingsBack.addEventListener('click', (e) => {
    e.stopPropagation();
    saveSettings();
    settingsScreen.classList.remove('visible');
  });

  // Toggle show stats
  settingsShowStats.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsShowStats.classList.toggle('active');
  });

  // Toggle dark mode (in settings)
  const settingsDarkMode = document.getElementById('settings-dark-mode');
  settingsDarkMode.addEventListener('click', (e) => {
    e.stopPropagation();
    isDark = !isDark;
    applyTheme();
    saveToCloud({ darkMode: isDark });
  });

  // Reset all data
  settingsReset.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm('This will erase all your progress, streak, and data. Are you sure?')) {
      localStorage.clear();
      location.reload();
    }
  });

  // Auto-save on input change
  [settingsName, settingsPrice, settingsPackSize, settingsDaily].forEach(el => {
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
  function savePartialProgress() {
    if (started && !gameOver && burnProgress > 0 && burnProgress < 1) {
      const partial = burnProgress * CIG_PRICE();
      totalMoneySaved += partial;
      burnProgress = 0;
      gameOver = true;
      saveToCloud({ moneySaved: totalMoneySaved });
    }
  }

  window.addEventListener('beforeunload', savePartialProgress);

  // Pause loop when app is in background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      savePartialProgress();
      loopRunning = false;
      if (loopFrameId) cancelAnimationFrame(loopFrameId);
    } else if (!gameOver && started) {
      loopRunning = true;
      lastFrameTime = 0;
      loopFrameId = requestAnimationFrame(loop);
    }
  });

  // --- History management for iOS swipe-back ---
  function closeActiveScreen() {
    if (settingsScreen.classList.contains('visible')) {
      settingsScreen.classList.remove('visible');
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

  // --- Keyboard avoidance for settings inputs ---
  document.querySelectorAll('.settings-input').forEach(input => {
    input.addEventListener('focus', () => {
      setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    });
  });

  loop();
})();
