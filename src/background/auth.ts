import { toBase64Url } from '../shared/mime';
import { getKey, withDefaults } from '../shared/store';
import type { Settings } from '../shared/types';

/**
 * OAuth for any number of Google accounts.
 *
 * chrome.identity.getAuthToken only knows the one account signed into the
 * browser profile, so each account goes through launchWebAuthFlow with the
 * authorization-code flow and PKCE instead. That keeps a refresh token per
 * account. An "External" app in testing mode has its refresh tokens expire
 * after seven days; when that happens, Glance asks Google again without
 * showing anything (prompt=none), which works while the browser is still
 * signed in to that account. Only if that fails is the account marked as
 * needing a click to reconnect.
 */

export const SCOPES = [
  'openid',
  'email',
  'profile',
  // Read, label, archive, trash and send. Not permanent deletion.
  'https://www.googleapis.com/auth/gmail.modify',
];

interface StoredTokens {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

export interface Profile {
  email: string;
  name: string;
  picture?: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

async function client(): Promise<{ id: string; secret: string }> {
  const s = withDefaults(await getKey<Partial<Settings>>('settings'));
  const id = s.clientId || import.meta.env.WXT_GOOGLE_CLIENT_ID;
  const secret = s.clientSecret || import.meta.env.WXT_GOOGLE_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('Glance has no Google OAuth client yet. Add one in Settings › Google connection (see SETUP.md).');
  }
  return { id, secret };
}

export function redirectUri(): string {
  return chrome.identity.getRedirectURL('oauth2');
}

function randomString(bytes = 48): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

interface FlowOptions {
  interactive: boolean;
  loginHint?: string;
  prompt?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function runFlow({ interactive, loginHint, prompt }: FlowOptions): Promise<TokenResponse> {
  const { id, secret } = await client();
  const verifier = randomString();
  const state = randomString(16);
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'true',
    state,
  });
  if (prompt) params.set('prompt', prompt);
  if (loginHint) params.set('login_hint', loginHint);

  let redirected: string | undefined;
  try {
    redirected = await chrome.identity.launchWebAuthFlow({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      interactive,
    });
  } catch (e) {
    throw new AuthError(e instanceof Error ? e.message : String(e));
  }
  if (!redirected) throw new AuthError('Sign-in was cancelled.');

  const url = new URL(redirected);
  const back = new URLSearchParams(url.search || url.hash.slice(1));
  if (back.get('error')) throw new AuthError(back.get('error_description') || back.get('error')!);
  if (back.get('state') !== state) throw new AuthError('Sign-in came back with the wrong state. Try again.');
  const code = back.get('code');
  if (!code) throw new AuthError('Google did not return an authorization code.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) throw new AuthError(json.error_description || json.error || `Token exchange failed (${res.status})`);
  if (!json.refresh_token && interactive) {
    // Can happen if the scope was already granted without offline access.
    console.warn('[glance] no refresh token returned; will rely on silent re-auth');
  }
  return json;
}

const tokenKey = (accountId: string) => `tokens:${accountId}`;

async function readTokens(accountId: string): Promise<StoredTokens | undefined> {
  return getKey<StoredTokens>(tokenKey(accountId));
}

async function writeTokens(accountId: string, tokens: StoredTokens) {
  await chrome.storage.local.set({ [tokenKey(accountId)]: tokens });
}

export async function forgetTokens(accountId: string) {
  const tokens = await readTokens(accountId);
  await chrome.storage.local.remove(tokenKey(accountId));
  const revoke = tokens?.refreshToken ?? tokens?.accessToken;
  if (revoke) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(revoke)}`, { method: 'POST' }).catch(() => {});
  }
}

async function store(accountId: string, res: TokenResponse, previousRefresh?: string) {
  await writeTokens(accountId, {
    accessToken: res.access_token,
    expiresAt: Date.now() + res.expires_in * 1000,
    refreshToken: res.refresh_token ?? previousRefresh,
  });
}

async function fetchProfile(accessToken: string): Promise<Profile> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new AuthError(`Could not read the account profile (${res.status})`);
  const p = await res.json();
  return { email: String(p.email), name: String(p.name || p.email), picture: p.picture };
}

/** Interactive sign-in for a new account, or to reconnect one. */
export async function signIn(loginHint?: string): Promise<Profile> {
  const res = await runFlow({
    interactive: true,
    loginHint,
    prompt: loginHint ? 'consent' : 'select_account consent',
  });
  const profile = await fetchProfile(res.access_token);
  const id = profile.email.toLowerCase();
  if (loginHint && id !== loginHint.toLowerCase()) {
    throw new AuthError(`You signed in as ${profile.email}, not ${loginHint}.`);
  }
  const existing = await readTokens(id);
  await store(id, res, existing?.refreshToken);
  return profile;
}

async function refresh(accountId: string, tokens: StoredTokens | undefined): Promise<string> {
  if (tokens?.refreshToken) {
    const { id, secret } = await client();
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const json = (await res.json().catch(() => ({}))) as TokenResponse;
    if (res.ok && json.access_token) {
      await store(accountId, json, tokens.refreshToken);
      return json.access_token;
    }
    // invalid_grant: expired (7-day testing limit), revoked, or password changed.
    // Anything else (network, 5xx) is worth retrying later rather than giving up.
    if (json.error !== 'invalid_grant') {
      throw new Error(json.error_description || `Token refresh failed (${res.status})`);
    }
  }

  try {
    const res = await runFlow({ interactive: false, loginHint: accountId, prompt: 'none' });
    await store(accountId, res, undefined);
    return res.access_token;
  } catch {
    throw new AuthError('Google signed this account out. Reconnect it to keep syncing.');
  }
}

const inflight = new Map<string, Promise<string>>();

/** A valid access token, refreshed at most once at a time per account. */
export async function accessToken(accountId: string, force = false): Promise<string> {
  const tokens = await readTokens(accountId);
  if (!force && tokens && tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
  let pending = inflight.get(accountId);
  if (!pending) {
    pending = refresh(accountId, tokens).finally(() => inflight.delete(accountId));
    inflight.set(accountId, pending);
  }
  return pending;
}
