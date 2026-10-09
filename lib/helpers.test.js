'use strict';

const { expect } = require('chai');
const { formatDate, convertToWh, convertToW, getLastEntry, getLastNonNull, sumNonNull } = require('./helpers');

describe('helpers', () => {
    describe('formatDate', () => {
        it('formats local time with offset', () => {
            const d = new Date(2026, 0, 2, 3, 4, 5);
            expect(formatDate(d)).to.match(/^2026-01-02T03:04:05[+-]\d\d:\d\d$/);
            expect(new Date(formatDate(d)).getTime()).to.equal(d.getTime());
        });
    });

    describe('convertToWh', () => {
        it('converts units case-insensitively', () => {
            expect(convertToWh(1.5, 'kWh')).to.equal(1500);
            expect(convertToWh(1.5, 'KWH')).to.equal(1500);
            expect(convertToWh(2, 'MWh')).to.equal(2e6);
            expect(convertToWh(7, 'Wh')).to.equal(7);
        });
        it('keeps value for missing or unknown unit', () => {
            expect(convertToWh(7)).to.equal(7);
            expect(convertToWh(7, 'foo')).to.equal(7);
        });
        it('returns 0 for null/undefined', () => {
            expect(convertToWh(null, 'kWh')).to.equal(0);
            expect(convertToWh(undefined)).to.equal(0);
        });
    });

    describe('convertToW', () => {
        it('converts kW to W', () => {
            expect(convertToW(2.5, 'KW')).to.equal(2500);
            expect(convertToW(300, 'W')).to.equal(300);
        });
    });

    describe('series helpers', () => {
        const values = [
            { timestamp: 'a', value: 1 },
            { timestamp: 'b', value: 2 },
            { timestamp: 'c', value: null },
        ];
        it('getLastEntry skips trailing nulls', () => {
            expect(getLastEntry(values)).to.deep.equal({ timestamp: 'b', value: 2 });
            expect(getLastEntry([])).to.equal(null);
            expect(getLastEntry(undefined)).to.equal(null);
        });
        it('getLastNonNull returns 0 if nothing found', () => {
            expect(getLastNonNull(values)).to.equal(2);
            expect(getLastNonNull([{ value: null }])).to.equal(0);
        });
        it('sumNonNull ignores nulls', () => {
            expect(sumNonNull(values)).to.equal(3);
            expect(sumNonNull(null)).to.equal(0);
        });
    });
});
