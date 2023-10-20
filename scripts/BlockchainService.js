const TronWeb = require('tronweb');
const blockchainConfig = require('./blockchainConfig');
const databaseService = require('./DatabaseService');
const axios = require("axios");

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const MAX_ATTEMPTS = 100;  // Maximum number of attempts to check the transaction
const DELAY_INTERVAL = 5000;  // Delay of 5 seconds between each check
const tokenDecimalCache = {};



class BlockchainService {
    constructor() {
        this.tronWeb = blockchainConfig.tronWeb
        this.contract = this.tronWeb.contract(blockchainConfig.factoryAbi, blockchainConfig.contractAddress);
    }

    async getCurrentBlockNumber() {
        const currentBlock = await this.tronWeb.trx.getCurrentBlock()

        return currentBlock.block_header.raw_data.number;
    }

    async getTokenDecimals(tokenAddress) {
        // If we've already fetched the decimals for this token, return it
        if (tokenDecimalCache[tokenAddress]) {
            return tokenDecimalCache[tokenAddress];
        }
        console.log(tokenAddress)
        const tokenContract = this.tronWeb.contract(blockchainConfig.erc20Abi, tokenAddress);
        const decimals = await tokenContract.decimals().call();

        // Cache the result for future use
        tokenDecimalCache[tokenAddress] = decimals;

        return decimals;
    }

    async getPastEvents(toAddress, sinceTimestamp = 0, untilTimestamp = Date.now()) {
        const hexAddress = '0x' + toAddress.slice(24);

// Convert to base58
        const base58Address = this.tronWeb.address.fromHex(hexAddress);
        const url = `${blockchainConfig.fullHost}/v1/accounts/${base58Address}/transactions/trc20?only_confirmed=true&only_to=true`;
        const response = await axios.get(url);
        if (response.data && response.data.data) {
            return response.data.data;
        }
        return [];
    }

    async checkTokenTransfers(end) {
        console.log("Checking for new transactions. current block number: ", end)
        const addresses = await databaseService.fetchUsedAddressesFromDB();
        for (let address of addresses) {
            console.log(`Checking address ${address.address}`)
            const events = await this.getPastEvents(address.address, address.last_seen, end)
            if (events.length > 0) {
                // console.log(`Found ${events.length} transfer events for ${address.address}`)
            }

            for (const event of events) {
                try {
                    await this.recordTransferToDB(event);
                } catch (e) {
                    console.log("error", e)
                }
            }



            await databaseService.updateLastSeenBlock(address.address, end)
        }
    }

