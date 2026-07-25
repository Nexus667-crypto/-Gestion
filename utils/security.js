const logger = require('./logger');

async function safeExecute(fn, context = 'unknown') {
  try {
    return await fn();
  } catch (err) {
    logger.error(`[SECURITY] Erreur dans ${context}:`, err);
    return null;
  }
}

function validateDuration(duration, maxDays) {
  const ms = duration * 1000;
  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  if (ms > maxMs) return { ok: false, reason: `Durée maximale : ${maxDays} jour(s).` };
  if (ms <= 0) return { ok: false, reason: 'Durée invalide.' };
  return { ok: true };
}

module.exports = { safeExecute, validateDuration };
