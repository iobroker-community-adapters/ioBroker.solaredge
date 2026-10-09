'use strict';

const crypto = require('node:crypto');

const AUTHORIZE_URL = 'https://connect.solaredge.com/authorize';
const TOKEN_URL = 'https://monitoringapi.solaredge.com/v2/oauth2/token';
const AUTH_STATE = 'info.auth';
// refresh a bit before the access token really expires
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
// used if the token response does not contain expires_in
const DEFAULT_EXPIRES_IN_S = 7200;

/**
 * Accepts either the bare authorization code or the complete redirect URL
 * the browser ended up on after the user granted access.
 * @param {string} [input]
 * @returns {string} the code or '' if none found
 */
function extractAuthCode(input) {
    const value = (input || '').trim();
    if (!value) {
        return '';
    }
    if (value.includes('code=')) {
        try {
            const url = new URL(value, 'https://localhost');
            return url.searchParams.get('code') || '';
        } catch {
            return '';
        }
    }
    return value;
}

/**
 * Extracts the site id from the redirect URL (SolarEdge appends it as `site_id`).
 * @param {string|undefined} input
 * @returns {string}
 */
function extractSiteId(input) {
    const value = (input || '').trim();
    if (!/[?&]site_?id=/i.test(value)) {
        return '';
    }
    try {
        const params = new URL(value, 'https://localhost').searchParams;
        return params.get('site_id') || params.get('siteId') || '';
    } catch {
        return '';
    }
}

