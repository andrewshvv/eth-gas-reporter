const { ethers } = require("ethers");

const utils = require("./utils");
const GasData = require("./gasData");
const ProxyResolver = require("./proxyResolver");

const { getContractFactory, predeploys } = require("@eth-optimism/contracts");
const { injectL2Context } = require("@eth-optimism/core-utils");
const { BigNumber } = require("bignumber.js");
/**
 * Tracks blocks and cycles across them, extracting gas usage data and
 * associating it with the relevant contracts, methods.
 */
class TransactionWatcher {
  constructor(config) {
    // TODO: Subscribe on events with ethers.js provider
    // TODO: Introduce web-sockets and async queue tasks:
    // - block => get txs => add to queue
    // - new tx => get receipts => add to queue
    // - new receipt => collect data

    this.data = new GasData();
    this.provider = config.provider;
    this.resolver = new ProxyResolver(this.data, config);

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
      let block = await this.provider.getBlockWithTransactions(currentBlock);

      if (block) {
        // Collect methods and deployments data
        await block.transactions.forEach(async transaction => {
          const receipt = await this.provider.getTransactionReceipt(
            transaction.hash
          );

          // Omit transactions that throw
          if (parseInt(receipt.status) === 0) return;

          // Collect gas usage data
          await this.collectData(receipt, transaction);
        });
      }

      currentBlock++;
    }
  }

  async collectData(receipt, transaction) {
    receipt.contractAddress
      ? await this._asyncCollectDeploymentsData(transaction, receipt)
      : await this._asyncCollectMethodsData(transaction, receipt);
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

      // Compute the estimated L1 calldata fee in wei for L2 transactions
      // TODO: Do I put every field for serialisation?
      const callDataFeeInWei = await this.optimismGasPriceOracle.getL1Fee(
        ethers.utils.serializeTransaction({
          nonce: transaction.nonce,
          data: transaction.data,
          to: transaction.to,
          gasPrice: transaction.gasPrice.toNumber(),
          gasLimit: transaction.gasLimit.toNumber()
        })
      );

      match.gasData.push(new BigNumber(receipt.gasUsed.toString()));
      match.callDataFee.push(new BigNumber(callDataFeeInWei.toString()));
    }
  }

  /**
   * Extracts and stores methods gas usage data for a tx
   * @param  {Object} transaction return value of `getTransactionByHash`
   * @param  {Object} receipt
   */
  async _asyncCollectMethodsData(transaction, receipt) {
    let contractName = this.data.asyncGetNameByAddress(transaction.to);

    // Case: transfer
    if (!contractName && transaction.data == "0x") {
      return;
    }

    // Case: proxied call
    if (this._isProxied(contractName, transaction.data)) {
      contractName = this.resolver.resolve(transaction);

      // Case: hidden contract factory deployment
    } else if (!contractName) {
      contractName = this.resolver.asyncResolveByDeployedBytecode(
        transaction.to
      );
    }

    // Case: all else fails, use first match strategy
    if (!contractName) {
      contractName = this.resolver.resolveByMethodSignature(transaction);
    }

    // Compute the estimated L1 calldata fee in wei for L2 transactions
    // TODO: Do I put every field for serialisation?
    const callDataFeeInWei = await this.optimismGasPriceOracle.getL1Fee(
      ethers.utils.serializeTransaction({
        nonce: transaction.nonce,
        data: transaction.data,
        to: transaction.to,
        gasPrice: transaction.gasPrice.toNumber(),
        gasLimit: transaction.gasLimit.toNumber()
      })
    );

    const id = utils.getMethodID(contractName, transaction.data);
    if (this.data.methods[id]) {
      this.data.methods[id].gasData.push(
        new BigNumber(receipt.gasUsed.toString())
      );
      this.data.methods[id].callDataFee.push(
        new BigNumber(callDataFeeInWei.toString())
      );
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
