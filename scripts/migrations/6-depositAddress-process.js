require('dotenv').config();
const mysql = require('mysql2');

const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};

console.log(dbConfig);

const connection = mysql.createConnection(dbConfig);

connection.connect((err) => {
    if (err) throw err;
    console.log('Connected to the database.');

    const checkColumnExistsQuery = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ? AND table_name = 'DepositAddress' AND column_name = 'processing';
    `;

    connection.query(checkColumnExistsQuery, [dbConfig.database], (error, results) => {
        if (error) throw error;

        if (results.length === 0) {
            // The column doesn't exist, add it
            const addColumnQuery = `
            ALTER TABLE DepositAddress
                ADD COLUMN processing TINYINT NOT NULL DEFAULT 0;
            `;

            connection.query(addColumnQuery, (error) => {
                if (error) throw error;
                console.log('Processing column added to DepositAddress table.');
            });
        } else {
            console.log('Processing column already exists in DepositAddress table.');
        }

        connection.end();
    });
});
