(() => {
  const PASSWORD = "0511";
  let pin = "";
  let userName = "나";

  const nameView = document.getElementById("nameView");
  const lockView = document.getElementById("lockView");
  const passcodeView = document.getElementById("passcodeView");
  const homeView = document.getElementById("homeView");
  const passDots = document.getElementById("passDots");
  const keypad = document.getElementById("keypad");
  const homeIndicator = document.getElementById("homeIndicator");
  const userNameInput = document.getElementById("userNameInput");
  const nameStartBtn = document.getElementById("nameStartBtn");

  const views = [
    nameView,
    lockView,
    passcodeView,
    homeView,
    ...document.querySelectorAll(".app-view"),
  ];

  function showView(view) {
    views.forEach((v) => v.classList.remove("active"));
    view.classList.add("active");
  }

  let husbandCallTimer = null;
  let husbandCallTriggered = false;
  let husbandCallCompleted = false;
  let callAudio = null;
  let callBedAudio = null;
  let callAudioCtx = null;
  let callGainNode = null;
  let callSourceNode = null;
  let callBufferSource = null;
  let callAudioBufferCache = Object.create(null);
  let callStepTimer = null;
  let callConnectTimer = null;
  let callTimerInterval = null;
  let callElapsedSec = 0;
  let callSequenceBusy = false;
  let activeCallIsHusband = false;
  let husbandMaxTimer = null;
  /** Accept 탭에서 동기 play() 한 첫 클립 — endActiveCall 이 끊지 않도록 */
  let gesturePrimedSrc = null;
  let gesturePlayToken = 0;

  /* 통화스크립트.txt 순서 — 파일은 업로드본을 증폭해 assets/call 에 배치 */
  const HUSBAND_CALL_SEQUENCE = [
    { type: "audio", src: "assets/call/01_working.wav" }, // 지금 일하고 있나
    { type: "subtitle", text: "응. 미안해. 늦어지네. 여보는 뭐해.", ms: 3200 },
    { type: "audio", src: "assets/call/02_lying.wav" }, // 누워있어
    { type: "subtitle", text: "시우는? 자?", ms: 2200 },
    { type: "audio", src: "assets/call/03_ung.wav" }, // 웅/음
    { type: "subtitle", text: "혼자 보느라 힘들었지.", ms: 2600 },
    { type: "audio", src: "assets/call/04_notbad.wav" }, // 나쁘지 않았어요
    { type: "subtitle", text: "또 애 놀리다가 울린건 아니지?", ms: 3000 },
    { type: "audio", src: "assets/call/05_hehe.wav" }, // 흐흐흐
    { type: "subtitle", text: "에휴. 얼른 끝내고 가야겠네.", ms: 2800 },
    { type: "audio", src: "assets/call/06_fighting.wav" }, // 화이팅
    { type: "audio", src: "assets/call/07_saranghae.wav" }, // 사랑해
    { type: "subtitle", text: "난 별루.", ms: 2000 },
    { type: "audio", src: "assets/call/08_whisper.wav" }, // 사랑해(속삭임)
  ];

  const YUSHI_CALL_SEQUENCE = [
    { type: "audio", src: "assets/call/yushi_01_ee.wav" },
    { type: "audio", src: "assets/call/yushi_02_hello.wav" },
  ];

  let activeCallSequence = HUSBAND_CALL_SEQUENCE;
  let activeCallOnComplete = null;

  function clearHusbandCallTimer() {
    if (husbandCallTimer) {
      clearTimeout(husbandCallTimer);
      husbandCallTimer = null;
    }
  }

  function hideIncomingCall() {
    clearHusbandCallTimer();
    const callEl = document.getElementById("incomingCall");
    if (callEl) {
      callEl.classList.add("hidden");
      callEl.setAttribute("aria-hidden", "true");
    }
  }

  function formatCallTimer(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function hideCallSubtitle() {
    const el = document.getElementById("callSubtitle");
    if (!el) return;
    el.classList.add("hidden");
    el.textContent = "";
  }

  function showCallSubtitle(text) {
    const el = document.getElementById("callSubtitle");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("hidden");
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }

  function getSharedCallAudio() {
    if (callAudio && callAudio.tagName === "AUDIO") return callAudio;
    let el = document.getElementById("sharedCallAudio");
    if (!el) {
      el = document.createElement("audio");
      el.id = "sharedCallAudio";
      el.preload = "auto";
      el.playsInline = true;
      el.setAttribute("playsinline", "true");
      el.setAttribute("webkit-playsinline", "true");
      el.setAttribute("x-webkit-airplay", "deny");
      el.controls = false;
      el.style.cssText = "position:fixed;width:0;height:0;opacity:0;pointer-events:none;";
      document.body.appendChild(el);
    }
    callAudio = el;
    return el;
  }

  function ensureCallAudioCtx() {
    if (!callAudioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) callAudioCtx = new Ctx();
    }
    if (callAudioCtx?.state === "suspended") {
      callAudioCtx.resume().catch(() => {});
    }
    return callAudioCtx;
  }

  /** 클릭 핸들러 안에서 동기 호출 — iOS Safari 오디오 잠금 해제 */
  function unlockCallAudio() {
    const a = getSharedCallAudio();
    ensureCallAudioCtx();
    try {
      a.muted = true;
      a.volume = 0;
      if (!a.src || !String(a.src).includes("silence.wav")) {
        a.src = "assets/call/silence.wav";
      }
      const p = a.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          try {
            a.pause();
            a.currentTime = 0;
          } catch (_) {}
          a.muted = false;
          a.volume = 1;
        }).catch(() => {
          a.muted = false;
          a.volume = 1;
        });
      } else {
        a.muted = false;
        a.volume = 1;
      }
    } catch (_) {
      a.muted = false;
      a.volume = 1;
    }
  }

  /**
   * Accept 등 사용자 제스처 스택에서 첫 클립을 즉시 play().
   * startActiveCall → endActiveCall 이 이 재생을 끊지 않도록 gesturePrimedSrc 설정.
   */
  function primeCallAudioFromGesture(src) {
    if (!src) return;
    const a = getSharedCallAudio();
    gesturePlayToken += 1;
    gesturePrimedSrc = src;
    a.onended = null;
    a.onerror = null;
    a.muted = false;
    a.volume = 1;
    try {
      a.pause();
    } catch (_) {}
    a.src = src;
    try {
      a.load();
    } catch (_) {}
    const playAttempt = a.play();
    if (playAttempt && typeof playAttempt.catch === "function") {
      playAttempt.catch(() => {
        /* playCallSequence 가 다시 시도 */
      });
    }
  }

  function stopCallBufferSource() {
    try {
      callBufferSource?.stop();
    } catch (_) {}
    try {
      callBufferSource?.disconnect();
    } catch (_) {}
    callBufferSource = null;
  }

  function loadCallBuffer(src) {
    if (callAudioBufferCache[src]) return Promise.resolve(callAudioBufferCache[src]);
    const ctx = ensureCallAudioCtx();
    if (!ctx) return Promise.reject(new Error("no audio ctx"));
    return fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`audio fetch ${res.status}`);
        return res.arrayBuffer();
      })
      .then((arr) => ctx.decodeAudioData(arr.slice(0)))
      .then((decoded) => {
        callAudioBufferCache[src] = decoded;
        return decoded;
      });
  }

  function disconnectCallAudioGraph() {
    stopCallBufferSource();
    try {
      callSourceNode?.disconnect();
    } catch (_) {}
    try {
      callGainNode?.disconnect();
    } catch (_) {}
    callSourceNode = null;
    callGainNode = null;
  }

  function audioSrcMatches(el, src) {
    if (!el || !src) return false;
    const cur = el.currentSrc || el.src || "";
    if (!cur) return false;
    if (cur === src) return true;
    try {
      return cur === new URL(src, location.href).href || cur.endsWith(src.replace(/^\.\//, ""));
    } catch (_) {
      return String(cur).includes(src.split("/").pop());
    }
  }

  function stopCallBed() {
    if (!callBedAudio) return;
    callBedAudio.onended = null;
    callBedAudio.pause();
    try {
      callBedAudio.currentTime = 0;
    } catch (_) {}
  }

  function startCallBed() {
    /* 배경음 사용 안 함 */
  }

  function clearHusbandMaxTimer() {
    if (husbandMaxTimer) {
      clearTimeout(husbandMaxTimer);
      husbandMaxTimer = null;
    }
  }

  function stopCallPlayback(options = {}) {
    const preserveGesture = !!options.preserveGesture && !!gesturePrimedSrc;
    callSequenceBusy = false;
    activeCallOnComplete = null;
    clearHusbandMaxTimer();
    if (callStepTimer) {
      clearTimeout(callStepTimer);
      callStepTimer = null;
    }
    if (callConnectTimer) {
      clearTimeout(callConnectTimer);
      callConnectTimer = null;
    }
    if (callAudio && !preserveGesture) {
      callAudio.onended = null;
      callAudio.onerror = null;
      try {
        callAudio.pause();
      } catch (_) {}
      // iOS: src 비우면 다음 play 권한도 날아갈 수 있어 유지. pause만.
    }
    if (!preserveGesture) gesturePrimedSrc = null;
    stopCallBed();
    disconnectCallAudioGraph();
    hideCallSubtitle();
  }

  function stopActiveCallTimer() {
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
    callElapsedSec = 0;
    const timerEl = document.getElementById("activeCallTimer");
    if (timerEl) timerEl.textContent = "00:00";
  }

  function endActiveCall(options = {}) {
    activeCallOnComplete = null;
    activeCallIsHusband = false;
    callEnding = false;
    stopCallPlayback(options);
    stopActiveCallTimer();
    const active = document.getElementById("activeCall");
    if (active) {
      active.classList.add("hidden");
      active.setAttribute("aria-hidden", "true");
    }
  }

  let callEnding = false;

  function showCallEndedThenHangup() {
    const active = document.getElementById("activeCall");
    if (!active || active.classList.contains("hidden") || callEnding) return;
    callEnding = true;
    const banner = document.getElementById("callEndedBanner");
    const timerEl = document.getElementById("activeCallTimer");
    const controls = document.querySelector(".active-call-controls");
    clearHusbandMaxTimer();
    callSequenceBusy = false;
    activeCallOnComplete = null;
    stopCallBed();
    if (callAudio) {
      callAudio.onended = null;
      callAudio.onerror = null;
      callAudio.pause();
    }
    if (callStepTimer) {
      clearTimeout(callStepTimer);
      callStepTimer = null;
    }
    hideCallSubtitle();
    stopActiveCallTimer();
    if (timerEl) {
      timerEl.textContent = "통화 종료";
      timerEl.classList.add("call-ended-text");
    }
    banner?.classList.add("hidden");
    controls?.classList.add("dimmed");
    setTimeout(() => {
      timerEl?.classList.remove("call-ended-text");
      controls?.classList.remove("dimmed");
      callEnding = false;
      endActiveCall();
    }, 1600);
  }

  function finishCallSequence() {
    hideCallSubtitle();
    callSequenceBusy = false;
    const done = activeCallOnComplete;
    activeCallOnComplete = null;
    const settleMs = activeCallIsHusband ? 2000 : 250;
    if (typeof done === "function") {
      setTimeout(() => done(), settleMs);
    }
  }

  function playCallSequence(index = 0) {
    if (!callSequenceBusy) return;
    if (index >= activeCallSequence.length) {
      finishCallSequence();
      return;
    }

    const step = activeCallSequence[index];
    const next = () => {
      if (!callSequenceBusy) return;
      if (index + 1 >= activeCallSequence.length) {
        finishCallSequence();
        return;
      }
      callStepTimer = setTimeout(() => {
        callStepTimer = null;
        playCallSequence(index + 1);
      }, 300);
    };

    if (step.type === "subtitle") {
      showCallSubtitle(step.text);
      callStepTimer = setTimeout(() => {
        callStepTimer = null;
        hideCallSubtitle();
        next();
      }, step.ms || 2500);
      return;
    }

    hideCallSubtitle();
    disconnectCallAudioGraph();

    const a = getSharedCallAudio();
    const bindEnded = () => {
      a.onended = () => next();
      a.onerror = () => next();
    };

    // Accept 제스처에서 이미 재생 중이면 핸들러만 연결 (절대 pause/재load 금지)
    if (gesturePrimedSrc === step.src) {
      const primedOk = audioSrcMatches(a, step.src) && !a.paused;
      gesturePrimedSrc = null;
      if (primedOk) {
        bindEnded();
        return;
      }
    }

    // 같은 요소로 src만 바꿔 연속 재생 (iOS는 요소 재사용이 중요)
    const playViaHtmlAudio = () => {
      const el = getSharedCallAudio();
      el.onended = null;
      el.onerror = null;
      el.muted = false;
      el.volume = 1;
      if (!audioSrcMatches(el, step.src) || el.ended || el.paused) {
        try {
          el.pause();
        } catch (_) {}
        el.src = step.src;
        try {
          el.load();
        } catch (_) {}
      }
      bindEnded();
      const p = el.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          // HTMLAudio 실패 시 Web Audio 버퍼로 한 번 더
          const ctx = ensureCallAudioCtx();
          if (!ctx) {
            next();
            return;
          }
          loadCallBuffer(step.src)
            .then((buffer) => {
              if (!callSequenceBusy) return;
              stopCallBufferSource();
              const srcNode = ctx.createBufferSource();
              callBufferSource = srcNode;
              srcNode.buffer = buffer;
              srcNode.connect(ctx.destination);
              srcNode.onended = () => {
                if (callBufferSource === srcNode) callBufferSource = null;
                next();
              };
              const start = () => {
                try {
                  srcNode.start(0);
                } catch (_) {
                  next();
                }
              };
              if (ctx.state === "suspended") {
                ctx.resume().then(start).catch(() => next());
              } else {
                start();
              }
            })
            .catch(() => next());
        });
      }
    };

    playViaHtmlAudio();
  }

  function setActiveCallVisuals({ name, poster, initial }) {
    const active = document.getElementById("activeCall");
    const nameEl = document.getElementById("activeCallName");
    const blur = document.getElementById("activeCallBlur");
    const posterEl = document.getElementById("activeCallPoster");
    const fallback = document.getElementById("activeCallFallback");
    const initialEl = document.getElementById("activeCallInitial");

    if (nameEl) nameEl.textContent = name || "";

    if (poster) {
      active?.classList.add("has-poster");
      if (blur) {
        blur.src = poster;
        blur.classList.add("hidden");
      }
      if (posterEl) {
        posterEl.src = poster;
        posterEl.classList.remove("hidden");
      }
      fallback?.classList.add("hidden");
      return;
    }

    active?.classList.remove("has-poster");
    blur?.classList.add("hidden");
    posterEl?.classList.add("hidden");
    if (fallback) fallback.classList.remove("hidden");
    if (initialEl) initialEl.textContent = initial || (name ? name[0] : "?");
  }

  function beginCallTimer(timerEl) {
    callElapsedSec = 0;
    if (timerEl) timerEl.textContent = "00:00";
    callTimerInterval = setInterval(() => {
      callElapsedSec += 1;
      if (timerEl) timerEl.textContent = formatCallTimer(callElapsedSec);
      if (activeCallIsHusband && callElapsedSec >= 56) {
        husbandCallCompleted = true;
        showCallEndedThenHangup();
      }
    }, 1000);
  }

  function startActiveCall(options = {}) {
    const {
      name = "남편",
      poster = "assets/call/husband-call-hq.png",
      initial = "남",
      sequence = HUSBAND_CALL_SEQUENCE,
      connectingMs = 0,
      connectingLabel = "연결 중...",
      onComplete = null,
      isHusband = false,
    } = options;

    hideIncomingCall();
    // 제스처에서 이미 play() 한 클립이 있으면 끊지 않음
    endActiveCall({ preserveGesture: !!gesturePrimedSrc });
    ensureCallAudioCtx();

    activeCallIsHusband = !!isHusband;
    activeCallSequence = sequence;
    activeCallOnComplete = onComplete;
    setActiveCallVisuals({ name, poster, initial });

    const active = document.getElementById("activeCall");
    if (!active) return;
    active.classList.remove("hidden");
    active.setAttribute("aria-hidden", "false");

    const timerEl = document.getElementById("activeCallTimer");

    const begin = () => {
      beginCallTimer(timerEl);
      callSequenceBusy = true;
      playCallSequence(0);
      if (activeCallIsHusband) {
        clearHusbandMaxTimer();
        husbandMaxTimer = setTimeout(() => {
          husbandMaxTimer = null;
          if (!activeCallIsHusband) return;
          const activeNow = document.getElementById("activeCall");
          if (!activeNow || activeNow.classList.contains("hidden")) return;
          husbandCallCompleted = true;
          showCallEndedThenHangup();
        }, 56000);
      }
    };

    if (connectingMs > 0) {
      if (timerEl) timerEl.textContent = connectingLabel;
      callConnectTimer = setTimeout(() => {
        callConnectTimer = null;
        if (!document.getElementById("activeCall") || active.classList.contains("hidden")) return;
        begin();
      }, connectingMs);
      return;
    }

    begin();
  }

  function preloadHusbandCallAudio() {
    HUSBAND_CALL_SEQUENCE.forEach((step) => {
      if (step.type !== "audio" || !step.src) return;
      // HTMLAudio preload + 버퍼 캐시 (실패해도 무시)
      try {
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "audio";
        link.href = step.src;
        document.head.appendChild(link);
      } catch (_) {}
      loadCallBuffer(step.src).catch(() => {});
    });
  }

  function firstAudioSrc(sequence) {
    const step = sequence.find((s) => s.type === "audio" && s.src);
    return step ? step.src : null;
  }

  function startHusbandCall(options = {}) {
    if (husbandCallCompleted) return;
    // 모바일 Safari: 연결 지연 없이 제스처 직후 재생해야 소리가 남
    const connectingMs = options.connectingMs ?? 0;
    if (!gesturePrimedSrc) {
      const first = firstAudioSrc(HUSBAND_CALL_SEQUENCE);
      if (first) primeCallAudioFromGesture(first);
      else unlockCallAudio();
    }
    ensureCallAudioCtx();
    preloadHusbandCallAudio();
    startActiveCall({
      name: "남편",
      poster: "assets/call/husband-call-hq.png",
      initial: "남",
      sequence: HUSBAND_CALL_SEQUENCE,
      connectingMs,
      connectingLabel: "연결 중...",
      isHusband: true,
      onComplete: () => {
        husbandCallCompleted = true;
        showCallEndedThenHangup();
      },
    });
  }

  function startYushiCall() {
    if (!gesturePrimedSrc) {
      const first = firstAudioSrc(YUSHI_CALL_SEQUENCE);
      if (first) primeCallAudioFromGesture(first);
      else unlockCallAudio();
    }
    startActiveCall({
      name: "유우시",
      poster: null,
      initial: "유",
      sequence: YUSHI_CALL_SEQUENCE,
      connectingMs: 0,
      connectingLabel: "연결 중...",
      onComplete: () => showCallEndedThenHangup(),
    });
  }

  function goHome() {
    document.querySelectorAll(".chat-room").forEach((el) => el.classList.add("hidden"));
    document.getElementById("lightbox").classList.add("hidden");
    document.getElementById("profileSheet").classList.add("hidden");
    hideIncomingCall();
    endActiveCall();
    activeChatId = null;
    showView(homeView);
  }

  function updateBrideName() {
    const bride = userName && userName !== "나" ? userName : "신부";
    document.querySelectorAll("#brideName, #brideNameFoot").forEach((el) => {
      el.textContent = bride;
    });
  }

  function applyUserName(name) {
    userName = name && name.trim() ? name.trim() : "나";
    if (typeof kakaoProfiles !== "undefined" && kakaoProfiles.me) {
      kakaoProfiles.me.name = userName;
    }
    if (typeof renderKakaoFriends === "function") renderKakaoFriends();
    if (typeof renderKakaoChats === "function") renderKakaoChats();
    const contactMyName = document.getElementById("contactMyName");
    if (contactMyName) contactMyName.textContent = userName;
    const profileNameEl = document.getElementById("profileName");
    if (profileNameEl && activeProfileId === "me") profileNameEl.textContent = userName;
    updateBrideName();
  }

  function startWithName() {
    applyUserName(userNameInput.value);
    showView(lockView);
  }

  nameStartBtn.addEventListener("click", startWithName);
  userNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startWithName();
  });

  function updateClocks() {
    const now = new Date();
    const time = now.toLocaleTimeString("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    });
    document.querySelectorAll("[data-clock]").forEach((el) => {
      el.textContent = time;
    });
    document.getElementById("lockTime").textContent = time;
    document.getElementById("lockDate").textContent = now.toLocaleDateString("ko-KR", {
      month: "long",
      day: "numeric",
      weekday: "long",
    });
    const calWeekday = document.getElementById("calWeekday");
    const calDay = document.getElementById("calDay");
    if (calWeekday) {
      calWeekday.textContent = now.toLocaleDateString("ko-KR", { weekday: "short" });
    }
    if (calDay) {
      calDay.textContent = String(now.getDate());
    }
  }

  updateClocks();
  setInterval(updateClocks, 1000 * 30);

  let pendingUnlockAction = null;

  function goToPasscode() {
    pin = "";
    renderDots();
    showView(passcodeView);
  }

  function openHusbandChatFromLock() {
    const kakaoApp = document.getElementById("app-kakao");
    if (!kakaoApp) {
      showView(homeView);
      return;
    }
    renderKakaoFriends();
    renderKakaoChats();
    showView(kakaoApp);
    switchKakaoTab("chats");
    openChat("sion");
  }

  document.getElementById("lockKakaoNotif")?.addEventListener("click", (e) => {
    e.stopPropagation();
    pendingUnlockAction = "husbandChat";
    goToPasscode();
  });

  document.querySelectorAll("[data-go-passcode]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      pendingUnlockAction = null;
      goToPasscode();
    });
  });

  (() => {
    const sheet = document.getElementById("lockSheet");
    if (!sheet || !lockView) return;

    let dragging = false;
    let startY = 0;
    let offsetY = 0;
    let pointerId = null;

    const resetSheet = (immediate = false) => {
      sheet.classList.remove("unlocking");
      if (immediate) sheet.classList.remove("settling");
      else sheet.classList.add("settling");
      sheet.style.transform = "translate3d(0, 0, 0)";
      sheet.style.opacity = "1";
      sheet.style.filter = "brightness(1)";
      offsetY = 0;
    };

    const applyDrag = (dy) => {
      const lift = Math.max(0, dy);
      const progress = Math.min(1, lift / 220);
      offsetY = lift;
      sheet.classList.remove("settling", "unlocking");
      sheet.style.transform = `translate3d(0, ${-lift}px, 0) scale(${1 - progress * 0.035})`;
      sheet.style.opacity = String(1 - progress * 0.45);
      sheet.style.filter = `brightness(${1 + progress * 0.08})`;
    };

    const finishUnlock = () => {
      sheet.classList.remove("settling");
      sheet.classList.add("unlocking");
      sheet.style.transform = "translate3d(0, -118%, 0) scale(0.94)";
      sheet.style.opacity = "0";
      sheet.style.filter = "brightness(1.05)";
      setTimeout(() => {
        resetSheet(true);
        goToPasscode();
      }, 380);
    };

    const onPointerDown = (e) => {
      if (!lockView.classList.contains("active")) return;
      if (e.target.closest(".lock-btn, .lock-notif, #lockKakaoNotif, [data-go-passcode]")) return;
      dragging = true;
      pointerId = e.pointerId;
      startY = e.clientY;
      offsetY = 0;
      sheet.classList.remove("settling", "unlocking");
      try {
        lockView.setPointerCapture(e.pointerId);
      } catch (_) {}
    };

    const onPointerMove = (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const dy = startY - e.clientY;
      if (dy > 0) e.preventDefault();
      applyDrag(dy);
    };

    const onPointerUp = (e) => {
      if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
      dragging = false;
      pointerId = null;
      const threshold = Math.min(140, lockView.clientHeight * 0.18);
      if (offsetY >= threshold) finishUnlock();
      else resetSheet();
    };

    lockView.addEventListener("pointerdown", onPointerDown);
    lockView.addEventListener("pointermove", onPointerMove, { passive: false });
    lockView.addEventListener("pointerup", onPointerUp);
    lockView.addEventListener("pointercancel", onPointerUp);

    document.getElementById("unlockBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      if (offsetY < 8) finishUnlock();
    });
  })();

  document.getElementById("passCancel")?.addEventListener("click", () => {
    /* iOS 비상 전화 — 시뮬레이션에서는 유지 */
  });

  function renderDots() {
    [...passDots.children].forEach((dot, i) => {
      dot.classList.toggle("filled", i < pin.length);
    });
  }

  function checkPin() {
    if (pin === PASSWORD) {
      pin = "";
      renderDots();
      const action = pendingUnlockAction;
      pendingUnlockAction = null;
      if (action === "husbandChat") {
        openHusbandChatFromLock();
        return;
      }
      showView(homeView);
      return;
    }
    passDots.classList.add("shake");
    setTimeout(() => {
      passDots.classList.remove("shake");
      pin = "";
      renderDots();
    }, 400);
  }

  keypad.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-key]");
    if (!btn) return;
    const key = btn.dataset.key;
    if (key === "delete") {
      pin = pin.slice(0, -1);
      renderDots();
      return;
    }
    if (pin.length >= 4) return;
    pin += key;
    renderDots();
    if (pin.length === 4) setTimeout(checkPin, 120);
  });

  document.querySelectorAll("[data-app]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const appId = btn.dataset.app;
      const app = document.getElementById(`app-${appId}`);
      if (!app) return;
      if (appId === "kakao") renderKakaoFriends();
      showView(app);
    });
  });

  document.querySelectorAll("[data-home]").forEach((btn) => {
    btn.addEventListener("click", goHome);
  });

  homeIndicator.addEventListener("click", () => {
    if (nameView.classList.contains("active")) return;
    if (homeView.classList.contains("active")) {
      showView(lockView);
      return;
    }
    if (passcodeView.classList.contains("active")) {
      showView(lockView);
      return;
    }
    goHome();
  });

  /* ---------- KakaoTalk ---------- */
  const kakaoProfiles = {
    me: {
      name: "나",
      avatar: "assets/kakao/me.jfif",
    },
    sion: {
      name: "남편",
      avatar: "assets/kakao/sion.jfif",
      chatId: "sion",
    },
    daeyoung: {
      name: "김대영",
      avatar: "assets/kakao/daeyoung.jfif",
      chatId: "daeyoung",
    },
    yina: {
      name: "서이나",
      avatar: "assets/kakao/yina.jfif",
      chatId: "yina",
    },
    yushi: {
      name: "유우시",
      avatar: "",
      chatId: "yushi",
    },
    riku: {
      name: "리쿠",
      avatar: "assets/kakao/riku.jfif",
      chatId: "riku",
    },
    sakuya: {
      name: "사쿠야",
      avatar: "assets/kakao/sakuya.jfif",
      chatId: "sakuya",
    },
    ryo: {
      name: "료",
      avatar: "assets/kakao/ryo.jfif",
      chatId: "ryo",
    },
    mom: {
      name: "엄마",
      avatar: "assets/kakao/mom.jfif",
    },
    dad: {
      name: "아빠",
      avatar: "",
    },
  };

  const chats = {
    sion: {
      name: "남편",
      preview: "내가 보고싶어서.",
      time: "방금",
      unread: 1,
      avatar: "assets/kakao/sion.jfif",
      messages: [
        { day: "2026년 11월 10일 월요일" },
        { from: "them", image: "assets/kakao/accident1.jfif", time: "오후 2:11" },
        { from: "them", image: "assets/kakao/accident2.jfif", time: "오후 2:11" },
        { from: "them", text: "누구 닮아서 이래 얘?", time: "오후 2:12" },
        { from: "me", text: "ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ누구겠어^^", time: "오후 2:13" },
        { day: "2026년 11월 12일 수요일" },
        { from: "me", image: "assets/kakao/cake.png", time: "오후 6:40" },
        { from: "me", text: "대박", time: "오후 6:40" },
        { from: "them", text: "이미 사놨지요~", time: "오후 6:41" },
        { from: "them", text: "육퇴하고 먹자 ❤️", time: "오후 6:41" },
        { day: "2026년 11월 14일 금요일" },
        { from: "them", text: "여보.", time: "오전 9:18" },
        { from: "them", text: "시우 괜찮을거니까 울지말고.", time: "오전 9:18" },
        { from: "them", text: "일단 병원으로 와.", time: "오전 9:19" },
        { day: "2026년 11월 15일 토요일" },
        { from: "them", image: "assets/kakao/vacation.jfif", time: "오후 3:05" },
        { from: "them", text: "이번 휴가 때 여기 어때?", time: "오후 3:05" },
        { from: "me", text: "좋아.", time: "오후 3:07" },
        { from: "me", text: "시우가 좋아하겠다", time: "오후 3:07" },
        { from: "them", text: "너 어떻냐구", time: "오후 3:08" },
        { from: "me", text: "나야 뭐~", time: "오후 3:09" },
        { from: "them", text: "ㅡㅡ", time: "오후 3:09" },
        { from: "them", text: "너도 내 애기야.", time: "오후 3:10" },
        { day: "2026년 11월 16일 일요일" },
        { from: "them", text: "여보 언제와??", time: "오후 7:41" },
        { from: "me", text: "좀 더 걸릴 것 같은데 ㅠㅠ", time: "오후 7:42" },
        { from: "me", text: "왜?", time: "오후 7:42" },
        { from: "me", text: "시우가 찾아?", time: "오후 7:42" },
        { from: "them", text: "시우는 엄마 보고싶다고 좀 찡찡대다", time: "오후 7:43" },
        { from: "them", text: "놀아주니까 뻗으셨고.", time: "오후 7:43" },
        { from: "them", text: "내가 보고싶어서.", time: "오후 7:44" },
      ],
    },
    yina: {
      name: "서이나",
      preview: "굿",
      time: "오늘",
      unread: 0,
      avatar: "assets/kakao/yina.jfif",
      messages: [
        { from: "them", text: "요즘 오시우 어린이 사진 업뎃이 느리시네요", time: "오후 7:12" },
        { from: "me", text: "복직하니까죽겠다쉿", time: "오후 7:15" },
        { from: "them", text: "ㅋㅋㅋㅋㅋ내일 한 잔 하쉴?", time: "오후 7:16" },
        { from: "me", text: "굿", time: "오후 7:17" },
      ],
    },
    daeyoung: {
      name: "김대영",
      preview: "넵! 감사합니다!",
      time: "11월 4일",
      unread: 0,
      avatar: "assets/kakao/daeyoung.jfif",
      messages: [
        { day: "2026년 11월 4일 수요일" },
        { from: "them", text: "형수님. 갑자기 연락드려서 죄송해요.", time: "오후 1:20" },
        { from: "them", text: "다름이 아니라", time: "오후 1:20" },
        { from: "them", text: "시우 이 장난감 있을까요?", time: "오후 1:21" },
        { from: "them", image: "assets/kakao/gift.jfif", time: "오후 1:21" },
        { from: "me", text: "대영씨~", time: "오후 1:24" },
        { from: "me", text: "아니요! 이 장난감은 없어요", time: "오후 1:24" },
        { from: "me", text: "최근에 땡깡 부려서 한 번 싹 버렸더니 … ^^", time: "오후 1:25" },
        { from: "them", text: "아이고… 시우야… ㅎㅎ", time: "오후 1:26" },
        { from: "them", text: "넵! 감사합니다!", time: "오후 1:26" },
      ],
    },
    yushi: {
      name: "유우시",
      preview: "누나도 즐거운 하루 보내세요",
      time: "11월 5일",
      unread: 0,
      avatar: "",
      messages: [
        { day: "2026년 11월 5일 목요일" },
        { from: "them", text: "잘못걸었어요", time: "오전 10:12" },
        { from: "them", text: "죄송해요 ㅠㅠ", time: "오전 10:12" },
        { from: "me", text: "아니에요~ 좋은 하루 보내세요 !", time: "오전 10:14" },
        { from: "them", text: "네", time: "오전 10:15" },
        { from: "them", text: "누나도 즐거운 하루 보내세요", time: "오전 10:15" },
      ],
    },
    riku: {
      name: "리쿠",
      preview: "쉬세요오오",
      time: "11월 8일",
      unread: 0,
      avatar: "assets/kakao/riku.jfif",
      messages: [
        { day: "2026년 11월 8일 일요일" },
        { from: "me", text: "아니 뭐 이런것까지 사왔어요 ㅠㅠ", time: "오후 4:02" },
        { from: "me", text: "그냥 오지", time: "오후 4:02" },
        { from: "me", text: "너무 고마워요", time: "오후 4:02" },
        { from: "me", text: "잘 쓸게요", time: "오후 4:03" },
        { from: "them", text: "아녜용", time: "오후 4:05" },
        { from: "them", text: "애기는 선물 많이 받는데", time: "오후 4:05" },
        { from: "them", text: "엄마는 많이 못받는다구 그래성", time: "오후 4:06" },
        { from: "me", text: "감동…", time: "오후 4:07" },
        { from: "me", text: "다음에 또 놀러와요 리쿠", time: "오후 4:07" },
        { from: "them", text: "넹!", time: "오후 4:08" },
        { from: "them", text: "쉬세요오오", time: "오후 4:08" },
      ],
    },
    sakuya: {
      name: "사쿠야",
      preview: "다음에 뵙겠습니다.",
      time: "11월 2일",
      unread: 0,
      avatar: "assets/kakao/sakuya.jfif",
      messages: [
        { day: "2026년 11월 2일 월요일" },
        { from: "me", text: "오늘 시우랑 놀아주느라", time: "오후 8:10" },
        { from: "me", text: "너무 고생많았어요!", time: "오후 8:10" },
        { from: "me", text: "조심히 들어가요!", time: "오후 8:10" },
        { from: "them", text: "아닙니다", time: "오후 8:12" },
        { from: "them", text: "시우가 순해서 하나도 힘들지 않았어요", time: "오후 8:12" },
        { from: "me", text: "많이 힘드셨군요…", time: "오후 8:13" },
        { from: "them", text: "넵", time: "오후 8:14" },
        { from: "them", text: "다음에는 사람 한 명 더 데리고 갈게요", time: "오후 8:14" },
        { from: "me", text: "언제든 환영이에요!", time: "오후 8:15" },
        { from: "me", text: "다음에도 맛난거 사줄게요~", time: "오후 8:15" },
        { from: "them", text: "넵", time: "오후 8:16" },
        { from: "them", text: "다음에 뵙겠습니다.", time: "오후 8:16" },
      ],
    },
    ryo: {
      name: "료",
      preview: "오늘 감사했습니다~~",
      time: "11월 8일",
      unread: 0,
      avatar: "assets/kakao/ryo.jfif",
      messages: [
        { day: "2026년 11월 8일 일요일" },
        { from: "them", text: "다음에는 저희가 살게요", time: "오후 7:40" },
        { from: "them", text: "왜 매번 사주세요~~", time: "오후 7:40" },
        { from: "me", text: "시온이 카드예요 ^^", time: "오후 7:42" },
        { from: "them", text: "앗 그렇다면", time: "오후 7:43" },
        { from: "them", text: "ㅋㅋㅋ", time: "오후 7:43" },
        { from: "me", text: "ㅎㅎ 다음에 봐요~", time: "오후 7:44" },
        { from: "them", text: "네~~~", time: "오후 7:45" },
        { from: "them", text: "오늘 감사했습니다~~", time: "오후 7:45" },
      ],
    },
  };

  const kakaoFriends = document.getElementById("kakaoFriends");
  const kakaoChats = document.getElementById("kakaoChats");
  const kakaoNavTitle = document.getElementById("kakaoNavTitle");
  const chatRoom = document.getElementById("chatRoom");
  const chatMessages = document.getElementById("chatMessages");
  const chatTitle = document.getElementById("chatTitle");
  const profileSheet = document.getElementById("profileSheet");
  const profileAvatar = document.getElementById("profileAvatar");
  const profileName = document.getElementById("profileName");
  const profileChatBtn = document.getElementById("profileChatBtn");
  let activeChatId = null;
  let activeProfileId = null;
  let lastChatFrom = null;

  function avatarHtml(avatar, className = "avatar") {
    if (!avatar) return `<div class="${className} empty"></div>`;
    return `<div class="${className}" style="background-image:url('${avatar}')"></div>`;
  }

  const profileBg = document.getElementById("profileBg");
  const profileStatus = document.getElementById("profileStatus");
  const profileChatLabel = document.getElementById("profileChatLabel");
  const profileEditBtn = document.getElementById("profileEditBtn");
  const profileGiftBtn = document.getElementById("profileGiftBtn");

  function openProfile(id) {
    const profile = kakaoProfiles[id];
    if (!profile) return;
    activeProfileId = id;
    const isMe = id === "me";
    const displayName = isMe
      ? (userName && userName.trim() ? userName.trim() : profile.name)
      : profile.name;

    profileName.textContent = displayName;
    if (profileStatus) profileStatus.textContent = profile.status || "";

    profileAvatar.className = profile.avatar ? "profile-avatar" : "profile-avatar empty";
    profileAvatar.style.backgroundImage = profile.avatar ? `url('${profile.avatar}')` : "";

    if (profileBg) {
      if (profile.avatar) {
        profileBg.classList.remove("empty");
        profileBg.style.backgroundImage = `url('${profile.avatar}')`;
      } else {
        profileBg.classList.add("empty");
        profileBg.style.backgroundImage = "";
      }
    }

    if (profileChatLabel) {
      profileChatLabel.textContent = isMe ? "나와의 채팅" : "1:1 채팅";
    }
    profileChatBtn.classList.toggle("hidden", !(isMe || profile.chatId));
    profileEditBtn?.classList.toggle("hidden", !isMe);
    profileGiftBtn?.classList.toggle("hidden", isMe);

    profileSheet.classList.remove("hidden");
  }

  document.getElementById("profileClose").addEventListener("click", () => {
    profileSheet.classList.add("hidden");
    activeProfileId = null;
  });

  profileChatBtn.addEventListener("click", () => {
    const profile = kakaoProfiles[activeProfileId];
    profileSheet.classList.add("hidden");
    if (activeProfileId === "me") return;
    if (profile?.chatId) openChat(profile.chatId);
  });

  function renderKakaoFriends() {
    if (!kakaoFriends) return;
    kakaoFriends.innerHTML = "";

    const me = kakaoProfiles.me;
    const myName = userName && userName.trim() ? userName.trim() : "나";
    me.name = myName;
    const meBtn = document.createElement("div");
    meBtn.className = "kakao-me-row static";
    meBtn.innerHTML = `${avatarHtml(me.avatar)}<div class="row-text"></div>`;
    const meNameEl = document.createElement("strong");
    meNameEl.textContent = myName;
    const meStatus = document.createElement("p");
    meStatus.textContent = "";
    const meText = meBtn.querySelector(".row-text");
    meText.appendChild(meNameEl);
    meText.appendChild(meStatus);
    kakaoFriends.appendChild(meBtn);

    const label = document.createElement("div");
    label.className = "kakao-section-label";
    const friendIds = ["sion", "daeyoung", "yina", "yushi", "riku", "sakuya", "ryo", "mom", "dad"];
    label.textContent = `친구 ${friendIds.length}`;
    kakaoFriends.appendChild(label);

    friendIds.forEach((id) => {
      const profile = kakaoProfiles[id];
      const row = document.createElement("div");
      row.className = "kakao-row static";
      row.innerHTML = `
        ${avatarHtml(profile.avatar)}
        <div class="row-text">
          <strong>${profile.name}</strong>
        </div>
      `;
      kakaoFriends.appendChild(row);
    });
  }

  function renderKakaoChats() {
    kakaoChats.innerHTML = "";
    Object.entries(chats).forEach(([id, chat]) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "kakao-row";
      row.innerHTML = `
        ${avatarHtml(chat.avatar)}
        <div class="row-text">
          <strong>${chat.name}</strong>
          <p>${chat.preview}</p>
        </div>
        <div>
          <div class="row-meta">${chat.time}</div>
          ${chat.unread ? `<div class="badge">${chat.unread}</div>` : ""}
        </div>
      `;
      row.addEventListener("click", () => openChat(id));
      kakaoChats.appendChild(row);
    });
  }

  function switchKakaoTab(tab) {
    document.querySelectorAll("#kakaoTabs button[data-kakao-tab]").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.kakaoTab === tab);
    });
    kakaoFriends.classList.toggle("hidden", tab !== "friends");
    kakaoChats.classList.toggle("hidden", tab !== "chats");
    const friendsSeg = document.getElementById("kakaoFriendsSeg");
    friendsSeg?.classList.toggle("hidden", tab !== "friends");
    kakaoNavTitle?.classList.toggle("hidden", tab === "friends");
    if (kakaoNavTitle) kakaoNavTitle.textContent = "채팅";
  }

  document.getElementById("kakaoTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-kakao-tab]");
    if (!btn) return;
    switchKakaoTab(btn.dataset.kakaoTab);
  });

  function appendBubble(message) {
    if (message.day) {
      const day = document.createElement("div");
      day.className = "chat-day";
      day.textContent = message.day;
      chatMessages.appendChild(day);
      lastChatFrom = null;
      return;
    }

    const chat = chats[activeChatId];
    const isMe = message.from === "me";
    const showIdentity = !isMe && lastChatFrom !== "them";
    lastChatFrom = message.from;

    const row = document.createElement("div");
    row.className = `msg-row-chat ${message.from}`;

    if (!isMe) {
      if (showIdentity) {
        row.innerHTML = avatarHtml(chat.avatar, "msg-avatar");
      } else {
        row.innerHTML = `<div class="msg-avatar" style="visibility:hidden"></div>`;
      }
    }

    const col = document.createElement("div");
    col.className = "msg-col";

    if (showIdentity) {
      const name = document.createElement("div");
      name.className = "msg-name";
      name.textContent = chat.name;
      col.appendChild(name);
    }

    const line = document.createElement("div");
    line.className = "msg-line";

    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.from}${message.image ? " image" : ""}`;
    if (message.image) {
      const img = document.createElement("img");
      img.src = message.image;
      img.alt = "사진";
      bubble.appendChild(img);
    } else {
      bubble.textContent = message.text;
    }

    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = message.time || "";

    line.appendChild(bubble);
    if (message.time) line.appendChild(time);
    col.appendChild(line);
    row.appendChild(col);
    chatMessages.appendChild(row);
  }

  const incomingCall = document.getElementById("incomingCall");

  function showIncomingCall() {
    if (!incomingCall || husbandCallTriggered) return;
    husbandCallTriggered = true;
    incomingCall.classList.remove("hidden");
    incomingCall.setAttribute("aria-hidden", "false");
  }

  function openChat(id) {
    const chat = chats[id];
    if (!chat) return;
    activeChatId = id;
    lastChatFrom = null;
    if (chat.unread) {
      chat.unread = 0;
      renderKakaoChats();
    }
    chatTitle.textContent = chat.name;
    chatMessages.innerHTML = "";
    chat.messages.forEach(appendBubble);
    chatRoom.classList.remove("hidden");
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (id === "sion") scheduleHusbandCall();
  }

  function scheduleHusbandCall() {
    if (husbandCallTriggered || husbandCallTimer) return;
    husbandCallTimer = setTimeout(() => {
      husbandCallTimer = null;
      showIncomingCall();
    }, 3000);
  }

  document.getElementById("chatBack").addEventListener("click", () => {
    chatRoom.classList.add("hidden");
    activeChatId = null;
    lastChatFrom = null;
  });

  document.getElementById("callDeclineBtn")?.addEventListener("click", hideIncomingCall);
  document.getElementById("callAcceptBtn")?.addEventListener("click", () => {
    // iOS Safari: play()는 이 클릭 스택 안에서 동기적으로 시작해야 함
    const first = firstAudioSrc(HUSBAND_CALL_SEQUENCE);
    if (first) primeCallAudioFromGesture(first);
    else unlockCallAudio();
    startHusbandCall({ connectingMs: 0 });
  });
  document.getElementById("callRemindBtn")?.addEventListener("click", hideIncomingCall);
  document.getElementById("callMessageBtn")?.addEventListener("click", hideIncomingCall);
  document.getElementById("activeCallEndBtn")?.addEventListener("click", () => endActiveCall());
  document.getElementById("missedCallYushi")?.addEventListener("click", () => {
    const first = firstAudioSrc(YUSHI_CALL_SEQUENCE);
    if (first) primeCallAudioFromGesture(first);
    else unlockCallAudio();
    startYushiCall();
  });
  document.getElementById("callHusbandRecent")?.addEventListener("click", () => {
    const first = firstAudioSrc(HUSBAND_CALL_SEQUENCE);
    if (first) primeCallAudioFromGesture(first);
    else unlockCallAudio();
    startHusbandCall({ connectingMs: 0 });
  });
  document.querySelectorAll("[data-call-husband]").forEach((el) => {
    el.addEventListener("click", () => {
      const first = firstAudioSrc(HUSBAND_CALL_SEQUENCE);
      if (first) primeCallAudioFromGesture(first);
      else unlockCallAudio();
      startHusbandCall({ connectingMs: 0 });
    });
  });

  document.getElementById("chatSend")?.addEventListener("click", (e) => {
    e.preventDefault();
  });
  document.getElementById("chatInput")?.addEventListener("keydown", (e) => {
    e.preventDefault();
  });
  document.getElementById("chatInput")?.addEventListener("beforeinput", (e) => {
    e.preventDefault();
  });
  document.getElementById("chatInput")?.addEventListener("focus", (e) => {
    e.target.blur();
  });

  function nowChatTime() {
    const now = new Date();
    const hour = now.getHours();
    const minute = String(now.getMinutes()).padStart(2, "0");
    const period = hour < 12 ? "오전" : "오후";
    const h12 = hour % 12 || 12;
    return `${period} ${h12}:${minute}`;
  }

  function sendChat() {
    return;
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (!text) return;
    appendBubble({ from: "me", text, time: nowChatTime() });
    input.value = "";
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const replies = {
      sion: "응 여보, 기다릴게 ❤️",
      yina: "ㅋㅋㅋㄱㄱ",
      daeyoung: "넵 형수님!",
      yushi: "네 누나~",
      riku: "넹넹!",
      sakuya: "넵",
      ryo: "네~~~",
    };
    setTimeout(() => {
      appendBubble({
        from: "them",
        text: replies[activeChatId] || "알겠어!",
        time: nowChatTime(),
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 900);
  }

  renderKakaoFriends();
  renderKakaoChats();

  /* ---------- Messages ---------- */
  const smsThreads = {
    coupang: {
      name: "쿠팡",
      preview: "[쿠팡] 고객님의 상품이 배송완료되었습니다.",
      time: "오늘",
      color: "linear-gradient(135deg,#c2410c,#ea580c)",
      messages: [
        {
          from: "them",
          text: "[쿠팡] 주문하신 상품이 배송을 시작했습니다.\n상품: 아기물티슈 100매 x10\n도착예정: 오늘 밤 11시~내일 아침 7시\n배송조회 http://coupa.ng/a1b2c3\n문의 1577-7011",
        },
        {
          from: "them",
          text: "[쿠팡] 고객님의 상품이 배송완료되었습니다.\n상품: 아기물티슈 100매 x10\n문 앞 배송 사진을 앱에서 확인해 주세요.\n배송조회 http://coupa.ng/a1b2c3\n문의 1577-7011",
        },
      ],
    },
    baemin: {
      name: "배달의민족",
      preview: "[배달의민족] 배달이 완료되었습니다.",
      time: "어제",
      color: "linear-gradient(135deg,#2f6bff,#5b8cff)",
      messages: [
        {
          from: "them",
          text: "[배달의민족] 주문이 접수되었습니다.\n가게: 키즈한식\n메뉴: 아기한우미음, 단호박죽\n주문번호: B0261115-88421\n예상시간: 약 35분",
        },
        {
          from: "them",
          text: "[배달의민족] 가게가 조리를 시작했습니다.\n주문번호: B0261115-88421",
        },
        {
          from: "them",
          text: "[배달의민족] 배달이 시작되었습니다.\n라이더가 가게에서 픽업했습니다.\n예상 도착: 약 18분",
        },
        {
          from: "them",
          text: "[배달의민족] 배달이 완료되었습니다.\n맛있게 드셨다면 리뷰를 남겨주세요.\n주문번호: B0261115-88421",
        },
      ],
    },
    clinic: {
      name: "우리소아과",
      preview: "[우리소아과] 시우 보호자님, 내일 예약 리마인드입니다.",
      time: "토요일",
      color: "linear-gradient(135deg,#0d9488,#14b8a6)",
      messages: [
        {
          from: "them",
          text: "[우리소아과] 오시우 보호자님, 예방접종 예약이 확인되었습니다.\n일시: 11월 20일(목) 오전 10:30\n준비물: 아기수첩, 건강보험증\n변경·취소는 24시간 전까지 02-3456-7890으로 연락 부탁드립니다.",
        },
        {
          from: "them",
          text: "[우리소아과] 시우 보호자님, 내일 예약 리마인드입니다.\n11월 20일(목) 오전 10:30 방문 예정입니다.\n아기수첩을 꼭 지참해 주세요.\n문의 02-3456-7890",
        },
      ],
    },
    sion: {
      name: "남편",
      preview: "여보. 이거 보면 바로 전화줘.",
      time: "11월 14일",
      avatar: "assets/kakao/sion.jfif",
      messages: [
        { from: "them", text: "여보. 이거 보면 바로 전화줘." },
      ],
    },
    daycare: {
      name: "햇살어린이집",
      preview: "[햇살어린이집] 시우 오늘 낮잠 잘 자고 간식도 잘 먹었어요.",
      time: "금요일",
      color: "linear-gradient(135deg,#db2777,#f472b6)",
      messages: [
        {
          from: "them",
          text: "[햇살어린이집] 시우 보호자님, 오늘 원 일정 안내드립니다.\n오전: 실내자유놀이\n오후: 미술활동(손도장)\n하원 예정: 오후 4시\n문의 02-5678-1234",
        },
        {
          from: "them",
          text: "[햇살어린이집] 시우 오늘 낮잠 잘 자고 간식도 잘 먹었어요. 기분 좋게 하원합니다.",
        },
      ],
    },
    nhis: {
      name: "국민건강보험",
      preview: "[국민건강보험] 영유아 건강검진 안내",
      time: "목요일",
      color: "linear-gradient(135deg,#1d4ed8,#3b82f6)",
      messages: [
        {
          from: "them",
          text: "[국민건강보험] 오시우 보호자님, 영유아 건강검진(36개월) 수검 기간 안내드립니다.\n기간: 2026.10.01 ~ 2026.12.31\n가까운 검진기관에서 예약 후 방문해 주세요.\n문의 1577-1000",
        },
      ],
    },
    pharmacy: {
      name: "튼튼약국",
      preview: "[튼튼약국] 처방약 조제가 완료되었습니다.",
      time: "수요일",
      color: "linear-gradient(135deg,#15803d,#22c55e)",
      messages: [
        {
          from: "them",
          text: "[튼튼약국] 시우 보호자님, 처방약 조제가 완료되었습니다.\n수령 가능: 오늘 오후 8시까지\n주소: 우리동네 튼튼약국\n문의 02-2222-3333",
        },
      ],
    },
    kidcafe: {
      name: "플레이키즈카페",
      preview: "[플레이키즈카페] 예약이 확정되었습니다.",
      time: "화요일",
      color: "linear-gradient(135deg,#7c3aed,#a78bfa)",
      messages: [
        {
          from: "them",
          text: "[플레이키즈카페] 예약이 확정되었습니다.\n일시: 11월 22일(토) 오후 2:00\n인원: 성인 1, 아동 1\n이용시간: 2시간\n변경·취소는 하루 전까지 연락 주세요.",
        },
      ],
    },
  };

  const msgList = document.getElementById("msgList");
  const smsRoom = document.getElementById("smsRoom");
  const smsMessages = document.getElementById("smsMessages");
  const smsTitle = document.getElementById("smsTitle");

  const smsUnread = new Set(["coupang", "sion", "clinic"]);

  Object.entries(smsThreads).forEach(([id, thread]) => {
    const row = document.createElement("button");
    row.className = "messages-row" + (smsUnread.has(id) ? " unread" : "");
    row.type = "button";
    const avatarStyle = thread.avatar
      ? `background-image:url('${thread.avatar}')`
      : `background:${thread.color || "linear-gradient(135deg,#34c759,#30d158)"}`;
    row.innerHTML = `
      <div class="messages-avatar" style="${avatarStyle}"></div>
      <div class="messages-row-body">
        <div class="messages-row-top">
          <strong>${thread.name}</strong>
          <span>${thread.time}</span>
        </div>
        <p>${thread.preview}</p>
      </div>
    `;
    row.addEventListener("click", () => {
      smsTitle.textContent = thread.name;
      const smsAvatar = document.getElementById("smsAvatar");
      if (thread.avatar) {
        smsAvatar.style.backgroundImage = `url('${thread.avatar}')`;
        smsAvatar.style.background = "";
      } else {
        smsAvatar.style.backgroundImage = "";
        smsAvatar.style.background = thread.color || "linear-gradient(135deg,#8e8e93,#aeaeb2)";
      }
      smsMessages.innerHTML = "";
      thread.messages.forEach((m) => {
        const wrap = document.createElement("div");
        wrap.className = `messages-bubble-row ${m.from}`;
        const bubble = document.createElement("div");
        bubble.className = `messages-bubble ${m.from}`;
        bubble.textContent = m.text;
        wrap.appendChild(bubble);
        smsMessages.appendChild(wrap);
      });
      smsRoom.classList.remove("hidden");
      row.classList.remove("unread");
      smsUnread.delete(id);
    });
    msgList.appendChild(row);
  });

  document.getElementById("smsBack").addEventListener("click", () => {
    smsRoom.classList.add("hidden");
  });

  /* ---------- Gallery ---------- */
  const photos = [
    { src: "assets/gallery/wedding.jfif" },
    { src: "assets/gallery/couple.jfif" },
    { src: "assets/gallery/sion1.jfif" },
    { src: "assets/gallery/sion2.jfif" },
    { src: "assets/gallery/sion3.jfif" },
    { src: "assets/gallery/sion4.jfif" },
    { src: "assets/gallery/sion5.jfif" },
    { src: "assets/gallery/sion6.jfif" },
    { src: "assets/gallery/sion7.jfif" },
    { src: "assets/gallery/sion8.jfif" },
    { src: "assets/gallery/sion9.jfif" },
    { src: "assets/gallery/sion10.jfif" },
  ];

  const galleryGrid = document.getElementById("galleryGrid");
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const lightboxStage = document.getElementById("lightboxStage");
  let galleryIndex = 0;

  const photoCount = document.getElementById("photoCount");
  if (photoCount) photoCount.textContent = String(photos.length);

  function showGalleryPhoto(index) {
    if (!photos.length) return;
    galleryIndex = (index + photos.length) % photos.length;
    lightboxImg.src = photos[galleryIndex].src;
  }

  photos.forEach((photo, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.backgroundImage = `url('${photo.src}')`;
    btn.addEventListener("click", () => {
      showGalleryPhoto(index);
      lightbox.classList.remove("hidden");
    });
    galleryGrid.appendChild(btn);
  });

  document.getElementById("lightboxClose").addEventListener("click", () => {
    lightbox.classList.add("hidden");
  });

  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeActive = false;

  function onSwipeStart(clientX, clientY) {
    swipeActive = true;
    swipeStartX = clientX;
    swipeStartY = clientY;
  }

  function onSwipeEnd(clientX, clientY) {
    if (!swipeActive) return;
    swipeActive = false;
    const dx = clientX - swipeStartX;
    const dy = clientY - swipeStartY;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) showGalleryPhoto(galleryIndex + 1);
    else showGalleryPhoto(galleryIndex - 1);
  }

  const swipeTarget = lightboxStage || lightbox;
  swipeTarget.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches[0]) onSwipeStart(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: true }
  );
  swipeTarget.addEventListener(
    "touchend",
    (e) => {
      const t = e.changedTouches[0];
      if (t) onSwipeEnd(t.clientX, t.clientY);
    },
    { passive: true }
  );
  swipeTarget.addEventListener("mousedown", (e) => onSwipeStart(e.clientX, e.clientY));
  window.addEventListener("mouseup", (e) => {
    if (!lightbox.classList.contains("hidden")) onSwipeEnd(e.clientX, e.clientY);
  });

  /* ---------- Music ---------- */
  const tracks = [
    { title: "wit that confidence", artist: "Tai Verdes", art: "assets/music/wit.jpg" },
    { title: "Cool", artist: "Daniel Caesar", art: "assets/music/cool.jpg" },
    { title: "Bonnie & Clyde", artist: "DEAN", art: "assets/music/bonnie.jpg" },
    { title: "TOUCH", artist: "NCT 127", art: "assets/music/touch.jpg" },
    { title: "My Song", artist: "H.E.R.", art: "assets/music/mysong.jpg" },
    { title: "Ego", artist: "Crush", art: "assets/music/ego.jpg" },
    { title: "bad", artist: "wave to earth", art: "assets/music/bad.jpg" },
    { title: "Come Through and Chill", artist: "Miguel", art: "assets/music/chill.jpg" },
  ];

  const trackList = document.getElementById("trackList");

  function renderTracks() {
    if (!trackList) return;
    trackList.innerHTML = "";
    tracks.forEach((t) => {
      const row = document.createElement("div");
      row.className = "music-track-row static";
      row.innerHTML = `
        <div class="track-art" style="background-image:url('${t.art}')"></div>
        <div class="track-text">
          <strong>${t.title}</strong>
          <span>${t.artist}</span>
        </div>
        <span class="music-more">•••</span>
      `;
      trackList.appendChild(row);
    });
  }

  renderTracks();

  /* ---------- Baby album ---------- */
  const babyAlbum = document.getElementById("babyAlbum");
  ["baby1", "baby2", "baby3", "baby4"].forEach((name) => {
    const img = document.createElement("img");
    img.src = `assets/baby/${name}.jfif`;
    img.alt = "아기 사진";
    babyAlbum.appendChild(img);
  });

  /* ---------- Notes ---------- */
  const notes = [
    {
      title: "시온에게 하고 싶은 말",
      body: "오늘도 무대 위에서 빛난 우리 남편. 집에 오면 꼭 안아줄게. 사랑해 🌷",
    },
    {
      title: "아기 예방접종 체크",
      body: "11/20 10:30 우리소아과 / 예방접종 수첩 챙기기 / 시온이랑 같이 가기",
    },
    {
      title: "장보기",
      body: "분유, 기저귀, 시온이 좋아하는 페퍼로니 피자, 디저트(달달한 거)",
    },
    {
      title: "비밀번호 힌트",
      body: "우리 비밀번호는 시온이 생일… 혹시 까먹으면 안 되지 0511",
    },
  ];

  const notesList = document.getElementById("notesList");
  notes.forEach((note) => {
    const row = document.createElement("button");
    row.className = "note-row";
    row.type = "button";
    row.innerHTML = `<strong>${note.title}</strong><p>${note.body}</p><em>방금</em>`;
    row.addEventListener("click", () => alert(`${note.title}\n\n${note.body}`));
    notesList.appendChild(row);
  });

  /* ---------- Calendar grid ---------- */
  const calGrid = document.getElementById("calGrid");
  if (calGrid) {
    const today = new Date().getDate();
    // Nov 2026 starts on Sunday
    for (let d = 1; d <= 30; d += 1) {
      const cell = document.createElement("div");
      cell.className = "cal-cell" + (d === today ? " today" : "");
      cell.textContent = String(d);
      if ([5, 7, 11, 13, 18, 20, 21, 22, 23, 27, 28].includes(d)) cell.classList.add("has-event");
      calGrid.appendChild(cell);
    }
  }

  /* ---------- Contacts ---------- */
  const contacts = [
    { name: "남편", sub: "휴대폰", avatar: "assets/kakao/sion.jfif", me: false },
    { name: "김대영", sub: "휴대폰", avatar: "assets/kakao/daeyoung.jfif" },
    { name: "서이나", sub: "휴대폰", avatar: "assets/kakao/yina.jfif" },
    { name: "엄마", sub: "가족", avatar: "assets/kakao/mom.jfif" },
    { name: "아빠", sub: "가족", avatar: "" },
    { name: "우리소아과", sub: "병원", avatar: "" },
  ];

  const contactsList = document.getElementById("contactsList");
  const myCard = document.createElement("button");
  myCard.type = "button";
  myCard.className = "contact-mycard";
  myCard.innerHTML = `
    <div class="avatar round" style="background-image:url('assets/kakao/me.jfif')"></div>
    <div class="row-text">
      <strong id="contactMyName">나</strong>
      <p>나의 카드</p>
    </div>
  `;
  contactsList.appendChild(myCard);

  contacts.forEach((c) => {
    const row = document.createElement("div");
    row.className = "contact-row";
    const bg = c.avatar
      ? `background-image:url('${c.avatar}')`
      : "";
    row.innerHTML = `
      <div class="avatar round ${c.avatar ? "" : "empty"}" style="${bg}"></div>
      <div class="row-text">
        <strong>${c.name}</strong>
      </div>
    `;
    contactsList.appendChild(row);
  });

  /* ---------- Safari ---------- */
  const safariHome = document.getElementById("safariHome");
  const safariInvite = document.getElementById("safariInvite");
  const safariSimple = document.getElementById("safariSimple");
  const safariUrl = document.getElementById("safariUrl");

  function showSafariHome() {
    safariHome.classList.remove("hidden");
    safariInvite.classList.add("hidden");
    if (safariSimple) safariSimple.classList.add("hidden");
    safariUrl.textContent = "favorites";
  }

  function openSafariInvite() {
    updateBrideName();
    safariHome.classList.add("hidden");
    if (safariSimple) safariSimple.classList.add("hidden");
    safariInvite.classList.remove("hidden");
    safariUrl.textContent = "invite.ohsion.wedding";
    safariInvite.scrollTop = 0;
  }

  document.getElementById("safariBackBtn").addEventListener("click", () => {
    if (!safariHome.classList.contains("hidden")) {
      goHome();
      return;
    }
    showSafariHome();
  });

  document.querySelectorAll('[data-app="safari"]').forEach((btn) => {
    btn.addEventListener("click", () => openSafariInvite());
  });

})();
