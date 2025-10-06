const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');

const app = express();
const PORT = process.env.PORT || 3000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
const thumbnailsDir = path.join(__dirname, 'thumbnails');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Thumbnail generation function
async function generateThumbnail(originalPath, thumbnailPath) {
    try {
        console.log('Generating thumbnail for:', originalPath);
        const image = await Jimp.Jimp.read(originalPath);
        console.log('Original size:', image.bitmap.width, 'x', image.bitmap.height);
        
        const thumbnail = image.cover({ w: 150, h: 150 });
        await thumbnail.write(thumbnailPath);
        
        console.log('Thumbnail generated successfully:', thumbnailPath);
        return true;
    } catch (error) {
        console.error('Error generating thumbnail:', error);
        return false;
    }
}

// Initialize SQLite database
const db = new sqlite3.Database('pastebin.db');

// Create tables
db.serialize(() => {
    // Items table
    db.run(`CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT,
        originalname TEXT,
        mimetype TEXT,
        size INTEGER,
        content TEXT,
        upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Add thumbnail_filename column if it doesn't exist
    db.run(`ALTER TABLE items ADD COLUMN thumbnail_filename TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding thumbnail_filename column:', err);
        }
    });
    
    // Password table
    db.run(`CREATE TABLE IF NOT EXISTS password (
        id INTEGER PRIMARY KEY,
        hash TEXT
    )`);
});

// Session configuration
app.use(session({
    secret: 'pastebin-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static(uploadsDir));
app.use('/thumbnails', express.static(thumbnailsDir));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.authenticated) {
        next();
    } else {
        // Check if request came through proxy (has /paste/ prefix)
        const referer = req.get('Referer') || '';
        const basePath = referer.includes('/paste/') ? '/paste' : '';
        res.redirect(basePath + '/login');
    }
};

// Routes
app.get('/', requireAuth, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    
    db.all(`SELECT * FROM items ORDER BY upload_date DESC LIMIT ? OFFSET ?`, [limit, offset], (err, items) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send(`Database error: ${err.message} (Code: ${err.code})`);
        }
        
        db.get(`SELECT COUNT(*) as total FROM items`, (err, count) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send(`Database error: ${err.message} (Code: ${err.code})`);
            }
            
            const totalPages = Math.ceil(count.total / limit);
            res.render('index', { 
                items, 
                currentPage: page, 
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
                nextPage: page + 1,
                prevPage: page - 1
            });
        });
    });
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {
    const { password } = req.body;
    
    db.get(`SELECT hash FROM password LIMIT 1`, (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send(`Database error: ${err.message} (Code: ${err.code})`);
        }
        
        if (!row) {
            // No password set, create one
            const hash = bcrypt.hashSync(password, 10);
            db.run(`INSERT INTO password (hash) VALUES (?)`, [hash], (err) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).send(`Database error: ${err.message} (Code: ${err.code})`);
                }
                req.session.authenticated = true;
                res.redirect('/');
            });
        } else {
            // Verify password
            if (bcrypt.compareSync(password, row.hash)) {
                req.session.authenticated = true;
                res.redirect('/');
            } else {
                res.render('login', { error: 'Invalid password' });
            }
        }
    });
});

app.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file && !req.body.text) {
        return res.status(400).send('No file or text provided');
    }
    
    let filename = '';
    let originalname = '';
    let mimetype = '';
    let size = 0;
    let content = '';
    let thumbnailFilename = '';
    
    if (req.file) {
        filename = req.file.filename;
        originalname = req.file.originalname;
        mimetype = req.file.mimetype;
        size = req.file.size;
        
        // If it's a text file, read its content
        if (mimetype.startsWith('text/')) {
            try {
                content = fs.readFileSync(req.file.path, 'utf8');
            } catch (err) {
                console.error('Error reading file:', err);
            }
        }
        
        // Generate thumbnail for images
        if (mimetype.startsWith('image/')) {
            thumbnailFilename = 'thumb_' + filename;
            const thumbnailPath = path.join(thumbnailsDir, thumbnailFilename);
            const success = await generateThumbnail(req.file.path, thumbnailPath);
            if (!success) {
                thumbnailFilename = ''; // Clear if generation failed
            }
        }
    } else if (req.body.text) {
        content = req.body.text;
        mimetype = 'text/plain';
        originalname = 'text-paste.txt';
        filename = Date.now() + '-text.txt';
        size = Buffer.byteLength(content, 'utf8');
        
        // Save text content to file
        fs.writeFileSync(path.join(uploadsDir, filename), content);
    }
    
    db.run(`INSERT INTO items (filename, originalname, mimetype, size, content, thumbnail_filename) VALUES (?, ?, ?, ?, ?, ?)`,
        [filename, originalname, mimetype, size, content, thumbnailFilename], (err) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send(`Database error: ${err.message} (Code: ${err.code})`);
            }
            // Redirect to home page after successful upload
            res.redirect('/');
        });
});

