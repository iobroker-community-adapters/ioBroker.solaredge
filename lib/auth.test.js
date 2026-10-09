'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const { SolarEdgeAuth, AuthError, TOKEN_URL, extractAuthCode, extractSiteId } = require('./auth');

function fakeAdapter(stored) {
    const states = {};
    if (stored) {
        states['info.auth'] = { val: `enc:${JSON.stringify(stored)}` };
    }
    return {
        states,
        log: { debug() {}, info() {}, warn() {}, error: sinon.spy() },
        encrypt: v => `enc:${v}`,
        decrypt: v => v.replace(/^enc:/, ''),
        getStateAsync: async id => states[id] || null,
        setStateAsync: async (id, val) => {
            states[id] = { val };
        },
        stored() {
            return JSON.parse(states['info.auth'].val.replace(/^enc:/, ''));
        },
    };
}

function httpError(status, data) {
    const error = new Error(`Request failed with status code ${status}`);
    // @ts-ignore
    error.response = { status, data };
    return error;
}

const oauthOptions = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://localhost/' };

describe('auth', () => {
    describe('extractAuthCode', () => {
        it('returns a bare code', () => {
            expect(extractAuthCode('  abc123 ')).to.equal('abc123');
        });
        it('extracts the code from a redirect URL', () => {
            expect(extractAuthCode('https://localhost/?code=xyz&site_id=1')).to.equal('xyz');
        });
        it('returns empty string for empty input', () => {
            expect(extractAuthCode(undefined)).to.equal('');
            expect(extractAuthCode('')).to.equal('');
        });
    });

    describe('extractSiteId', () => {
        it('extracts the site id from a redirect URL', () => {
            expect(extractSiteId('https://localhost/?code=xyz&site_id=12345')).to.equal('12345');
        });
        it('returns empty string for a bare code or empty input', () => {
            expect(extractSiteId('abc123')).to.equal('');
            expect(extractSiteId('https://localhost/?code=xyz')).to.equal('');
            expect(extractSiteId(undefined)).to.equal('');
        });
    });

    it('uses X-API-Key if an api key is set', async () => {
        const auth = new SolarEdgeAuth({ adapter: fakeAdapter(), http: sinon.stub(), apiKey: 'key' });
        expect(await auth.getHeaders()).to.deep.equal({ 'X-API-Key': 'key' });
    });

    it('throws AuthError if neither tokens nor code exist', async () => {
        const auth = new SolarEdgeAuth({ adapter: fakeAdapter(), http: sinon.stub(), ...oauthOptions });
        try {
            await auth.getHeaders();
            expect.fail('should throw');
        } catch (error) {
            expect(error).to.be.instanceOf(AuthError);
        }
    });

    it('exchanges a new code and stores the tokens', async () => {
        const adapter = fakeAdapter();
        const http = sinon.stub().resolves({ data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } });
        const auth = new SolarEdgeAuth({ adapter, http, ...oauthOptions, authCode: 'https://localhost/?code=c1' });

        expect(await auth.getHeaders()).to.deep.equal({ Authorization: 'Bearer at' });

        const req = http.firstCall.args[0];
        expect(req.url).to.equal(TOKEN_URL);
        expect(req.headers['Content-Type']).to.equal('application/json');
        expect(req.data).to.deep.equal({
            grant_type: 'authorization_code',
            code: 'c1',
            redirect_uri: 'https://localhost/',
            client_id: 'id',
            client_secret: 'secret',
        });

        const stored = adapter.stored();
        expect(stored.accessToken).to.equal('at');
        expect(stored.refreshToken).to.equal('rt');
        expect(stored.codeHash).to.be.a('string').and.not.empty;
    });

    it('does not exchange the same code twice', async () => {
        const http = sinon.stub().resolves({ data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } });
        const adapter = fakeAdapter();
        await new SolarEdgeAuth({ adapter, http, ...oauthOptions, authCode: 'c1' }).getHeaders();
        await new SolarEdgeAuth({ adapter, http, ...oauthOptions, authCode: 'c1' }).getHeaders();
        expect(http.callCount).to.equal(1);
    });

    it('uses a valid stored access token without request', async () => {
        const adapter = fakeAdapter({ accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600e3 });
        const http = sinon.stub();
        const auth = new SolarEdgeAuth({ adapter, http, ...oauthOptions });
        expect(await auth.getHeaders()).to.deep.equal({ Authorization: 'Bearer at' });
        expect(http.called).to.equal(false);
    });

    it('refreshes an expired token and persists the rotated refresh token', async () => {
        const adapter = fakeAdapter({ accessToken: 'old', refreshToken: 'rt1', expiresAt: Date.now() - 1 });
        const http = sinon.stub().resolves({ data: { access_token: 'new', refresh_token: 'rt2', expires_in: 3600 } });
        const auth = new SolarEdgeAuth({ adapter, http, ...oauthOptions });

        expect(await auth.getHeaders()).to.deep.equal({ Authorization: 'Bearer new' });
        const params = new URLSearchParams(http.firstCall.args[0].data);
        expect(params.get('grant_type')).to.equal('refresh_token');
        expect(params.get('refresh_token')).to.equal('rt1');
        expect(adapter.stored().refreshToken).to.equal('rt2');
    });

    it('clears tokens if the refresh token is rejected', async () => {
        const adapter = fakeAdapter({ accessToken: 'old', refreshToken: 'rt1', expiresAt: 0 });
        const http = sinon.stub().rejects(httpError(401, { error: 'invalid_grant' }));
        const auth = new SolarEdgeAuth({ adapter, http, ...oauthOptions });
        try {
            await auth.getHeaders();
            expect.fail('should throw');
        } catch (error) {
            expect(error).to.be.instanceOf(AuthError);
        }
        expect(adapter.stored().refreshToken).to.equal('');
    });

    it('refreshes the access token with a JSON body', async () => {
        const adapter = fakeAdapter({ refreshToken: 'rt1' });
        const http = sinon.stub().resolves({ data: { access_token: 'at', refresh_token: 'rt2' } });
        const auth = new SolarEdgeAuth({ adapter, http, ...oauthOptions });

        expect(await auth.getHeaders()).to.deep.equal({ Authorization: 'Bearer at' });
        expect(http.firstCall.args[0].data).to.deep.equal({
            grant_type: 'refresh_token',
            refresh_token: 'rt1',
            client_id: 'id',
            client_secret: 'secret',
        });
    });

    it('keeps the existing authorization if a new code fails', async () => {
        const adapter = fakeAdapter({ refreshToken: 'rt1' });
        const http = sinon.stub();
        http.onFirstCall().rejects(httpError(400, { error: 'invalid_grant' }));
        http.onSecondCall().resolves({ data: { access_token: 'at', refresh_token: 'rt2' } });
        const auth = new SolarEdgeAuth({ adapter, http, ...oauthOptions, authCode: 'expired' });

        expect(await auth.getHeaders()).to.deep.equal({ Authorization: 'Bearer at' });
        expect(adapter.log.error.calledOnce).to.equal(true);
        expect(http.callCount).to.equal(2);
    });

    it('shares one refresh between concurrent callers', async () => {
        const adapter = fakeAdapter({ accessToken: 'old', refreshToken: 'rt1', expiresAt: 0 });
        const http = sinon.stub().resolves({ data: { access_token: 'new', refresh_token: 'rt2' } });
        const auth = new SolarEdgeAuth({ adapter, http, ...oauthOptions });
        const headers = await Promise.all([auth.getHeaders(), auth.getHeaders(), auth.getHeaders()]);
        expect(headers.map(h => h.Authorization)).to.deep.equal(['Bearer new', 'Bearer new', 'Bearer new']);
        expect(http.callCount).to.equal(1);
    });

    it('invalidateAccessToken forces a refresh', async () => {
        const adapter = fakeAdapter({ accessToken: 'at', refreshToken: 'rt1', expiresAt: Date.now() + 3600e3 });
        const http = sinon.stub().resolves({ data: { access_token: 'new', refresh_token: 'rt2' } });
        const auth = new SolarEdgeAuth({ adapter, http, ...oauthOptions });
        await auth.getHeaders();
        expect(await auth.invalidateAccessToken()).to.equal(true);
        expect(await auth.getHeaders()).to.deep.equal({ Authorization: 'Bearer new' });
    });
});
