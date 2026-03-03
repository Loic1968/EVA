/**
 * Personal tools layer — enforces tools-first for flight/calendar questions.
 * Reads EVA_PERSONAL_TOOLS_ENABLED. Classifies intents, builds expanded queries,
 * and returns structured status (OK, AUTH_ERROR, EMPTY, etc.).
 */

const INTENTS = Object.freeze({
  FLIGHT_QUESTION: 'flight_question',
  CALENDAR_QUESTION: 'calendar_question',
  GENERAL_NEWS: 'general_news',
  GENERAL_CHAT: 'general_chat',
});

const STATUS = Object.freeze({
  OK: 'OK',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  AUTH_ERROR: 'AUTH_ERROR',
  EMPTY_RESULT: 'EMPTY_RESULT',
  RATE_LIMIT: 'RATE_LIMIT',
  TIMEOUT: 'TIMEOUT',
  ERROR: 'ERROR',
});

const FLIGHT_PATTERNS = /\b(?:vol|vols?|vole|billet|e-ticket|e-ticket|avion|flight|itinerary|itin[eé]raire|PVG|SHA|Shanghai|booking|r[eé]servation|confirmation|PNR)\b/i;
const FLIGHT_DEST_PATTERNS = /\b(Shanghai|shanaghai|PVG|SHA|Dubai|DXB|Paris|CDG|London|LHR|Singapore|SIN|Hong Kong|HKG|Doha|DOH)\b/i;

