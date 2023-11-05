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
    WHERE table_schema = ? AND table_name = 'sweeps' AND column_name = 'depositHash';
    `;

    connection.query(checkColumnExistsQuery, [dbConfig.database], (error, results) => {
        if (error) {
            console.error('Error checking for depositHash column:', error);
            return connection.end();
        }

        if (results.length === 0) {
            // The column doesn't exist, add it
            const alterTableQuery = `
            ALTER TABLE sweeps
                ADD COLUMN depositHash VARCHAR(66) NULL;
            `;

            connection.query(alterTableQuery, (alterError) => {
                if (alterError) {
                    console.error('Error adding depositHash column:', alterError);
                } else {
                    console.log('depositHash column added to sweeps table.');
                }
                connection.end();
            });
        } else {
            console.log('depositHash column already exists in sweeps table.');
            connection.end();
        }
    });
});
