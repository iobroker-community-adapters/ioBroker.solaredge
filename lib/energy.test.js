'use strict';

const { expect } = require('chai');
const { formatDate } = require('./helpers');
const { quarterWindowStart, mergeQuarters, sumQuarters, currentPower, monthAndYear, isDaylight } = require('./energy');

const at = (h, m = 0) => new Date(2026, 5, 21, h, m);
const quarter = (h, m, value) => ({ timestamp: formatDate(at(h, m)), value });

describe('energy', () => {
    describe('quarterWindowStart', () => {
        it('starts at midnight in the morning', () => {
            expect(quarterWindowStart(at(9)).getTime()).to.equal(at(0).getTime());
        });
        it('goes back at most 11.5 hours', () => {
            expect(quarterWindowStart(at(20)).getTime()).to.equal(at(8, 30).getTime());
            expect(quarterWindowStart(at(20, 7)).getTime()).to.equal(at(8, 30).getTime());
        });
    });

    describe('mergeQuarters', () => {
        it('keeps older quarters of today and updates newer ones', () => {
            let cache = mergeQuarters(null, { unit: 'WH', values: [quarter(6, 0, 10), quarter(6, 15, 20)] }, at(6, 30));
            cache = mergeQuarters(cache, { unit: 'WH', values: [quarter(6, 15, 25), quarter(6, 30, null), quarter(6, 45, 30)] }, at(19));
            expect(sumQuarters(cache)).to.equal(65);
        });
        it('converts units', () => {
            const cache = mergeQuarters(null, { unit: 'KWH', values: [quarter(12, 0, 0.5)] }, at(13));
            expect(sumQuarters(cache)).to.equal(500);
        });
        it('starts over on a new day', () => {
            const cache = mergeQuarters(null, { unit: 'WH', values: [quarter(12, 0, 100)] }, at(13));
            const next = mergeQuarters(cache, { unit: 'WH', values: [] }, new Date(2026, 5, 22, 6));
            expect(sumQuarters(next)).to.equal(0);
        });
    });

    describe('currentPower', () => {
        it('uses the last complete quarter', () => {
            const cache = mergeQuarters(null, { unit: 'WH', values: [quarter(12, 0, 100), quarter(12, 15, 250), quarter(12, 30, 10)] }, at(12, 40));
            const result = currentPower(cache, at(12, 40));
            expect(result.power).to.equal(1000);
            expect(result.timestamp).to.equal(at(12, 15).getTime());
        });
        it('returns 0 without data', () => {
            expect(currentPower({ quarters: {} }, at(12)).power).to.equal(0);
        });
    });

    describe('monthAndYear', () => {
        it('sums this year and picks this month', () => {
            const data = {
                unit: 'KWH',
                values: [
                    { timestamp: '2025-12-01T00:00:00+01:00', value: 99 },
                    { timestamp: '2026-01-01T00:00:00+01:00', value: 100 },
                    { timestamp: '2026-05-01T00:00:00+02:00', value: null },
                    { timestamp: '2026-06-01T00:00:00+02:00', value: 200 },
                ],
            };
            expect(monthAndYear(data, at(12))).to.deep.equal({ month: 200000, year: 300000 });
        });
        it('returns 0 without data', () => {
            expect(monthAndYear(null, at(12))).to.deep.equal({ month: 0, year: 0 });
        });
    });

    describe('isDaylight', () => {
        // Berlin
        const lat = 52.52;
        const lon = 13.4;
        it('is true at noon and false at night', () => {
            // UTC times, so the test does not depend on the time zone of the test machine
            expect(isDaylight(new Date(Date.UTC(2026, 5, 21, 11)), lat, lon)).to.equal(true);
            expect(isDaylight(new Date(Date.UTC(2026, 11, 21, 22)), lat, lon)).to.equal(false);
            expect(isDaylight(new Date(Date.UTC(2026, 11, 21, 2)), lat, lon)).to.equal(false);
        });
        it('is true without location', () => {
            expect(isDaylight(new Date(2026, 11, 21, 23), undefined, undefined)).to.equal(true);
        });
    });
});
