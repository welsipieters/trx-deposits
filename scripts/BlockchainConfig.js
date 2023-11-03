const TronWeb = require('tronweb');
const tronboxConfig = require('../tronbox.js');

const apiKeys = process.env.GETBLOCK_API_KEYS.split(',');
let currentKeyIndex = 0;
let requestCount = 0;
const maxRequestsPerKey = 100;

class BlockchainConfig {
    constructor() {
        this.network = process.env.BLOCKCHAIN_NETWORK || 'shasta'; // Default to Shasta testnet, for example
        this.apiKey = process.env.TRONGRID_API_KEY;
        this.networkConfig = tronboxConfig.networks[this.network];
        if (!this.networkConfig) {
            throw new Error(`Network configuration not found for ${this.network}`);
        }

        if (!this.networkConfig.fullHost) {
            throw new Error('Provider URL is missing.');
        }

        if (!this.networkConfig.privateKey) {
            throw new Error('Private key is missing.');
        }

        this.fullHost = this.networkConfig.fullHost;

        this.tronWeb = new TronWeb({
            fullHost: this.networkConfig.fullHost,
            solidityNode: this.networkConfig.solidityNode,
            privateKey: this.networkConfig.privateKey
        });


        // Load ABI files
        this.factoryAbi = require("../abi/factory.json");
        this.depositAbi = require("../abi/deposit.json");
        this.erc20Abi = require("../abi/erc20.json");
        this.allowedTokens = require("../allowedTokens");
    }

    updateApiKey() {
        if (requestCount >= maxRequestsPerKey) {
            currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
            requestCount = 0; // reset the request count for the new key
            this.networkConfig.fullHost = this.getFullHost();
            this.networkConfig.solidityNode = this.getFullHost();
            this.tronWeb = new TronWeb({
                fullHost: this.networkConfig.fullHost,
                solidityNode: this.networkConfig.solidityNode,
                privateKey: this.networkConfig.privateKey
            })
        }
        requestCount++;
    }

    getFullHost() {
        // Replace the placeholder with the actual key
        const baseUrl = 'https://trx.nownodes.io/';
        return baseUrl + apiKeys[currentKeyIndex];
    }
}

// Export a single instance of the config class
const blockchainConfig = new BlockchainConfig();
module.exports = blockchainConfig;
