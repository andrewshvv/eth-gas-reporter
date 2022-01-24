const colors = require("colors/safe");
const _ = require("lodash");
const fs = require("fs");
const Table = require("cli-table3");
const utils = require("./utils");
const CodeChecksReport = require("./codechecksReport");
const { BigNumber } = require("bignumber.js");
const { constant } = require("lodash");

function getMethods(obj) {
  var res = [];
  for (var m in obj) {
    if (typeof obj[m] == "function") {
      res.push(m);
    }
  }
  return res;
}

class GasTable {
  constructor(config) {
    this.config = config;
  }
  /**
   * Formats and prints a gas statistics table. Optionally writes to a file.
   * Based on Alan Lu's (github.com/@cag) stats for Gnosis
   * @param  {Object} info   GasData instance with `methods` and `deployments` data
   */
  generate(info) {
    colors.enabled = !this.config.noColors || false;

    // ---------------------------------------------------------------------------------------------
    // Assemble section: methods
    // ---------------------------------------------------------------------------------------------
    const methodRows = [];

    _.forEach(info.methods, (data, methodId) => {
      if (!data) return;

      let stats = {};

      if (data.gasData.length) {
        // Calculate total gas usage by function
        const total = data.gasData.reduce(
          (acc, datum) => acc.plus(datum),
          new BigNumber(0)
        );

        // Calculate average gas usage by function
        stats.average = total
          .dividedBy(data.gasData.length)
          .toFixed(0)
          .toString();

        if (this.config.ethPrice && this.config.gasPrice) {
          // Calculate average cost in chosen currency
          stats.cost = utils.pretifyCost(
            utils.gasToCost(
              stats.average,
              this.config.ethPrice,
              this.config.gasPrice
            )
          );
        } else {
          stats.cost = colors.grey("-");
        }
      } else {
        stats.average = colors.grey("-");
        stats.cost = colors.grey("-");
      }

      if (data.callDataFee.length) {
        // Calculate total L1 calldata fee by function
        const total = data.callDataFee.reduce(
          (acc, datum) => acc.plus(datum),
          new BigNumber(0)
        );

        if (this.config.ethPrice) {
          // Calculate average L1 gas calldata usage by function
          let average = total.dividedBy(data.callDataFee.length);

          // Calculate L1 calldata cost of function
          stats.callDataCost = utils.pretifyCost(
            utils.gasFeeToCost(average, this.config.ethPrice)
          );
        } else {
          stats.callDataCost = colors.grey("-");
        }
      } else {
        stats.callDataCost = colors.grey("-");
      }

      const sortedData = data.gasData.sort((a, b) => a - b);
      stats.min = sortedData[0];
      stats.max = sortedData[sortedData.length - 1];

      const uniform = stats.min === stats.max;
      stats.min = uniform ? "-" : colors.cyan(stats.min.toString());
      stats.max = uniform ? "-" : colors.red(stats.max.toString());

      stats.numberOfCalls = colors.grey(data.gasData.length);

      const fnName = this.config.showMethodSig ? data.fnSig : data.method;

      if (!this.config.onlyCalledMethods || data.gasData.length > 0) {
        const section = [];
        section.push(colors.grey(data.contract));
        section.push(fnName);
        section.push({ hAlign: "right", content: stats.min });
        section.push({ hAlign: "right", content: stats.max });
        section.push({ hAlign: "right", content: stats.average });
        section.push({ hAlign: "right", content: data.gasData.length });
        section.push({ hAlign: "right", content: colors.green(stats.cost) });
        if (data.callDataFee.length > 0) {
          section.push({
            hAlign: "right",
            content: colors.green(stats.callDataCost)
          });
        }

        methodRows.push(section);
      }
    });

    // ---------------------------------------------------------------------------------------------
    // Assemble section: deployments
    // ---------------------------------------------------------------------------------------------
    const deployRows = [];

    // Alphabetize contract names
    info.deployments.sort((a, b) => a.name.localeCompare(b.name));

    info.deployments.forEach(contract => {
      let stats = {};
      if (!contract.gasData.length) {
        return;
      }

      if (contract.callDataFee.length) {
        // Calculate total L1 calldata fee by function
        const total = contract.callDataFee.reduce(
          (acc, datum) => acc.plus(datum),
          new BigNumber(0)
        );

        if (this.config.ethPrice) {
          // Calculate average L1 gas calldata usage by function
          let average = total.dividedBy(contract.callDataFee.length);

          // Calculate L1 calldata cost of function
          stats.callDataCost = utils.pretifyCost(
            utils.gasFeeToCost(average, this.config.ethPrice)
          );
        } else {
          stats.callDataCost = colors.grey("-");
        }
      } else {
        stats.callDataCost = colors.grey("-");
      }

      const total = contract.gasData.reduce(
        (acc, datum) => acc.plus(datum),
        new BigNumber(0)
      );

      stats.average = total
        .dividedBy(contract.gasData.length)
        .toFixed(0)
        .toString();

      stats.percent = utils
        .gasToPercentOfLimit(stats.average, info.blockLimit)
        .toString();

      stats.cost =
        this.config.ethPrice && this.config.gasPrice
          ? utils.pretifyCost(
              utils.gasToCost(
                stats.average,
                this.config.ethPrice,
                this.config.gasPrice
              )
            )
          : colors.grey("-");

      const sortedData = contract.gasData.sort((a, b) => a - b);
      stats.min = sortedData[0];
      stats.max = sortedData[sortedData.length - 1];

      const uniform = stats.min === stats.max;
      stats.min = uniform ? "-" : colors.cyan(stats.min.toString());
      stats.max = uniform ? "-" : colors.red(stats.max.toString());

      const section = [];
      section.push({ hAlign: "left", colSpan: 2, content: contract.name });
      section.push({ hAlign: "right", content: stats.min });
      section.push({ hAlign: "right", content: stats.max });
      section.push({ hAlign: "right", content: stats.average });
      section.push({
        hAlign: "right",
        content: colors.grey(`${stats.percent} %`)
      });
      section.push({ hAlign: "right", content: colors.green(stats.cost) });
      if (contract.callDataFee.length) {
        section.push({
          hAlign: "right",
          content: colors.green(stats.callDataCost)
        });
      }
      deployRows.push(section);
    });

    // ---------------------------------------------------------------------------------------------
    // Assemble section: headers
    // ---------------------------------------------------------------------------------------------

    // Configure indentation for RTD
    const leftPad = this.config.rst ? "  " : "";

    // Format table
    const table = new Table({
      style: { head: [], border: [], "padding-left": 2, "padding-right": 2 },
      chars: {
        mid: "·",
        "top-mid": "|",
        "left-mid": `${leftPad}·`,
        "mid-mid": "|",
        "right-mid": "·",
        left: `${leftPad}|`,
        "top-left": `${leftPad}·`,
        "top-right": "·",
        "bottom-left": `${leftPad}·`,
        "bottom-right": "·",
        middle: "·",
        top: "-",
        bottom: "-",
        "bottom-mid": "|"
      }
    });

    // Format and load methods metrics
    console.log(this.config.metadata);
    const solc = utils.getSolcInfo(this.config.metadata);

    let title = [
      {
        hAlign: "center",
        colSpan: 2,
        content: colors.grey(`Solc version: ${solc.version}`)
      },
      {
        hAlign: "center",
        colSpan: 2,
        content: colors.grey(`Optimizer enabled: ${solc.optimizer}`)
      },
      {
        hAlign: "center",
        colSpan: 1,
        content: colors.grey(`Runs: ${solc.runs}`)
      },
      {
        hAlign: "center",
        colSpan: 2,
        content: colors.grey(`Block limit: ${info.blockLimit} gas`)
      }
    ];

    let methodSubtitle;
    if (this.config.ethPrice && this.config.gasPrice) {
      const gwei = new BigNumber(this.config.gasPrice).toNumber();
      const rate = new BigNumber(this.config.ethPrice).toFixed(2);
      const currency = `${this.config.currency.toLowerCase()}`;
      const token = `${this.config.token.toLowerCase()}`;

      methodSubtitle = [
        { hAlign: "left", colSpan: 2, content: colors.green.bold("Methods") },
        {
          hAlign: "center",
          colSpan: 3,
          content: colors.grey(`${gwei} gwei/gas`)
        },
        {
          hAlign: "center",
          colSpan: 2,
          content: colors.red(`${rate} ${currency}/${token}`)
        }
      ];
    } else {
      methodSubtitle = [
        { hAlign: "left", colSpan: 7, content: colors.green.bold("Methods") }
      ];
    }

    const header = [
      colors.bold("Contract"),
      colors.bold("Method"),
      colors.green("Min"),
      colors.green("Max"),
      colors.green("Avg"),
      colors.bold("# calls"),
      colors.bold(`${this.config.currency.toLowerCase()} L2 fee (avg)`),
      colors.bold(`${this.config.currency.toLowerCase()} L1 fee (avg)`)
    ];

    // TODO: Add rows only if optimism specified

    // ---------------------------------------------------------------------------------------------
    // Final assembly
    // ---------------------------------------------------------------------------------------------
    table.push(title);
    table.push(methodSubtitle);
    table.push(header);

    methodRows.sort((a, b) => {
      const contractName = a[0].localeCompare(b[0]);
      const methodName = a[1].localeCompare(b[1]);
      return contractName || methodName;
    });

    methodRows.forEach(row => table.push(row));

    if (deployRows.length) {
      const deploymentsSubtitle = [
        {
          hAlign: "left",
          colSpan: 2,
          content: colors.green.bold("Deployments")
        },
        { hAlign: "right", colSpan: 3, content: "" },
        { hAlign: "left", colSpan: 1, content: colors.bold(`% of limit`) }
      ];
      table.push(deploymentsSubtitle);
      deployRows.forEach(row => table.push(row));
    }

    // ---------------------------------------------------------------------------------------------
    // RST / ReadTheDocs / Sphinx output
    // ---------------------------------------------------------------------------------------------
    let rstOutput = "";
    if (this.config.rst) {
      rstOutput += `${this.config.rstTitle}\n`;
      rstOutput += `${"=".repeat(this.config.rstTitle.length)}\n\n`;
      rstOutput += `.. code-block:: shell\n\n`;
    }

    let tableOutput = rstOutput + table.toString();

    // ---------------------------------------------------------------------------------------------
    // Print
    // ---------------------------------------------------------------------------------------------
    this.config.outputFile
      ? fs.writeFileSync(this.config.outputFile, tableOutput)
      : console.log(tableOutput);

    this.saveCodeChecksData(info);

    // For integration tests
    if (process.env.DEBUG_CODECHECKS_TABLE) {
      const report = new CodeChecksReport(this.config);
      console.log(report.generate(info));
    }
  }

  /**
   * Writes acccumulated data and the current config to gasReporterOutput.json so it
   * can be consumed by codechecks
   * @param  {Object} info  GasData instance
   */
  saveCodeChecksData(info) {
    delete this.config.provider;
    delete info.provider;

    const output = {
      namespace: "ethGasReporter",
      config: this.config,
      info: info
    };

    if (process.env.CI) {
      fs.writeFileSync("./gasReporterOutput.json", JSON.stringify(output));
    }
  }
}

module.exports = GasTable;
