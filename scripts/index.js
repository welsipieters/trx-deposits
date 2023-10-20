require('dotenv').config()
const databaseService = require('./DatabaseService');
const cron = require('node-cron');
const BlockchainService = require("./BlockchainService");
const blockchainConfig = require('./blockchainConfig');
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
    const hexAddress = '0x66880e6a8c7d456b8f5600b81930f8f9fc6cd44b';

    const base58Address = blockchainConfig.tronWeb.address.fromHex(hexAddress);
    console.log(base58Address)
    const bcs = new BlockchainService()

    // bcs.generateAddresses(2)
    checkForTransfers(bcs)

    cron.schedule('*/2 * * * *', async () => {
        checkForTransfers(bcs)
    });

    cron.schedule('*/2 * * * *', async () => {
        bcs.sweepTokens()
    });

    cron.schedule('*/2 * * * *', async () => {
        bcs.notifySweeped(config)
    });


    cron.schedule('*/2 * * * *', async () => {
        fetchAddressesFromExternalAPI(bcs, config)
    });

    setTimeout(async () =>  {
        fetchAddressesFromExternalAPI(bcs, config)
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