require('dotenv').config();
const mysql = require('mysql2');

const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};

;

const connection = mysql.createConnection(dbConfig);

connection.connect((err) => {
    if (err) throw err;
    console.log('Connected to the database.');

    const createTableQuery = `
    CREATE TABLE IF NOT EXISTS WalletFundingSweeps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        wallet_funding_id INT NOT NULL,
        sweep_id INT NOT NULL,
        FOREIGN KEY (wallet_funding_id) REFERENCES walletFunding(id),
        FOREIGN KEY (sweep_id) REFERENCES sweeps(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );`;

    connection.query(createTableQuery, (error) => {
        if (error) throw error;
        console.log('WalletFundingSweeps table created or already exists.');
        connection.end();
    });
});
