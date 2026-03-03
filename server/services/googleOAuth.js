/**
 * Google OAuth2 Service for EVA Gmail Integration.
 * Handles token exchange, refresh, and Gmail API client creation.
 */
const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

function hasCredentials() {
  const clientId = process.env.EVA_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.EVA_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  return !!(clientId && clientSecret);
}

function getOAuth2Client() {
  if (!hasCredentials()) {
    throw new Error('EVA_GOOGLE_CLIENT_ID et EVA_GOOGLE_CLIENT_SECRET (ou GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) doivent être définis. Add to eva/.env — see .env.example');
  }
  const clientId = process.env.EVA_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.EVA_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.NODE_ENV === 'production'
      ? process.env.GOOGLE_OAUTH_REDIRECT_URI || 'https://eva.halisoft.biz/api/oauth/gmail/callback'
      : process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:5002/api/oauth/gmail/callback';

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Generate the Google OAuth consent URL.
 * @param {string} state – opaque state to pass through (e.g. ownerId)
 */
function getAuthUrl(state = '') {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',   // get refresh_token
    prompt: 'consent',        // always show consent to ensure refresh_token
    scope: SCOPES,
    state,
  });
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
async function exchangeCode(code) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date, scope, token_type }
}

/**
 * Refresh an access token using a stored refresh_token.
 */
async function refreshAccessToken(refreshToken) {
  const client = getOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials;
}

/**
 * Return an authenticated Gmail API client.
 */
function getGmailClient(accessToken, refreshToken) {
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return google.gmail({ version: 'v1', auth: client });
}

/**
 * Return an authenticated Google Calendar API client.
 */
function getCalendarClient(accessToken, refreshToken) {
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return google.calendar({ version: 'v3', auth: client });
}

/**
 * Get the authenticated user's email address.
 */
async function getUserEmail(accessToken, refreshToken) {
  const gmail = getGmailClient(accessToken, refreshToken);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.emailAddress;
}

/**
 * Revoke a token (on disconnect).
 */
async function revokeToken(token) {
  const client = getOAuth2Client();
  try {
    await client.revokeToken(token);
  } catch (err) {
    console.warn('Token revocation failed (may already be revoked):', err.message);
  }
}

module.exports = {
  hasCredentials,
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  getGmailClient,
  getCalendarClient,
  getUserEmail,
  revokeToken,
};
