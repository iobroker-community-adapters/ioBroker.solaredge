# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

## Adapter-Specific Context

This is the **SolarEdge** adapter for ioBroker, which connects to the SolarEdge monitoring portal API to retrieve solar energy data.

### Adapter Details
- **Adapter Name**: solaredge
- **Primary Function**: Retrieve solar energy data from SolarEdge monitoring portal API
- **Target Service**: SolarEdge monitoring API (https://monitoringapi.solaredge.com)
- **API Limitations**: 300 requests per day limit
- **Configuration Requirements**: Site ID and API key (obtained from SolarEdge monitoring portal)
- **Data Update Frequency**: SolarEdge updates data every 15 minutes
- **Schedule**: Adapter runs every 15 minutes (*/15 * * * *) with random seconds offset
- **Connection Type**: Cloud-based API (REST)
- **Data Source**: Polling

### Key Data Points Retrieved
- Current power production (W)
- Daily energy production (Wh)
- Monthly energy production (Wh) 
- Yearly energy production (Wh)
- Lifetime energy production (Wh)
- Optional: Current power flow data (if enabled in config)

### API Endpoints Used
- Primary: `/site/{siteid}/overview.json?api_key={apikey}` - Overview data with current power and energy totals
- Optional: Power flow data endpoint (when currentPowerFlow config is enabled)

### Configuration Schema
- `siteid`: String - SolarEdge site ID (numeric)
- `apikey`: String - SolarEdge API key
- `currentPowerFlow`: Boolean - Enable current power flow data (optional)

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Verify adapter functionality by checking created states
                        const states = await harness.objects.getObjectListAsync({
                            startkey: `${harness.adapterName}.0.`,
                            endkey: `${harness.adapterName}.0.\u9999`
                        });
                        
                        console.log(`States found: ${states.rows.length}`);
                        
                        if (states.rows.length === 0) {
                            return reject(new Error('No states created after adapter startup'));
                        }
                        
                        resolve();
                        
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        });
    }
});
```

#### SolarEdge-Specific Integration Testing

For the SolarEdge adapter, integration tests should focus on:

```javascript
// SolarEdge-specific integration test example
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('SolarEdge API Integration Tests', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should handle SolarEdge API configuration and data retrieval', async function() {
                const obj = await new Promise((resolve, reject) => {
                    harness.objects.getObject('system.adapter.solaredge.0', (err, o) => {
                        if (err) return reject(err);
                        resolve(o);
                    });
                });

                if (!obj) {
                    throw new Error('SolarEdge adapter object not found');
                }

                // Configure with test/mock credentials
                Object.assign(obj.native, {
                    siteid: '12345', // Test site ID
                    apikey: 'test_api_key_123456789',
                    currentPowerFlow: false
                });

                harness.objects.setObject(obj._id, obj);
                
                // Mock axios for testing without real API calls
                // Or use test credentials if available
                
                await harness.startAdapterAndWait();
                
                // Wait for schedule execution (adapter runs on schedule)
                await new Promise(resolve => setTimeout(resolve, 20000));
                
                // Verify expected states are created
                const expectedStates = [
                    'solaredge.0.12345.currentPower',
                    'solaredge.0.12345.lifeTimeData',
                    'solaredge.0.12345.lastYearData',
                    'solaredge.0.12345.lastMonthData',
                    'solaredge.0.12345.lastDayData'
                ];
                
                for (const stateId of expectedStates) {
                    const state = await harness.objects.getObjectAsync(stateId);
                    if (!state) {
                        throw new Error(`Expected state ${stateId} was not created`);
                    }
                }
                
                console.log('✅ All expected SolarEdge states created successfully');
            });
        });
    }
});
```

### API Testing Strategy

Given SolarEdge API limitations (300 requests/day), implement careful testing:

```javascript
// Mock SolarEdge API responses for testing
const mockSolarEdgeResponse = {
    overview: {
        currentPower: { power: 1234.5 },
        lifeTimeData: { energy: 12345678 },
        lastYearData: { energy: 1234567 },
        lastMonthData: { energy: 123456 },
        lastDayData: { energy: 12345 }
    }
};

// Use axios mock or interceptors
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const mock = new MockAdapter(axios);

mock.onGet(/monitoringapi\.solaredge\.com/).reply(200, mockSolarEdgeResponse);
```

## ioBroker Development Patterns

### Adapter Structure
ioBroker adapters follow a specific structure and lifecycle:

```javascript
const utils = require('@iobroker/adapter-core');

class AdapterName extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: 'adapter-name',
    });
    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));
  }
  
  async onReady() {
    // Initialize adapter
    this.subscribeStates('*');
  }
  
  onStateChange(id, state) {
    if (state && !state.ack) {
      // Handle state change
    }
  }
  
  onUnload(callback) {
    // Clean up resources
    callback();
  }
}

function startAdapter(options) {
  return new AdapterName(options);
}