app.get('/view/:id', requireAuth, (req, res) => {
    const id = req.params.id;
    
    db.get(`SELECT * FROM items WHERE id = ?`, [id], (err, item) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send(`Database error: ${err.message} (Code: ${err.code})`);
        }
        
        if (!item) {
            return res.status(404).send('Item not found');
        }
        
        res.render('view', { item });
    });
});

app.get('/download/:id', requireAuth, (req, res) => {
    const id = req.params.id;
    
    db.get(`SELECT * FROM items WHERE id = ?`, [id], (err, item) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send(`Database error: ${err.message} (Code: ${err.code})`);
        }
        
        if (!item) {
            return res.status(404).send('Item not found');
        }
        
        const filePath = path.join(uploadsDir, item.filename);
        res.download(filePath, item.originalname);
    });
});

app.delete('/delete/:id', requireAuth, (req, res) => {
    const id = req.params.id;
    
    db.get(`SELECT * FROM items WHERE id = ?`, [id], (err, item) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: `Database error: ${err.message} (Code: ${err.code})` });
        }
        
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }
        
        // Delete file from filesystem
        const filePath = path.join(uploadsDir, item.filename);
        fs.unlink(filePath, (err) => {
            if (err && err.code !== 'ENOENT') {
                console.error('Error deleting file:', err);
            }
        });
        
        // Delete thumbnail if it exists
        if (item.thumbnail_filename) {
            const thumbnailPath = path.join(thumbnailsDir, item.thumbnail_filename);
            fs.unlink(thumbnailPath, (err) => {
                if (err && err.code !== 'ENOENT') {
                    console.error('Error deleting thumbnail:', err);
                }
            });
        }
        
        // Delete from database
        db.run(`DELETE FROM items WHERE id = ?`, [id], (err) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: `Database error: ${err.message} (Code: ${err.code})` });
            }
            res.json({ success: true });
        });
    });
});

app.delete('/delete-all', requireAuth, (req, res) => {
    db.all(`SELECT filename, thumbnail_filename FROM items`, (err, items) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: `Database error: ${err.message} (Code: ${err.code})` });
        }
        
        // Delete all files from filesystem
        items.forEach(item => {
            const filePath = path.join(uploadsDir, item.filename);
            fs.unlink(filePath, (err) => {
                if (err && err.code !== 'ENOENT') {
                    console.error('Error deleting file:', err);
                }
            });
            
            // Delete thumbnail if it exists
            if (item.thumbnail_filename) {
                const thumbnailPath = path.join(thumbnailsDir, item.thumbnail_filename);
                fs.unlink(thumbnailPath, (err) => {
                    if (err && err.code !== 'ENOENT') {
                        console.error('Error deleting thumbnail:', err);
                    }
                });
            }
        });
        
        // Delete all from database
        db.run(`DELETE FROM items`, (err) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: `Database error: ${err.message} (Code: ${err.code})` });
            }
            res.json({ success: true });
        });
    });
});

app.post('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Admin console endpoint
app.post('/admin/set-password', (req, res) => {
    const { password } = req.body;
    
    if (!password) {
        return res.status(400).json({ error: 'Password required' });
    }
    
    const hash = bcrypt.hashSync(password, 10);
    
    db.run(`DELETE FROM password`, (err) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: `Database error: ${err.message} (Code: ${err.code})` });
        }
        
        db.run(`INSERT INTO password (hash) VALUES (?)`, [hash], (err) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: `Database error: ${err.message} (Code: ${err.code})` });
            }
            res.json({ success: true, message: 'Password updated successfully' });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Pastebin server running on http://localhost:${PORT}`);
});