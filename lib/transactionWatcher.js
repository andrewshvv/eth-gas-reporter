const { ethers } = require("ethers");

const utils = require("./utils");
const GasData = require("./gasData");
const ProxyResolver = require("./proxyResolver");

const { getContractFactory, predeploys } = require("@eth-optimism/contracts");
const { injectL2Context } = require("@eth-optimism/core-utils");

/**
 * Tracks blocks and cycles across them, extracting gas usage data and
 * associating it with the relevant contracts, methods.
 */
class TransactionWatcher {
  constructor(config) {
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

    await this._calculateL1OptimismCost(transaction);
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
    // console.log(ethers.utils.parseTransaction(transaction.raw));
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

    const id = utils.getMethodID(contractName, transaction.data);
    if (this.data.methods[id]) {
      console.log(id, receipt.gasUsed.toNumber().toString());
      this.data.methods[id].gasData.push(receipt.gasUsed);
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
