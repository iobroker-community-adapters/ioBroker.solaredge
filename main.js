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

async function main() {
    siteid = adapter.config.siteid;
    const apikey = adapter.config.apikey;

    adapter.log.debug(`site id: ${siteid}`);
    adapter.log.debug(`api key: ${apikey ? (`${apikey.substring(0, 4)}...`) : 'not set'}`);

    // adapter only works with siteid and api key set
    if (!siteid || !apikey) {
        adapter.log.error('siteid or api key not set');
    } else {
        // possible resources: overview, details, list
        // for some other resources, the url itself might change
        const url = `https://monitoringapi.solaredge.com/site/${siteid}/overview.json?api_key=${apikey}`;

        await checkStatesCreationNeeded();

        try {
            axios.defaults.timeout = 15 * 1000; // response timeout
            const response = await axios(url);
            if (response.data) {
                const overview = response.data.overview;

                adapter.log.debug(`Current power for ${siteid}: ${overview.currentPower.power} W`);

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
                        await adapter.createStateAsync('', siteid, 'currentStorageStatus', {
                            name: 'Current status: Storage',
                            type: 'string',
                            read: true,
                            write: false,
                            role: 'value.storage.status',
                            desc: 'Current status of the storage'
                        });
                        await adapter.createStateAsync('', siteid, 'currentStoragePower', {
                            name: 'Current flow: Storage',
                            type: 'number',
                            read: true,
                            write: false,
                            unit: 'kW',
                            role: 'value.storage.produced',
                            desc: 'Current production from storage'
                        });
                        await adapter.createStateAsync('', siteid, 'currentStoragePower', {
                            name: 'Current charge level: Storage',
                            type: 'number',
                            read: true,
                            write: false,
                            unit: '%',
                            role: 'value.storage.charge-level',
                            desc: 'Current production from storage'
                        });
                        await adapter.createStateAsync('', siteid, 'currentStorageCritical', {
                            name: 'Current criticality: Storage',
                            type: 'boolean',
                            read: true,
                            write: false,
                            role: 'value.storage.critical',
                            desc: 'Current criticality of storage'
                        });
                    }

                    createStates = false;
                }

                adapter.log.debug('updating states');

                await adapter.setStateChangedAsync(`${siteid}.lastUpdateTime`, overview.lastUpdateTime, true);
                await adapter.setStateChangedAsync(`${siteid}.currentPower`, overview.currentPower.power, true);
                await adapter.setStateChangedAsync(`${siteid}.lifeTimeData`, overview.lifeTimeData.energy, true);
                await adapter.setStateChangedAsync(`${siteid}.lastYearData`, overview.lastYearData.energy, true);
                await adapter.setStateChangedAsync(`${siteid}.lastMonthData`, overview.lastMonthData.energy, true);
                await adapter.setStateChangedAsync(`${siteid}.lastDayData`, overview.lastDayData.energy, true);
            } else {
                adapter.log.warn(`Response has no valid content. Check your data and try again. ${response.statusCode}`);
            }

            if (adapter.config.currentPowerFlow) {
                const url = `https://monitoringapi.solaredge.com/site/${siteid}/currentPowerFlow.json?api_key=${apikey}`;

                await checkStatesCreationNeeded();

                const response = await axios(url);
                if (response.data) {
                    const powerFlow = response.data.siteCurrentPowerFlow;
                    if (powerFlow) {
                        await adapter.setStateChangedAsync(`${siteid}.currentFlowGrid`, powerFlow.GRID ? powerFlow.GRID.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.currentFlowLoad`, powerFlow.LOAD ? powerFlow.LOAD.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.currentFlowPv`, powerFlow.PV ? powerFlow.PV.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.currentStorageStatus`, powerFlow.STORAGE ? powerFlow.STORAGE.status : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.currentStoragePower`, powerFlow.STORAGE ? powerFlow.STORAGE.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.currentStorageChargeLevel`, powerFlow.STORAGE ? powerFlow.STORAGE.chargeLevel : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.currentStorageCritical`, powerFlow.STORAGE ? powerFlow.STORAGE.critical : 0, true);
                    }
                }
            }
        } catch (error) {
            adapter.log.error(`Cannot read data from solaredge cloud: ${error.response && error.response.data ?
                JSON.stringify(error.response.data) : (error.response && error.response.status ? error.response.status : error)}`);
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
