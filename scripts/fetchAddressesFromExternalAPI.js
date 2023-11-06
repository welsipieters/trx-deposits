const axios = require('axios');
const databaseService = require('./DatabaseService');
const blockchainConfig = require('./BlockchainConfig');
const fetchAddressesFromExternalAPI = async (bcs, config) => {
    const getEndpoint = 'get-deposit-address-requests';
    const setEndpoint = 'set-deposit-addresses';
    const params = {
        walletAPIKey: config.keys.admin,
        network: 'tron',
    };

    // Fetch the wanted addresses
    const response = await axios.post(`${config.knakenURL}${getEndpoint}`, params, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Knaken-Wallet-Processor': config.keys.core
        }
    });

    const wantedAddresses = await response.data;

    const addressMap = {};

    for (const wantedAddress of wantedAddresses) {
        let addressEntity = await databaseService.fetchAndMarkUnusedAddress();

        if (!addressEntity) {
            bcs.generateAddresses(parseInt(process.env.BATCH_SIZE || '10')).catch((error) => {
                console.error('[fetchAddressesFromExternalAPI] Error generating addresses:', error);
            });

            console.log(`[fetchAddressesFromExternalAPI] Ran out of addresses. Generated new batch of addresses`);
            break;
        }

        if (addressEntity) {
            addressMap[wantedAddress.id] = addressEntity.deposit_address;
        }
    }

    // Send the address map back to the external API
    if (Object.keys(addressMap).length === 0) {
        console.log('[fetchAddressesFromExternalAPI] No addresses to set');
        return;
    }

    const setAddressResponse = await axios.post(`${config.knakenURL}${setEndpoint}`, {
        walletAPIKey: config.keys.admin,
        addresses: addressMap
    }, {
        headers: {
            'Content-Type': 'application/json',
            'X-Knaken-Wallet-Processor': config.keys.core
        }
    });

    console.log('[fetchAddressesFromExternalAPI] Successfully set addresses', setAddressResponse.statusText, setAddressResponse.status, setAddressResponse.data);
};

module.exports = fetchAddressesFromExternalAPI;
