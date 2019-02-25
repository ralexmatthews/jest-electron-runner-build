'use strict';
Object.defineProperty(exports, '__esModule', {value: true});

var _utils = require('@jest-runner/core/utils');
var _docblock = require('@jest-runner/core/docblock');
var _docblock2 = _interopRequireDefault(_docblock);
var _child_process = require('child_process');
var _fsExtra = require('fs-extra');
var _fsExtra2 = _interopRequireDefault(_fsExtra);
var _NuclideE2ERPCProcess = require('./rpc/NuclideE2ERPCProcess.generated');
var _NuclideE2ERPCProcess2 = _interopRequireDefault(_NuclideE2ERPCProcess);
var _os = require('os');
var _os2 = _interopRequireDefault(_os);
var _path = require('path');
var _path2 = _interopRequireDefault(_path);
var _throat = require('throat');
var _throat2 = _interopRequireDefault(_throat);
var _v = require('uuid/v4');
var _v2 = _interopRequireDefault(_v);
function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : {default: obj};
}
function _objectSpread(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};
    var ownKeys = Object.keys(source);
    if (typeof Object.getOwnPropertySymbols === 'function') {
      ownKeys = ownKeys.concat(
        Object.getOwnPropertySymbols(source).filter(function(sym) {
          return Object.getOwnPropertyDescriptor(source, sym).enumerable;
        })
      );
    }
    ownKeys.forEach(function(key) {
      _defineProperty(target, key, source[key]);
    });
  }
  return target;
}
function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }
  return obj;
}

const INJECTED_PACKAGE_PATH = _path2.default.resolve(
  __dirname,
  './nuclide-e2e-injected-package'
);

const makeTmpDirs = runID => {
  const tmpDir = _path2.default.resolve(
    _os2.default.tmpdir(),
    `.atom-${runID}`
  );
  // temp ~ that can be set to process.env.HOME to make sure
  // e2e tests don't write anything in the home dir of the user
  // that's running the test.
  const userHome = _path2.default.join(tmpDir, 'USER_HOME');
  const atomHome = _path2.default.join(tmpDir, 'ATOM_HOME');
  const packagesPath = _path2.default.join(atomHome, 'packages');
  _fsExtra2.default.mkdirpSync(packagesPath);
  _fsExtra2.default.mkdirpSync(userHome);
  _fsExtra2.default.ensureSymlinkSync(
    INJECTED_PACKAGE_PATH,
    _path2.default.join(
      packagesPath,
      _path2.default.basename(INJECTED_PACKAGE_PATH)
    )
  );

  return {atomHome, userHome};
};

let thingsToCleanUp = [];

const spawnAtomProcess = (
  {atomHome, atomExecutable, onOutput, runID, userHome},
  {serverID}
) => {
  if (!atomExecutable || !_fsExtra2.default.existsSync(atomExecutable)) {
    throw new Error(`
    can't find atomExecutable: "${JSON.stringify(atomExecutable)}".
    Make sure you have it specified in ${NUCLIDE_E2E_CONFIG_NAME}`);
  }
  const spawned = (0, _child_process.spawn)(atomExecutable, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: _objectSpread({}, process.env, {
      ATOM_HOME: atomHome,
      HOME: userHome,
      JEST_RUN_ID: runID,
      JEST_SERVER_ID: serverID
    }),

    detached: true
  });

  spawned.stdout.on('data', onOutput.bind(null, 'stdout'));
  spawned.stderr.on('data', onOutput.bind(null, 'stderr'));

  return spawned;
};

const once = fn => {
  let hasBeenCalled = false;
  return (...args) => {
    if (!hasBeenCalled) {
      hasBeenCalled = true;
      return fn(...args);
    }
  };
};

const NUCLIDE_E2E_CONFIG_NAME = 'jest.nuclide-e2e-runner-config.js';

const findConfig = rootDir => {
  if (rootDir === _path2.default.basename(rootDir)) {
    throw new Error(`
    Could not find a configuration file for Nuclide E2E test runner.
    Config file must be named ${NUCLIDE_E2E_CONFIG_NAME} and put either in the rootDir
    of jest project or in any of its parents.`);
  }
  const configPath = _path2.default.join(rootDir, NUCLIDE_E2E_CONFIG_NAME);
  return _fsExtra2.default.existsSync(configPath)
    ? // $FlowFixMe dynamic require
      require(configPath)
    : findConfig(_path2.default.basename(rootDir));
};

class TestRunner {
  constructor(globalConfig) {
    _defineProperty(this, '_globalConfig', void 0);
    this._globalConfig = globalConfig;
  }

