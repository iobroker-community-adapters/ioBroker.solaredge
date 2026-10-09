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
const { formatDate, convertToWh } = require('./lib/helpers');
const { dayKey, startOfDay, quarterWindowStart, mergeQuarters, sumQuarters, currentPower, monthAndYear, isDaylight } = require('./lib/energy');
const adapterName = require('./package.json').name.split('.').pop();

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;
let siteid;

// today's quarter hour energy values, kept between the scheduled runs
const CACHE_STATE = 'info.energyToday';
// month, year and lifetime energy until midnight
const BASE_STATE = 'info.energyBase';

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

/**
 * @param {string} id
 * @returns {Promise<any>} parsed JSON value of the state, null if not set or invalid
 */
async function readJsonState(id) {
    try {
        const state = await adapter.getStateAsync(id);
        return state && state.val ? JSON.parse(String(state.val)) : null;
    } catch {
        return null;
    }
}

/**
 * @param {string} id
 * @param {any} value
 */
async function writeJsonState(id, value) {
    await adapter.setStateAsync(id, JSON.stringify(value), true);
}

/**
 * @returns {Promise<[number|undefined, number|undefined]>} latitude and longitude from the system settings
 */
async function getLocation() {
    try {
        const config = await adapter.getForeignObjectAsync('system.config');
        const latitude = parseFloat(config && config.common && config.common.latitude);
        const longitude = parseFloat(config && config.common && config.common.longitude);
        if (!isNaN(latitude) && !isNaN(longitude)) {
            return [latitude, longitude];
        }
    } catch {
        // ignore, handled below
    }
    adapter.log.debug('No location set in the system settings, querying the API at night, too');
    return [undefined, undefined];
}

/**
 * Fetches month, year and lifetime energy until midnight.
 * @param {SolarEdgeAuth} auth
 * @param {string} baseUrl
 * @param {Date} now
 * @param {number} todayEnergy today's energy in Wh, subtracted from the lifetime counter
 * @returns {Promise<{date: string, month: number, year: number, lifetime: number|null}>}
 */
async function fetchBase(auth, baseUrl, now, todayEnergy) {
    const midnight = startOfDay(now);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    // on January 1st there is nothing to fetch yet
    const monthResp = midnight > startOfYear
        ? await apiGet(auth, `${baseUrl}/energy?${query({ resolution: 'MONTH', unit: 'WH', from: startOfYear, to: midnight })}`)
        : null;
    const { month, year } = monthAndYear(monthResp && monthResp.data, now);

    let lifetime = null;
    if (adapter.config.retrieveLastYearData) {
        const lifetimeResp = await apiGet(auth, `${baseUrl}/lifetime-energy`);
        if (lifetimeResp.data && typeof lifetimeResp.data.energy === 'number') {
            lifetime = convertToWh(lifetimeResp.data.energy, lifetimeResp.data.unit) - todayEnergy;
        }
    }
    return { date: dayKey(now), month, year, lifetime };
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
        const now = new Date();
        const today = dayKey(now);
        // instances from before the option existed have no value: pause by default
        const daylight = adapter.config.pauseAtNight === false || isDaylight(now, ...(await getLocation()));

        if (!daylight) {
            // no production at night: save the credits
            adapter.log.debug('Night, no API calls');
            await adapter.setStateChangedAsync(`${siteid}.currentPower`, 0, true);
            const cache = await readJsonState(CACHE_STATE);
            if (adapter.config.retrieveLastDayData && (!cache || cache.date !== today)) {
                await adapter.setStateChangedAsync(`${siteid}.lastDayData`, 0, true);
            }
        } else {
            try {
                // one call per run: today's quarter hour energy, gives today's energy and the current power
                const energyResp = await apiGet(auth, `${baseUrl}/energy?${query({ resolution: 'QUARTER_HOUR', unit: 'WH', from: quarterWindowStart(now), to: now })}`);
                const cache = mergeQuarters(await readJsonState(CACHE_STATE), energyResp.data, now);
                await writeJsonState(CACHE_STATE, cache);
                const todayEnergy = sumQuarters(cache);
                const power = currentPower(cache, now);

                adapter.log.debug(`Current power for ${siteid}: ${power.power} W, today: ${todayEnergy} Wh`);
                adapter.log.debug('updating states');

                if (power.timestamp !== null) {
                    await adapter.setStateChangedAsync(`${siteid}.lastUpdateTime`, formatDate(new Date(power.timestamp)), true);
                }
                await adapter.setStateChangedAsync(`${siteid}.currentPower`, power.power, true);
                if (adapter.config.retrieveLastDayData) {
                    await adapter.setStateChangedAsync(`${siteid}.lastDayData`, todayEnergy, true);
                }

                // month, year and lifetime until midnight are fetched once per day; today's energy is added
                if (adapter.config.retrieveLastMonthData || adapter.config.retrieveLastYearData) {
                    let base = await readJsonState(BASE_STATE);
                    if (!base || base.date !== today) {
                        base = await fetchBase(auth, baseUrl, now, todayEnergy);
                        await writeJsonState(BASE_STATE, base);
                    }
                    if (adapter.config.retrieveLastMonthData) {
                        await adapter.setStateChangedAsync(`${siteid}.lastMonthData`, base.month + todayEnergy, true);
                    }
                    if (adapter.config.retrieveLastYearData) {
                        await adapter.setStateChangedAsync(`${siteid}.lastYearData`, base.year + todayEnergy, true);
                        if (typeof base.lifetime === 'number') {
                            await adapter.setStateChangedAsync(`${siteid}.lifeTimeData`, base.lifetime + todayEnergy, true);
                        }
                    }
                }
            } catch (error) {
                if (error instanceof AuthError) {
                    authFailed = true;
                    adapter.log.error(error.message);
                } else {
                    adapter.log.error(`Cannot read data from solaredge cloud: ${describeError(error)}`);
                }
            }
        }

        if (adapter.config.currentPowerFlow && daylight && !authFailed) {
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
            // the old default (every 15 minutes) needs more credits than the free tier has; changed once only
            if (instObj && !instObj.native.scheduleMigrated) {
                if (/^(\d+ )?\*\/15 \* \* \* \*$/.test(instObj.common.schedule || '')) {
                    instObj.common.schedule = '*/30 * * * *';
                    adapter.log.info('Schedule changed from every 15 to every 30 minutes to stay within the free API credits');
                }
                instObj.native.scheduleMigrated = true;
                changed = true;
            }
            if (instObj && instObj.common && instObj.common.schedule === '*/30 * * * *') {
                instObj.common.schedule = `${Math.floor(Math.random() * 60)} */30 * * * *`;
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