    async notifySweeped(config) {
        try {
            const endpoint = 'create-or-update-deposit';
            const deposits = [];

            const sweepsToNotify = await databaseService.findSweepsForNotification();
            for (const sweep of sweepsToNotify) {
                deposits.push({
                    'address': sweep.address,
                    'network': 'tron',
                    'currency': sweep.token_name,
                    'txid': sweep.transactionHash,
                    'amount': parseFloat(sweep.amount).toString(),
                    'confirmations': sweep.core_notifications+1
                });
            }


            try {
                // Make the API call to post the transactions
                const response = await axios.post(`${config.knakenURL}${endpoint}`, { deposits,  walletAPIKey: config.keys.admin, }, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Knaken-Wallet-Processor': config.keys.core
                    }
                });


                if (response.status === 200) {
                    console.log("Transactions posted successfully", response.data);
                    sweepsToNotify.each(sweep => databaseService.incrementCoreNotification(sweep.id))
                } else {
                    console.error("Failed to post transactions:", response.data);
                }

            } catch (error) {
                console.error('Error posting transactions:', error);
            }

        } catch (error) {
            console.error('Error in cron job:', error);
        }
    }

    async sweepTokens() {
        const addresses = await databaseService.fetchUsedAddressesFromDB();

        for (const address of addresses) {
            const hexAddress = '0x' + address.address.slice(24);

            const base58Address = this.tronWeb.address.fromHex(hexAddress);
            const deposits = await databaseService.findUnprocessedDepositsByToAddress(base58Address)
            if (deposits.length == 0) {
                continue;
            }

            console.log(`Found ${deposits.length} unprocessed deposits for ${address.address}`)

            for (const deposit of deposits) {

               try {
                   const contract = this.tronWeb.contract(blockchainConfig.depositAbi, deposit.to_address);

                   const tx = await contract.sweepERC20Token(deposit.currency_address, deposit.amount_real).send({
                       from: this.tronWeb.defaultAddress.hex,
                       shouldPollResponse: false
                   })


                   console.log(`Sweeping ${deposit.amount} ${deposit.currency_name} from ${deposit.to_address}. Hash: `, tx)
                   await databaseService.updateProcessedStatusByHash(deposit.hash, tx, true)

                   const txInfo = await this.checkTransactionUntilConfirmed(tx);

                   console.log(`Successfully swept ${deposit.amount} ${deposit.currency_name} from ${deposit.to_address}`)
                   const blockNumber = await this.getCurrentBlockNumber()
                   const sweepData = {
                       address: deposit.to_address,
                       amount: deposit.amount_real,
                       transactionHash: txInfo.id,
                       token_name: deposit.currency_name,
                       tokenContractAddress: deposit.currency_address,
                       block: blockNumber,
                       core_notifications: 0
                   };

                   await databaseService.insertSweep(sweepData);

               } catch (e) {
                   console.error('error', e)
                   await databaseService.updateProcessedStatusByHash(deposit.hash, null, false)
               }
            }
        }
    }

    async recordTransferToDB(event) {
        const depositData = {
            blockNumber: event.block_timestamp,
            fromAddress: event.from,
            toAddress: event.to,
            currencyAddress: event.token_info.address,
            currencyName: event.token_info.symbol,
            hash: event.transaction_id,
            process_tx: '',
            processed: false,
            amount: BigInt(event.value) / BigInt(10 ** event.token_info.decimals),
            amount_real: event.value
        };

        if (!blockchainConfig.allowedTokens.some(addr => addr.toLowerCase() === depositData.currencyAddress.toLowerCase())) {
            return;
        }


        const deposit = await databaseService.findDepositByHash(depositData.hash)

        if (!deposit) {
            console.log(`Recording transaction of token ${depositData.currencyName} for wallet ${depositData.toAddress}`)

            await databaseService.insertDeposit(depositData);
        }

    }

    async checkTransactionUntilConfirmed(txId, attempts = 0) {
        if (attempts >= MAX_ATTEMPTS) {
            throw new Error("Max attempts reached. Transaction not confirmed.");
        }

        try {
            const txInfo = await this.tronWeb.trx.getTransactionInfo(txId);

            // Check if the transaction has been confirmed (you can adjust the condition based on your needs)
            if (txInfo && txInfo.id) {
                return txInfo;
            }

            // If not confirmed, wait and then retry
            await delay(DELAY_INTERVAL);
            return await this.checkTransactionUntilConfirmed(txId, attempts + 1);
        } catch (error) {
            throw new Error(`Error checking transaction: ${error.message}`);
        }
    }

    async generateAddresses(count) {
        console.log(`Generating ${count} addresses`)
        const currentBlock = await this.tronWeb.trx.getCurrentBlock()
        const currentBlockNumber = currentBlock.block_header.raw_data.timestamp
        console.log(`Block number: ${JSON.stringify(currentBlockNumber)}`)

        try {
            const tx = await this.contract.deployMultipleContracts(count).send({
                from: this.tronWeb.defaultAddress.hex,
                shouldPollResponse: false
            });

            console.log("Creation TX hash: ", tx)

            const txInfo = await this.checkTransactionUntilConfirmed(tx);

            // console.log(txInfo)

            this.processReceipt(txInfo, count)
                .then(deployedAddresses => deployedAddresses.map(address => this.insertAddressIntoDB(address, currentBlockNumber)))
                .then(saveAddressPromises => Promise.all(saveAddressPromises))
                .catch(error => console.error('Error processing receipt', error));
            console.log(`Creating addresses, tx: ${txInfo.id}`)
            // Return transaction hash immediately
            return tx;
        } catch (e) {
            console.log("error", e)
        }

    }

    async processReceipt(receipt, count) {
        const eventSignature = 'ContractDeployed(address)';
        const eventTopic = TronWeb.sha3(eventSignature).replace("0x", "");

        let deployedAddresses = [];
        if (receipt.log) {
            deployedAddresses = receipt.log
                .filter(log => log.topics[0] === eventTopic)
                .map(log => log.data);
        }

        if (deployedAddresses.length !== count) {
            throw new Error('Mismatch in number of deployed addresses and expected count');
        }

        return deployedAddresses;
    }

    async insertAddressIntoDB(address, blockNumber) {
        await databaseService.insertAddress(address, 'UNUSED', blockNumber);
    }

}

module.exports = BlockchainService;
