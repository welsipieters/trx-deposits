require('dotenv').config();
const mysql = require('mysql2/promise'); // Use mysql2/promise for async/await support

const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};

async function runMigration() {
    const connection = await mysql.createConnection(dbConfig);

    try {
        // Check if the unique constraints already exist
        const checkConstraintsQuery = `
            SELECT COUNT(*) as count
            FROM information_schema.table_constraints
            WHERE table_schema = ? AND table_name = 'sweeps'
            AND (constraint_name = 'unique_transactionHash' OR constraint_name = 'unique_depositHash');
        `;

        const [results] = await connection.execute(checkConstraintsQuery, [dbConfig.database]);
        const { count } = results[0];

        if (count === 0) {
            // The unique constraints don't exist, so add them
            const migrationQuery = `
                ALTER TABLE sweeps
                ADD CONSTRAINT unique_transactionHash UNIQUE (transactionHash),
                ADD CONSTRAINT unique_depositHash UNIQUE (DepositHash);
            `;

            await connection.execute(migrationQuery);
            console.log('Migration successful: Unique constraints added.');
        } else {
            console.log('Unique constraints already exist in the sweeps table.');
        }
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await connection.end();
    }
}

runMigration().catch(err => {
    console.error('Failed to run migration:', err);
});
