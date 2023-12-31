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

    const checkColumnExistsQuery = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'DepositAddress' AND column_name = 'private_key';
    `;

    connection.query(checkColumnExistsQuery, (error, results) => {
        if (error) throw error;

        if (results.length === 0) {
            // The column doesn't exist, add it
            const addPrivateKeyColumnQuery = `
            ALTER TABLE DepositAddress
            ADD COLUMN private_key VARCHAR(255) NOT NULL AFTER deposit_address;
            `;

            connection.query(addPrivateKeyColumnQuery, (error) => {
                if (error) throw error;
                console.log('private_key column added to DepositAddress table.');
            });
        } else {
            console.log('private_key column already exists in DepositAddress table.');
        }

        connection.end();
    });
});