const CALENDAR_PATTERNS = /\b(?:meeting|rdv|rendez-vous|calendrier|calendar|agenda|schedule|plann|prochain|demain|aujourd'hui|lundi|mardi|mercredi|jeudi|vendredi)\b/i;

const NEWS_PATTERNS = /\b(?:quoi de neuf|what'?s new|actualit[eé]s?|latest news|ce qui se passe)\b.*\b(dubai|paris|london|shanghai|singapore)\b/i;

function isPersonalToolsEnabled() {
  const v = process.env.EVA_PERSONAL_TOOLS_ENABLED;
  return v === 'true' || v === '1' || v === 'yes';
}

function classifyIntent(userMessage) {
  const m = (userMessage || '').trim();
  if (!m) return INTENTS.GENERAL_CHAT;
  if (NEWS_PATTERNS.test(m)) return INTENTS.GENERAL_NEWS;
  if (FLIGHT_PATTERNS.test(m) || FLIGHT_DEST_PATTERNS.test(m)) return INTENTS.FLIGHT_QUESTION;
  if (CALENDAR_PATTERNS.test(m)) return INTENTS.CALENDAR_QUESTION;
  return INTENTS.GENERAL_CHAT;
}

/**
 * Build expanded Gmail search query for flight/itinerary.
 * Destination-only "Shanghai" -> "Shanghai PVG SHA itinerary e-ticket booking"
 */
function buildFlightEmailQuery(userMessage) {
  const terms = [];
  const destMatch = (userMessage || '').match(FLIGHT_DEST_PATTERNS);
  if (destMatch) {
    const dest = destMatch[1].toLowerCase();
    if (/shanghai|pvg|sha/i.test(dest)) {
      terms.push('Shanghai', 'PVG', 'SHA');
    } else if (/dubai|dxb/i.test(dest)) {
      terms.push('Dubai', 'DXB', 'Emirates');
    } else if (/paris|cdg/i.test(dest)) {
      terms.push('Paris', 'CDG');
    } else {
      terms.push(destMatch[1]);
    }
  }
  terms.push('itinerary', 'e-ticket', 'booking', 'PNR', 'flight number', 'Emirates', 'China Eastern', 'Air China');
  return [...new Set(terms)].join(' ');
}

/**
 * Build calendar search query for flight events.
 */
function buildFlightCalendarQuery() {
  return 'flight e-ticket itinerary booking PNR airline';
}

function simpleHash(obj) {
  try {
    const s = JSON.stringify(obj);
    let h = 0;
    for (let i = 0; i < Math.min(s.length, 50); i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
    return Math.abs(h).toString(36);
  } catch {
    return '?';
  }
}

/**
 * Mask email for logs: l***@domain.com
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '—';
  const [local, domain] = email.split('@');
  if (!domain) return '—';
  const mask = local && local.length > 1 ? local[0] + '***' : '***';
  return `${mask}@${domain}`;
}

/**
 * TEMP debug log — safe, redacted.
 */
function logToolCall(toolName, argsHash, status, detail = '') {
  if (process.env.EVA_DEBUG !== 'true' && process.env.EVA_PERSONAL_TOOLS_DEBUG !== 'true') return;
  const detailStr = detail ? ` | ${detail}` : '';
  console.log(`[EVA personal-tools] ${toolName} args#${argsHash} → ${status}${detailStr}`);
}

function isAuthError(err) {
  const msg = String(err?.message || err?.code || err);
  return /invalid_grant|Token has been expired|revoked|access_denied|insufficient.*scope|401|403/i.test(msg);
}

function isRateLimitError(err) {
  const msg = String(err?.message || err?.code || err);
  return /rate limit|quota exceeded|429|too many requests/i.test(msg);
}

function isTimeoutError(err) {
  const msg = String(err?.message || err?.code || err);
  return /timeout|ETIMEDOUT|ECONNRESET/i.test(msg);
}

/**
 * Fetch calendar + gmail + docs for flight_question intent. Tools-first, with auth error detection.
 * @returns {{ calendarEvents: any[], emails: any[], docs: any[], authBlock: string|null, statuses: object }}
 */
async function fetchFlightContext(ownerId, userMessage) {
  const result = {
    calendarEvents: [],
    emails: [],
    docs: [],
    authBlock: null,
    statuses: { calendar: STATUS.OK, gmail: STATUS.OK, documents: STATUS.OK },
  };

  try {
    const calSync = require('./calendarSync');
    const gmailSync = require('./gmailSync');
    const docProcessor = require('./documentProcessor');

    const flightCalQuery = buildFlightCalendarQuery();
    const flightEmailQuery = buildFlightEmailQuery(userMessage);

    // 1. Calendar search (flight events in ±30/90 days)
    try {
      const events = await calSync.searchCalendarEvents(ownerId, flightCalQuery, 30, 90, 20);
      result.calendarEvents = events || [];
      result.statuses.calendar = result.calendarEvents.length > 0 ? STATUS.OK : STATUS.EMPTY_RESULT;
      logToolCall('calendar.search_events', simpleHash({ query: flightCalQuery }), result.statuses.calendar, `count=${result.calendarEvents.length}`);
    } catch (err) {
      if (isAuthError(err)) {
        result.statuses.calendar = STATUS.AUTH_ERROR;
        result.authBlock = result.authBlock || '## Google connection: AUTH_ERROR — Reconnect Google account in Data Sources (Paramètres > Données). EVA cannot read Calendar/Gmail right now. Tell user: "Your Google connection needs re-auth. Reconnect Google account in Data Sources." Do NOT ask airline/date.';
      } else if (isRateLimitError(err)) {
        result.statuses.calendar = STATUS.RATE_LIMIT;
      } else if (isTimeoutError(err)) {
        result.statuses.calendar = STATUS.TIMEOUT;
      } else {
        result.statuses.calendar = STATUS.ERROR;
      }
      logToolCall('calendar.search_events', simpleHash({ query: flightCalQuery }), result.statuses.calendar, err.message);
    }

    // 2. Gmail search (expanded flight query)
    try {
      const emails = await gmailSync.searchEmails(ownerId, flightEmailQuery, 8, null, 'all');
      result.emails = emails || [];
      result.statuses.gmail = result.emails.length > 0 ? STATUS.OK : STATUS.EMPTY_RESULT;
      logToolCall('gmail.search', simpleHash({ query: flightEmailQuery.slice(0, 50) }), result.statuses.gmail, `count=${result.emails.length}`);
    } catch (err) {
      if (isAuthError(err)) {
        result.statuses.gmail = STATUS.AUTH_ERROR;
        result.authBlock = result.authBlock || '## Google connection: AUTH_ERROR — Reconnect Google account in Data Sources. Tell user: "Your Google connection needs re-auth. Reconnect Google account in Data Sources." Do NOT ask airline/date.';
      } else {
        result.statuses.gmail = STATUS.ERROR;
      }
      logToolCall('gmail.search', simpleHash({ query: flightEmailQuery.slice(0, 50) }), result.statuses.gmail, err.message);
    }

    // 3. Documents (Memory Vault) — flight keywords
    try {
      let docs = await docProcessor.searchDocuments(ownerId, userMessage + ' ' + flightEmailQuery, 8);
      if (docs.length === 0) docs = await docProcessor.getRecentDocuments(ownerId, 5);
      result.docs = docs || [];
      result.statuses.documents = result.docs.length > 0 ? STATUS.OK : STATUS.EMPTY_RESULT;
      logToolCall('documents.search', simpleHash({ query: userMessage.slice(0, 30) }), result.statuses.documents, `count=${result.docs.length}`);
    } catch (err) {
      result.statuses.documents = STATUS.ERROR;
      logToolCall('documents.search', simpleHash({}), STATUS.ERROR, err.message);
    }
  } catch (err) {
    console.warn('[EVA personalTools] fetchFlightContext failed:', err.message);
  }

  return result;
}

/**
 * Run diagnostic: calendar + gmail status. Used by "eva diag personal-tools".
 */
async function runDiagnostic(ownerId) {
  const out = {
    enabled: isPersonalToolsEnabled(),
    mailbox: null,
    authStatus: 'UNKNOWN',
    calendar: { status: 'NOT_RUN', count: 0 },
    gmail: { status: 'NOT_RUN', count: 0 },
  };

  try {
    const db = require('../db');
    const acct = await db.query(
      'SELECT id, gmail_address FROM eva.gmail_accounts WHERE owner_id = $1 LIMIT 1',
      [ownerId]
    );
    if (acct.rows[0]) {
      out.mailbox = maskEmail(acct.rows[0].gmail_address);
    }
  } catch (e) {
    out.mailbox = 'error';
  }

  const calSync = require('./calendarSync');
  const gmailSync = require('./gmailSync');

  try {
    const events = await calSync.searchCalendarEvents(ownerId, buildFlightCalendarQuery(), 30, 30, 10);
    out.calendar = { status: 'OK', count: events.length };
  } catch (err) {
    out.calendar = { status: isAuthError(err) ? 'AUTH_ERROR' : 'ERROR', count: 0, message: err.message };
  }

  try {
    const emails = await gmailSync.searchEmails(ownerId, buildFlightEmailQuery('itinerary Shanghai'), 5, null, 'all');
    out.gmail = { status: 'OK', count: emails.length };
  } catch (err) {
    out.gmail = { status: isAuthError(err) ? 'AUTH_ERROR' : 'ERROR', count: 0, message: err.message };
  }

  if (out.calendar.status === 'AUTH_ERROR' || out.gmail.status === 'AUTH_ERROR') {
    out.authStatus = 'FAIL';
  } else if (out.calendar.status === 'OK' || out.gmail.status === 'OK') {
    out.authStatus = 'OK';
  }

  return out;
}

module.exports = {
  INTENTS,
  STATUS,
  isPersonalToolsEnabled,
  classifyIntent,
  buildFlightEmailQuery,
  buildFlightCalendarQuery,
  simpleHash,
  maskEmail,
  logToolCall,
  isAuthError,
  fetchFlightContext,
  runDiagnostic,
};
