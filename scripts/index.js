require('dotenv').config()
const databaseService = require('./DatabaseService');
const cron = require('node-cron');
const BlockchainService = require("./BlockchainService");
const blockchainConfig = require('./BlockchainConfig');
const fetchAddressesFromExternalAPI = require("./fetchAddressesFromExternalAPI");
const sendMattermostAlert = require("./matterMost");

const config = {
    knakenURL: process.env.KNAKEN_URL,
    keys: {
        core: process.env.CORE_KEY,
        admin: process.env.ADMIN_KEY,
    }
};

const main = async () => {
    const bcs = new BlockchainService()

    // checkForTransfers(bcs)
    cron.schedule('*/1 * * * *', async () => {
        await checkForTransfers(bcs)
    });

    cron.schedule('*/1 * * * *', async () => {
        await bcs.sweepTokens()
    });

    cron.schedule('*/1 * * * *', async () => {
        await bcs.notifySweeped(config)
    });

    cron.schedule('*/15 * * * * *', async () => {
        await fetchAddressesFromExternalAPI(bcs, config);
    });

    setTimeout(async () =>  {
        // await fetchAddressesFromExternalAPI(bcs, config)
        // bcs.sweepTokens()
    }, 100)
}

async function checkForTransfers(bcs) {
    const currentBlock = await bcs.getCurrentBlockNumber();

    await bcs.checkTokenTransfers(currentBlock);
}


main().catch(error => {
    sendMattermostAlert(error);
    console.error(error)
})