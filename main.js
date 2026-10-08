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
const adapterName = require('./package.json').name.split('.').pop();

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;
let createStates;
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

async function checkStateCreationNeeded(stateName){
    let state;
    try {
        state = await adapter.getState(`solaredge.${adapter.instance}.${siteid}.${stateName}`);
    } catch (error) {
        // state does not exist, ignore
    }

    if (!state) {
        adapter.log.info(`state ${stateName} does not exist, will be created`);
        createStates = true;
    } else {
        adapter.log.debug(`state ${stateName} exists`);
        createStates |= false;
    }
}

async function checkStatesCreationNeeded(){
    await checkStateCreationNeeded('lastUpdateTime');
    await checkStateCreationNeeded('currentPower');
    await checkStateCreationNeeded('lifeTimeData');
    await checkStateCreationNeeded('lastYearData');
    await checkStateCreationNeeded('lastMonthData');
    await checkStateCreationNeeded('lastDayData');

    if (adapter.config.currentPowerFlow) {
        await checkStateCreationNeeded('currentFlowGrid');
        await checkStateCreationNeeded('currentFlowLoad');
        await checkStateCreationNeeded('currentFlowPv');
    }
}

function formatDate(date) {
    return date.toISOString().slice(0, 19); // "2026-10-08T12:00:00"
}

function convertToWh(value, unit) {
    if (value === null || value === undefined) return 0;
    if (unit === 'kWh') return value * 1000;
    return value;
}

function getLastNonNull(values) {
    if (!values || values.length === 0) return 0;
    for (let i = values.length - 1; i >= 0; i--) {
        if (values[i].value !== null && values[i].value !== undefined) return values[i].value;
    }
    return 0;
}

function sumNonNull(values) {
    if (!values || values.length === 0) return 0;
    return values.reduce((sum, v) => sum + (v.value !== null && v.value !== undefined ? v.value : 0), 0);
}

