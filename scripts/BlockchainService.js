const TronWeb = require('tronweb');
const blockchainConfig = require('./BlockchainConfig');
const databaseService = require('./DatabaseService');
const axios = require("axios");

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const MAX_ATTEMPTS = 250;  // Maximum number of attempts to check the transaction
const DELAY_INTERVAL = 5000;  // Delay of 5 seconds between each check
const tokenDecimalCache = {};

const FEE_LIMIT = 1000 * 1e6;


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
        const url = `${blockchainConfig.fullHost}/v1/accounts/${toAddress}/transactions/trc20?only_confirmed=true&only_to=true`;
        const response = await axios.get(url);
        if (response.data && response.data.data) {
            return response.data.data;
        }
        return [];
    }

    async checkTokenTransfers(end) {
        console.log("Checking for new transactions. Current block number: ", end);
        const addresses = await databaseService.fetchUsedAddressesFromDB();

        for (let address of addresses) {
            if (address.processing === 1) {
                continue;
            }

            await databaseService.updateProcessingStatusById(address.address, true);

            console.log(`Checking address ${address.address}`);
            const tokenEvents = await this.getPastEvents(address.address, address.last_seen, end);
            for (const event of tokenEvents) {
                try {
                    await this.recordTransferToDB(event);
                } catch (e) {
                    console.error("Error recording token transfer to DB:", e);
                }
            }

            const trxTransfers = await this.getTrxTransfers(address.address, address.last_seen, end);
            for (const transfer of trxTransfers) {
                try {
                    await this.recordTrxTransferToDB(transfer);
                } catch (e) {
                    console.error("Error recording TRX transfer to DB:", e);
                }
            }

            await databaseService.updateLastSeenBlock(address.address, end);
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
                    'txid': sweep.depositHash,
                    'amount': parseFloat(sweep.amount).toString(),
                    'confirmations': sweep.core_notifications+1
                });
            }
            console.log(deposits)

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
                    for (const sweep of sweepsToNotify) {
                        databaseService.incrementCoreNotification(sweep.id)
                    }

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

    async fundWalletForGas(walletAddress, amountToFund) {
        try {
            const tradeobj = await this.tronWeb.transactionBuilder.sendTrx(
                walletAddress,
                this.tronWeb.toSun(amountToFund),
                this.tronWeb.defaultAddress.base58
            );
            const signedtxn = await this.tronWeb.trx.sign(tradeobj);
            const broadcast = await this.tronWeb.trx.sendRawTransaction(signedtxn);

            if (broadcast.result === true) {
                console.log(`Attempting to fund ${amountToFund} TRX to wallet ${walletAddress}`)
            } else {
                throw new Error('Failed to broadcast transaction');
            }

            // Now wait for the transaction to be confirmed
            await this.checkTransactionUntilConfirmed(broadcast.txid);

            console.log(`Funded ${amountToFund} TRX to wallet ${walletAddress}. Transaction ID: ${broadcast.txid}`);
            return broadcast;
        } catch (e) {
            console.error('Error during funding wallet:', e);
            throw e; // You may want to handle this more gracefully depending on your error handling strategy
        }
    }

    async sweepTokens() {
        const addresses = await databaseService.fetchUsedAddressesFromDB();
        const gasFundAmount = process.env.GAS_FUND_AMOUNT_TRON;

        for (const address of addresses) {
            const deposits = await databaseService.findUnprocessedDepositsByToAddress(address.address);

            if (deposits.length === 0) {
                continue;
            }

            const status = await databaseService.getDepositAddressStatus(address.address);
            if (status.processing === 1) {
                continue;
            }

            await databaseService.updateProcessingStatusByAddress(address.address, 1)

            console.log(`Found ${deposits.length} unprocessed deposits for ${address.address}`);

            let fundingTransactionHash;
            try {
                const fundingReceipt = await this.fundWalletForGas(address.address, gasFundAmount);
                fundingTransactionHash = fundingReceipt.txid;

                await databaseService.insertWalletFunding(address.address, gasFundAmount, fundingTransactionHash);
            } catch (e) {
                console.error('Error during funding for gas:', e);
                continue;
            }


            for (const deposit of deposits) {
                if (deposit.currency_address === 'TRX') {
                    continue;
                }

                try {
                    await this.sweepERC20Tokens(deposit, address);
                } catch (e) {
                    console.error('Error during token sweep:', e);
                    await databaseService.updateProcessedStatusByHash(deposit.hash, null, false);
                }
            }

            let didSweepTRX = false;

            for (const deposit of deposits) {
                if (deposit.currency_address !== 'TRX') {
                    continue;
                }

                try {
                    await this.sweepTRX(address, deposit, fundingTransactionHash);
                    didSweepTRX = true;

                    await databaseService.updateProcessingStatusByAddress(address.address, 0)

                } catch (e) {
                    console.error('Error during TRX sweep:', e);

                    await databaseService.updateProcessingStatusByAddress(address.address, 0)
                }
            }

            if (!didSweepTRX) {
                try {
                    await this.sweepTRX(address, null, fundingTransactionHash);
                    await databaseService.updateProcessingStatusByAddress(address.address, 0)

                } catch (e) {
                    console.error('Error during TRX sweep:', e);

                    await databaseService.updateProcessingStatusByAddress(address.address, 0)
                }
            }
        }
    }

    async recordTrxTransferToDB(transfer) {
        if (!transfer) {
            return;
        }

        const depositData = {
            blockNumber: transfer.block_timestamp,
            fromAddress: transfer.from,
            toAddress: transfer.to,
            currencyAddress: 'TRX',
            currencyName: 'TRX',
            hash: transfer.transaction_id,
            process_tx: '',
            processed: false,
            amount: BigInt(transfer.value) / BigInt(1e6),
            amount_real: transfer.value
        };

        if (depositData.fromAddress === depositData.toAddress) {
            return;
        }

        if (this.tronWeb.address.fromPrivateKey(process.env.PRIVATE_KEY).toLowerCase() === depositData.fromAddress.toLowerCase()) {
            return;
        }

        // Assuming that TRX is always an allowed token
        const deposit = await databaseService.findDepositByHash(depositData.hash);
        if (!deposit) {
            console.log(`Recording TRX transaction for wallet ${depositData.toAddress}`);
            await databaseService.insertDeposit(depositData);
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
            process_tx: null,
            processed: false,
            amount: BigInt(event.value) / BigInt(10 ** event.token_info.decimals),
            amount_real: event.value
        };

        if (depositData.fromAddress === depositData.toAddress) {
            return
        }

        if (!blockchainConfig.allowedTokens.some(addr => addr.toLowerCase() === depositData.currencyAddress.toLowerCase())) {
            return;
        }


        const deposit = await databaseService.findDepositByHash(depositData.hash)

        if (!deposit) {
            console.log(`Recording transaction of token ${depositData.currencyName} for wallet ${depositData.toAddress}`)

            await databaseService.insertDeposit(depositData);
        }

    }

    async getTrxTransfers(address, startBlock, endBlock) {
        let transfers = [];

        try {
            const url = `${blockchainConfig.fullHost}/v1/accounts/${address}/transactions`;
            const tx = await axios.get(url, {
                params: {
                    only_to: true,
                    only_confirmed: true,
                    limit: 30, // Adjust the limit as needed
                },
                headers: {
                    'TRON-PRO-API-KEY': blockchainConfig.apiKey
                }
            }).catch(error => {
                console.error('Error fetching TRX transfers:', error);
            });


            transfers = tx.data.data.map(tx => {

                if (this.tronWeb.fromSun(tx.raw_data.contract[0].parameter.value.amount) < 1) {
                    return;
                }

                return {
                    block_timestamp: tx.raw_data.timestamp,
                    from:  this.tronWeb.address.fromHex(tx.raw_data.contract[0].parameter.value.owner_address),
                    to: address,
                    value: tx.raw_data.contract[0].parameter.value.amount,
                    transaction_id: tx.txID
                }
            });
        } catch (error) {
            console.error(`Error fetching TRX transfers for address ${address}:`, error);
        }

        return transfers;
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
        console.log(`Generating ${count} addresses`);
        const currentBlock = await this.getCurrentBlockNumber()
        console.log(`Current block number: ${currentBlock}`);

        let addresses = [];
        for (let i = 0; i < count; i++) {
            const newAddress = await this.tronWeb.createAccount();
            if (newAddress.address) {
                addresses.push(newAddress);
            } else {
                console.error('Error generating new address:', newAddress);
            }
        }

        // Process each newly generated address
        try {
            const saveAddressPromises = addresses.map(({ address: { base58 }, privateKey }) =>
                this.insertAddressIntoDB(base58, privateKey, currentBlock)
            );

            await Promise.all(saveAddressPromises);
            console.log(`Successfully inserted ${count} addresses into the database.`);
        } catch (error) {
            console.error('Error inserting addresses into DB', error);
        }

        // Return the list of new addresses
        return addresses;
    }


    async sweepERC20Tokens(deposit, address) {
        await databaseService.updateProcessedStatusByHash(deposit.hash, null, true);

        try {
            const tokenContract = await this.tronWeb.contract().at(deposit.currency_address);
            const tokenTransfer = await tokenContract.transfer(
                process.env.COLD_STORAGE_ADDRESS_TRON,
                deposit.amount_real
            ).send({ feeLimit: FEE_LIMIT }, address.private_key);


            console.log(`Sweeping ${deposit.amount} ${deposit.currency_name} from ${deposit.to_address}. Transaction ID: `, tokenTransfer);

            await this.checkTransactionUntilConfirmed(tokenTransfer);

            const blockNumber = await this.getCurrentBlockNumber();
            await databaseService.updateProcessedStatusByHash(deposit.hash, tokenTransfer, true);
            await databaseService.insertSweep({
                address: deposit.to_address,
                amount: deposit.amount,
                depositHash: deposit.hash,
                transactionHash: tokenTransfer,
                token_name: deposit.currency_name,
                tokenContractAddress: deposit.currency_address,
                block: blockNumber,
                core_notifications: 0
            });
        } catch (error) {
            console.error(`Error sweeping ${deposit.amount} ${deposit.currency_name} from ${deposit.to_address}:`, error);
            await databaseService.updateProcessedStatusByHash(deposit.hash, null, false);
        }
    }


    async sweepTRX(address, deposit, fundingTransactionHash) {
        if (!fundingTransactionHash) {
            throw new Error("Funding transaction hash is required.");
        }
        const trxBalanceSUN = await this.tronWeb.trx.getBalance(address.address);
        const gasFundAmount = process.env.GAS_FUND_AMOUNT_TRON;
        const estimatedGasSUN = this.tronWeb.toSun(process.env.ESTIMATED_GAS_FEE_TRON);

        // Make sure there is enough balance to cover the gas fee
        if (trxBalanceSUN <= estimatedGasSUN) {
            throw new Error("Not enough balance to cover the gas fee.");
        }

        let actualGasUsedSUN = 0;
        let amountToSendForCustomer = 0;

        if (deposit) {
            // Calculate the amount to send by deducting the estimated gas fee
            amountToSendForCustomer = deposit.amount_real;
            console.log(`Sending ${this.tronWeb.fromSun(amountToSendForCustomer)} TRX from ${address.address} to cold storage`);


            const tradeobj = await this.tronWeb.transactionBuilder.sendTrx(
                process.env.COLD_STORAGE_ADDRESS_TRON,
                amountToSendForCustomer,
                this.tronWeb.address.fromPrivateKey(address.private_key)
            );
            const signedtxn = await this.tronWeb.trx.sign(tradeobj, address.private_key);
            const receipt = await this.tronWeb.trx.sendRawTransaction(signedtxn)

            if (receipt.result === true) {
                await this.checkTransactionUntilConfirmed(receipt.txid);
                const txInfo = await this.tronWeb.trx.getTransactionInfo(receipt.txid);

                console.log(txInfo)

                actualGasUsedSUN = txInfo.receipt ? txInfo.receipt.net_fee : 0;
                console.log(`Actual gas used: ${this.tronWeb.fromSun(actualGasUsedSUN)}`)

                await databaseService.insertSweep({
                    address: address.address,
                    amount: this.tronWeb.fromSun(amountToSendForCustomer),
                    depositHash: fundingTransactionHash,
                    transactionHash: receipt.txid,
                    token_name: 'TRX',
                    tokenContractAddress: 'TRX',
                    block: await this.getCurrentBlockNumber(),
                    core_notifications: 0
                });

                console.log(`Sent ${this.tronWeb.fromSun(amountToSendForCustomer)} TRX to cold storage (net amount after gas). Transaction ID: ${receipt.txid}`);
                await databaseService.updateProcessedStatusByToAddress(address.address, receipt.txid, true);
            }
        }

        console.log(trxBalanceSUN, actualGasUsedSUN, amountToSendForCustomer)
        const amountForGasRefund = trxBalanceSUN - (actualGasUsedSUN) - amountToSendForCustomer - estimatedGasSUN;
        console.log(`Sending ${this.tronWeb.fromSun(amountForGasRefund)} TRX from ${address.address} to Gas lender`);

        const tradeobj = await this.tronWeb.transactionBuilder.sendTrx(
            this.tronWeb.address.fromPrivateKey(process.env.PRIVATE_KEY),
            amountForGasRefund,
            this.tronWeb.address.fromPrivateKey(address.private_key)
        );

        const signedtxn = await this.tronWeb.trx.sign(tradeobj, address.private_key);
        const refundReceipt = await this.tronWeb.trx.sendRawTransaction(signedtxn)

        if (refundReceipt.result === true) {
            await this.checkTransactionUntilConfirmed(refundReceipt.txid);
            console.log(`Sent ${this.tronWeb.fromSun(amountForGasRefund)} TRX to Gas lender. Transaction ID: ${refundReceipt.txid}`);
        } else {
            console.log(`Failed to send ${this.tronWeb.fromSun(amountForGasRefund)} TRX to Gas lender. Transaction ID: ${refundReceipt.txid}`);
        }

        await databaseService.updateWalletFunding(fundingTransactionHash, this.tronWeb.fromSun(this.tronWeb.toSun(gasFundAmount) - actualGasUsedSUN));

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

    async insertAddressIntoDB(address, private_key, blockNumber) {
        await databaseService.insertAddress(address, private_key,'UNUSED', blockNumber);
    }

}

module.exports = BlockchainService;
