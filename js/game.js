/**
 * js/game.js
 * Core inspection, red-flag spotting, scoring, hint, and catch loop
 * for "The Phishing Aquarium".
 */
(function () {
  const FLAG_POINTS = 100;
  const CATCH_BONUS = 150;
  const WRONG_PENALTY = 25;
  const HINT_COST = 50;

  const gameState = {
    species: [],
    score: 0,
    caughtIds: [],
    activeSpecies: null,
    foundFlagIds: new Set(),
    activeExplanation: null,
    hintedFlagId: null,
    isCatching: false,
    toastTimer: null
  };

  function getEls() {
    return {
      scoreEl: document.getElementById('score-display'),
      caughtEl: document.getElementById('caught-display'),
      inspectorEl: document.getElementById('inspector-card'),
      slotsWrap: document.querySelector('.collection-slots'),
      viewportEl: document.querySelector('.tank-viewport')
    };
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateHud() {
    const { scoreEl, caughtEl } = getEls();
    if (scoreEl) {
      scoreEl.textContent = gameState.score.toLocaleString();
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
    }, 2800);
  }

  /**
   * Splits a plain-text field into clickable/focusable red-flag buttons
   * and normal text segments without mutating surrounding characters.
   */
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

    // Sort left-to-right and discard overlapping segments
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
      const classes = ['flag-token'];
      if (isFound) classes.push('is-found');
      if (isHinted) classes.push('is-hinted');

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

  function renderInspector() {
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

    bindInspectorEvents();
  }

  function triggerWrongClickFeedback() {
    gameState.score = Math.max(0, gameState.score - WRONG_PENALTY);
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
    renderInspector();
  }

  function handleFlagFound(flag) {
    if (!flag || gameState.foundFlagIds.has(flag.id) || gameState.isCatching) return;

    gameState.foundFlagIds.add(flag.id);
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

    updateHud();
    renderInspector();

    if (sp && foundCount >= totalFlags) {
      completeCatch(sp);
    }
  }

  function completeCatch(species) {
    if (!species || gameState.isCatching) return;
    gameState.isCatching = true;

    const slotIndex = gameState.caughtIds.length;
    if (!gameState.caughtIds.includes(species.id)) {
      gameState.caughtIds.push(species.id);
    }
    gameState.score += CATCH_BONUS;

    if (window.Storage && typeof window.Storage.saveProgress === 'function') {
      window.Storage.saveProgress({
        score: gameState.score,
        caughtIds: gameState.caughtIds.slice()
      });
    }

    updateHud();
    showToast(`Caught ${species.name}! +${CATCH_BONUS} bonus pts`);

    if (window.Tank && typeof window.Tank.playCatchAnimation === 'function') {
      window.Tank.playCatchAnimation(species.id, slotIndex);
    }

    window.setTimeout(() => {
      gameState.activeSpecies = null;
      gameState.foundFlagIds = new Set();
      gameState.activeExplanation = null;
      gameState.hintedFlagId = null;
      gameState.isCatching = false;
      if (window.Tank && typeof window.Tank.setFrozenFish === 'function') {
        window.Tank.setFrozenFish(null);
      }
      renderEmptyInspector();
    }, 680);
  }

  function handleHintClick() {
    const sp = gameState.activeSpecies;
    if (!sp || gameState.isCatching) return;

    const flags = Array.isArray(sp.redFlags) ? sp.redFlags : [];
    const unfound = flags.filter((f) => !gameState.foundFlagIds.has(f.id));
    if (unfound.length === 0) return;

    gameState.score = Math.max(0, gameState.score - HINT_COST);
    const chosen = gameState.hintedFlagId && unfound.some((f) => f.id === gameState.hintedFlagId)
      ? unfound.find((f) => f.id === gameState.hintedFlagId)
      : unfound[0];

    gameState.hintedFlagId = chosen.id;
    gameState.activeExplanation = {
      kind: 'hint active',
      explanation: `Pulsing an unfound red flag in the email (${HINT_COST} pts). Click the glowing highlight to inspect it!`
    };

    updateHud();
    renderInspector();
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

    // Clicking non-flag email text costs 25 points and shakes
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

    gameState.activeSpecies = species;
    gameState.foundFlagIds = new Set();
    gameState.activeExplanation = null;
    gameState.hintedFlagId = null;

    if (window.Tank && typeof window.Tank.setFrozenFish === 'function') {
      window.Tank.setFrozenFish(species.id);
    }

    renderInspector();
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
    if (window.Storage && typeof window.Storage.loadProgress === 'function') {
      const saved = window.Storage.loadProgress();
      if (saved && typeof saved.score === 'number') {
        gameState.score = saved.score;
      }
      if (saved && Array.isArray(saved.caughtIds)) {
        gameState.caughtIds = saved.caughtIds.slice();
      }
    }

    gameState.species = await loadSpeciesData();
    updateHud();

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGame);
  } else {
    initGame();
  }
})();