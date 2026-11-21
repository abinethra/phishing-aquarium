/**
 * js/storage.js
 * localStorage persistence for "The Phishing Aquarium".
 * Saves score, caught species, best score, elapsed time, accuracy stats,
 * and per-species catch stats.
 */
(function () {
  const STORAGE_KEY = 'phishing_aquarium_save_v1';

  function getDefaultState() {
    return {
      score: 0,
      bestScore: 0,
      caughtIds: [],
      totalTimeSec: 0,
      correctClicks: 0,
      wrongClicks: 0,
      speciesStats: {}
    };
  }

  function sanitizeState(raw) {
    const base = getDefaultState();
    if (!raw || typeof raw !== 'object') return base;

    const score = typeof raw.score === 'number' && Number.isFinite(raw.score)
      ? Math.max(0, Math.round(raw.score))
      : 0;

    const bestScore = typeof raw.bestScore === 'number' && Number.isFinite(raw.bestScore)
      ? Math.max(0, Math.round(raw.bestScore), score)
      : score;

    const caughtIds = Array.isArray(raw.caughtIds)
      ? Array.from(new Set(raw.caughtIds.filter((id) => typeof id === 'string' && id.length > 0)))
      : [];

    const totalTimeSec = typeof raw.totalTimeSec === 'number' && Number.isFinite(raw.totalTimeSec)
      ? Math.max(0, raw.totalTimeSec)
      : 0;

    const correctClicks = typeof raw.correctClicks === 'number' && Number.isFinite(raw.correctClicks)
      ? Math.max(0, Math.round(raw.correctClicks))
      : 0;

    const wrongClicks = typeof raw.wrongClicks === 'number' && Number.isFinite(raw.wrongClicks)
      ? Math.max(0, Math.round(raw.wrongClicks))
      : 0;

    const speciesStats = {};
    if (raw.speciesStats && typeof raw.speciesStats === 'object') {
      Object.keys(raw.speciesStats).forEach((id) => {
        const entry = raw.speciesStats[id];
        if (!entry || typeof entry !== 'object') return;
        speciesStats[id] = {
          caught: Boolean(entry.caught),
          caughtCount: Math.max(0, Math.round(Number(entry.caughtCount) || 0)),
          bestTimeSec: entry.bestTimeSec == null ? null : Math.max(0, Number(entry.bestTimeSec) || 0),
          lastTimeSec: entry.lastTimeSec == null ? null : Math.max(0, Number(entry.lastTimeSec) || 0),
          wrongClicks: Math.max(0, Math.round(Number(entry.wrongClicks) || 0)),
          hintsUsed: Math.max(0, Math.round(Number(entry.hintsUsed) || 0)),
          lastPoints: Math.round(Number(entry.lastPoints) || 0),
          lastCaughtAt: typeof entry.lastCaughtAt === 'string' ? entry.lastCaughtAt : null
        };
      });
    }

    return {
      score,
      bestScore,
      caughtIds,
      totalTimeSec,
      correctClicks,
      wrongClicks,
      speciesStats
    };
  }

  function loadProgress() {
    try {
      const rawStr = window.localStorage.getItem(STORAGE_KEY);
      if (!rawStr) return getDefaultState();
      return sanitizeState(JSON.parse(rawStr));
    } catch (_) {
      return getDefaultState();
    }
  }

  function saveProgress(partialOrFull) {
    try {
      const current = loadProgress();
      const merged = sanitizeState({
        ...current,
        ...(partialOrFull || {}),
        bestScore: Math.max(
          current.bestScore || 0,
          (partialOrFull && partialOrFull.bestScore) || 0,
          (partialOrFull && typeof partialOrFull.score === 'number' ? partialOrFull.score : current.score) || 0
        )
      });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return merged;
    } catch (_) {
      return loadProgress();
    }
  }

  function recordSpeciesCatch(speciesId, stats = {}) {
    const current = loadProgress();
    const prev = current.speciesStats[speciesId] || {
      caught: false,
      caughtCount: 0,
      bestTimeSec: null,
      lastTimeSec: null,
      wrongClicks: 0,
      hintsUsed: 0,
      lastPoints: 0,
      lastCaughtAt: null
    };

    const elapsedSec = Math.max(0, Number(stats.elapsedSec) || 0);
    const wrongClicks = Math.max(0, Math.round(Number(stats.wrongClicks) || 0));
    const hintsUsed = Math.max(0, Math.round(Number(stats.hintsUsed) || 0));
    const pointsEarned = Math.round(Number(stats.pointsEarned) || 0);

    const bestTimeSec = prev.bestTimeSec == null
      ? elapsedSec
      : Math.min(prev.bestTimeSec, elapsedSec);

    current.speciesStats[speciesId] = {
      caught: true,
      caughtCount: prev.caughtCount + 1,
      bestTimeSec,
      lastTimeSec: elapsedSec,
      wrongClicks,
      hintsUsed,
      lastPoints: pointsEarned,
      lastCaughtAt: new Date().toISOString()
    };

    return saveProgress(current);
  }

  function resetProgress() {
    const existing = loadProgress();
    const fresh = {
      ...getDefaultState(),
      bestScore: existing.bestScore || 0
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch (_) {
      // Ignore storage quota / privacy errors
    }
    return fresh;
  }

  window.Storage = {
    KEY: STORAGE_KEY,
    getDefaultState,
    loadProgress,
    saveProgress,
    recordSpeciesCatch,
    resetProgress
  };
})();