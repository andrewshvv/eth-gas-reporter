const mocha = require("mocha");
const Base = mocha.reporters.Base;
const color = Base.color;
const log = console.log;
const utils = require("./lib/utils");
const Config = require("./lib/config");
const TransactionWatcher = require("./lib/transactionWatcher");
const GasTable = require("./lib/gasTable");
const mochaStats = require("./lib/mochaStats");

var { sleep } = require("deasync");

const {
  EVENT_RUN_BEGIN,
  EVENT_RUN_END,
  EVENT_SUITE_BEGIN,
  EVENT_SUITE_END,
  EVENT_TEST_BEGIN,
  EVENT_TEST_FAIL,
  EVENT_TEST_PASS,
  EVENT_TEST_PENDING
} = mocha.Runner.constants;

/**
 * Based on the Mocha 'Spec' reporter. Watches an Ethereum test suite run
 * and collects data about method & deployments gas usage. Mocha executes the hooks
 * in this reporter synchronously so any client calls here should be executed
 * via low-level RPC interface using sync-request. (see /lib/syncRequest)
 * An exception is made for fetching gas & currency price data from coinmarketcap and
 * ethgasstation (we hope that single call will complete by the time the tests finish running)
 *
 * @param {Object} runner  mocha's runner
 * @param {Object} options reporter.options (see README example usage)
 */

class GasReporter extends Base {
  constructor(runner, options) {
    // Spec reporter
    super(runner, options);

    // Initialize stats for Mocha 6+ epilogue
    if (!runner.stats) {
      mochaStats(runner);
      this.stats = runner.stats;
    }

    const self = this;

    let indents = 0;
    let n = 0;
    let indent = () => Array(indents).join("  ");

    // Gas reporter setup
    const config = new Config(options.reporterOptions);
    const provider = config.provider;
    const watch = new TransactionWatcher(config);
    const table = new GasTable(config);

    // Expose internal methods to plugins (like hardhat-eth-gas-reporter)
    if (typeof options.attachments === "object") {
      options.attachments.recordTransaction = watch.transaction.bind(watch);
    }

    // These call the cloud, start running them.
    utils.setGasAndPriceRates(config);
    self.startBlock = 0;

    // ------------------------------------  Runners -------------------------------------------------

    runner.on(EVENT_RUN_BEGIN, event => {
      watch.data.initialize(config);

      let startBlock = 0;
      let done = false;

      (async function() {
        startBlock = await provider.getBlockNumber();
        done = true;
      })();

      while (!done) {
        sleep(100);
      }

      this.startBlock = startBlock;
    });

    runner.on(EVENT_SUITE_BEGIN, suite => {
      ++indents;
      log(color("suite", "%s%s"), indent(), suite.title);
    });

    runner.on(EVENT_SUITE_END, suite => {
      --indents;
      if (indents === 1) {
        log();
      }
    });

    runner.on(EVENT_TEST_PENDING, test => {
      let fmt = indent() + color("pending", "  - %s");
      log(fmt, test.title);
    });

    runner.on(EVENT_TEST_BEGIN, test => {
      watch.data.resetAddressCache();
    });

    runner.on(EVENT_TEST_PASS, test => {
      let fmt;
      let fmtArgs;
      let consumptionString;
      let timeSpentString = color(test.speed, "%dms");

      if (config.showTimeSpent) {
        consumptionString = " (" + timeSpentString + ")";
        fmtArgs = [test.title, test.duration];
      } else {
        consumptionString = "";
        fmtArgs = [test.title];
      }

      fmt =
        indent() +
        color("checkmark", "  " + Base.symbols.ok) +
        color("pass", " %s") +
        consumptionString;

      log.apply(null, [fmt, ...fmtArgs]);
    });

    runner.on(EVENT_TEST_FAIL, test => {
      let fmt = indent() + color("fail", "  %d) %s");
      log();
      log(fmt, ++n, test.title);
    });

    runner.on(EVENT_RUN_END, () => {
      let done = false;

      // Hack: execute async function inside the mocha sync context
      (async startBlock => {
        const endBlock = await provider.getBlockNumber();
        if (!config.collectedOutside) {
          // Generate data if we're not collecting it outside
          // Example: in hardhat-eth-gas-reporter
          await watch.collectGasUsage(startBlock, endBlock);
        }

        table.generate(watch.data);
        self.epilogue();
        done = true;
      })(this.startBlock);

      // Wait for asyn function, otherwise Mocha
      // will exit before we're done
      while (!done) {
        sleep(100);
      }
    });
  }
}

module.exports = GasReporter;
