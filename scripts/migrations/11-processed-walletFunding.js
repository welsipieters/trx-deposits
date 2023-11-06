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

    const checkColumnExistsQuery = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ? AND table_name = 'WalletFunding' AND column_name = 'processed';
    `;

    connection.query(checkColumnExistsQuery, [dbConfig.database], (error, results) => {
        if (error) {
            console.error('Error checking for processed column:', error);
            return connection.end();
        }

        if (results.length === 0) {
            // The column doesn't exist, add it
            const alterTableQuery = `
            ALTER TABLE WalletFunding
                ADD COLUMN processed BOOLEAN DEFAULT FALSE;
            `;

            connection.query(alterTableQuery, (alterError) => {
                if (alterError) {
                    console.error('Error adding processed column:', alterError);
                } else {
                    console.log('processed column added to WalletFunding table.');
                }
                connection.end();
            });
        } else {
            console.log('processed column already exists in WalletFunding table.');
            connection.end();
        }
    });
});
