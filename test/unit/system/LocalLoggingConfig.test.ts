import { strict as assert } from 'node:assert';
import localConfig from '../../../config/config.local';

describe('local logging config', () => {
  it('keeps application, framework, and AI info logs visible in the terminal', () => {
    const config = localConfig();

    assert.equal(config.logger?.consoleLevel, 'INFO');
    assert.equal(config.logger?.coreLogger?.consoleLevel, 'INFO');
    assert.equal(config.logger?.disableConsoleAfterReady, false);
    assert.equal(config.customLogger?.aiLogger?.consoleLevel, 'INFO');
  });
});
