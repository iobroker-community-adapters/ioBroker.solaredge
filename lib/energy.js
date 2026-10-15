'use strict';

const SunCalc = require('suncalc');
const { convertToWh } = require('./helpers');

const QUARTER_MS = 15 * 60 * 1000;
// QUARTER_HOUR requests are limited to 12 hours; stay a bit below
const MAX_QUARTER_WINDOW_MS = 11.5 * 60 * 60 * 1000;
// query the API from 30 minutes before sunrise until 1 hour after sunset
const BEFORE_SUNRISE_MS = 30 * 60 * 1000;
const AFTER_SUNSET_MS = 60 * 60 * 1000;

/**
 * @param {Date} date
 * @returns {string} local date "YYYY-MM-DD"
 */
function dayKey(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * @param {Date} now
 * @returns {Date} local midnight of the given day
 */
function startOfDay(now) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Start of the QUARTER_HOUR window for today: midnight, but at most about 11.5 hours back.
 * Older quarters of today are kept in the cache from earlier runs.
 * @param {Date} now
 * @returns {Date}
 */
function quarterWindowStart(now) {
    // aligned to a quarter hour, so the first value is complete and does not overwrite a cached one
    const start = Math.floor((now.getTime() - MAX_QUARTER_WINDOW_MS) / QUARTER_MS) * QUARTER_MS;
    return new Date(Math.max(startOfDay(now).getTime(), start));
}

/**
 * Merges QUARTER_HOUR energy values into the cache of today's quarters.
 * The cache is reset when the day changes.
 * @param {{date: string, quarters: Record<string, number>}|null} cache
 * @param {{unit?: string, values?: Array<{timestamp: string, value: number|null}>}} data energy response
 * @param {Date} now
 * @returns {{date: string, quarters: Record<string, number>}} new cache, quarters in Wh keyed by start time (ms)
 */
function mergeQuarters(cache, data, now) {
    const date = dayKey(now);
    const quarters = cache && cache.date === date ? { ...cache.quarters } : {};
    const midnight = startOfDay(now).getTime();
    for (const entry of (data && data.values) || []) {
        const start = Date.parse(entry.timestamp);
        if (!isNaN(start) && start >= midnight && typeof entry.value === 'number') {
            quarters[start] = convertToWh(entry.value, data.unit);
        }
    }
    return { date, quarters };
}

/**
 * @param {{quarters: Record<string, number>}} cache
 * @returns {number} today's energy in Wh
 */
function sumQuarters(cache) {
    return Object.values(cache.quarters).reduce((sum, value) => sum + value, 0);
}

/**
 * Average power of the last complete quarter hour.
 * @param {{quarters: Record<string, number>}} cache
 * @param {Date} now
 * @returns {{power: number, timestamp: number|null}} power in W, start of the quarter (ms)
 */
function currentPower(cache, now) {
    const complete = Object.keys(cache.quarters)
        .map(Number)
        .filter(start => start + QUARTER_MS <= now.getTime())
        .sort((a, b) => a - b);
    const last = complete.pop();
    if (last === undefined) {
        return { power: 0, timestamp: null };
    }
    return { power: cache.quarters[last] * 4, timestamp: last };
}

/**
 * Energy of this month and this year until midnight from a MONTH energy response.
 * @param {{unit?: string, values?: Array<{timestamp: string, value: number|null}>}|null} data
 * @param {Date} now
 * @returns {{month: number, year: number}} in Wh
 */
function monthAndYear(data, now) {
    let month = 0;
    let year = 0;
    for (const entry of (data && data.values) || []) {
        if (typeof entry.value !== 'number') {
            continue;
        }
        const value = convertToWh(entry.value, data.unit);
        // read year and month from the local part of the timestamp, not from UTC
        const match = /^(\d{4})-(\d{2})/.exec(entry.timestamp || '');
        if (!match || Number(match[1]) !== now.getFullYear()) {
            continue;
        }
        year += value;
        if (Number(match[2]) === now.getMonth() + 1) {
            month += value;
        }
    }
    return { month, year };
}

/**
 * Whether the API should be queried at this time.
 * @param {Date} now
 * @param {number|undefined} latitude
 * @param {number|undefined} longitude
 * @returns {boolean} false at night; true if the location is unknown
 */
function isDaylight(now, latitude, longitude) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || isNaN(latitude) || isNaN(longitude)) {
        return true;
    }
    // noon avoids getting the times of the previous or next day
    const times = SunCalc.getTimes(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12), latitude, longitude);
    const sunrise = times.sunrise.getTime();
    const sunset = times.sunset.getTime();
    if (isNaN(sunrise) || isNaN(sunset)) {
        // polar day or night: no sunrise/sunset, decide by the sun's altitude at noon
        return SunCalc.getPosition(times.solarNoon, latitude, longitude).altitude > 0;
    }
    return now.getTime() >= sunrise - BEFORE_SUNRISE_MS && now.getTime() <= sunset + AFTER_SUNSET_MS;
}

module.exports = {
    dayKey,
    startOfDay,
    quarterWindowStart,
    mergeQuarters,
    sumQuarters,
    currentPower,
    monthAndYear,
    isDaylight,
};