module.exports = startAdapter;
```

### State Management
- Always use `setState()` with proper acknowledgment flags
- Set `ack: true` for values read from external systems
- Set `ack: false` for commands to be sent to external systems
- Define proper state roles and types in object definitions

### Object Creation
Use `createStateAsync()` or `setObjectAsync()` to create states:

```javascript
await this.createStateAsync('', 'device_id', 'state_name', {
  name: 'Human readable name',
  type: 'number',
  read: true,
  write: false,
  unit: 'W',
  role: 'value.power',
  desc: 'Current power consumption'
});
```

### Common State Roles for Energy Adapters
- `value.power` - Current power (W)
- `value.energy.produced` - Energy produced (Wh/kWh)
- `value.energy.consumed` - Energy consumed (Wh/kWh)
- `info.connection` - Connection status (boolean)
- `info.status` - Status information (string)

### Error Handling
- Always implement proper error handling for external API calls
- Log errors with appropriate levels (error, warn, info, debug)
- Handle network timeouts and retry logic appropriately
- Terminate adapter gracefully on unrecoverable errors

```javascript
try {
  const response = await axios(url, { timeout: 15000 });
  // Process response
} catch (error) {
  this.log.error(`API call failed: ${error.message}`);
  // Implement retry logic or graceful degradation
}
```

### Scheduling and Intervals
- Use the built-in schedule system rather than setInterval
- Clear timers in the unload() method
- Implement random delays for API calls to avoid rate limiting

```javascript
onUnload(callback) {
  try {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = undefined;
    }
    // Close connections, clean up resources
    callback();
  } catch (e) {
    callback();
  }
}
```

### SolarEdge-Specific Patterns

#### API Response Handling
```javascript
// SolarEdge API response structure
const response = await axios(url);
if (response.data && response.data.overview) {
    const overview = response.data.overview;
    
    // Current power
    if (overview.currentPower && overview.currentPower.power !== undefined) {
        await this.setState(`${siteid}.currentPower`, {
            val: overview.currentPower.power,
            ack: true
        });
    }
    
    // Energy data
    if (overview.lifeTimeData && overview.lifeTimeData.energy !== undefined) {
        await this.setState(`${siteid}.lifeTimeData`, {
            val: overview.lifeTimeData.energy,
            ack: true
        });
    }
}
```

#### Configuration Validation
```javascript
// Validate required SolarEdge configuration
if (!this.config.siteid || !this.config.apikey) {
    this.log.error('Site ID or API key not configured');
    return;
}

// Log configuration (sanitize API key for security)
this.log.debug(`Site ID: ${this.config.siteid}`);
this.log.debug(`API key: ${this.config.apikey ? this.config.apikey.substring(0, 4) + '...' : 'not set'}`);
```

#### Rate Limiting Awareness
```javascript
// SolarEdge has 300 requests/day limit
// Schedule should not exceed this limit
const REQUESTS_PER_DAY_LIMIT = 300;
const SCHEDULE_INTERVAL_MINUTES = 15; // */15 * * * *
const DAILY_REQUESTS = (24 * 60) / SCHEDULE_INTERVAL_MINUTES; // 96 requests/day

if (DAILY_REQUESTS > REQUESTS_PER_DAY_LIMIT) {
    this.log.warn(`Schedule may exceed API rate limit. Current: ${DAILY_REQUESTS}/day, Limit: ${REQUESTS_PER_DAY_LIMIT}/day`);
}
```

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    
    if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    
    return result;
}

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```

## Security Considerations

### API Key Handling
- Never log full API keys in debug output
- Always sanitize credentials in logs: `apikey.substring(0, 4) + '...'`
- Store API keys in adapter native configuration, not in code
- Consider encryption for sensitive configuration data

### Input Validation
- Validate site ID format (should be numeric)
- Validate API key format and length
- Sanitize any user inputs that might be logged

### Error Message Security
- Don't expose sensitive information in error messages
- Log detailed errors only at debug level
- Provide user-friendly error messages at info/warn levels

## Performance Considerations

### API Rate Limiting
- SolarEdge allows 300 requests per day maximum
- Default schedule (*/15 * * * *) uses 96 requests per day
- Add random seconds offset to distribute load
- Implement exponential backoff for failed requests

### Memory Management
- Clear timers and intervals in unload()
- Avoid memory leaks in long-running scheduled operations
- Use appropriate timeout values for HTTP requests

### Data Processing Efficiency
- Process API responses efficiently
- Batch state updates when possible
- Only update states when values actually change

## Common Issues and Solutions

### API Connection Issues
- Always set timeout for HTTP requests (15 seconds recommended)
- Handle network errors gracefully
- Implement retry logic with exponential backoff
- Check API key and site ID validity

### Schedule Management
- Use random seconds in schedule to avoid simultaneous requests
- Adjust schedule automatically if default detected
- Clear timers properly in unload to prevent orphaned processes

### State Creation and Updates
- Create states only once, update values as needed
- Use proper state roles and types
- Handle undefined or null API response values

### Logging Best Practices
- Use appropriate log levels (error, warn, info, debug)
- Sanitize sensitive information (API keys, credentials)
- Provide meaningful error messages for troubleshooting
- Log successful operations at debug level only

This comprehensive guide ensures that GitHub Copilot can provide intelligent, context-aware suggestions specifically tailored for ioBroker adapter development with the SolarEdge API.