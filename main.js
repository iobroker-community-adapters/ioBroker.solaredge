'use strict';

/*
 * Solaredge Monitoring
 * github.com/92lleo/ioBroker.solaredge
 *
 * (c) 2019-2023 Leonhard Kuenzler (MIT)
 *
 * Created with @iobroker/create-adapter v1.18.0
 */

const utils = require('@iobroker/adapter-core');
const axios = require('axios');
const { SolarEdgeAuth, AuthError, describeError, extractSiteId } = require('./lib/auth');
const { formatDate, convertToWh, convertToW, getLastEntry, getLastNonNull, sumNonNull } = require('./lib/helpers');
const adapterName = require('./package.json').name.split('.').pop();

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;
let siteid;

/**
 * Starts the adapter instance
 * @param {Partial<ioBroker.AdapterOptions>} [options]
 */
function startAdapter(options) {
    // Create the adapter and define its methods
    return adapter = utils.adapter(Object.assign({}, options, {
        name: adapterName,
        ready: main, // Main method defined below for readability
    }));
}

/**
 * Builds a query string; dates are formatted as local time with offset.
 * @param {Record<string, string|Date>} params
 */
function query(params) {
    const entries = Object.entries(params).map(([key, value]) => [key, value instanceof Date ? formatDate(value) : value]);
    return new URLSearchParams(entries).toString();
}

/**
 * GET request against the v2 API. Retries once with a fresh access token on 401.
 * @param {SolarEdgeAuth} auth
 * @param {string} url
 */
async function apiGet(auth, url) {
    const request = async () => {
        const response = await axios(url, { headers: await auth.getHeaders(), timeout: 15 * 1000 });
        adapter.log.debug(`GET ${url.replace(/^.*\/v2/, '')}: ${JSON.stringify(response.data)}`);
        return response;
    };
    try {
        return await request();
    } catch (error) {
        if (error.response && error.response.status === 401 && await auth.invalidateAccessToken()) {
            adapter.log.debug('Access token rejected, refreshing');
            return await request();
        }
        throw error;
    }
}

/**
 * Creates the state `<siteid>.<name>` if it does not exist yet.
 * @param {string} name
 * @param {ioBroker.StateCommon} common
 */
async function createState(name, common) {
    await adapter.setObjectNotExistsAsync(`${siteid}.${name}`, { type: 'state', common, native: {} });
}

