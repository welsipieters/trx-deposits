const mysql = require('mysql2/promise');

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};

let connection;

async function initializeDatabase() {
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected to the database.');
}

const databaseService = {
    insertAddress: async (deposit_address, private_key, status, last_seen_at_block) => {
        const query = `INSERT INTO DepositAddress (deposit_address, private_key, status, last_seen_at_block) VALUES (?, ?, ?, ?)`;
        try {
            await connection.execute(query, [deposit_address, private_key, status, last_seen_at_block]);
            console.log(`Address ${deposit_address} inserted.`);
        } catch (error) {
            throw error;
        }
    },

    fetchUsedAddressesFromDB: async () => {
        const [rows] = await connection.execute('SELECT deposit_address, private_key, processing, last_seen_at_block FROM DepositAddress WHERE status = "USED"');
        return rows.map(row => ({address: row.deposit_address, last_seen: row.last_seen_at_block, processing: row.processing, private_key: row.private_key}));
    },

    getDepositAddressStatus: async (depositAddress) => {
        const query = `SELECT status, processing FROM DepositAddress WHERE deposit_address = ? LIMIT 1`;
        const [rows] = await connection.execute(query, [depositAddress]);
        return rows.length > 0 ? rows[0] : null; // Return the address status or null if not found
    },


    async updateLastSeenBlock(depositAddress, blockNumber) {
        const query = `UPDATE DepositAddress 
                   SET last_seen_at_block = ? 
                   WHERE deposit_address = ?`;
        const [result] = await connection.execute(query, [blockNumber, depositAddress]);

        if (result.affectedRows === 0) {
            console.log(`No address found with deposit_address: ${depositAddress}`);
            return false;
        }
        return true;
    },


    fetchAndMarkUnusedAddress: async () => {
        const queryFindUnused = 'SELECT * FROM DepositAddress WHERE status = "UNUSED" ORDER BY created_at ASC LIMIT 1';
        const [rows] = await connection.execute(queryFindUnused);

        if (rows.length === 0) {
            return null;
        }

        const unusedAddress = rows[0];
        const queryUpdateStatus = 'UPDATE DepositAddress SET status = "USED" WHERE id = ?';
        await connection.execute(queryUpdateStatus, [unusedAddress.id]);

        console.log(`Address ${unusedAddress.deposit_address} marked as IN_USE.`);
        return unusedAddress;
    },


    findUnprocessedDepositsByToAddress: async (toAddress) => {
        const query = `SELECT * FROM deposits WHERE to_address = ? AND process_tx IS NULL AND processed = false`;
        const [rows] = await connection.execute(query, [toAddress]);
        return rows;
    },

    updateProcessedStatusByHash: async (transactionHash, processTx, processed) => {
        const query = `UPDATE deposits SET processed = ?, process_tx = ? WHERE hash = ?`;
        await connection.execute(query, [processed, processTx, transactionHash]);
    },

    findDepositByHash: async (hash) => {
        const query = `SELECT * FROM deposits WHERE hash = ? LIMIT 1`;
        const [rows] = await connection.execute(query, [hash]);
        return rows[0] || null;  // Return the deposit or null if not found
    },

    insertDeposit: async (depositData) => {
        const query = `INSERT IGNORE INTO deposits 
                       (block_number, from_address, to_address, currency_address, currency_name, hash,  amount, amount_real) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        await connection.execute(query, [
            depositData.blockNumber,
            depositData.fromAddress,
            depositData.toAddress,
            depositData.currencyAddress,
            depositData.currencyName,
            depositData.hash,
            depositData.amount,
            depositData.amount_real
        ]);
        return depositData;
    },

    insertSweep: async (sweepData) => {
        const query = `INSERT INTO sweeps 
                       (address, amount, transactionHash, depositHash, token_name, tokenContractAddress, block, core_notifications) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        try {
            await connection.execute(query, [
                sweepData.address,
                sweepData.amount,
                sweepData.transactionHash,
                sweepData.depositHash,
                sweepData.token_name,
                sweepData.tokenContractAddress,
                sweepData.block,
                sweepData.core_notifications
            ]);
            console.log(`Sweep for address ${sweepData.address} and transaction ${sweepData.transactionHash} inserted.`);
            return sweepData;  // Return the inserted sweep data
        } catch (error) {
            throw error;
        }
    },
    updateProcessingStatusById: async (id, processing) => {
        const query = `UPDATE DepositAddress SET processing = ? WHERE id = ?`;
        await connection.execute(query, [processing, id]);
    },


    updateProcessingStatusByAddress: async (address, processing) => {
        const query = `UPDATE DepositAddress SET processing = ? WHERE deposit_address = ?`;
        await connection.execute(query, [processing, address]);
    },

    findSweepsForNotification: async () => {
        const query = `SELECT * FROM sweeps WHERE core_notifications < 5`;
        const [rows] = await connection.execute(query);
        return rows;
    },

    incrementCoreNotification: async (sweepId) => {
        const query = `UPDATE sweeps SET core_notifications = core_notifications + 1 WHERE id = ?`;
        await connection.execute(query, [sweepId]);
    },

    insertTransactionRecord: async (walletAddress, amount, transactionHash, tokenName, tokenContractAddress) => {
        const query = `
        INSERT INTO WalletFunding (wallet_address, amount_returned, transaction_hash, token_name, token_contract_address)
        VALUES (?, ?, ?, ?, ?);`;
        try {
            const [rows] = await connection.promise().execute(query, [walletAddress, amount, transactionHash, tokenName, tokenContractAddress]);
            return rows;
        } catch (error) {
            console.error('Error inserting transaction record:', error);
            throw error;
        }
    },

    // Method to set the process_tx and processed fields for all deposits of TRX

    updateProcessedStatusByToAddress: async (toAddress, processTx, processed) => {
        const query = `UPDATE deposits SET processed = ?, process_tx = ? WHERE to_address = ? AND currency_name = 'TRX' AND currency_address = 'TRX' AND processed = false`;
        await connection.execute(query, [processed, processTx, toAddress]);
    },

    updateWalletFunding: async (id, amountReturned) => {
        const query = `
        UPDATE WalletFunding
        SET amount_returned = ?
        WHERE id = ?;
    `;
        try {
            const [rows] = await connection.execute(query, [parseFloat(amountReturned), id]);
            return rows;
        } catch (error) {
            console.error('Error updating wallet funding record:', error);
            throw error;
        }
    },

    insertWalletFunding: async (walletAddress, amountFunded, transactionHash) => {
        const query = `
        INSERT INTO WalletFunding (wallet_address, amount_funded, transaction_hash)
        VALUES (?, ?, ?);
    `;
        // You can use a promise-based approach or async/await with try/catch for error handling
        try {
            const [rows] = await connection.execute(query, [walletAddress, amountFunded, transactionHash]);
            return rows;
        } catch (error) {
            console.error('Error inserting wallet funding record:', error);
            throw error;
        }
    }
};

// Initialize the database on startup
initializeDatabase().catch(err => {
    console.error('Failed to connect to the database:', err);
});

module.exports = databaseService;
