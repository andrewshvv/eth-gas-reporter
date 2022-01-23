const mocha = require("mocha");
const inherits = require("util").inherits;
const Base = mocha.reporters.Base;
const color = Base.color;
const log = console.log;
const utils = require("./lib/utils");
const Config = require("./lib/config");
const TransactionWatcher = require("./lib/transactionWatcher");
const GasTable = require("./lib/gasTable");
const SyncRequest = require("./lib/syncRequest");
const mochaStats = require("./lib/mochaStats");
const deasync = require("deasync");

const {
  EVENT_HOOK_BEGIN,
  EVENT_HOOK_END,
  EVENT_RUN_BEGIN,
  EVENT_DELAY_BEGIN,
  EVENT_DELAY_END,
  EVENT_RUN_END,
  EVENT_SUITE_BEGIN,
  EVENT_SUITE_END,
  EVENT_TEST_BEGIN,
  EVENT_TEST_END,
  EVENT_TEST_FAIL,
  EVENT_TEST_PASS,
  EVENT_TEST_PENDING,
  EVENT_TEST_RETRY,
  STATE_IDLE,
  STATE_RUNNING,
  STATE_STOPPED
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

function Gas(runner, options) {
  // Spec reporter
  Base.call(this, runner, options);

  // Initialize stats for Mocha 6+ epilogue
  if (!runner.stats) {
    mochaStats(runner);
    this.stats = runner.stats;
  }

  const self = this;

  let indents = 0;
  let n = 0;
  let failed = false;
  let indent = () => Array(indents).join("  ");

  // Gas reporter setup
  const config = new Config(options.reporterOptions);
  const sync = new SyncRequest(config.url);
  const watch = new TransactionWatcher(config);
  const table = new GasTable(config);
  const provider = config.provider;

  // Expose internal methods to plugins
  if (typeof options.attachments === "object") {
    options.attachments.recordTransaction = watch.transaction.bind(watch);
  }

  // These call the cloud, start running them.
  utils.setGasAndPriceRates(config);

  // ------------------------------------  Runners -------------------------------------------------

  runner.on(EVENT_RUN_BEGIN, () => {
    watch.data.initialize(config);
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

  runner.on(EVENT_TEST_PENDING, async test => {
    let fmt = indent() + color("pending", "  - %s");
    log(fmt, test.title);
  });

  // ------------------------------------  RPC part -------------------------------------------------

  runner.on("test", test => {
    // if (!config.provider) {
    // watch.beforeStartBlock = sync.blockNumber();
    // }
    watch.data.resetAddressCache();
  });

  runner.on(EVENT_HOOK_END, hook => {
    if (hook.title.includes("before each")) {
      watch.itStartBlock = sync.blockNumber() + 1;
    }
  });

  runner.on(EVENT_TEST_PASS, test => {
    let fmt;
    let fmtArgs;
    let gasUsedString;
    let consumptionString;
    let timeSpentString = color(test.speed, "%dms");
    let gasUsed;

    // const endBlock = sync.blockNumber();
    // const startBlock = watch.beforeStartBlock;
    // const itStartBlock = watch.itStartBlock;

    fn = async (startBlock, endBlock, itStartBlock) => {
      gasUsed = await watch.collectGasUsage(startBlock, endBlock, itStartBlock);
      // }

      if (gasUsed) {
        //   gasUsedString = color("checkmark", "%d gas");

        //   if (config.showTimeSpent) {
        //     consumptionString =
        //       " (" + timeSpentString + ", " + gasUsedString + ")";
        //     fmtArgs = [test.title, test.duration, gasUsed];
        //   } else {
        //     consumptionString = " (" + gasUsedString + ")";
        //     fmtArgs = [test.title, gasUsed];
        //   }

        //   fmt =
        //     indent() +
        //     color("checkmark", "  " + Base.symbols.ok) +
        //     color("pass", " %s") +
        //     consumptionString;
        // } else {
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
      }
      log.apply(null, [fmt, ...fmtArgs]);
    };

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

    // fn(startBlock, endBlock, itStartBlock);
  });

  runner.on(EVENT_TEST_FAIL, test => {
    failed = true;
    let fmt = indent() + color("fail", "  %d) %s");
    log();
    log(fmt, ++n, test.title);
  });

  runner.on(EVENT_RUN_END, () => {
    let done = false;
    async function report() {
      try {
        const endBlock = sync.blockNumber();
        await watch.collectGasUsage(0, endBlock, 0);

        table.generate(watch.data);
        self.epilogue();
      } catch (err) {
        // TODO: What is the proper way?
        console.log(err);
      } finally {
        done = true;
      }
    }

    report();
    while (!done) {
      require("deasync").sleep(100);
    }
  });
}

/**
 * Inherit from `Base.prototype`.
 */
inherits(Gas, Base);

module.exports = Gas;
