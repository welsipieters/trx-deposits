require('dotenv').config();
const mysql = require('mysql2');

const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};

const connection = mysql.createConnection(dbConfig);

connection.connect((err) => {
    if (err) throw err;
    console.log('Connected to the database.');

    const createWalletFundingTableQuery = `
    CREATE TABLE IF NOT EXISTS WalletFunding (
        id INT AUTO_INCREMENT PRIMARY KEY,
        wallet_address VARCHAR(255) NOT NULL,
        amount_funded DECIMAL(18, 6) NOT NULL,
        amount_returned DECIMAL(18, 6) NOT NULL DEFAULT 0.000000,
        transaction_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );`;

    connection.query(createWalletFundingTableQuery, (error) => {
        if (error) throw error;
        console.log('WalletFunding table created or already exists.');
        connection.end();
    });
});
