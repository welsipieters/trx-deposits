require('dotenv').config()
const mysql = require('mysql2');
const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};

async function runMigration() {
    const connection = await mysql.createConnection(dbConfig);

    const migrationQuery = `
        CREATE TABLE IF NOT EXISTS deposits (
            id INT AUTO_INCREMENT PRIMARY KEY,
            block_number BIGINT NOT NULL,
            from_address VARCHAR(42) NOT NULL,
            to_address VARCHAR(42) NOT NULL,
            currency_address VARCHAR(42) NOT NULL,
            currency_name VARCHAR(255) NOT NULL,
            hash VARCHAR(255) NOT NULL,
            process_tx VARCHAR(255),
            processed BOOLEAN DEFAULT FALSE,
            amount DECIMAL(36,18) NOT NULL,
            amount_real varchar(42) NOT NULL,
            UNIQUE(hash, process_tx)
        );
    `;

    try {
        await connection.execute(migrationQuery);
        console.log('Migration successful.');
    } catch (error) {
        console.error('Migration failed:', error);
    }

    await connection.end();
}

runMigration().catch(err => {
    console.error('Failed to run migration:', err);
});
