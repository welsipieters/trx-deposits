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
        console.log("[checkTokenTransfers] Checking for new transactions. Current block number: ", end);
        const addresses = await databaseService.fetchUsedAddressesFromDB();

        for (let address of addresses) {
            if (address.processing === 1) {
                continue;
            }

            await databaseService.updateProcessingStatusById(address.address, true);

            console.log(`[checkTokenTransfers] Checking address ${address.address}`);
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

            try {
                // Make the API call to post the transactions
                const response = await axios.post(`${config.knakenURL}${endpoint}`, { deposits,  walletAPIKey: config.keys.admin, }, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Knaken-Wallet-Processor': config.keys.core
                    }
                });


                if (response.status === 200) {
                    console.log("[notifySweeped] Transactions posted successfully", response.data);
                    for (const sweep of sweepsToNotify) {
                        databaseService.incrementCoreNotification(sweep.id)
                    }

                } else {
                    console.error("[notifySweeped] Failed to post transactions:", response.data);
                }

            } catch (error) {
                console.error('[notifySweeped] Error posting transactions:', error);
            }

        } catch (error) {
            console.error('[notifySweeped] Error in cron job:', error);
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
                console.log(`[fundWalletForGas] Attempting to fund ${amountToFund} TRX to wallet ${walletAddress}`)
            } else {
                throw new Error('[fundWalletForGas] Failed to broadcast transaction');
            }

            // Now wait for the transaction to be confirmed
            await this.checkTransactionUntilConfirmed(broadcast.txid);

            console.log(`[fundWalletForGas] Funded ${amountToFund} TRX to wallet ${walletAddress}. Transaction ID: ${broadcast.txid}`);
            return broadcast;
        } catch (e) {
            console.error('[fundWalletForGas] Error during funding wallet:', e);
            throw e;
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

            console.log(`[sweepTokens] Found ${deposits.length} unprocessed deposits for ${address.address}`);

            let funding;
            try {
                const fundingReceipt = await this.fundWalletForGas(address.address, gasFundAmount);
                const fundingTransactionHash = fundingReceipt.txid;

                funding = await databaseService.insertWalletFunding(address.address, gasFundAmount, fundingTransactionHash);
            } catch (e) {
                console.error('[sweepTokens] Error during funding for gas:', e);
                continue;
            }

            if (!funding) {
                console.error('[sweepTokens] Error during funding for gas');
                continue;
            }


            for (const deposit of deposits) {
                if (deposit.currency_address === 'TRX') {
                    continue;
                }

                try {
                    await this.sweepERC20Tokens(deposit, address, funding);
                } catch (e) {
                    console.error('[sweepTokens] Error during token sweep:', e);
                    await databaseService.updateProcessedStatusByHash(deposit.hash, null, false);
                }
            }

            let didSweepTRX = false;

            for (const deposit of deposits) {
                if (deposit.currency_address !== 'TRX') {
                    continue;
                }

                try {
                    await this.sweepTRX(address, deposit, funding);
                    didSweepTRX = true;

                    await databaseService.updateProcessingStatusByAddress(address.address, 0)

                } catch (e) {
                    console.error('[sweepTokens] Error during TRX sweep:', e);

                    await databaseService.updateProcessingStatusByAddress(address.address, 0)
                }
            }

            if (!didSweepTRX) {
                try {
                    await this.sweepTRX(address, null, fundingTransactionHash);
                    await databaseService.updateProcessingStatusByAddress(address.address, 0)

                } catch (e) {
                    console.error('[sweepTokens] Error during TRX sweep:', e);

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
            console.log(`[recordTrxTransferToDB Recording TRX transaction for wallet ${depositData.toAddress}`);
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
            console.log(`[recordTransferToDB] Recording transaction of token ${depositData.currencyName} for wallet ${depositData.toAddress}`)

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

              if (  tx.raw_data.contract[0].type === "TransferAssetContract") {
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
        console.log(`[generateAddresses] Generating ${count} addresses`);
        const currentBlock = await this.getCurrentBlockNumber()
        console.log(`[generateAddresses] Current block number: ${currentBlock}`);

        let addresses = [];
        for (let i = 0; i < count; i++) {
            const newAddress = await this.tronWeb.createAccount();
            if (newAddress.address) {
                addresses.push(newAddress);
            } else {
                console.error('[generateAddresses] Error generating new address:', newAddress);
            }
        }

        try {
            const saveAddressPromises = addresses.map(({ address: { base58 }, privateKey }) =>
                this.insertAddressIntoDB(base58, privateKey, currentBlock)
            );

            await Promise.all(saveAddressPromises);
            console.log(`[generateAddresses Successfully inserted ${count} addresses into the database.`);
        } catch (error) {
            console.error('[generateAddresses] Error inserting addresses into DB', error);
        }

        return addresses;
    }


    async sweepERC20Tokens(deposit, address, funding) {
        await databaseService.updateProcessedStatusByHash(deposit.hash, null, true);

        try {
            const tokenContract = await this.tronWeb.contract().at(deposit.currency_address);
            const tokenTransfer = await tokenContract.transfer(
                process.env.COLD_STORAGE_ADDRESS_TRON,
                deposit.amount_real
            ).send({ feeLimit: FEE_LIMIT }, address.private_key);


            console.log(`[sweepERC20Tokens] Sweeping ${deposit.amount} ${deposit.currency_name} from ${deposit.to_address}. Transaction ID: `, tokenTransfer);
            const blockNumber = await this.getCurrentBlockNumber();
            const sweep = await databaseService.insertSweep({
                address: deposit.to_address,
                amount: deposit.amount,
                depositHash: deposit.hash,
                transactionHash: tokenTransfer,
                token_name: deposit.currency_name,
                tokenContractAddress: deposit.currency_address,
                block: blockNumber,
                core_notifications: 0
            });

            await databaseService.attachSweepToWalletFundingById(sweep.id, funding.id);

        } catch (error) {
            console.error(`[sweepERC20Tokens] Error sweeping ${deposit.amount} ${deposit.currency_name} from ${deposit.to_address}:`, error);
            await databaseService.updateProcessedStatusByHash(deposit.hash, null, false);
        }
    }

    async processGasRefunds() {
        const gasRefunds = await databaseService.fetchAllUnprocessedWalletFunding();


        console.log(`[processGasRefunds] Processing ${gasRefunds.length} gas refunds}`);

        for (const gasRefund of gasRefunds) {
            const sweepIds = await databaseService.fetchSweepIdsByWalletFundingId(gasRefund.id);

            let allSweepsProcessed = true; // Flag to track if all associated sweeps are processed

            for (const sweepId of sweepIds) {
                const sweep = await databaseService.fetchSweepById(sweepId);

                if (!sweep || !sweep.processed) {
                    // If a sweep is not found or not processed, set the flag to false
                    allSweepsProcessed = false;
                    break; // Exit the loop early since we can't refund gas yet
                }
            }

            if (allSweepsProcessed) {
                console.log(`[processGasRefunds] Gas refund can be processed for gas refund ID ${gasRefund.id}`);

                await this.refundGas(gasRefund);
            } else {
                console.log(`[processGasRefunds] Gas refund for gas refund ID ${gasRefund.id} requires all sweeps to be processed. Waiting for next cycle.`);
            }
        }
    }

    async refundGas(funding) {
        const wallet = await databaseService.findDepositAddressByAddress(funding.wallet_address);

        if (!wallet) {
            throw new Error("Wallet not found");
        }

        const trxBalanceSUN = await this.tronWeb.trx.getBalance(funding.wallet_address);
        const estimatedGasSUN = this.tronWeb.toSun(process.env.ESTIMATED_GAS_FEE_TRON);
        const gasFundAmount = process.env.GAS_FUND_AMOUNT_TRON;

        const amountForGasRefund = trxBalanceSUN - estimatedGasSUN;

        console.log(`[refundGas] Refunding ${this.tronWeb.fromSun(amountForGasRefund)} TRX to Gas lender. Wallet balance: ${this.tronWeb.fromSun(trxBalanceSUN)} TRX`)

        const tradeobj = await this.tronWeb.transactionBuilder.sendTrx(
            this.tronWeb.address.fromPrivateKey(process.env.PRIVATE_KEY),
            amountForGasRefund,
            this.tronWeb.address.fromPrivateKey(wallet.private_key)
        );

        const signedtxn = await this.tronWeb.trx.sign(tradeobj, wallet.private_key);
        const refundReceipt = await this.tronWeb.trx.sendRawTransaction(signedtxn)

        if (refundReceipt.result === true) {
            await databaseService.updateWalletFunding(funding.id, { refundHash: refundReceipt.txid });

            console.log(`[refundGas] Sent ${this.tronWeb.fromSun(amountForGasRefund)} TRX to Gas lender. Transaction ID: ${refundReceipt.txid}`);
            await databaseService.updateWalletFunding(funding.id, { amountReturned: this.tronWeb.fromSun(this.tronWeb.toSun(gasFundAmount) - amountForGasRefund) });
        } else {
            console.log(`[refundGas] Failed to send ${this.tronWeb.fromSun(amountForGasRefund)} TRX to Gas lender. Transaction ID: ${refundReceipt.txid}`);
        }
    }

    async ensureRefunds() {
        const pendingRefunds = await databaseService.fetchAllPendingRefunds();

        console.log(`[ensureRefunds] Processing ${pendingRefunds.length} pending refunds`);

        for (const refund of pendingRefunds) {
            try {
                console.log('[ensureRefunds] Checking if refund transaction is confirmed. If not, waiting for confirmation. Hash: ', refund.refund_hash);
                const receipt = await this.checkTransactionUntilConfirmed(refund.refund_hash);

                if (receipt) {
                    console.log('[ensureRefunds] Refund transaction confirmed. Updating database. Hash:', refund.refund_hash);
                    await databaseService.updateWalletFunding(refund.id, { processed: 1 });
                } else {
                    throw new Error('[ensureRefunds] Failed to confirm refund transaction. Hash:', refund.refund_hash);
                }
            } catch (e) {
                console.error('Error processing refund:', e);

            }
        }
    }

    async processSweeps() {
        const sweeps = await databaseService.findUnprocessedSweeps()
        console.log(`[processSweeps] Processing ${sweeps.length} sweeps`);

        for (const sweep of sweeps) {
            console.log('[processSweeps] Checking if sweep transaction is confirmed. If not, waiting for confirmation. Hash: ', sweep.transactionHash);

            try {
                const receipt = await this.checkTransactionUntilConfirmed(sweep.transactionHash);

                if (receipt) {
                    console.log('[processSweeps] Sweep transaction confirmed. Updating database. Hash:', sweep.transactionHash)
                    await databaseService.updateProcessedStatusByHash(sweep.depositHash, sweep.transactionHash, true);
                    await databaseService.updateSweepProcessedStatus(sweep.id, true);
                } else {
                    throw new Error('[processSweeps] Failed to confirm sweep transaction. Hash:', sweep.transactionHash);
                }
            } catch (e) {
                console.error('Error processing sweep:', e);
            }
        }
    }

    async sweepTRX(address, deposit, funding) {
        if (!funding) {
            throw new Error("[sweepTRX] Funding is required.");
        }

        const trxBalanceSUN = await this.tronWeb.trx.getBalance(address.address);
        const estimatedGasSUN = this.tronWeb.toSun(process.env.ESTIMATED_GAS_FEE_TRON);

        // Make sure there is enough balance to cover the gas fee
        if (trxBalanceSUN <= estimatedGasSUN) {
            throw new Error("[sweepTRX] Not enough balance to cover the gas fee.");
        }

        let actualGasUsedSUN = 0;

        if (!deposit) {
            console.log(`[sweepTRX] Deposit with ID ${deposit.id} not found.`);

            return;
        }

        await databaseService.updateProcessedStatusByHash(deposit.hash, null, true);
        console.log(`[sweepTRX] Sending ${this.tronWeb.fromSun(deposit.amount_real)} TRX from ${address.address} to cold storage`);


        const tradeobj = await this.tronWeb.transactionBuilder.sendTrx(
            process.env.COLD_STORAGE_ADDRESS_TRON,
            deposit.amount_real,
            this.tronWeb.address.fromPrivateKey(address.private_key)
        );

        const signedtxn = await this.tronWeb.trx.sign(tradeobj, address.private_key);
        const receipt = await this.tronWeb.trx.sendRawTransaction(signedtxn)

        if (receipt.result === true) {
            const sweep = await databaseService.insertSweep({
                address: address.address,
                amount: this.tronWeb.fromSun(deposit.amount_real),
                depositHash: deposit.hash,
                transactionHash: receipt.txid,
                token_name: 'TRX',
                tokenContractAddress: 'TRX',
                block: await this.getCurrentBlockNumber(),
                core_notifications: 0
            });

            await databaseService.attachSweepToWalletFundingById(sweep.id, funding.id);

            const amountForGasRefund = trxBalanceSUN - (actualGasUsedSUN) - deposit.amount_real - estimatedGasSUN;
            console.log(`[sweepTRX] Waiting to send ${this.tronWeb.fromSun(amountForGasRefund)} TRX from ${address.address} to Gas lender`);
        } else {
            console.log('[sweepTRX] Failed to send TRX to cold storage. Transaction ID: ', receipt.txid);
        }



    }

    async insertAddressIntoDB(address, private_key, blockNumber) {
        await databaseService.insertAddress(address, private_key,'UNUSED', blockNumber);
    }

}

module.exports = BlockchainService;
