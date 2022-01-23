const { ethers } = require("ethers");

const utils = require("./utils");
const GasData = require("./gasData");
const SyncRequest = require("./syncRequest");
const ProxyResolver = require("./proxyResolver");

const { getContractFactory, predeploys } = require("@eth-optimism/contracts");
const { injectL2Context } = require("@eth-optimism/core-utils");

/**
 * Tracks blocks and cycles across them, extracting gas usage data and
 * associating it with the relevant contracts, methods.
 */
class TransactionWatcher {
  constructor(config) {
    this.itStartBlock = 0; // Tracks within `it` block transactions (gas usage per test)
    this.beforeStartBlock = 0; // Tracks from `before/beforeEach` transactions (methods & deploys)
    this.data = new GasData();
    this.sync = new SyncRequest(config.url);
    this.provider = config.provider;
    this.resolver = new ProxyResolver(this.data, config);

    console.log(ethers);
    // Create an ethers provider connected to the public mainnet endpoint.
    this.optimismProvider = injectL2Context(
      new ethers.providers.JsonRpcProvider("https://mainnet.optimism.io")
    );

    // Create contract instances connected to the GPO and WETH contracts.
    this.optimismGasPriceOracle = getContractFactory("OVM_GasPriceOracle")
      .attach(predeploys.OVM_GasPriceOracle)
      .connect(this.optimismProvider);
  }

  /**
   * Cycles across a range of blocks, from beforeStartBlock set in the reporter's
   * `test` hook to current block when it's called. Collect deployments and methods
   * gas usage data.
   * @return {Number} Total gas usage for the `it` block
   */

  async collectGasUsage(startBlock, endBlock) {
    let currentBlock = startBlock;

    // TODO: Fetch blocks async, than tx collect data async
    while (currentBlock <= endBlock) {
      let block = await this.provider.getBlock(currentBlock, true);

      if (block) {
        // Collect methods and deployments data
        await block.transactions.forEach(async transaction => {
          const receipt = await this.provider.getTransactionReceipt(
            transaction.hash
          );

          // Omit transactions that throw
          if (parseInt(receipt.status) === 0) return;

          // Collect gas usage data
          await collectData(receipt, transaction);
        });
      }

      currentBlock++;
    }
  }

  async collectData(receipt, transaction) {
    receipt.contractAddress
      ? await this._asyncCollectDeploymentsData(transaction, receipt)
      : await this._asyncCollectMethodsData(transaction, receipt);

    await _calculateL1OptimismCost(transaction);
  }

  /**
   * Extracts and stores deployments gas usage data for a tx
   * @param  {Object} transaction return value of `getTransactionByHash`
   * @param  {Object} receipt
   */
  async _calculateL1OptimismCost(transaction) {
    // console.log({
    //     ...(await WETH.populateTransaction.transfer(to, amount)),
    //     gasPrice: await provider.getGasPrice(),
    //     gasLimit: await WETH.estimateGas.transfer(to, amount, { from,}),
    // })

    console.log(transaction);
    console.log(ethers.utils.parseTransaction(transaction.raw));

    // // Compute the estimated fee in wei
    // const l1FeeInWei = await GasPriceOracle.getL1Fee(
    //   ethers.utils.serializeTransaction({
    //     ...(await WETH.populateTransaction.transfer(to, amount)),
    //     gasPrice: await provider.getGasPrice(),
    //     gasLimit: await WETH.estimateGas.transfer(to, amount, { from, }),
    //   })
    // )
  }

  /**
   * Extracts and stores deployments gas usage data for a tx
   * @param  {Object} transaction return value of `getTransactionByHash`
   * @param  {Object} receipt
   */
  async _asyncCollectDeploymentsData(transaction, receipt) {
    const match = this.data.getContractByDeploymentInput(transaction.data);

    if (match) {
      await this.data.asyncTrackNameByAddress(
        match.name,
        receipt.contractAddress
      );
      match.gasData.push(receipt.gasUsed);
    }
  }

  /**
   * Extracts and stores methods gas usage data for a tx
   * @param  {Object} transaction return value of `getTransactionByHash`
   * @param  {Object} receipt
   */
  async _asyncCollectMethodsData(transaction, receipt) {
    let contractName = await this.data.asyncGetNameByAddress(transaction.to);

    // Case: transfer
    if (!contractName && transaction.data == "0x") {
      return;
    }

    // Case: proxied call
    if (this._isProxied(contractName, transaction.data)) {
      contractName = this.resolver.resolve(transaction);

      // Case: hidden contract factory deployment
    } else if (!contractName) {
      contractName = await this.resolver.asyncResolveByDeployedBytecode(
        transaction.to
      );
    }

    // Case: all else fails, use first match strategy
    if (!contractName) {
      contractName = this.resolver.resolveByMethodSignature(transaction);
    }

    const id = utils.getMethodID(contractName, transaction.data);
    if (this.data.methods[id]) {
      this.data.methods[id].gasData.push(receipt.gasUsed);
      this.data.methods[id].numberOfCalls += 1;
    } else {
      this.resolver.unresolvedCalls++;
    }
  }

  /**
   * Returns true if there is a contract name associated with an address
   * but method can't be matched to it
   * @param  {String}  name  contract name
   * @param  {String}  input code
   * @return {Boolean}
   */
  _isProxied(name, input) {
    return name && !this.data.methods[utils.getMethodID(name, input)];
  }
}

module.exports = TransactionWatcher;
