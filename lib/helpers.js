'use strict';

const POWER_TO_W = { W: 1, KW: 1e3, MW: 1e6 };
const ENERGY_TO_WH = { WH: 1, KWH: 1e3, MWH: 1e6, GWH: 1e9 };

/**
 * Formats a date as local time with offset ("2026-10-08T12:00:00+02:00").
 * The v2 API requires a time zone; local time keeps day/month/year boundaries in the time zone
 * of the ioBroker host, which is assumed to be the time zone of the site.
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
    const pad = n => String(n).padStart(2, '0');
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const tz = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${tz}`;
}

function isValue(v) {
    return typeof v === 'number' && !isNaN(v);
}

function convert(value, unit, table) {
    if (!isValue(value)) {
        return 0;
    }
    const factor = unit ? table[String(unit).toUpperCase()] : 1;
    return value * (factor || 1);
}

/**
 * @param {number|null|undefined} value
 * @param {string} [unit] e.g. "Wh", "kWh", "KWH"
 * @returns {number} value in Wh, 0 if not a number
 */
function convertToWh(value, unit) {
    return convert(value, unit, ENERGY_TO_WH);
}

/**
 * @param {number|null|undefined} value
 * @param {string} [unit] e.g. "W", "kW", "KW"
 * @returns {number} value in W, 0 if not a number
 */
function convertToW(value, unit) {
    return convert(value, unit, POWER_TO_W);
}

/**
 * @param {Array<{value: number|null}>} values
 * @returns {{value: number, timestamp?: string, date?: string}|null} last entry with a numeric value
 */
function getLastEntry(values) {
    if (!Array.isArray(values)) {
        return null;
    }
    for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] && isValue(values[i].value)) {
            return values[i];
        }
    }
    return null;
}

/**
 * @param {Array<{value: number|null}>} values
 * @returns {number} last numeric value or 0
 */
function getLastNonNull(values) {
    const entry = getLastEntry(values);
    return entry ? entry.value : 0;
}

/**
 * @param {Array<{value: number|null}>} values
 * @returns {number} sum of all numeric values
 */
function sumNonNull(values) {
    if (!Array.isArray(values)) {
        return 0;
    }
    return values.reduce((sum, v) => sum + (v && isValue(v.value) ? v.value : 0), 0);
}

/**
 * Converts a v2 power flow response (`SitePowerFlow`) to the adapter's values.
 * @param {any} data
 * @returns {{grid: number, load: number, pv: number, storage: number, storageLevel: number|null, gridStatus: string, storageStatus: string}|null}
 *   power in kW; null if the response contains no power flow
 */
function parsePowerFlow(data) {
    if (!data || (!data.pv && !data.load && !data.grid)) {
        return null;
    }
    const kW = element => convertToW(element && element.power, data.unit) / 1000;
    return {
        grid: kW(data.grid),
        load: kW(data.load),
        pv: kW(data.pv),
        storage: kW(data.storage),
        storageLevel: data.storage && typeof data.storage.chargeLevel === 'number' ? data.storage.chargeLevel : null,
        gridStatus: (data.grid && data.grid.status) || '',
        storageStatus: (data.storage && data.storage.status) || '',
    };
}

module.exports = {
    parsePowerFlow,
    formatDate,
    convertToWh,
    convertToW,
    getLastEntry,
    getLastNonNull,
    sumNonNull,
};