function hash(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

class AuthError extends Error {}

/**
 * Provides the auth header for the SolarEdge Monitoring API v2.
 *
 * - Fleet Access: static API key in X-API-Key header.
 * - Site Access: OAuth2 authorization code flow with the user's own app (client id/secret).
 *   Tokens are stored encrypted in the state info.auth. SolarEdge rotates the refresh
 *   token on every use, so the new one is persisted before the access token is used.
 */
class SolarEdgeAuth {
    /**
     * @param {object} options
     * @param {ioBroker.Adapter} options.adapter
     * @param {(config: object) => Promise<any>} options.http axios-compatible request function
     * @param {string} [options.apiKey]
     * @param {string} [options.clientId]
     * @param {string} [options.clientSecret]
     * @param {string} [options.redirectUri]
     * @param {string} [options.authCode] code or redirect URL pasted by the user
     */
    constructor(options) {
        this.adapter = options.adapter;
        this.http = options.http;
        this.apiKey = options.apiKey;
        this.clientId = options.clientId;
        this.clientSecret = options.clientSecret;
        this.redirectUri = options.redirectUri;
        this.authCode = extractAuthCode(options.authCode);
        this.tokens = null;
        /** @type {Promise<string>|null} */
        this.pending = null;
    }

    get isApiKey() {
        return !!this.apiKey;
    }

    /**
     * @returns {Promise<Record<string, string>>}
     */
    async getHeaders() {
        if (this.isApiKey) {
            return { 'X-API-Key': this.apiKey };
        }
        return { Authorization: `Bearer ${await this.getAccessToken()}` };
    }

    /**
     * Forget the current access token, e.g. after a 401, so the next call refreshes it.
     * @returns {Promise<boolean>} true if a retry makes sense
     */
    async invalidateAccessToken() {
        if (this.isApiKey || !this.tokens || !this.tokens.refreshToken) {
            return false;
        }
        this.tokens.accessToken = '';
        this.tokens.expiresAt = 0;
        await this.saveTokens();
        return true;
    }

    /**
     * Concurrent callers share one token request, otherwise parallel refreshes
     * would use the same (rotating) refresh token and all but one would fail.
     * @returns {Promise<string>}
     */
    getAccessToken() {
        if (!this.pending) {
            this.pending = this.fetchAccessToken().finally(() => {
                this.pending = null;
            });
        }
        return this.pending;
    }

    async fetchAccessToken() {
        if (!this.tokens) {
            this.tokens = await this.loadTokens();
        }

        // a new code was entered in the config -> (re-)authorize
        // codes are single use, so each code is only tried once
        const codeHash = this.authCode ? hash(this.authCode) : '';
        if (codeHash && this.tokens.codeHash !== codeHash) {
            this.adapter.log.info('New authorization code found, requesting tokens');
            try {
                const response = await this.requestToken({
                    grant_type: 'authorization_code',
                    code: this.authCode,
                    redirect_uri: this.redirectUri,
                });
                await this.storeTokenResponse(response, codeHash);
                this.adapter.log.info('Authorization successful');
                return this.tokens.accessToken;
            } catch (error) {
                this.tokens.codeHash = codeHash;
                await this.saveTokens();
                const details = describeError(error);
                const hint = details.includes('redirect_uri')
                    ? `The redirect URI in the instance settings ("${this.redirectUri}") must be exactly the same as in your SolarEdge app.`
                    : 'Codes expire quickly, please authorize again and paste the new code.';
                const message = `Authorization with the entered code failed (${details}). ${hint}`;
                if (!this.tokens.refreshToken) {
                    throw new AuthError(message);
                }
                this.adapter.log.error(`${message} Using existing authorization.`);
            }
        }

        if (this.tokens.accessToken && Date.now() < this.tokens.expiresAt - EXPIRY_MARGIN_MS) {
            return this.tokens.accessToken;
        }

        if (!this.tokens.refreshToken) {
            throw new AuthError('Not authorized. Open the authorization link in the instance settings and paste the code or the redirect URL.');
        }

        this.adapter.log.debug('Refreshing access token');
        let response;
        try {
            response = await this.requestToken({
                grant_type: 'refresh_token',
                refresh_token: this.tokens.refreshToken,
            });
        } catch (error) {
            const status = error.response && error.response.status;
            if (status === 400 || status === 401) {
                // refresh token expired or revoked, user has to authorize again
                this.tokens.accessToken = '';
                this.tokens.refreshToken = '';
                this.tokens.expiresAt = 0;
                await this.saveTokens();
                throw new AuthError(`Authorization expired or revoked (${describeError(error)}). Please authorize again in the instance settings.`);
            }
            throw error;
        }
        await this.storeTokenResponse(response, this.tokens.codeHash);
        return this.tokens.accessToken;
    }

    /**
     * The token endpoint is documented differently by existing integrations
     * (form encoded with basic auth vs. JSON body). Try form first, JSON as fallback.
     * @param {Record<string, string>} params
     */
    async requestToken(params) {
        const response = await this.http({
            method: 'post',
            url: TOKEN_URL,
            data: { ...params, client_id: this.clientId, client_secret: this.clientSecret },
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        });
        return response.data;
    }

    async storeTokenResponse(data, codeHash) {
        if (!data || !data.access_token) {
            throw new AuthError('Token response did not contain an access token');
        }
        const expiresIn = Number(data.expires_in) || DEFAULT_EXPIRES_IN_S;
        this.tokens = {
            accessToken: data.access_token,
            // keep the old refresh token if none is returned
            refreshToken: data.refresh_token || (this.tokens && this.tokens.refreshToken) || '',
            expiresAt: Date.now() + expiresIn * 1000,
            codeHash: codeHash || '',
        };
        await this.saveTokens();
    }

    async loadTokens() {
        const empty = { accessToken: '', refreshToken: '', expiresAt: 0, codeHash: '' };
        try {
            const state = await this.adapter.getStateAsync(AUTH_STATE);
            if (state && state.val) {
                return { ...empty, ...JSON.parse(this.adapter.decrypt(String(state.val))) };
            }
        } catch (error) {
            this.adapter.log.warn(`Could not read stored tokens: ${error.message}`);
        }
        return empty;
    }

    async saveTokens() {
        await this.adapter.setStateAsync(AUTH_STATE, this.adapter.encrypt(JSON.stringify(this.tokens)), true);
    }
}

/**
 * @param {any} error axios error or other
 * @returns {string}
 */
function describeError(error) {
    if (error && error.response) {
        const data = error.response.data;
        return `${error.response.status}${data ? ` ${typeof data === 'string' ? data : JSON.stringify(data)}` : ''}`;
    }
    return error && error.message ? error.message : String(error);
}

module.exports = {
    AUTHORIZE_URL,
    TOKEN_URL,
    AuthError,
    SolarEdgeAuth,
    extractAuthCode,
    extractSiteId,
    describeError,
};
