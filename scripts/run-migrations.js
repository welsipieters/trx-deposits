const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, 'migrations');

fs.readdir(migrationsDir, (err, files) => {
    if (err) {
        console.error('Could not list the directory.', err);
        process.exit(1);
    }

    // Sort files based on the leading number in the filename
    const sortedFiles = files.sort((a, b) => {
        const numA = parseInt(a.match(/^(\d+)/), 10);
        const numB = parseInt(b.match(/^(\d+)/), 10);
        return numA - numB;
    });

    sortedFiles.forEach((file, index) => {
        const filePath = path.join(migrationsDir, file);
        if (path.extname(file) === '.js') {
            console.log(`Running migration: ${file}`);
            try {
                require(filePath);
            } catch (error) {
                console.error(`Error running migration ${file}:`, error);
                process.exit(1);
            }
        }
    });
});