async function main() {
    const apikey = adapter.config.authType === 'apikey' ? adapter.config.apikey : '';
    const { clientId, clientSecret } = adapter.config;
    // SolarEdge appends the site id to the redirect URL, so it can be taken from there
    siteid = adapter.config.siteid || (apikey ? '' : extractSiteId(adapter.config.authCode));

    adapter.log.debug(`site id: ${siteid}`);
    adapter.log.debug(`auth type: ${apikey ? 'api key' : 'oauth2'}`);

    // adapter only works with siteid and credentials set
    if (!siteid || (!apikey && (!clientId || !clientSecret))) {
        if (adapter.config.authType === 'apikey') {
            adapter.log.error('siteid or api key not set');
        } else if (!clientId || !clientSecret) {
            adapter.log.error('client id or client secret not set');
        } else {
            adapter.log.error('siteid not set: paste the complete redirect URL (including site_id) or enter the site id manually');
        }
        adapter.stop();
    } else {
        const baseUrl = `https://monitoringapi.solaredge.com/v2/sites/${siteid}`;
        const auth = new SolarEdgeAuth({
            adapter,
            http: axios,
            apiKey: apikey,
            clientId,
            clientSecret,
            redirectUri: adapter.config.redirectUri,
            authCode: adapter.config.authCode,
        });

        // create state objects only on first run; they persist across scheduled restarts
        if (!(await adapter.getObjectAsync(`${siteid}.currentPower`))) {
            adapter.log.debug('creating states');
            await adapter.setObjectNotExistsAsync(siteid, { type: 'channel', common: { name: `Site ${siteid}` }, native: {} });
            await createState('lastUpdateTime', {
                name: 'lastUpdateTime',
                type: 'string',
                role: 'date',
                read: true,
                write: false,
                desc: 'Last update from inverter'
            });
            await createState('currentPower', {
                name: 'currentPower',
                type: 'number',
                read: true,
                write: false,
                role: 'value.power',
                desc: 'current power in W',
                unit: 'W',
            });
        }
        if (adapter.config.retrieveLastYearData && !(await adapter.getObjectAsync(`${siteid}.lifeTimeData`))) {
            await createState('lifeTimeData', {
                name: 'lifeTimeData',
                type: 'number',
                read: true,
                write: false,
                role: 'value.energy.produced',
                unit: 'Wh',
                desc: 'Lifetime energy in Wh'
            });
            await createState('lastYearData', {
                name: 'lastYearData',
                type: 'number',
                read: true,
                write: false,
                unit: 'Wh',
                role: 'value.energy.produced',
                desc: 'last year energy in Wh'
            });
        }
        if (adapter.config.retrieveLastMonthData && !(await adapter.getObjectAsync(`${siteid}.lastMonthData`))) {
            await createState('lastMonthData', {
                name: 'lastMonthData',
                type: 'number',
                read: true,
                write: false,
                role: 'value.energy.produced',
                unit: 'Wh',
                desc: 'last month energy in Wh'
            });
        }
        if (adapter.config.retrieveLastDayData && !(await adapter.getObjectAsync(`${siteid}.lastDayData`))) {
            await createState('lastDayData', {
                name: 'lastDayData',
                type: 'number',
                read: true,
                write: false,
                unit: 'Wh',
                role: 'value.energy.produced',
                desc: 'last day energy in Wh'
            });
        }
        if (adapter.config.currentPowerFlow && !(await adapter.getObjectAsync(`${siteid}.currentFlowGrid`))) {
            await createState('currentFlowGrid', {
                name: 'Current flow: Grid',
                type: 'number',
                read: true,
                write: false,
                unit: 'kW',
                role: 'value.power.consumed',
                desc: 'Current usage from energy grid'
            });
            await createState('currentFlowLoad', {
                name: 'Current flow: Load',
                type: 'number',
                read: true,
                write: false,
                unit: 'kW',
                role: 'value.power.consumed',
                desc: 'Current total usage'
            });
            await createState('currentFlowPv', {
                name: 'Current flow: PV',
                type: 'number',
                read: true,
                write: false,
                unit: 'kW',
                role: 'value.power.produced',
                desc: 'Current production from PV'
            });
        }

        let authFailed = false;
        try {
            const now = new Date();
            const oneHourAgo = new Date(now - 3600000);
            const startOfYear = new Date(now.getFullYear(), 0, 1);

            // Energy totals change slowly: YEAR (lifeTimeData + lastYearData) once per day,
            // MONTH (lastMonthData) once per hour. Check state ts to decide whether to fetch.
            // setStateAsync is used for these states (not setStateChangedAsync) so ts always
            // reflects the last fetch time, not only the last value change.
            const [lifetimeState, monthState] = await Promise.all([
                adapter.config.retrieveLastYearData ? adapter.getStateAsync(`${siteid}.lifeTimeData`) : null,
                adapter.config.retrieveLastMonthData ? adapter.getStateAsync(`${siteid}.lastMonthData`) : null,
            ]);
            const fetchYearEnergy = adapter.config.retrieveLastYearData && (
                !lifetimeState || !lifetimeState.ts ||
                (now.getTime() - lifetimeState.ts) >= 24 * 60 * 60 * 1000
            );
            const fetchMonthEnergy = adapter.config.retrieveLastMonthData && (
                !monthState || !monthState.ts ||
                (now.getTime() - monthState.ts) >= 60 * 60 * 1000
            );

            adapter.log.debug(`fetchYearEnergy: ${fetchYearEnergy}, fetchMonthEnergy: ${fetchMonthEnergy}`);

            // Fetch live data every cycle; energy and overview calls are conditional on config
            const [overviewResp, powerResp, yearEnergyResp, monthEnergyResp] = await Promise.all([
                adapter.config.retrieveLastDayData ? apiGet(auth, `${baseUrl}/overview`) : null,
                apiGet(auth, `${baseUrl}/power?${query({ resolution: 'QUARTER_HOUR', unit: 'W', from: oneHourAgo, to: now })}`),
                fetchYearEnergy ? apiGet(auth, `${baseUrl}/energy?${query({ resolution: 'YEAR', unit: 'WH', from: new Date(2000, 0, 1), to: now })}`) : null,
                fetchMonthEnergy ? apiGet(auth, `${baseUrl}/energy?${query({ resolution: 'MONTH', unit: 'WH', from: startOfYear, to: now })}`) : null,
            ]);

            const powerValues = (powerResp.data && powerResp.data.values) || [];

            // Derive lastUpdateTime from the last power value timestamp (avoids a separate site-details call)
            const lastPowerEntry = getLastEntry(powerValues);
            const lastUpdateTime = lastPowerEntry ? lastPowerEntry.date || lastPowerEntry.timestamp : null;

            const currentPower = convertToW(lastPowerEntry ? lastPowerEntry.value : 0, powerResp.data && powerResp.data.unit);

            adapter.log.debug(`Current power for ${siteid}: ${currentPower} W`);
            adapter.log.debug('updating states');

            await adapter.setStateChangedAsync(`${siteid}.lastUpdateTime`, lastUpdateTime, true);
            await adapter.setStateChangedAsync(`${siteid}.currentPower`, currentPower, true);

            if (overviewResp) {
                const overview = overviewResp.data;
                const lastDayData = convertToWh(
                    overview.production ? overview.production.total : 0,
                    overview.production ? overview.production.unit : 'Wh'
                );
                await adapter.setStateChangedAsync(`${siteid}.lastDayData`, lastDayData, true);
            }
            if (yearEnergyResp) {
                const yearValues = (yearEnergyResp.data && yearEnergyResp.data.values) || [];
                const yearUnit = yearEnergyResp.data && yearEnergyResp.data.unit;
                await adapter.setStateAsync(`${siteid}.lifeTimeData`, convertToWh(sumNonNull(yearValues), yearUnit), true);
                await adapter.setStateAsync(`${siteid}.lastYearData`, convertToWh(getLastNonNull(yearValues), yearUnit), true);
            }
            if (monthEnergyResp) {
                const monthValues = (monthEnergyResp.data && monthEnergyResp.data.values) || [];
                await adapter.setStateAsync(`${siteid}.lastMonthData`, convertToWh(getLastNonNull(monthValues), monthEnergyResp.data && monthEnergyResp.data.unit), true);
            }
        } catch (error) {
            if (error instanceof AuthError) {
                authFailed = true;
                adapter.log.error(error.message);
            } else {
                adapter.log.error(`Cannot read data from solaredge cloud: ${describeError(error)}`);
            }
        }

        if (adapter.config.currentPowerFlow && !authFailed) {
            try {
                const powerFlowResp = await apiGet(auth, `${baseUrl}/power-flow`);
                if (powerFlowResp.data) {
                    const powerFlow = powerFlowResp.data.siteCurrentPowerFlow;
                    if (powerFlow) {
                        await adapter.setStateChangedAsync(`${siteid}.currentFlowGrid`, powerFlow.GRID ? powerFlow.GRID.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.currentFlowLoad`, powerFlow.LOAD ? powerFlow.LOAD.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.currentFlowPv`, powerFlow.PV ? powerFlow.PV.currentPower : 0, true);
                    }
                }
            } catch (error) {
                if (error.response && error.response.status === 403) {
                    adapter.log.warn('Power flow data requires Business Pro or Enterprise tier. See https://developer.solaredge.com/');
                } else {
                    adapter.log.error(`Cannot read power flow from solaredge cloud: ${describeError(error)}`);
                }
            }
        }

        adapter.log.debug('Done, stopping...');

        // Change the schedule to a random seconds to spread the calls over the minute
        // and remember a site id taken from the redirect URL
        try {
            const instObj = await adapter.getForeignObjectAsync(`system.adapter.${adapter.namespace}`);
            let changed = false;
            if (instObj && instObj.common && instObj.common.schedule && instObj.common.schedule === '*/15 * * * *') {
                instObj.common.schedule = `${Math.floor(Math.random() * 60)} */15 * * * *`;
                adapter.log.info(`Default schedule found and adjusted to spread calls better over the minute`);
                changed = true;
            }
            if (instObj && !instObj.native.siteid) {
                instObj.native.siteid = siteid;
                adapter.log.info(`Site id ${siteid} taken from the redirect URL`);
                changed = true;
            }
            if (changed) {
                await adapter.setForeignObjectAsync(`system.adapter.${adapter.namespace}`, instObj);
            }
        } catch (err) {
            adapter.log.error(`Could not check or adjust the instance settings: ${err.message}`);
        }

        adapter.stop();
    }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}
