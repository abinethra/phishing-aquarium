/**
 * js/game.js
 * Full inbox-style email viewer with word-by-word click & keyboard guessing,
 * link URL status preview, two-stage progressive hints (-50 / -100),
 * 6-wrong-click fish escape with 10s respawn, scoring, persistence,
 * New Game confirm, and Tank Cleared modal.
 */
(function () {
  const FLAG_POINTS = 100;
  const CATCH_BASE_POINTS = 300;
  const NO_WRONG_CLICK_BONUS = 100;
  const SPEED_BONUS_PER_SEC = 50;
  const SPEED_THRESHOLD_SEC = 20;
  const SPEED_BONUS_CAP = 200;
  const WRONG_PENALTY = 25;
  const MAX_WRONG_PER_FISH = 6;
  const ESCAPE_DURATION_MS = 10000;
  const HINT_FIRST_COST = 50;
  const HINT_SECOND_COST = 100;

  const FIELD_LABELS = {
    fromName: 'sender name',
    fromAddress: 'sender address',
    to: 'recipient field',
    date: 'date header',
    subject: 'subject line',
    body: 'email body',
    linkText: 'action link',
    attachmentName: 'attachment name',
    signature: 'signature',
    footer: 'footer'
  };

  const gameState = {
    species: [],
    score: 0,
    bestScore: 0,
    caughtIds: [],
    escapedIds: new Set(),
    escapeTimers: new Map(),
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
    wrongWordKeys: new Set(),
    shakenWordKey: null,
    hintStage: 0, // 0 = none, 1 = field narrowed, 2 = phrase revealed
    hintedFlagId: null,
    hoveredLinkUrl: '',
    feedbackNote: null, // { type: 'flag' | 'wrong' | 'hint', badge: string, text: string }
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

  function announceLive(message) {
    const { announcerEl } = getEls();
    if (!announcerEl) return;
    announcerEl.textContent = '';
    window.setTimeout(() => {
      announcerEl.textContent = message;
    }, 25);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function syncTankSpecies() {
    if (!window.Tank || typeof window.Tank.setSpecies !== 'function') return;
    const available = gameState.species.filter(
      (sp) => !gameState.caughtIds.includes(sp.id) && !gameState.escapedIds.has(sp.id)
    );
    window.Tank.setSpecies(available);
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

  function clearEscapeTimers() {
    gameState.escapeTimers.forEach((timerId) => window.clearTimeout(timerId));
    gameState.escapeTimers.clear();
    gameState.escapedIds.clear();
  }

  function resetActiveInspectionState() {
    gameState.activeSpecies = null;
    gameState.inspectStartMs = null;
    gameState.fishWrongClicks = 0;
    gameState.fishHintsUsed = 0;
    gameState.foundFlagIds = new Set();
    gameState.justStampedFlagId = null;
    gameState.wrongWordKeys = new Set();
    gameState.shakenWordKey = null;
    gameState.hintStage = 0;
    gameState.hintedFlagId = null;
    gameState.hoveredLinkUrl = '';
    gameState.feedbackNote = null;
    if (window.Tank && typeof window.Tank.setFrozenFish === 'function') {
      window.Tank.setFrozenFish(null);
    }
  }

  function handleNewGameClick() {
    const confirmed = window.confirm(
      'Start a new game? Your current score and caught fish in this run will be reset (your Best Score is kept).'
    );
    if (!confirmed) return;

    clearEscapeTimers();

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
    gameState.isCatching = false;
    gameState.modalShownForRun = false;
    resetActiveInspectionState();

    closeTankClearedModal();

    if (window.Tank && typeof window.Tank.setCaughtIds === 'function') {
      window.Tank.setCaughtIds([]);
    }
    syncTankSpecies();
    updateHud();
    renderEmptyInspector();
    showToast('New aquarium run started!');
    announceLive('New aquarium run started. Score reset to 0.');
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

  /**
   * Finds all matching red flags for a given field string and returns
   * character ranges { start, end, flag } along with which flag each char belongs to.
   */
  function getFieldFlagRanges(fieldName, text, redFlags) {
    const raw = String(text || '');
    if (!raw || !Array.isArray(redFlags)) return [];

    const matches = [];
    redFlags.forEach((flag) => {
      if (!flag || !flag.text) return;
      if (flag.field && flag.field !== fieldName) return;

      let searchFrom = 0;
      while (searchFrom < raw.length) {
        const idx = raw.indexOf(flag.text, searchFrom);
        if (idx === -1) break;
        matches.push({
          start: idx,
          end: idx + flag.text.length,
          flag
        });
        searchFrom = idx + flag.text.length;
      }
    });

    return matches;
  }

  /**
   * Tokenizes a field string into whitespace-separated word tokens while preserving
   * exact character indices in the field, attaching any overlapping red flag IDs.
   */
  function tokenizeFieldWords(fieldName, text, redFlags) {
    const raw = String(text || '');
    if (!raw) return [];

    const ranges = getFieldFlagRanges(fieldName, raw, redFlags);
    const tokens = [];
    const wordRegex = /\S+/g;
    let match;

    while ((match = wordRegex.exec(raw)) !== null) {
      const wStart = match.index;
      const wEnd = wStart + match[0].length;
      const matchingFlags = ranges
        .filter((r) => r.start < wEnd && r.end > wStart)
        .map((r) => r.flag);

      tokens.push({
        field: fieldName,
        word: match[0],
        start: wStart,
        end: wEnd,
        key: `${fieldName}:${wStart}:${wEnd}`,
        flags: matchingFlags
      });
    }

    return tokens;
  }

  /**
   * Renders a string with every word as a clickable span[role="button"][tabindex="0"].
   * Whole red flag phrases that are already found are grouped into a single highlighted span
   * in #F7C1C1 with #501313 text. Otherwise, words look like normal text with hover underline.
   */
  function renderClickableWordsHtml(fieldName, text, redFlags) {
    const raw = String(text || '');
    if (!raw) return '';

    const ranges = getFieldFlagRanges(fieldName, raw, redFlags);
    const tokens = tokenizeFieldWords(fieldName, raw, redFlags);
    if (tokens.length === 0) return escapeHtml(raw);

    // Group contiguous tokens belonging to the same *found* flag into one phrase highlight
    const renderedParts = [];
    let cursor = 0;
    let i = 0;

    while (i < tokens.length) {
      const tok = tokens[i];

      if (tok.start > cursor) {
        renderedParts.push(escapeHtml(raw.slice(cursor, tok.start)));
      }

      const foundFlag = tok.flags.find((f) => gameState.foundFlagIds.has(f.id));
      if (foundFlag) {
        // Find contiguous tokens covered by this foundFlag
        let j = i;
        let groupEnd = tok.end;
        while (j + 1 < tokens.length && tokens[j + 1].flags.some((f) => f.id === foundFlag.id)) {
          j += 1;
          groupEnd = tokens[j].end;
        }
        const phraseText = raw.slice(tok.start, groupEnd);
        const isStamped = gameState.justStampedFlagId === foundFlag.id;
        renderedParts.push(
          `<span class="mail-flag-found ${isStamped ? 'is-stamped' : ''}" data-found-flag-id="${escapeHtml(foundFlag.id)}" title="Found red flag: ${escapeHtml(foundFlag.kind)}">${escapeHtml(phraseText)}</span>`
        );
        cursor = groupEnd;
        i = j + 1;
        continue;
      }

      const isWrongTried = gameState.wrongWordKeys.has(tok.key);
      const isShaking = gameState.shakenWordKey === tok.key;
      const isHintRevealedPhrase =
        gameState.hintStage >= 2 &&
        gameState.hintedFlagId &&
        tok.flags.some((f) => f.id === gameState.hintedFlagId);

      const classes = ['mail-word'];
      if (isWrongTried) classes.push('is-wrong-tried');
      if (isShaking) classes.push('is-word-shaking');
      if (isHintRevealedPhrase) classes.push('is-hint-target');

      // Check if any flag overlaps this word for aria-label without giving away the answer
      const hasFlag = tok.flags.length > 0;
      const ariaLabel = hasFlag
        ? `Inspect word "${tok.word}" in ${FIELD_LABELS[fieldName] || fieldName}`
        : `Inspect word "${tok.word}" in ${FIELD_LABELS[fieldName] || fieldName}`;

      renderedParts.push(
        `<span class="${classes.join(' ')}" role="button" tabindex="0" data-word-key="${escapeHtml(tok.key)}" data-field="${escapeHtml(fieldName)}" data-start="${tok.start}" data-end="${tok.end}" aria-label="${escapeHtml(ariaLabel)}">${escapeHtml(tok.word)}</span>`
      );

      cursor = tok.end;
      i += 1;
    }

    if (cursor < raw.length) {
      renderedParts.push(escapeHtml(raw.slice(cursor)));
    }

    return renderedParts.join('');
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

  function getNextHintCost(flags, foundCount) {
    const unfound = flags.filter((f) => !gameState.foundFlagIds.has(f.id));
    if (unfound.length === 0) return null;
    if (gameState.hintStage < 1) return HINT_FIRST_COST;
    return HINT_SECOND_COST;
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

    const fromNameHtml = renderClickableWordsHtml('fromName', email.fromName || '', flags);
    const fromAddrHtml = renderClickableWordsHtml('fromAddress', email.fromAddress || '', flags);
    const toHtml = renderClickableWordsHtml('to', email.to || 'you@college.edu', flags);
    const dateHtml = renderClickableWordsHtml('date', email.date || '', flags);
    const subjectHtml = renderClickableWordsHtml('subject', email.subject || '', flags);

    const rawBody = String(email.body || '');
    const paragraphs = rawBody.split(/\n\n+/);
    let offset = 0;
    const bodyParagraphsHtml = paragraphs
      .map((para, idx) => {
        const idxInRaw = rawBody.indexOf(para, offset);
        const startPos = idxInRaw !== -1 ? idxInRaw : offset;
        offset = startPos + para.length + 2;

        // Render tokens within this paragraph offset
        const paraFlags = flags.map((f) => ({
          ...f
        }));
        const paraHtml = renderBodySliceHtml('body', rawBody, startPos, startPos + para.length, paraFlags);
        return `<p class="mail-para" data-para-index="${idx}">${paraHtml}</p>`;
      })
      .join('');

    const attachmentHtml = email.attachmentName
      ? `<div class="mail-attachment-row">
          <span class="mail-attachment-label">Attachment:</span>
          <span class="mail-attachment-chip">📎 ${renderClickableWordsHtml('attachmentName', email.attachmentName, flags)}</span>
        </div>`
      : '';

    const linkTextHtml = email.linkText
      ? renderClickableWordsHtml('linkText', email.linkText, flags)
      : '';

    const linkSectionHtml = email.linkText
      ? `<div class="mail-link-wrap">
          <button type="button" id="mail-action-link" class="mail-action-link" data-real-url="${escapeHtml(email.linkRealUrl || '')}">${linkTextHtml}</button>
        </div>`
      : '';

    const signatureHtml = email.signature
      ? `<div class="mail-signature">${renderClickableWordsHtml('signature', email.signature, flags).replace(/\n/g, '<br />')}</div>`
      : '';

    const footerHtml = email.footer
      ? `<div class="mail-footer">${renderClickableWordsHtml('footer', email.footer, flags)}</div>`
      : '';

    const statusBarText = gameState.hoveredLinkUrl
      ? `Destination: ${gameState.hoveredLinkUrl}`
      : 'Hover or focus the link button to preview its destination URL.';

    const segments = [];
    for (let i = 0; i < totalFlags; i++) {
      segments.push(
        `<span class="flag-seg ${i < foundCount ? 'is-filled' : ''}" aria-hidden="true"></span>`
      );
    }

    const nextHintCost = getNextHintCost(flags, foundCount);
    const canHint = nextHintCost !== null && !gameState.isCatching;
    const hintLabel = nextHintCost ? `Hint (-${nextHintCost})` : 'Hints used';

    let feedbackHtml = '';
    if (gameState.feedbackNote) {
      const fb = gameState.feedbackNote;
      const cardClass = fb.type === 'wrong' ? 'flag-explanation-card is-wrong-note' : 'flag-explanation-card';
      feedbackHtml = `
        <div class="${cardClass}" role="region" aria-label="Inspector feedback">
          <div class="explanation-badge">${escapeHtml(fb.badge)}</div>
          <p class="explanation-text">${escapeHtml(fb.text)}</p>
        </div>
      `;
    } else {
      feedbackHtml = `<p class="inspector-hint-copy">Read the email and click suspicious words to spot all ${totalFlags} red flags (${gameState.fishWrongClicks}/${MAX_WRONG_PER_FISH} wrong clicks).</p>`;
    }

    inspectorEl.innerHTML = `
      <div class="inspector-head">
        <div class="inspector-species-meta">
          <span class="species-dot" style="background-color: ${escapeHtml(sp.colour || '#D85A30')}"></span>
          <strong class="inspector-species-name">${escapeHtml(sp.name)}</strong>
        </div>
        <button type="button" id="hint-btn" class="hint-btn" ${canHint ? '' : 'disabled'} aria-label="${canHint ? `Use hint for ${nextHintCost} points` : 'No hints available'}">
          ${escapeHtml(hintLabel)}
        </button>
      </div>

      <div class="flag-progress-wrap" aria-label="${foundCount} of ${totalFlags} red flags found">
        <div class="flag-progress-bars">${segments.join('')}</div>
        <span class="flag-progress-label">${foundCount} / ${totalFlags} flags</span>
      </div>

      <div class="email-sheet" data-email-body>
        <div class="mail-headers">
          <div class="mail-header-row">
            <span class="mail-header-key">From:</span>
            <span class="mail-header-val">
              <span class="mail-from-name">${fromNameHtml}</span>
              <span class="mail-from-addr">&lt;${fromAddrHtml}&gt;</span>
            </span>
          </div>
          <div class="mail-header-row">
            <span class="mail-header-key">To:</span>
            <span class="mail-header-val">${toHtml}</span>
          </div>
          ${
            email.date
              ? `<div class="mail-header-row">
                  <span class="mail-header-key">Date:</span>
                  <span class="mail-header-val mail-date">${dateHtml}</span>
                </div>`
              : ''
          }
          <div class="mail-header-row">
            <span class="mail-header-key">Subject:</span>
            <span class="mail-header-val mail-subject">${subjectHtml}</span>
          </div>
        </div>

        <div class="mail-body-container">${bodyParagraphsHtml}</div>
        ${attachmentHtml}
        ${linkSectionHtml}
        ${signatureHtml}
        ${footerHtml}

        <div class="mail-url-status" role="status" aria-live="polite">
          ${escapeHtml(statusBarText)}
        </div>
      </div>

      ${feedbackHtml}
    `;

    if (shouldPop) {
      inspectorEl.classList.remove('is-popping');
      void inspectorEl.offsetWidth;
      inspectorEl.classList.add('is-popping');
    }

    gameState.justStampedFlagId = null;
    gameState.shakenWordKey = null;
    bindInspectorEvents();
  }

  /**
   * Renders a slice [sliceStart, sliceEnd) of a full field string while keeping
   * character offsets relative to the full field string so word keys match.
   */
  function renderBodySliceHtml(fieldName, fullText, sliceStart, sliceEnd, redFlags) {
    const raw = String(fullText || '');
    if (!raw || sliceEnd <= sliceStart) return '';

    const ranges = getFieldFlagRanges(fieldName, raw, redFlags);
    const allTokens = tokenizeFieldWords(fieldName, raw, redFlags);
    const sliceTokens = allTokens.filter((t) => t.start >= sliceStart && t.end <= sliceEnd);

    if (sliceTokens.length === 0) {
      return escapeHtml(raw.slice(sliceStart, sliceEnd));
    }

    const parts = [];
    let cursor = sliceStart;
    let i = 0;

    while (i < sliceTokens.length) {
      const tok = sliceTokens[i];
      if (tok.start > cursor) {
        parts.push(escapeHtml(raw.slice(cursor, tok.start)));
      }

      const foundFlag = tok.flags.find((f) => gameState.foundFlagIds.has(f.id));
      if (foundFlag) {
        let j = i;
        let groupEnd = tok.end;
        while (j + 1 < sliceTokens.length && sliceTokens[j + 1].flags.some((f) => f.id === foundFlag.id)) {
          j += 1;
          groupEnd = sliceTokens[j].end;
        }
        const phraseText = raw.slice(tok.start, groupEnd);
        const isStamped = gameState.justStampedFlagId === foundFlag.id;
        parts.push(
          `<span class="mail-flag-found ${isStamped ? 'is-stamped' : ''}" data-found-flag-id="${escapeHtml(foundFlag.id)}" title="Found red flag: ${escapeHtml(foundFlag.kind)}">${escapeHtml(phraseText)}</span>`
        );
        cursor = groupEnd;
        i = j + 1;
        continue;
      }

      const isWrongTried = gameState.wrongWordKeys.has(tok.key);
      const isShaking = gameState.shakenWordKey === tok.key;
      const isHintRevealedPhrase =
        gameState.hintStage >= 2 &&
        gameState.hintedFlagId &&
        tok.flags.some((f) => f.id === gameState.hintedFlagId);

      const classes = ['mail-word'];
      if (isWrongTried) classes.push('is-wrong-tried');
      if (isShaking) classes.push('is-word-shaking');
      if (isHintRevealedPhrase) classes.push('is-hint-target');

      parts.push(
        `<span class="${classes.join(' ')}" role="button" tabindex="0" data-word-key="${escapeHtml(tok.key)}" data-field="${escapeHtml(fieldName)}" data-start="${tok.start}" data-end="${tok.end}" aria-label="${escapeHtml(`Inspect word "${tok.word}"`)}">${escapeHtml(tok.word)}</span>`
      );

      cursor = tok.end;
      i += 1;
    }

    if (cursor < sliceEnd) {
      parts.push(escapeHtml(raw.slice(cursor, sliceEnd)));
    }

    return parts.join('');
  }

  function handleFishEscaped(species) {
    if (!species) return;
    const spId = species.id;
    const spName = species.name;

    resetActiveInspectionState();
    gameState.escapedIds.add(spId);
    syncTankSpecies();

    showToast('It got away!');
    announceLive(`${spName} got away! It will return to the tank in 10 seconds.`);
    renderEmptyInspector();

    if (gameState.escapeTimers.has(spId)) {
      window.clearTimeout(gameState.escapeTimers.get(spId));
    }

    const timerId = window.setTimeout(() => {
      gameState.escapeTimers.delete(spId);
      gameState.escapedIds.delete(spId);
      syncTankSpecies();
      showToast(`${spName} swam back into the tank!`);
    }, ESCAPE_DURATION_MS);

    gameState.escapeTimers.set(spId, timerId);
  }

  function registerWrongWord(wordKey, labelForAnnounce) {
    if (gameState.wrongWordKeys.has(wordKey)) {
      return; // Clicking the same wrong word twice does nothing
    }

    gameState.wrongWordKeys.add(wordKey);
    gameState.shakenWordKey = wordKey;
    gameState.wrongClicks += 1;
    gameState.fishWrongClicks += 1;
    gameState.score = Math.max(0, gameState.score - WRONG_PENALTY);

    persistNow();
    updateHud();

    if (gameState.fishWrongClicks >= MAX_WRONG_PER_FISH) {
      handleFishEscaped(gameState.activeSpecies);
      return;
    }

    gameState.feedbackNote = {
      type: 'wrong',
      badge: `-${WRONG_PENALTY} pts`,
      text: 'Looks fine, keep looking'
    };

    announceLive(`Looks fine, keep looking. Minus ${WRONG_PENALTY} points. ${gameState.fishWrongClicks} of ${MAX_WRONG_PER_FISH} wrong clicks used.`);
    renderInspector(false);
  }

  function handleFlagFound(flag) {
    if (!flag || gameState.foundFlagIds.has(flag.id) || gameState.isCatching) return;

    gameState.foundFlagIds.add(flag.id);
    gameState.justStampedFlagId = flag.id;
    gameState.correctClicks += 1;

    if (gameState.hintedFlagId === flag.id) {
      gameState.hintedFlagId = null;
      gameState.hintStage = 0;
    }

    gameState.score += FLAG_POINTS;
    gameState.feedbackNote = {
      type: 'flag',
      badge: flag.kind || 'red flag',
      text: flag.explanation
    };

    const sp = gameState.activeSpecies;
    const totalFlags = (sp && Array.isArray(sp.redFlags) && sp.redFlags.length) || 3;
    const foundCount = sp ? sp.redFlags.filter((f) => gameState.foundFlagIds.has(f.id)).length : 0;

    persistNow();
    updateHud();
    renderInspector(false);
    announceLive(`Found ${flag.kind} red flag! Plus ${FLAG_POINTS} points. ${foundCount} of ${totalFlags} flags found.`);

    if (sp && foundCount >= totalFlags) {
      completeCatch(sp);
    }
  }

  function handleWordTokenActivate(wordEl) {
    if (!gameState.activeSpecies || gameState.isCatching || !wordEl) return;

    const wordKey = wordEl.getAttribute('data-word-key');
    const fieldName = wordEl.getAttribute('data-field');
    const start = Number(wordEl.getAttribute('data-start'));
    const end = Number(wordEl.getAttribute('data-end'));

    if (!wordKey || gameState.wrongWordKeys.has(wordKey)) {
      return;
    }

    const email = gameState.activeSpecies.email || {};
    const flags = Array.isArray(gameState.activeSpecies.redFlags) ? gameState.activeSpecies.redFlags : [];
    const fieldText = fieldName === 'body' ? String(email.body || '') : String(email[fieldName] || '');
    const ranges = getFieldFlagRanges(fieldName, fieldText, flags);

    const matchingRange = ranges.find((r) => r.start < end && r.end > start);
    if (matchingRange && matchingRange.flag) {
      if (gameState.foundFlagIds.has(matchingRange.flag.id)) {
        return; // Clicking an already-found flag does nothing
      }
      handleFlagFound(matchingRange.flag);
    } else {
      registerWrongWord(wordKey, wordEl.textContent || '');
    }
  }

  function handleActionLinkActivate() {
    if (!gameState.activeSpecies || gameState.isCatching) return;

    const flags = Array.isArray(gameState.activeSpecies.redFlags) ? gameState.activeSpecies.redFlags : [];
    const linkFlag = flags.find((f) => f.kind === 'link' || f.field === 'linkText');

    if (linkFlag) {
      if (gameState.foundFlagIds.has(linkFlag.id)) {
        return; // Already found does nothing
      }
      handleFlagFound(linkFlag);
    } else {
      const linkKey = 'linkText:0:link';
      registerWrongWord(linkKey, gameState.activeSpecies.email.linkText || 'link');
    }
  }

  function handleHintClick() {
    const sp = gameState.activeSpecies;
    if (!sp || gameState.isCatching) return;

    const flags = Array.isArray(sp.redFlags) ? sp.redFlags : [];
    const unfound = flags.filter((f) => !gameState.foundFlagIds.has(f.id));
    if (unfound.length === 0) return;

    const targetFlag = gameState.hintedFlagId && unfound.some((f) => f.id === gameState.hintedFlagId)
      ? unfound.find((f) => f.id === gameState.hintedFlagId)
      : unfound[0];

    gameState.hintedFlagId = targetFlag.id;

    if (gameState.hintStage < 1) {
      gameState.score = Math.max(0, gameState.score - HINT_FIRST_COST);
      gameState.fishHintsUsed += 1;
      gameState.hintStage = 1;
      const partName = FIELD_LABELS[targetFlag.field] || 'the email';
      gameState.feedbackNote = {
        type: 'hint',
        badge: `Hint 1 (-${HINT_FIRST_COST})`,
        text: `Look at the ${partName}.`
      };
      announceLive(`Hint 1 used: Look at the ${partName}. Minus ${HINT_FIRST_COST} points.`);
    } else {
      gameState.score = Math.max(0, gameState.score - HINT_SECOND_COST);
      gameState.fishHintsUsed += 1;
      gameState.hintStage = 2;
      gameState.feedbackNote = {
        type: 'hint',
        badge: `Hint 2 (-${HINT_SECOND_COST})`,
        text: `Look for the phrase: "${targetFlag.text}"`
      };
      announceLive(`Hint 2 used: Look for the phrase ${targetFlag.text}. Minus ${HINT_SECOND_COST} points.`);
    }

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

    const wordNodes = Array.from(inspectorEl.querySelectorAll('.mail-word'));
    wordNodes.forEach((wordEl, idx) => {
      wordEl.addEventListener('click', (e) => {
        e.stopPropagation();
        handleWordTokenActivate(wordEl);
      });

      wordEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          handleWordTokenActivate(wordEl);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = wordNodes[(idx + 1) % wordNodes.length];
          if (next) next.focus();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = wordNodes[(idx - 1 + wordNodes.length) % wordNodes.length];
          if (prev) prev.focus();
        }
      });
    });

    const actionLinkBtn = inspectorEl.querySelector('#mail-action-link');
    if (actionLinkBtn) {
      actionLinkBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleActionLinkActivate();
      });

      const showUrl = () => {
        const realUrl = actionLinkBtn.getAttribute('data-real-url') || '';
        gameState.hoveredLinkUrl = realUrl;
        const bar = inspectorEl.querySelector('.mail-url-status');
        if (bar) {
          bar.textContent = realUrl
            ? `Destination: ${realUrl}`
            : 'No external link target listed.';
        }
      };

      const hideUrl = () => {
        gameState.hoveredLinkUrl = '';
        const bar = inspectorEl.querySelector('.mail-url-status');
        if (bar) {
          bar.textContent = 'Hover or focus the link button to preview its destination URL.';
        }
      };

      actionLinkBtn.addEventListener('mouseenter', showUrl);
      actionLinkBtn.addEventListener('focus', showUrl);
      actionLinkBtn.addEventListener('mouseleave', hideUrl);
      actionLinkBtn.addEventListener('blur', hideUrl);
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
    announceLive(`${species.name} caught! ${gameState.caughtIds.length} of ${totalSpecies} species collected. Score is now ${Math.round(gameState.score)}.`);

    if (window.Tank && typeof window.Tank.playCatchAnimation === 'function') {
      window.Tank.playCatchAnimation(species.id, slotIndex);
    }

    const allCaught = gameState.caughtIds.length >= totalSpecies;

    window.setTimeout(() => {
      gameState.isCatching = false;
      resetActiveInspectionState();
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
        clearEscapeTimers();
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
        resetActiveInspectionState();

        if (window.Tank && typeof window.Tank.setCaughtIds === 'function') {
          window.Tank.setCaughtIds([]);
        }
        syncTankSpecies();
        updateHud();
        renderEmptyInspector();
      });
    }
  }

  function selectFishSpecies(species) {
    if (!species || gameState.isCatching) return;
    if (gameState.caughtIds.includes(species.id) || gameState.escapedIds.has(species.id)) return;

    dismissOnboarding();

    gameState.activeSpecies = species;
    gameState.inspectStartMs = performance.now();
    gameState.fishWrongClicks = 0;
    gameState.fishHintsUsed = 0;
    gameState.foundFlagIds = new Set();
    gameState.justStampedFlagId = null;
    gameState.wrongWordKeys = new Set();
    gameState.shakenWordKey = null;
    gameState.hintStage = 0;
    gameState.hintedFlagId = null;
    gameState.hoveredLinkUrl = '';
    gameState.feedbackNote = null;

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
          fromName: 'PayPai Account Team',
          fromAddress: 'alerts@paypai-billing-notice.com',
          to: 'you@college.edu',
          date: 'Tue, 18 Nov, 9:42 AM',
          subject: 'URGENT: Your account will be locked today',
          body: 'Hello valued member,\n\nWe recently updated our routine billing checks across member profiles and noticed a pending verification item on your account.\n\nURGENT: Your account will be locked today if you do not confirm your recent billing information.\n\nThank you for banking with us.',
          linkText: 'Confirm Billing Details',
          linkRealUrl: 'https://paypai-billing-notice.com/login-check',
          signature: 'PayPai Member Care\nMember Support Desk',
          footer: 'PayPai Holdings Ltd., 400 Harbor Way.'
        },
        redFlags: [
          { id: 'bulk-rf-1', kind: 'sender', field: 'fromAddress', text: 'alerts@paypai-billing-notice.com', explanation: 'Lookalike domain alert — verify sender addresses carefully.' },
          { id: 'bulk-rf-2', kind: 'urgency', field: 'subject', text: 'URGENT: Your account will be locked today', explanation: 'All-caps lock threats push hasty clicks.' },
          { id: 'bulk-rf-3', kind: 'greeting', field: 'body', text: 'Hello valued member,', explanation: 'Generic greetings often signal a mass phishing blast.' }
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
      syncTankSpecies();
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