![Logo](admin/solaredge.png)
# ioBroker.solaredge

[![GitHub license](https://img.shields.io/github/license/iobroker-community-adapters/ioBroker.solaredge)](https://github.com/iobroker-community-adapters/ioBroker.solaredge/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/iobroker.solaredge.svg)](https://www.npmjs.com/package/iobroker.solaredge)
![GitHub repo size](https://img.shields.io/github/repo-size/iobroker-community-adapters/ioBroker.solaredge)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/solaredge/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)</br>
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/iobroker-community-adapters/ioBroker.solaredge)
![GitHub commits since latest release (by date)](https://img.shields.io/github/commits-since/iobroker-community-adapters/ioBroker.solaredge/latest)
![GitHub last commit](https://img.shields.io/github/last-commit/iobroker-community-adapters/ioBroker.solaredge)
![GitHub issues](https://img.shields.io/github/issues/iobroker-community-adapters/ioBroker.solaredge)
</br>
**Version:** </br>
[![NPM version](http://img.shields.io/npm/v/iobroker.solaredge.svg)](https://www.npmjs.com/package/iobroker.solaredge)
![Current version in stable repository](https://iobroker.live/badges/solaredge-stable.svg)
![Number of Installations](https://iobroker.live/badges/solaredge-installed.svg)
</br>
**Tests:** </br>
[![Test and Release](https://github.com/iobroker-community-adapters/ioBroker.solaredge/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/iobroker-community-adapters/ioBroker.solaredge/actions/workflows/test-and-release.yml)
[![CodeQL](https://github.com/iobroker-community-adapters/ioBroker.solaredge/actions/workflows/codeql.yml/badge.svg)](https://github.com/iobroker-community-adapters/ioBroker.solaredge/actions/workflows/codeql.yml)

<!--
## Sentry
**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.**
For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.
-->

## Solaredge Adapter for ioBroker 

Get data from the SolarEdge monitoring portal via the SolarEdge Monitoring API v2.
The adapter reads current power and day/month/year/lifetime energy, optionally the current power flow
(power flow requires an Advanced Monitoring tier at SolarEdge).

You can also enable modbus on your solaredge device if it's a newer one and read the data directly.

### Setup

The Monitoring API v1 (api key from the monitoring portal) is shut down by SolarEdge on 2026-11-01.
v1 api keys do not work with v2.

**Site id:** log in at https://monitoring.solaredge.com, the site id is the "ID" shown for your site, e.g., 12345.

**Site Access (OAuth2, homeowners):**
1. Create an account at the [SolarEdge developer portal](https://developer.solaredge.com/) and create a
   Site Access application with scope `SITE_DATA`.
   As redirect URI enter the value shown in the instance settings (default `https://localhost/`).
   The redirect target does not need to exist.
2. Enter client id and client secret of the application in the instance settings and save.
3. Copy the authorization link shown in the instance settings, open it in your browser, log in and grant access.
4. The browser is redirected to the redirect URI (the page may fail to load). Copy the complete URL from the
   address bar into the field "Authorization code or redirect URL" and save. Authorization codes expire quickly,
   the instance runs right after saving and requests the tokens.

The tokens are stored encrypted in `solaredge.X.info.auth` and are refreshed automatically.
If the authorization expires or is revoked (refresh tokens expire after 30 days without use),
repeat steps 3 and 4.

**Fleet Access (API key, installers):** select access type "Fleet Access" and enter the App API key.

**Credits:** each API call consumes credits of your SolarEdge app (free tier: 2000 credits/month).
With the default schedule (every 15 minutes) the adapter needs about 2 calls per run,
plus one call per hour for month and one per day for year energy.
Disable the energy values you don't need or increase the schedule interval if you run out of credits.

## Credits

This adapter would not have been possible without the great work of @92lleo (https://github.com/92lleo), who wrote the code for the initial versions and released it to ioborker-community-adapters.

<!--
	### **WORK IN PROGRESS**
-->
## Changelog

### **WORK IN PROGRESS**
- (mcm1957) BREAKING: Adapter has been migrated to SolarEdge Monitoring API v2. A new API key must be generated at https://developer.solaredge.com/ — v1 keys are not valid in v2.
- (mcm1957) BREAKING: The `currentPowerFlow` feature now requires a Business Pro or Enterprise tier subscription at SolarEdge.
- (Garfonso) OAuth2 Site Access (client id/secret of your own SolarEdge app) has been added, Fleet Access API key is optional. See README for setup.
- (Garfonso) Time ranges are now sent in local time and API units are converted correctly.
- (copilot) Adapter requires node.js >= 22 now
- (iobroker-bot) Adapter requires node.js >= 20 now.
- (copilot) Adapter requires admin >= 7.7.22 now
- (copilot) Adapter requires js-controller >= 6.0.11 now
- (copilot) Adapter requires admin >= 7.6.17 now

### 1.4.1 (2024-04-28)
* (mcm1957) Adapter requires node.js >= 18 and js-controller >= 5 now
* (mcm1957) Dependencies have been updated

### 1.3.0 (2024-02-15)
* (mcm1957) BREAKING: adapter requires node.js 18 or newer now.
* (mcm1957) Adapter translations have been linked to weblate.
* (mcm1957) Dependencies have been updated.

### 1.2.2 (2023-12-14)
* (bluefox) Added random seconds to the schedule
* (bluefox) Updated packages
* (bluefox) Allowed adapter execution by restart

### 1.2.0 (2023-12-06)
* (mcm1957) Adapter did not terminate in case of an exception. This has been fixed.
* (mcm1957) A response timeout has been added to network calls.
* (mcm1957) Adapter has been moved to iobroker-community-adapters organization
* (mcm1957) Dependencies have been updated

### 1.1.0 (2023-11-16)
* (bluefox) Added the current power flow data

### 1.0.1 (2023-08-18)
* (bluefox) Added JSON config and replaced `require` module with `axios`

### 0.3.0
* (Apollon77) Address review feedback from adapter review (see #19)

### 0.2.0
* (92lleo) Add default values for native config vars
* (92lleo) Set schedule to 15s to match api update rate
* (92lleo) Fix updating already created states (broken since new js-controller, see #9)
* (92lleo) Update dependencies
* (92lleo) Clear timer on unload
* (92lleo) Add a connection type and dataSource

### 0.1.1
* (92lleo) fix "object data is invalid" issue, now works with new js-controller
* (92lleo) update dependencies

### 0.1.0
* (92lleo) first beta release. overview data from inteverters are available

### 0.0.1
* (92lleo) initial release

[Older changelogs can be found there](CHANGELOG_OLD.md)

## License
MIT License

Copyright (c) 2023-2026 iobroker-community-adapters <iobroker-community-adapters@gmx.de>
Copyright (c) 2019-2023 Leonhard Kuenzler <leonhard@kuenzler.io>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
