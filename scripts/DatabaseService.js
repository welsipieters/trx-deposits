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

    findDepositAddressByAddress: async (address) => {
        const query = 'SELECT * FROM DepositAddress WHERE deposit_address = ? LIMIT 1';

        try {
            const [rows] = await connection.execute(query, [address]);
            if (rows.length > 0) {
                // Return the first matching row (or null if no match)
                return rows[0];
            } else {
                // No matching row found
                return null;
            }
        } catch (error) {
            // Handle the error (e.g., log or throw)
            console.error('Error finding deposit address by address:', error);
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
                       (block_number, from_address, to_address, currency_address, currency_name, processed, hash,  amount, amount_real) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const [result] = await connection.execute(query, [
            depositData.blockNumber,
            depositData.fromAddress,
            depositData.toAddress,
            depositData.currencyAddress,
            depositData.currencyName,
            depositData.processed,
            depositData.hash,
            depositData.amount,
            depositData.amount_real
        ]);
        const insertedId = result.insertId;
        const insertedSweepData = {
            id: insertedId,
            ...depositData  // Include all other sweepData fields
        };
    },

    insertSweep: async (sweepData) => {
        const query = `INSERT INTO sweeps 
                   (address, amount, transactionHash, depositHash, token_name, tokenContractAddress, block, core_notifications) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        try {
            const [result] = await connection.execute(query, [
                sweepData.address,
                sweepData.amount,
                sweepData.transactionHash,
                sweepData.depositHash,
                sweepData.token_name,
                sweepData.tokenContractAddress,
                sweepData.block,
                sweepData.core_notifications
            ]);

            // Extract the ID of the newly inserted row
            const insertedId = result.insertId;

            // Create an object containing the inserted sweep data and its ID
            const insertedSweepData = {
                id: insertedId,
                ...sweepData  // Include all other sweepData fields
            };

            console.log(`[DB][insertSweep] Sweep for address ${sweepData.address} and transaction ${sweepData.transactionHash} inserted.`);
            return insertedSweepData;  // Return the inserted sweep data
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
        const query = `SELECT * FROM sweeps WHERE core_notifications < 5 AND processed = 1`;
        const [rows] = await connection.execute(query);
        return rows;
    },

    attachSweepToWalletFundingById: async (sweepId, walletFundingId) => {
        const query = `
        INSERT INTO WalletFundingSweeps (wallet_funding_id, sweep_id)
        VALUES (?, ?)
    `;
        await connection.execute(query, [walletFundingId, sweepId]);
    },

    fetchAllUnprocessedWalletFunding: async () => {
        const query = `SELECT * FROM WalletFunding WHERE processed = 0 AND refund_hash IS NULL`;
        const [rows] = await connection.execute(query);
        return rows;
    },

    fetchAllPendingRefunds: async () => {
        const query = `SELECT * FROM WalletFunding WHERE processed = 0 AND refund_hash IS NOT NULL`;
        const [rows] = await connection.execute(query);
        return rows;
    },



    fetchSweepIdsByWalletFundingId: async (walletFundingId) => {
        try {
            const query = `
            SELECT sweep_id
            FROM WalletFundingSweeps
            WHERE wallet_funding_id = ?
        `;
            const [rows] = await connection.execute(query, [walletFundingId]);
            const sweepIds = rows.map((row) => row.sweep_id);
            return sweepIds;
        } catch (error) {
            throw error;
        }
    },


    findUnprocessedSweeps: async () => {
        const query = `SELECT * FROM sweeps WHERE processed = 0`;
        const [rows] = await connection.execute(query);
        return rows;
    },

    fetchSweepById: async (sweepId) => {
        try {
            const query = `SELECT *
            FROM sweeps
            WHERE id = ?`;

            const [rows] = await connection.execute(query, [sweepId]);
            if (rows.length === 0) {
                return null;
            }
            return rows[0];
        } catch (error) {
            throw error;
        }
    },

    updateSweepProcessedStatus: async (sweepId, processedStatus) => {
        const updateQuery = `UPDATE sweeps SET processed = ? WHERE id = ?`;

        try {
            await connection.execute(updateQuery, [processedStatus, sweepId]);

        } catch (error) {
            console.error(`Error updating sweep with ID ${sweepId}:`, error);
        }
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

    updateWalletFunding: async (id, options) => {
        // Create a base update query
        let query = 'UPDATE WalletFunding SET';

        // Create an array to store the values that need to be updated
        const updateValues = [];

        // Check for each property in options and add it to the query and updateValues array if provided
        if (options.amountReturned !== undefined) {
            query += ' amount_returned = ?,';
            updateValues.push(parseFloat(options.amountReturned));
        }

        if (options.refundHash !== undefined) {
            query += ' refund_hash = ?,';
            updateValues.push(options.refundHash);
        }

        if (options.processed !== undefined) {
            query += ' processed = ?,';
            updateValues.push(options.processed);
        }

        // Remove the trailing comma and add the WHERE clause
        query = query.slice(0, -1) + ' WHERE id = ?';

        // Add the id to the updateValues array
        updateValues.push(id);

        try {
            const [rows] = await connection.execute(query, updateValues);
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
        try {
            const [result] = await connection.execute(query, [walletAddress, amountFunded, transactionHash]);
            // Extract the ID of the newly inserted row
            const insertedId = result.insertId;

            // Create an object containing the funding record and its ID
            return {
                id: insertedId,
                wallet_address: walletAddress,
                amount_funded: amountFunded,
                transaction_hash: transactionHash
            };
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
