const TronWeb = require('tronweb');
const tronboxConfig = require('../tronbox.js');

class BlockchainConfig {
    constructor() {
        this.network = process.env.BLOCKCHAIN_NETWORK || 'shasta'; // Default to Shasta testnet, for example

        const networkConfig = tronboxConfig.networks[this.network];
        if (!networkConfig) {
            throw new Error(`Network configuration not found for ${this.network}`);
        }

        if (!networkConfig.fullHost) {
            throw new Error('Provider URL is missing.');
        }

        if (!networkConfig.privateKey) {
            throw new Error('Private key is missing.');
        }

        this.fullHost = networkConfig.fullHost;

        this.tronWeb = new TronWeb({
            fullHost: networkConfig.fullHost,
            solidityNode: networkConfig.solidityNode,
            privateKey: networkConfig.privateKey
        });

        this.contractAddress = process.env.CONTRACT_ADDRESS || '';
        if (!TronWeb.isAddress(this.contractAddress)) {
            throw new Error(`Invalid contract address: ${this.contractAddress}`);
        }

        // Load ABI files
        this.factoryAbi = require("../abi/factory.json");
        this.depositAbi = require("../abi/deposit.json");
        this.erc20Abi = require("../abi/erc20.json");
        this.allowedTokens = require("../allowedTokens");
    }
}

// Export a single instance of the config class
const blockchainConfig = new BlockchainConfig();
module.exports = blockchainConfig;
