require('dotenv').config()
const mysql = require('mysql2');

const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};

console.log(dbConfig)

const connection = mysql.createConnection(dbConfig);

connection.connect((err) => {
    if (err) throw err;
    console.log('Connected to the database.');

    const createTableQuery = `
    CREATE TABLE IF NOT EXISTS DepositAddress (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deposit_address VARCHAR(255) NOT NULL,
        status ENUM('UNUSED', 'USED') NOT NULL DEFAULT 'UNUSED',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_seen_at_block BIGINT
    );`;

    connection.query(createTableQuery, (error) => {
        if (error) throw error;
        console.log('DepositAddress table created or already exists.');
        connection.end();
    });
});
