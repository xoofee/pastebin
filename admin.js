#!/usr/bin/env node

const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const db = new sqlite3.Database('pastebin.db');

console.log('Pastebin Admin Console');
console.log('=====================');

function setPassword() {
    rl.question('Enter new password: ', (password) => {
        if (!password.trim()) {
            console.log('Password cannot be empty!');
            setPassword();
            return;
        }
        
        const hash = bcrypt.hashSync(password, 10);
        
        db.run(`DELETE FROM password`, (err) => {
            if (err) {
                console.error('Error clearing old password:', err);
                return;
            }
            
            db.run(`INSERT INTO password (hash) VALUES (?)`, [hash], (err) => {
                if (err) {
                    console.error('Error setting password:', err);
                    return;
                }
                
                console.log('Password updated successfully!');
                rl.close();
                db.close();
            });
        });
    });
}

function showStats() {
    db.get(`SELECT COUNT(*) as total FROM items`, (err, count) => {
        if (err) {
            console.error('Error getting stats:', err);
            return;
        }
        
        console.log(`Total items: ${count.total}`);
        
        db.all(`SELECT mimetype, COUNT(*) as count FROM items GROUP BY mimetype`, (err, types) => {
            if (err) {
                console.error('Error getting file types:', err);
                return;
            }
            
            console.log('\nFile types:');
            types.forEach(type => {
                console.log(`  ${type.mimetype}: ${type.count}`);
            });
            
            rl.close();
            db.close();
        });
    });
}

function clearAll() {
    rl.question('Are you sure you want to delete ALL items? (yes/no): ', (answer) => {
        if (answer.toLowerCase() === 'yes') {
            db.run(`DELETE FROM items`, (err) => {
                if (err) {
                    console.error('Error clearing items:', err);
                    return;
                }
                
                console.log('All items deleted successfully!');
                rl.close();
                db.close();
            });
        } else {
            console.log('Operation cancelled.');
            rl.close();
            db.close();
        }
    });
}

console.log('\nAvailable commands:');
console.log('1. Set password');
console.log('2. Show statistics');
console.log('3. Clear all items');
console.log('4. Exit');

rl.question('\nSelect option (1-4): ', (option) => {
    switch (option) {
        case '1':
            setPassword();
            break;
        case '2':
            showStats();
            break;
        case '3':
            clearAll();
            break;
        case '4':
            console.log('Goodbye!');
            rl.close();
            db.close();
            break;
        default:
            console.log('Invalid option!');
            rl.close();
            db.close();
    }
});
