require('dotenv').config();
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
        ALTER DATABASE ${process.env.DB_NAME}
        CHARACTER SET utf8mb4
        COLLATE utf8mb4_unicode_ci;
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
