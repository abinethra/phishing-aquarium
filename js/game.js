/**
 * js/game.js
 * Core inspection, red-flag spotting, scoring, hint, persistence,
 * first-visit onboarding sticker, catch screen-reader announcements,
 * New Game confirm, and Tank Cleared results modal.
 */
(function () {
  const FLAG_POINTS = 100;
  const CATCH_BASE_POINTS = 300;
  const NO_WRONG_CLICK_BONUS = 100;
  const SPEED_BONUS_PER_SEC = 50;
  const SPEED_THRESHOLD_SEC = 20;
  const SPEED_BONUS_CAP = 200;
  const WRONG_PENALTY = 25;
  const HINT_COST = 50;

  const gameState = {
    species: [],
    score: 0,
    bestScore: 0,
    caughtIds: [],
    totalTimeSec: 0,
    correctClicks: 0,
    wrongClicks: 0,
    onboardingSeen: false,
    speciesStats: {},
    activeSpecies: null,
    inspectStartMs: null,
    fishWrongClicks: 0,
    fishHintsUsed: 0,
    foundFlagIds: new Set(),
    justStampedFlagId: null,
    activeExplanation: null,
    hintedFlagId: null,
    isCatching: false,
    modalShownForRun: false,
    toastTimer: null
  };

  function getEls() {
    return {
      scoreEl: document.getElementById('score-display'),
      caughtEl: document.getElementById('caught-display'),
      inspectorEl: document.getElementById('inspector-card'),
      slotsWrap: document.querySelector('.collection-slots'),
      viewportEl: document.querySelector('.tank-viewport'),
      deckControlsEl: document.querySelector('.deck-controls'),
      announcerEl: document.getElementById('catch-announcer')
    };
  }

  function announceCatch(message) {
    const { announcerEl } = getEls();
    if (!announcerEl) return;
    announcerEl.textContent = '';
    window.setTimeout(() => {
      announcerEl.textContent = message;
    }, 30);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function persistNow() {
    if (window.Storage && typeof window.Storage.saveProgress === 'function') {
      const saved = window.Storage.saveProgress({
        score: gameState.score,
        bestScore: Math.max(gameState.bestScore, gameState.score),
        caughtIds: gameState.caughtIds.slice(),
        totalTimeSec: gameState.totalTimeSec,
        correctClicks: gameState.correctClicks,
        wrongClicks: gameState.wrongClicks,
        onboardingSeen: gameState.onboardingSeen,
        speciesStats: gameState.speciesStats
      });
      if (saved && typeof saved.bestScore === 'number') {
        gameState.bestScore = saved.bestScore;
      }
    }
  }

  function dismissOnboarding() {
    if (gameState.onboardingSeen) return;
    gameState.onboardingSeen = true;
    persistNow();
    const sticker = document.getElementById('onboarding-sticker');
    if (sticker) sticker.remove();
  }

  function renderOnboardingSticker() {
    const { viewportEl } = getEls();
    if (!viewportEl || gameState.onboardingSeen) return;
    if (document.getElementById('onboarding-sticker')) return;

    const sticker = document.createElement('div');
    sticker.id = 'onboarding-sticker';
    sticker.className = 'onboarding-sticker';
    sticker.setAttribute('role', 'note');
    sticker.setAttribute('aria-label', 'How to play: Click a fish. Spot 3 red flags. Collect them all.');
    sticker.innerHTML = `
      <div class="onboarding-sticker-top">
        <span class="onboarding-tag">Quick Tip</span>
        <button type="button" id="onboarding-dismiss-btn" class="onboarding-dismiss-btn" aria-label="Dismiss quick tip">Got it</button>
      </div>
      <p class="onboarding-text">Click a fish. Spot 3 red flags. Collect them all.</p>
    `;

    viewportEl.appendChild(sticker);

    const dismissBtn = document.getElementById('onboarding-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissOnboarding();
      });
    }
  }

  function ensureNewGameButton() {
    const { deckControlsEl } = getEls();
    if (!deckControlsEl) return;

    let btn = document.getElementById('new-game-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'new-game-btn';
      btn.className = 'pill-btn new-game-btn';
      btn.textContent = 'New game';
      btn.setAttribute('aria-label', 'Start a new game and reset current progress');

      const guideBtn = deckControlsEl.querySelector('.field-guide-btn');
      if (guideBtn) {
        deckControlsEl.insertBefore(btn, guideBtn);
      } else {
        deckControlsEl.prepend(btn);
      }

      btn.addEventListener('click', handleNewGameClick);
    }
  }

  function handleNewGameClick() {
    const confirmed = window.confirm(
      'Start a new game? Your current score and caught fish in this run will be reset (your Best Score is kept).'
    );
    if (!confirmed) return;

    const resetData = window.Storage && typeof window.Storage.resetProgress === 'function'
      ? window.Storage.resetProgress()
      : {
          score: 0,
          bestScore: gameState.bestScore,
          caughtIds: [],
          totalTimeSec: 0,
          correctClicks: 0,
          wrongClicks: 0,
          onboardingSeen: true,
          speciesStats: {}
        };

    gameState.score = resetData.score || 0;
    gameState.bestScore = Math.max(gameState.bestScore, resetData.bestScore || 0);
    gameState.caughtIds = [];
    gameState.totalTimeSec = 0;
    gameState.correctClicks = 0;
    gameState.wrongClicks = 0;
    gameState.onboardingSeen = true;
    gameState.speciesStats = {};
    gameState.activeSpecies = null;
    gameState.inspectStartMs = null;
    gameState.fishWrongClicks = 0;
    gameState.fishHintsUsed = 0;
    gameState.foundFlagIds = new Set();
    gameState.justStampedFlagId = null;
    gameState.activeExplanation = null;
    gameState.hintedFlagId = null;
    gameState.isCatching = false;
    gameState.modalShownForRun = false;

    closeTankClearedModal();

    if (window.Tank) {
      if (typeof window.Tank.setFrozenFish === 'function') {
        window.Tank.setFrozenFish(null);
      }
      if (typeof window.Tank.setCaughtIds === 'function') {
        window.Tank.setCaughtIds([]);
      }
      if (typeof window.Tank.setSpecies === 'function' && gameState.species.length > 0) {
        window.Tank.setSpecies(gameState.species);
      }
    }

    updateHud();
    renderEmptyInspector();
    showToast('New aquarium run started!');
  }

  function updateHud() {
    const { scoreEl, caughtEl } = getEls();
    if (scoreEl) {
      scoreEl.textContent = Math.max(0, Math.round(gameState.score)).toLocaleString();
    }
    if (caughtEl) {
      const total = gameState.species.length || 8;
      caughtEl.textContent = `${gameState.caughtIds.length} / ${total}`;
    }
    renderCollectionStrip();
  }

  function renderCollectionStrip() {
    const { slotsWrap } = getEls();
    if (!slotsWrap) return;

    const totalSlots = 8;
    const html = [];

    for (let i = 0; i < totalSlots; i++) {
      const caughtId = gameState.caughtIds[i];
      const sp = caughtId ? gameState.species.find((item) => item.id === caughtId) : null;

      if (sp) {
        html.push(
          `<div class="slot slot-caught" role="listitem" title="${escapeHtml(sp.name)}" aria-label="Caught ${escapeHtml(sp.name)}" style="background-color: ${escapeHtml(sp.colour || '#5DCAA5')}">
            <span class="slot-envelope" aria-hidden="true">✉</span>
          </div>`
        );
      } else {
        html.push(
          `<div class="slot slot-empty" role="listitem" aria-label="Empty collection slot ${i + 1}">?</div>`
        );
      }
    }

    slotsWrap.innerHTML = html.join('');
  }

  function showToast(message) {
    const { viewportEl } = getEls();
    if (!viewportEl) return;

    let toast = viewportEl.querySelector('.catch-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'catch-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      viewportEl.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.remove('is-visible');
    void toast.offsetWidth;
    toast.classList.add('is-visible');

    if (gameState.toastTimer) {
      window.clearTimeout(gameState.toastTimer);
    }
    gameState.toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 3000);
  }

  function buildSegmentizedHtml(text, redFlags) {
    const raw = String(text || '');
    if (!raw || !Array.isArray(redFlags) || redFlags.length === 0) {
      return escapeHtml(raw);
    }

    const matches = [];
    redFlags.forEach((flag) => {
      if (!flag || !flag.text) return;
      const idx = raw.indexOf(flag.text);
      if (idx !== -1) {
        matches.push({
          start: idx,
          end: idx + flag.text.length,
          flag
        });
      }
    });

    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    const nonOverlapping = [];
    let cursor = 0;
    matches.forEach((m) => {
      if (m.start >= cursor) {
        nonOverlapping.push(m);
        cursor = m.end;
      }
    });

    if (nonOverlapping.length === 0) {
      return escapeHtml(raw);
    }

    let pos = 0;
    const chunks = [];

    nonOverlapping.forEach((m) => {
      if (m.start > pos) {
        const plainSlice = raw.slice(pos, m.start);
        chunks.push(
          `<span class="email-nonflag" data-nonflag="true">${escapeHtml(plainSlice)}</span>`
        );
      }

      const isFound = gameState.foundFlagIds.has(m.flag.id);
      const isHinted = gameState.hintedFlagId === m.flag.id && !isFound;
      const isStamped = gameState.justStampedFlagId === m.flag.id;
      const classes = ['flag-token'];
      if (isFound) classes.push('is-found');
      if (isHinted) classes.push('is-hinted');
      if (isStamped) classes.push('is-stamped');

      const ariaPressed = isFound ? 'true' : 'false';
      const label = isFound
        ? `${m.flag.text} (Found red flag: ${m.flag.kind})`
        : `Inspect potential red flag: ${m.flag.text}`;

      chunks.push(
        `<button type="button" class="${classes.join(' ')}" data-flag-id="${escapeHtml(m.flag.id)}" aria-pressed="${ariaPressed}" aria-label="${escapeHtml(label)}">${escapeHtml(raw.slice(m.start, m.end))}</button>`
      );

      pos = m.end;
    });

    if (pos < raw.length) {
      chunks.push(
        `<span class="email-nonflag" data-nonflag="true">${escapeHtml(raw.slice(pos))}</span>`
      );
    }

    return chunks.join('');
  }

  function animateInspectorPop() {
    const { inspectorEl } = getEls();
    if (!inspectorEl) return;
    inspectorEl.classList.remove('is-popping');
    void inspectorEl.offsetWidth;
    inspectorEl.classList.add('is-popping');
  }

  function renderEmptyInspector() {
    const { inspectorEl } = getEls();
    if (!inspectorEl) return;

    inspectorEl.classList.add('is-empty');
    inspectorEl.innerHTML = `
      <div class="inspector-empty-state">
        <div class="empty-envelope-icon" aria-hidden="true">✉</div>
        <p class="empty-title">Tap a fish to inspect it</p>
        <p class="empty-sub">Spot the red flags in suspicious emails before they slip away.</p>
      </div>
    `;
  }

  function renderInspector(shouldPop = false) {
    const { inspectorEl } = getEls();
    if (!inspectorEl) return;

    const sp = gameState.activeSpecies;
    if (!sp) {
      renderEmptyInspector();
      return;
    }

    inspectorEl.classList.remove('is-empty');
    const email = sp.email || {};
    const flags = Array.isArray(sp.redFlags) ? sp.redFlags : [];
    const foundCount = flags.filter((f) => gameState.foundFlagIds.has(f.id)).length;
    const totalFlags = flags.length || 3;

    const fromNameHtml = buildSegmentizedHtml(email.fromName || '', flags);
    const fromAddrHtml = buildSegmentizedHtml(email.fromAddress || '', flags);
    const subjectHtml = buildSegmentizedHtml(email.subject || '', flags);
    const bodyHtml = buildSegmentizedHtml(email.body || '', flags);
    const linkTextHtml = buildSegmentizedHtml(email.linkText || '', flags);

    const segments = [];
    for (let i = 0; i < totalFlags; i++) {
      segments.push(
        `<span class="flag-seg ${i < foundCount ? 'is-filled' : ''}" aria-hidden="true"></span>`
      );
    }

    const explanationHtml = gameState.activeExplanation
      ? `<div class="flag-explanation-card" role="region" aria-label="Red flag explanation">
          <div class="explanation-badge">${escapeHtml(gameState.activeExplanation.kind || 'red flag')}</div>
          <p class="explanation-text">${escapeHtml(gameState.activeExplanation.explanation)}</p>
        </div>`
      : `<p class="inspector-hint-copy">Click suspicious phrases in the email to spot all ${totalFlags} red flags.</p>`;

    const canHint = foundCount < totalFlags && !gameState.isCatching;

    inspectorEl.innerHTML = `
      <div class="inspector-head">
        <div class="inspector-species-meta">
          <span class="species-dot" style="background-color: ${escapeHtml(sp.colour || '#D85A30')}"></span>
          <strong class="inspector-species-name">${escapeHtml(sp.name)}</strong>
        </div>
        <button type="button" id="hint-btn" class="hint-btn" ${canHint ? '' : 'disabled'} aria-label="Use a hint for 50 points">
          Hint (-${HINT_COST})
        </button>
      </div>

      <div class="flag-progress-wrap" aria-label="${foundCount} of ${totalFlags} red flags found">
        <div class="flag-progress-bars">${segments.join('')}</div>
        <span class="flag-progress-label">${foundCount} / ${totalFlags} flags</span>
      </div>

      <div class="email-sheet" data-email-body>
        <div class="email-row">
          <span class="email-field-label">From:</span>
          <span class="email-field-value">
            <strong>${fromNameHtml}</strong>
            <span class="email-addr">&lt;${fromAddrHtml}&gt;</span>
          </span>
        </div>
        <div class="email-row">
          <span class="email-field-label">Subject:</span>
          <span class="email-field-value email-subject">${subjectHtml}</span>
        </div>
        <div class="email-body-copy">${bodyHtml}</div>
        ${
          email.linkText
            ? `<div class="email-cta-row">
                <span class="email-fake-link">${linkTextHtml}</span>
              </div>`
            : ''
        }
      </div>

      ${explanationHtml}
    `;

    if (shouldPop) {
      animateInspectorPop();
    }

    gameState.justStampedFlagId = null;
    bindInspectorEvents();
  }

  function triggerWrongClickFeedback() {
    gameState.wrongClicks += 1;
    gameState.fishWrongClicks += 1;
    gameState.score = Math.max(0, gameState.score - WRONG_PENALTY);
    persistNow();
    updateHud();

    const { inspectorEl } = getEls();
    if (!inspectorEl) return;

    const sheet = inspectorEl.querySelector('.email-sheet');
    if (sheet) {
      sheet.classList.remove('is-shaking');
      void sheet.offsetWidth;
      sheet.classList.add('is-shaking');
    }

    gameState.activeExplanation = {
      kind: 'not a red flag',
      explanation: `That part looks normal — ${WRONG_PENALTY} pts for a false alarm. Try another phrase!`
    };
    renderInspector(false);
  }

  function handleFlagFound(flag) {
    if (!flag || gameState.foundFlagIds.has(flag.id) || gameState.isCatching) return;

    gameState.foundFlagIds.add(flag.id);
    gameState.justStampedFlagId = flag.id;
    gameState.correctClicks += 1;
    if (gameState.hintedFlagId === flag.id) {
      gameState.hintedFlagId = null;
    }

    gameState.score += FLAG_POINTS;
    gameState.activeExplanation = {
      kind: flag.kind,
      explanation: flag.explanation
    };

    const sp = gameState.activeSpecies;
    const totalFlags = (sp && Array.isArray(sp.redFlags) && sp.redFlags.length) || 3;
    const foundCount = sp ? sp.redFlags.filter((f) => gameState.foundFlagIds.has(f.id)).length : 0;

    persistNow();
    updateHud();
    renderInspector(false);

    if (sp && foundCount >= totalFlags) {
      completeCatch(sp);
    }
  }

  function computeCatchBreakdown(elapsedSec, wrongClicksForFish) {
    const cleanBonus = wrongClicksForFish === 0 ? NO_WRONG_CLICK_BONUS : 0;
    const secondsUnder = Math.max(0, SPEED_THRESHOLD_SEC - elapsedSec);
    const speedBonus = Math.min(
      SPEED_BONUS_CAP,
      Math.floor(secondsUnder) * SPEED_BONUS_PER_SEC
    );
    const totalCatchAward = CATCH_BASE_POINTS + cleanBonus + speedBonus;
    return {
      base: CATCH_BASE_POINTS,
      cleanBonus,
      speedBonus,
      totalCatchAward
    };
  }

  function completeCatch(species) {
    if (!species || gameState.isCatching) return;
    gameState.isCatching = true;

    const elapsedSec = gameState.inspectStartMs
      ? Math.max(0.1, (performance.now() - gameState.inspectStartMs) / 1000)
      : 10;

    const breakdown = computeCatchBreakdown(elapsedSec, gameState.fishWrongClicks);
    gameState.score += breakdown.totalCatchAward;
    gameState.bestScore = Math.max(gameState.bestScore, gameState.score);
    gameState.totalTimeSec += elapsedSec;

    const slotIndex = gameState.caughtIds.length;
    if (!gameState.caughtIds.includes(species.id)) {
      gameState.caughtIds.push(species.id);
    }

    const prevStat = gameState.speciesStats[species.id] || {
      caught: false,
      caughtCount: 0,
      bestTimeSec: null,
      lastTimeSec: null,
      wrongClicks: 0,
      hintsUsed: 0,
      lastPoints: 0,
      lastCaughtAt: null
    };

    gameState.speciesStats[species.id] = {
      caught: true,
      caughtCount: prevStat.caughtCount + 1,
      bestTimeSec: prevStat.bestTimeSec == null
        ? elapsedSec
        : Math.min(prevStat.bestTimeSec, elapsedSec),
      lastTimeSec: elapsedSec,
      wrongClicks: gameState.fishWrongClicks,
      hintsUsed: gameState.fishHintsUsed,
      lastPoints: breakdown.totalCatchAward + (species.redFlags ? species.redFlags.length * FLAG_POINTS : 300),
      lastCaughtAt: new Date().toISOString()
    };

    if (window.Storage && typeof window.Storage.recordSpeciesCatch === 'function') {
      window.Storage.recordSpeciesCatch(species.id, {
        elapsedSec,
        wrongClicks: gameState.fishWrongClicks,
        hintsUsed: gameState.fishHintsUsed,
        pointsEarned: gameState.speciesStats[species.id].lastPoints
      });
    }
    persistNow();

    updateHud();

    const totalSpecies = gameState.species.length || 8;
    const bonusParts = [`+${breakdown.base}`];
    if (breakdown.cleanBonus > 0) bonusParts.push(`+${breakdown.cleanBonus} clean`);
    if (breakdown.speedBonus > 0) bonusParts.push(`+${breakdown.speedBonus} speed`);
    const toastMsg = `Caught ${species.name}! (${bonusParts.join(', ')})`;
    showToast(toastMsg);
    announceCatch(`${species.name} caught! ${gameState.caughtIds.length} of ${totalSpecies} species collected. Score is now ${Math.round(gameState.score)}.`);

    if (window.Tank && typeof window.Tank.playCatchAnimation === 'function') {
      window.Tank.playCatchAnimation(species.id, slotIndex);
    }

    const allCaught = gameState.caughtIds.length >= totalSpecies;

    window.setTimeout(() => {
      gameState.activeSpecies = null;
      gameState.inspectStartMs = null;
      gameState.fishWrongClicks = 0;
      gameState.fishHintsUsed = 0;
      gameState.foundFlagIds = new Set();
      gameState.justStampedFlagId = null;
      gameState.activeExplanation = null;
      gameState.hintedFlagId = null;
      gameState.isCatching = false;
      if (window.Tank && typeof window.Tank.setFrozenFish === 'function') {
        window.Tank.setFrozenFish(null);
      }
      renderEmptyInspector();

      if (allCaught && !gameState.modalShownForRun) {
        gameState.modalShownForRun = true;
        openTankClearedModal();
      }
    }, 680);
  }

  function getRankTitle(accuracyPct, finalScore) {
    if (accuracyPct >= 90 && finalScore >= 3200) return 'Apex Predator';
    if (accuracyPct >= 75 && finalScore >= 2200) return 'Phish Hunter';
    if (accuracyPct >= 50 && finalScore >= 1200) return 'Angler';
    return 'Minnow';
  }

  function formatDuration(sec) {
    const rounded = Math.max(0, Math.round(sec));
    const mins = Math.floor(rounded / 60);
    const rem = rounded % 60;
    return mins > 0 ? `${mins}m ${rem}s` : `${rem}s`;
  }

  function closeTankClearedModal() {
    const existing = document.getElementById('tank-cleared-modal');
    if (existing) {
      existing.remove();
    }
  }

  function openTankClearedModal() {
    closeTankClearedModal();

    const totalAttempts = gameState.correctClicks + gameState.wrongClicks;
    const accuracyPct = totalAttempts > 0
      ? Math.round((gameState.correctClicks / totalAttempts) * 100)
      : 100;
    const rank = getRankTitle(accuracyPct, gameState.score);
    const formattedTime = formatDuration(gameState.totalTimeSec);

    const modal = document.createElement('div');
    modal.id = 'tank-cleared-modal';
    modal.className = 'cleared-modal-backdrop';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'cleared-modal-title');

    modal.innerHTML = `
      <div class="cleared-modal-card">
        <div class="cleared-badge">ALL 8 SPECIES CAUGHT</div>
        <h2 id="cleared-modal-title" class="cleared-title">Tank Cleared!</h2>
        <p class="cleared-rank-line">Rank Achieved: <strong class="cleared-rank">${escapeHtml(rank)}</strong></p>

        <div class="cleared-stats-grid">
          <div class="cleared-stat">
            <span class="cleared-stat-label">Final Score</span>
            <strong class="cleared-stat-value">${Math.max(0, Math.round(gameState.score)).toLocaleString()}</strong>
          </div>
          <div class="cleared-stat">
            <span class="cleared-stat-label">Best Score</span>
            <strong class="cleared-stat-value">${Math.max(0, Math.round(gameState.bestScore)).toLocaleString()}</strong>
          </div>
          <div class="cleared-stat">
            <span class="cleared-stat-label">Total Time</span>
            <strong class="cleared-stat-value">${escapeHtml(formattedTime)}</strong>
          </div>
          <div class="cleared-stat">
            <span class="cleared-stat-label">Accuracy</span>
            <strong class="cleared-stat-value">${accuracyPct}%</strong>
          </div>
        </div>

        <div class="cleared-actions">
          <button type="button" id="play-again-btn" class="pill-btn cleared-play-btn">Play again</button>
          <a href="collection.html" class="pill-btn field-guide-btn">View Field Guide</a>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const playAgainBtn = document.getElementById('play-again-btn');
    if (playAgainBtn) {
      playAgainBtn.focus();
      playAgainBtn.addEventListener('click', () => {
        closeTankClearedModal();
        const resetData = window.Storage && typeof window.Storage.resetProgress === 'function'
          ? window.Storage.resetProgress()
          : { score: 0, bestScore: gameState.bestScore, caughtIds: [], totalTimeSec: 0, correctClicks: 0, wrongClicks: 0, onboardingSeen: true, speciesStats: {} };

        gameState.score = resetData.score || 0;
        gameState.bestScore = Math.max(gameState.bestScore, resetData.bestScore || 0);
        gameState.caughtIds = [];
        gameState.totalTimeSec = 0;
        gameState.correctClicks = 0;
        gameState.wrongClicks = 0;
        gameState.onboardingSeen = true;
        gameState.speciesStats = {};
        gameState.modalShownForRun = false;

        if (window.Tank) {
          if (typeof window.Tank.setCaughtIds === 'function') window.Tank.setCaughtIds([]);
          if (typeof window.Tank.setSpecies === 'function' && gameState.species.length > 0) {
            window.Tank.setSpecies(gameState.species);
          }
        }
        updateHud();
        renderEmptyInspector();
      });
    }
  }

  function handleHintClick() {
    const sp = gameState.activeSpecies;
    if (!sp || gameState.isCatching) return;

    const flags = Array.isArray(sp.redFlags) ? sp.redFlags : [];
    const unfound = flags.filter((f) => !gameState.foundFlagIds.has(f.id));
    if (unfound.length === 0) return;

    gameState.fishHintsUsed += 1;
    gameState.score = Math.max(0, gameState.score - HINT_COST);

    const chosen = gameState.hintedFlagId && unfound.some((f) => f.id === gameState.hintedFlagId)
      ? unfound.find((f) => f.id === gameState.hintedFlagId)
      : unfound[0];

    gameState.hintedFlagId = chosen.id;
    gameState.activeExplanation = {
      kind: 'hint active',
      explanation: `Pulsing an unfound red flag in the email (-${HINT_COST} pts). Click the glowing highlight to inspect it!`
    };

    persistNow();
    updateHud();
    renderInspector(false);
  }

  function bindInspectorEvents() {
    const { inspectorEl } = getEls();
    if (!inspectorEl) return;

    const hintBtn = inspectorEl.querySelector('#hint-btn');
    if (hintBtn) {
      hintBtn.addEventListener('click', handleHintClick);
    }

    const sp = gameState.activeSpecies;
    const flags = sp && Array.isArray(sp.redFlags) ? sp.redFlags : [];

    inspectorEl.querySelectorAll('.flag-token').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const flagId = btn.getAttribute('data-flag-id');
        const flagObj = flags.find((f) => f.id === flagId);
        if (flagObj) {
          handleFlagFound(flagObj);
        }
      });
    });

    const emailSheet = inspectorEl.querySelector('.email-sheet');
    if (emailSheet) {
      emailSheet.addEventListener('click', (e) => {
        if (e.target.closest('.flag-token')) return;
        if (gameState.isCatching || !gameState.activeSpecies) return;
        triggerWrongClickFeedback();
      });
    }
  }

  function selectFishSpecies(species) {
    if (!species || gameState.isCatching) return;
    if (gameState.caughtIds.includes(species.id)) return;

    dismissOnboarding();

    gameState.activeSpecies = species;
    gameState.inspectStartMs = performance.now();
    gameState.fishWrongClicks = 0;
    gameState.fishHintsUsed = 0;
    gameState.foundFlagIds = new Set();
    gameState.justStampedFlagId = null;
    gameState.activeExplanation = null;
    gameState.hintedFlagId = null;

    if (window.Tank && typeof window.Tank.setFrozenFish === 'function') {
      window.Tank.setFrozenFish(species.id);
    }

    renderInspector(true);
  }

  async function loadSpeciesData() {
    try {
      const res = await fetch('data/phish.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    } catch (_) {
      // Fallback if opened over file:// without HTTP server
    }

    return [
      {
        id: 'bulk-phish',
        name: 'Bulk Phish',
        colour: '#D85A30',
        shape: 'classic',
        difficulty: 1,
        email: {
          fromName: 'PayPai Security',
          fromAddress: 'support@paypai-alerts-center.com',
          subject: 'URGENT: Your account will be suspended in 24 hours',
          body: 'Dear valued customer, we noticed unusual sign-in activity on your profile. URGENT: Your account will be suspended in 24 hours unless you confirm your details right now.',
          linkText: 'Verify My Account Now'
        },
        redFlags: [
          { id: 'rf-1', kind: 'sender', text: 'support@paypai-alerts-center.com', explanation: 'Lookalike domain alert — verify sender addresses carefully.' },
          { id: 'rf-2', kind: 'urgency', text: 'URGENT: Your account will be suspended in 24 hours', explanation: 'Artificial 24-hour panic deadlines push hasty clicks.' },
          { id: 'rf-3', kind: 'greeting', text: 'Dear valued customer', explanation: 'Generic mass-email greetings often signal a wide phishing blast.' }
        ]
      }
    ];
  }

  async function initGame() {
    ensureNewGameButton();

    if (window.Storage && typeof window.Storage.loadProgress === 'function') {
      const saved = window.Storage.loadProgress();
      if (saved) {
        gameState.score = saved.score || 0;
        gameState.bestScore = saved.bestScore || 0;
        gameState.caughtIds = Array.isArray(saved.caughtIds) ? saved.caughtIds.slice() : [];
        gameState.totalTimeSec = saved.totalTimeSec || 0;
        gameState.correctClicks = saved.correctClicks || 0;
        gameState.wrongClicks = saved.wrongClicks || 0;
        gameState.onboardingSeen = Boolean(saved.onboardingSeen);
        gameState.speciesStats = saved.speciesStats || {};
      }
    }

    gameState.species = await loadSpeciesData();
    updateHud();
    renderOnboardingSticker();

    if (window.Tank) {
      if (typeof window.Tank.setSpecies === 'function') {
        window.Tank.setSpecies(gameState.species);
      }
      if (typeof window.Tank.setCaughtIds === 'function') {
        window.Tank.setCaughtIds(gameState.caughtIds);
      }
      if (typeof window.Tank.onClick === 'function') {
        window.Tank.onClick((fish) => {
          const sp = fish && fish.species
            ? gameState.species.find((item) => item.id === fish.species.id) || fish.species
            : gameState.species.find((item) => item.id === fish.id);
          selectFishSpecies(sp);
        });
      }
    }

    renderEmptyInspector();

    const totalSpecies = gameState.species.length || 8;
    if (gameState.caughtIds.length >= totalSpecies && !gameState.modalShownForRun) {
      gameState.modalShownForRun = true;
      openTankClearedModal();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGame);
  } else {
    initGame();
  }
})();