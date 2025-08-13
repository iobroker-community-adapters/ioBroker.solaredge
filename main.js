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
        await checkStateCreationNeeded('powerUnit'); // W or kW 
        await checkStateCreationNeeded('feedToBattery'); // true: battery charging
        await checkStateCreationNeeded('batteryStatus'); 
        await checkStateCreationNeeded('batteryPowerFlow'); // power from/to battery
        await checkStateCreationNeeded('batteryChargeLevel'); 
        await checkStateCreationNeeded('feedToGrid'); 
        await checkStateCreationNeeded('gridPowerFlow'); 
        await checkStateCreationNeeded('housePowerFlow');
        await checkStateCreationNeeded('pvPowerFlow'); // power from pv
        await checkStateCreationNeeded('pvStatus'); // active, idle, disabled
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
                        await adapter.createState('', siteid, 'powerUnit', {
                            name: "powerUnit",
                            type: 'string',
                            read: true,
                            write: false,
                            role: 'value',
                            desc: 'power unit (W or kW)'
                        });
                        await adapter.createState('', siteid, 'feedToBattery', {
                            name: "feedToBattery",
                            type: 'boolean',
                            read: true,
                            write: false,
                            role: 'value',
                            desc: 'true: feeding power to battery, false; retrieving power from battery'
                        });
                        await adapter.createState('', siteid, 'batteryStatus', {
                            name: "batteryStatus",
                            type: 'string',
                            read: true,
                            write: false,
                            role: 'value',
                            desc: 'PV battery status'
                        });
                        await adapter.createState('', siteid, 'batteryChargeLevel', {
                            name: "batteryChargeLevel",
                            type: 'number',
                            read: true,
                            write: false,
                            role: 'value',
                            desc: 'PV battery charge level in %'
                        });
                        await adapter.createState('', siteid, 'batteryPowerFlow', {
                            name: "batteryPowerFlow",
                            type: 'number',
                            read: true,
                            write: false,
                            role: 'value',
                            desc: 'Power (W / kW) flowing from/to battery'
                        });
                        await adapter.createState('', siteid, 'feedToGrid', {
                            name: "feedToGrid",
                            type: 'boolean',
                            read: true,
                            write: false,
                            role: 'value',
                            desc: 'true: feeding power to grid, false; retrieving power from grid'
                        });
                        await adapter.createState('', siteid, 'gridPowerFlow', {
                            name: "gridPowerFlow",
                            type: 'number',
                            read: true,
                            write: false,
                            role: 'value',
                            desc: 'Power (W / kW) flowing from/to grid'
                        });
                        await adapter.createState('', siteid, 'housePowerFlow', {
                            name: "housePowerFlow",
                            type: 'number',
                            read: true,
                            write: false,
                            role: 'value',
                            desc: 'Power (W / kW) flowing to house'
                        });
                        await adapter.createState('', siteid, 'pvPowerFlow', {
                            name: "pvPowerFlow",
                            type: 'number',
                            read: true,
                            write: false,
                            role: 'value',
                            desc: 'Power (W / kW) flowing to house'
                        });
                        await adapter.createState('', siteid, 'pvStatus', {
                            name: "pvStatus",
                            type: 'string',
                            read: true,
                            write: false,
                            role: 'value',
                            desc: 'PV power production status'
                        });
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
                        // find out if there is a connection from "load" to "grid",
                        // which means that the inverter feeds energy to the grid since there is enough energy available
                        // and if battery is loading or unloading
                        var feedToGrid = false;
                        var feedToBattery = false;
                        for (let i in powerFlow.connections) {
                            if(powerFlow.connections[i].from.toLowerCase() == "load" && powerFlow.connections[i].to.toLowerCase() == "grid") {
                                feedToGrid = true;
                            }
                            if(powerFlow.connections[i].from.toLowerCase() == "load" && powerFlow.connections[i].to.toLowerCase() == "storage") {
                                feedToBattery = true;
                            }
                        }
                        await adapter.setStateChangedAsync(`${siteid}.currentFlowGrid`, powerFlow.GRID ? powerFlow.GRID.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.currentFlowLoad`, powerFlow.LOAD ? powerFlow.LOAD.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.currentFlowPv`, powerFlow.PV ? powerFlow.PV.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.powerUnit`, powerFlow.unit, true);
                        await adapter.setStateChangedAsync(`${siteid}.feedToBattery`, feedToBattery, true);
                        await adapter.setStateChangedAsync(`${siteid}.batteryStatus`, powerFlow.STORAGE ? powerFlow.STORAGE.status : "unknown", true);
                        await adapter.setStateChangedAsync(`${siteid}.batteryPowerFlow`, powerFlow.STORAGE ? powerFlow.STORAGE.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.batteryChargeLevel`, powerFlow.STORAGE.chargeLevel, true);
                        await adapter.setStateChangedAsync(`${siteid}.feedToGrid`, feedToGrid, true);
                        await adapter.setStateChangedAsync(`${siteid}.gridPowerFlow`, powerFlow.GRID ? powerFlow.GRID.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.housePowerFlow`, powerFlow.LOAD ? powerFlow.LOAD.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.pvPowerFlow`, powerFlow.PV ? powerFlow.PV.currentPower : 0, true);
                        await adapter.setStateChangedAsync(`${siteid}.pvStatus`, powerFlow.PV ? powerFlow.PV.status : "unknown", true);
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