  async runTests(tests, watcher, onStart, onResult, onFailure) {
    // Force concurrency to be 1. Multiple atoms conflict with each other
    // even if run from completely separate directories.
    const concurrency = 1;
    const keepProcessAlive = this._globalConfig.expand;
    if (keepProcessAlive && tests.length > 1) {
      throw new Error(
        '--expand option can only be used when running a single test'
      );
    }

    const cleanup = once(() => {
      thingsToCleanUp.forEach(fn => fn());
      thingsToCleanUp = [];
    });

    process.on('SIGINT', () => {
      cleanup();
      process.exit(130);
    });
    process.on('uncaughtException', error => {
      // eslint-disable-next-line no-console
      console.error(error);
      cleanup();
      // This will prevent other handlers to handle errors
      // (e.g. global Jest handler). TODO: find a way to provide
      // a cleanup function to Jest so it runs it instead
      process.exit(1);
    });

    await Promise.all(
      tests.map(
        (0, _throat2.default)(concurrency, async test => {
          const config = test.context.config;
          const globalConfig = this._globalConfig;
          const {
            atomExecutable,
            consoleFilter,
            testTeardown,
            retries
          } = findConfig(config.rootDir);
          let retriesLeft = retries || 1;
          let allRunResults = [];

          try {
            onStart(test);

            while (retriesLeft) {
              retriesLeft -= 1;
              const runID = (0, _v2.default)();
              const {processOutput, testResult} = await _runTest(test, {
                keepProcessAlive,
                globalConfig,
                testTeardown,
                atomExecutable,
                runID
              });

              const amendedTestResult = amendTestResult({
                testResult,
                processOutput,
                runID,
                consoleFilter
              });

              allRunResults.push(amendedTestResult);
              if (!hasFailed(amendedTestResult)) {
                break;
              }
            }

            const [lastResult, ...retriedResults] = allRunResults.reverse();

            lastResult.retriedResults = retriedResults.reverse();
            lastResult.testExecError != null
              ? // $FlowFixMe jest expects it to be rejected with an object
                onFailure(test, lastResult.testExecError)
              : onResult(test, lastResult);
          } catch (error) {
            onFailure(
              test,
              (0, _utils.buildFailureTestResult)(
                test.path,
                error,
                config,
                globalConfig
              ).testExecError
            );
          }
        })
      )
    );

    if (!keepProcessAlive) {
      cleanup();
    }
  }
}
exports.default = TestRunner;

const _runTest = async (
  test,
  {keepProcessAlive, globalConfig, atomExecutable, testTeardown, runID}
) => {
  const config = test.context.config;
  const {atomHome, userHome} = makeTmpDirs(runID);
  let processOutput = [];
  const onOutput = (pipe, data) => {
    const message = data.toString ? data.toString() : data;
    processOutput.push({
      message,
      origin: `Atom process ${pipe}`,
      type: 'log'
    });
  };
  const nuclideE2ERPCProcess = new _NuclideE2ERPCProcess2.default({
    spawn: spawnAtomProcess.bind(null, {
      atomHome,
      atomExecutable,
      onOutput,
      runID,
      userHome
    })
  });

  const directives = _docblock2.default.fromFile(test.path).getDirectives();
  for (const setupFile of config.setupFiles) {
    // $FlowFixMe dynamic require
    const setup = require(setupFile); // if it's a function call it and pass arguments. This is different
    // from how Jest works, but right now there's no other workaround to it
    typeof setup === 'function' && (await setup({atomHome, directives}));
  }
  await nuclideE2ERPCProcess.start();

  const localCleanup = once(() => {
    nuclideE2ERPCProcess.remote.shutDown();
    nuclideE2ERPCProcess.stop();
    testTeardown && testTeardown({runID, atomHome});
  });
  // Add to global cleanup in case the process crashes or something. We still want to kill all
  // subprocesses.
  thingsToCleanUp.push(localCleanup);
  const testResult = await nuclideE2ERPCProcess.remote.runTest({
    config,
    globalConfig,
    path: test.path
  });

  // We'll reuse `expand` flag (not the best idea) to keep the nuclide process
  // alive if we want to go back and debug something.
  if (!keepProcessAlive) {
    localCleanup();
  }
  return {processOutput, testResult};
};

// Add values to the test result that are specific to this runner.
const amendTestResult = ({testResult, processOutput, consoleFilter, runID}) => {
  const amendedTestResult = _objectSpread({}, testResult, {
    runID,
    console: processOutput.length
      ? // Add messages from process output to test results
        [...processOutput, ...(testResult.console || [])]
      : testResult.console
  });

  amendedTestResult.console = consoleFilter(testResult.console);
  return amendedTestResult;
};

const hasFailed = testResult => {
  if (testResult.numFailingTests) {
    return true;
  }

  if (testResult.testExecError) {
    return true;
  }

  return false;
};
