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
        CREATE TABLE IF NOT EXISTS sweeps (
                                id INT PRIMARY KEY AUTO_INCREMENT,
                                address VARCHAR(42) NOT NULL,
                                amount DECIMAL(36, 0) NOT NULL,
                                transactionHash VARCHAR(66) NOT NULL,
                                token_name VARCHAR(255) NOT NULL,
                                tokenContractAddress VARCHAR(42) NULL,
                                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                block BIGINT NULL,
                                core_notifications INT DEFAULT 0
        )
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
