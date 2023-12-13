const { program } = require('commander');
const BlockchainService = require("./BlockchainService");
const blockchainConfig = require('./BlockchainConfig');
const axios = require("axios");
const databaseService = require("./DatabaseService");
program
    .requiredOption('-a, --address <walletAddress>', 'Wallet address')
    .requiredOption('-s, --start <start>', 'Start Block', parseInt)
    .requiredOption('-e, --end <end>', 'End Block', parseInt)

program.parse(process.argv);

const options = program.opts();


async function getPastEvents(walletAddress, startBlock, endBlock) {
    // Logic to retrieve events from the blockchain within the specified block range
    // For example, using TronWeb to query events:
    // return tronWeb.getEventResult(walletAddress, {
    //     eventName: 'Transfer',
    //     blockNumber: startBlock,
    //     endBlock: endBlock
    // });

    return blockchainConfig.tronWeb.getEventResult(walletAddress, {
        eventName: 'Transfer',
        blockNumber: startBlock,
        endBlock: endBlock
    });
}

async function getTransactionBlockNumber(transactionId) {
    const url = `${blockchainConfig.fullHost}/v1/transactions/${transactionId}/events`;
    const response = await axios.get(url);
    if (response.data) {
        return response.data.data[0].block_number;
    }
    return null;
}

async function main() {
    const bcs = new BlockchainService()
    console.log(`Wallet Address: ${options.address}`);
    console.log(`Start Block: ${options.start}`);
    console.log(`End Block: ${options.end}`);

    console.log('[Process Transaction] Starting...')

    const tokenEvents = await bcs.getPastEvents(options.address, options.start, options.end);
    console.log('[Process Transaction] Got events:', tokenEvents.length)
    const deposits = [];

    for (const event of tokenEvents) {
        const blockNumber = await getTransactionBlockNumber(event.transaction_id);
        console.log('[Process Transaction] Got block number:', blockNumber)
        // Check if the event's block number falls within the specified range
        // console.log(event)
        if (blockNumber >= options.start && blockNumber <= options.end) {
            console.log(`[Process Transaction] Processing event ${event.transactionHash} in block ${blockNumber}...`);
            try {
                await bcs.recordTransferToDB(event, true);
                const deposit = await databaseService.findDepositByHash(event.transaction_id);
                deposits.push(deposit);
            } catch (e) {
                console.error("Error recording token transfer to DB:", e);
            }
        } else {
            console.log(`[Process Transaction] Skipping event ${event.transactionHash} in block ${event.blockNumber} (outside specified range).`);
        }
    }

    const trx = await bcs.getTrxTransfers(options.address, options.start, options.end);
    console.log('[Process Transaction] Got trx transfers:', trx.length)

    for (const transfer of trx) {
        if (transfer.block_number >= options.start && transfer.block_number <= options.end) {
            console.log(`[Process Transaction] Processing transfer ${transfer.hash} in block ${transfer.block_number}...`);
            try {
                await bcs.recordTrxTransferToDB(transfer, true);
                const deposit = await databaseService.findDepositByHash(transfer.transaction_id);

                deposits.push(deposit)
            } catch (e) {
                console.error("Error recording trx transfer to DB:", e);
            }
        }
    }

    console.log('deposits', deposits)
    const address = await databaseService.findDepositAddressByAddress(options.address);
    await bcs.sweepTokens([{address: options.address, private_key: address.private_key}], deposits);
}

main()