'use strict';

var _jestExpect = require('jest-circus/build/legacy-code-todo-rewrite/jestExpect');
var _jestExpect2 = _interopRequireDefault(_jestExpect);
var _jestAdapterInit = require('jest-circus/build/legacy-code-todo-rewrite/jestAdapterInit');

var _electron = require('electron');
var _electron2 = _interopRequireDefault(_electron);

var _utils = require('@jest-runner/core/utils');
var _jestUtil = require('jest-util');
function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : {default: obj};
}
/**
 * Copyright (c) 2014-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */ const setupConsole = () => {
  const testConsole = new _jestUtil.BufferedConsole(() => {});
  const originalWrite = _jestUtil.BufferedConsole.write;
  _jestUtil.BufferedConsole.write = (...args) => {
    // make sure the stack trace still points to the original .log origin.
    args[3] = 5;
    return originalWrite(...args);
  };

  const rendererConsole = global.console;
  const mergedConsole = {};
  Object.getOwnPropertyNames(rendererConsole)
    .filter(prop => typeof rendererConsole[prop] === 'function')
    .forEach(prop => {
      mergedConsole[prop] =
        typeof testConsole[prop] === 'function'
          ? (...args) => {
              testConsole[prop](...args);
              return rendererConsole[prop](...args);
            }
          : (...args) => rendererConsole[prop](...args);
    });
  delete global.console;
  global.console = mergedConsole;

  return testConsole;
};

module.exports = {
  async runTest(testData) {
    try {
      const testConsole = setupConsole();
      // $FlowFixMe
      (0, _jestExpect2.default)(testData.globalConfig);
      (0, _jestAdapterInit.initialize)({
        config: testData.config,
        globalConfig: testData.globalConfig,
        localRequire: require,
        parentProcess: process,
        testPath: testData.path
      });

      const {setupTestFrameworkScriptFile} = testData.config;
      if (setupTestFrameworkScriptFile) {
        require(setupTestFrameworkScriptFile);
      }
      require(testData.path);
      const testResult = await (0,
      _jestAdapterInit.runAndTransformResultsToJestFormat)({
        config: testData.config,
        globalConfig: testData.globalConfig,
        testPath: testData.path
      });

      testResult.console = testConsole.getBuffer();
      return testResult;
    } catch (error) {
      return Promise.resolve(
        (0, _utils.buildFailureTestResult)(
          testData.path,
          error,
          testData.config,
          testData.globalConfig
        )
      );
    }
  },

  async shutDown() {
    setTimeout(() => _electron2.default.remote.app.quit(), 0);
    return Promise.resolve();
  }
};