async function main() {
    siteid = adapter.config.siteid;
    const apikey = adapter.config.apikey;

    adapter.log.debug(`site id: ${siteid}`);
    adapter.log.debug(`api key: ${apikey ? (`${apikey.substring(0, 4)}...`) : 'not set'}`);

    // adapter only works with siteid and api key set
    if (!siteid || !apikey) {
        adapter.log.error('siteid or api key not set');
    } else {
        const baseUrl = `https://monitoringapi.solaredge.com/v2/sites/${siteid}`;
        const axiosConfig = {
            headers: { 'X-API-Key': apikey },
            timeout: 15 * 1000,
        };

        await checkStatesCreationNeeded();

        try {
            const now = new Date();
            const oneHourAgo = new Date(now - 3600000);
            const startOfYear = new Date(now.getFullYear(), 0, 1);

            // Fetch all data in parallel
            const [siteResp, overviewResp, powerResp, lifetimeEnergyResp, monthEnergyResp] = await Promise.all([
                axios(baseUrl, axiosConfig),
                axios(`${baseUrl}/overview`, axiosConfig),
                axios(`${baseUrl}/power?resolution=QUARTER_HOUR&unit=W&from=${formatDate(oneHourAgo)}&to=${formatDate(now)}`, axiosConfig),
                axios(`${baseUrl}/energy?resolution=YEAR&unit=WH&from=2000-01-01T00:00:00&to=${formatDate(now)}`, axiosConfig),
                axios(`${baseUrl}/energy?resolution=MONTH&unit=WH&from=${formatDate(startOfYear)}&to=${formatDate(now)}`, axiosConfig),
            ]);

            const site = siteResp.data;
            const overview = overviewResp.data;
            const powerValues = (powerResp.data && powerResp.data.values) || [];
            const yearValues = (lifetimeEnergyResp.data && lifetimeEnergyResp.data.values) || [];
            const monthValues = (monthEnergyResp.data && monthEnergyResp.data.values) || [];

            const currentPower = getLastNonNull(powerValues);
            const lifeTimeData = sumNonNull(yearValues);
            const lastYearData = getLastNonNull(yearValues);
            const lastMonthData = getLastNonNull(monthValues);
            const lastDayData = convertToWh(
                overview.production ? overview.production.total : 0,
                overview.production ? overview.production.unit : 'Wh'
            );

            adapter.log.debug(`Current power for ${siteid}: ${currentPower} W`);

            if (createStates) {
                adapter.log.debug('creating states');
                // create all states, only needed on first start or after state deletion

                // last update time
                await adapter.createStateAsync('', siteid, 'lastUpdateTime', {
                    name: 'lastUpdateTime',
                    type: 'string',
                    role: 'date',
                    read: true,
                    write: false,
                    desc: 'Last update from inverter'
                });

                await adapter.createStateAsync('', siteid, 'currentPower', {
                    name: 'currentPower',
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'value.power',
                    desc: 'current power in W',
                    unit: 'W',
                });

                await adapter.createStateAsync('', siteid, 'lifeTimeData', {
                    name: 'lifeTimeData',
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'value.energy.produced',
                    unit: 'Wh',
                    desc: 'Lifetime energy in Wh'
                });

                await adapter.createStateAsync('', siteid, 'lastYearData', {
                    name: 'lastYearData',
                    type: 'number',
                    read: true,
                    write: false,
                    unit: 'Wh',
                    role: 'value.energy.produced',
                    desc: 'last year energy in Wh'
                });

                await adapter.createStateAsync('', siteid, 'lastMonthData', {
                    name: 'lastMonthData',
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'value.energy.produced',
                    unit: 'Wh',
                    desc: 'last month energy in Wh'
                });

                await adapter.createStateAsync('', siteid, 'lastDayData', {
                    name: 'lastDayData',
                    type: 'number',
                    read: true,
                    write: false,
                    unit: 'Wh',
                    role: 'value.energy.produced',
                    desc: 'last day energy in Wh'
                });
                if (adapter.config.currentPowerFlow) {
                    await adapter.createStateAsync('', siteid, 'currentFlowGrid', {
                        name: 'Current flow: Grid',
                        type: 'number',
                        read: true,
                        write: false,
                        unit: 'kW',
                        role: 'value.power.consumed',
                        desc: 'Current usage from energy grid'
                    });
                    await adapter.createStateAsync('', siteid, 'currentFlowLoad', {
                        name: 'Current flow: Load',
                        type: 'number',
                        read: true,
                        write: false,
                        unit: 'kW',
                        role: 'value.power.consumed',
                        desc: 'Current total usage'
                    });
                    await adapter.createStateAsync('', siteid, 'currentFlowPv', {
                        name: 'Current flow: PV',
                        type: 'number',
                        read: true,
                        write: false,
                        unit: 'kW',
                        role: 'value.power.produced',
                        desc: 'Current production from PV'
                    });
                }

                createStates = false;
            }

            adapter.log.debug('updating states');

            await adapter.setStateChangedAsync(`${siteid}.lastUpdateTime`, site.lastUpdateTime, true);
            await adapter.setStateChangedAsync(`${siteid}.currentPower`, currentPower, true);
            await adapter.setStateChangedAsync(`${siteid}.lifeTimeData`, lifeTimeData, true);
            await adapter.setStateChangedAsync(`${siteid}.lastYearData`, lastYearData, true);
            await adapter.setStateChangedAsync(`${siteid}.lastMonthData`, lastMonthData, true);
            await adapter.setStateChangedAsync(`${siteid}.lastDayData`, lastDayData, true);
        } catch (error) {
            adapter.log.error(`Cannot read data from solaredge cloud: ${error.response && error.response.data ?
                JSON.stringify(error.response.data) : (error.response && error.response.status ? error.response.status : error)}`);
        }

        if (adapter.config.currentPowerFlow) {
            try {
                const powerFlowResp = await axios(`${baseUrl}/power-flow`, axiosConfig);
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
                    adapter.log.error(`Cannot read power flow from solaredge cloud: ${error.response && error.response.data ?
                        JSON.stringify(error.response.data) : (error.response && error.response.status ? error.response.status : error)}`);
                }
            }
        }

        adapter.log.debug('Done, stopping...');

        // Change the schedule to a random seconds to spread the calls over the minute
        try {
            const instObj = await adapter.getForeignObjectAsync(`system.adapter.${adapter.namespace}`);
            if (instObj && instObj.common && instObj.common.schedule && instObj.common.schedule === '*/15 * * * *') {
                instObj.common.schedule = `${Math.floor(Math.random() * 60)} */15 * * * *`;
                adapter.log.info(`Default schedule found and adjusted to spread calls better over the minute`);
                await adapter.setForeignObjectAsync(`system.adapter.${adapter.namespace}`, instObj);
            }
        } catch (err) {
            this.log.error(`Could not check or adjust the schedule: ${err.message}`);
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
