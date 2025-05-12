require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise'); // Using promise-based API
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Create connection pool (better than single connection)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '32662272',
  database: process.env.DB_NAME || 'child_sponsor_connect1',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});
app.use('/api/', apiLimiter);

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Admin emails from environment variables
const ADMIN_EMAILS = process.env.ADMIN_EMAILS ? 
  process.env.ADMIN_EMAILS.split(',') : 
  ['admin@baobabschool.com'];

// Enhanced Google Auth Endpoint
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const { sub, email, name, picture } = payload;

    // Check admin status
    const isAdmin = ADMIN_EMAILS.includes(email);

    // Check/upsert sponsor in database
    const [sponsor] = await pool.execute(
      `INSERT INTO sponsors (google_id, name, email, avatar, is_admin, description) 
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       name = VALUES(name), avatar = VALUES(avatar), is_admin = VALUES(is_admin)`,
      [sub, name, email, picture, isAdmin, `Google OAuth user - ${email}`]
    );

    // Get sponsor ID
    let sponsorId;
    if (sponsor.insertId) {
      sponsorId = sponsor.insertId;
    } else {
      const [[existingSponsor]] = await pool.execute(
        'SELECT id FROM sponsors WHERE google_id = ?', 
        [sub]
      );
      sponsorId = existingSponsor.id;
    }

    // Generate JWT
    const appToken = jwt.sign(
      {
        userId: sub,
        email,
        sponsorId,
        isAdmin,
        name
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    res.json({ 
      token: appToken,
      user: {
        id: sub,
        email,
        name,
        avatar: picture,
        sponsorId,
        isAdmin
      }
    });

  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ 
      error: 'Authentication failed',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
});

// Admin Middleware
function isAdmin(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    if (!user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    
    req.user = user;
    next();
  });
}

// Admin Dashboard Endpoints
app.get('/admin/sponsors', isAdmin, async (req, res) => {
  try {
    const [results] = await pool.execute(`
      SELECT s.*, 
             COUNT(fm.id) as family_member_count,
             GROUP_CONCAT(fm.name SEPARATOR ', ') as family_member_names
      FROM sponsors s
      LEFT JOIN family_members fm ON s.id = fm.sponsor_id
      GROUP BY s.id
      ORDER BY s.name
    `);
    res.json(results);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Failed to fetch sponsors' });
  }
});

app.get('/admin/family-members', isAdmin, async (req, res) => {
  try {
    const [results] = await pool.execute(`
      SELECT fm.*, 
             s.name as sponsor_name,
             s.email as sponsor_email,
             DATEDIFF(CURDATE(), fm.date_of_birth)/365 as age
      FROM family_members fm
      JOIN sponsors s ON fm.sponsor_id = s.id
      ORDER BY fm.name
    `);
    res.json(results);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Failed to fetch family members' });
  }
});

app.get('/admin/search', isAdmin, async (req, res) => {
  const { query } = req.query;
  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters' });
  }

  try {
    const searchTerm = `%${query}%`;
    const [results] = await pool.execute(`
      (SELECT 'sponsor' as type, id, name, email, NULL as date_of_birth, NULL as sponsor_name
       FROM sponsors 
       WHERE name LIKE ? OR email LIKE ?)
      UNION ALL
      (SELECT 'family_member' as type, fm.id, fm.name, fm.email, fm.date_of_birth, s.name as sponsor_name
       FROM family_members fm
       JOIN sponsors s ON fm.sponsor_id = s.id
       WHERE fm.name LIKE ? OR fm.email LIKE ?)
      LIMIT 50
    `, [searchTerm, searchTerm, searchTerm, searchTerm]);
    
    res.json(results);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Database setup endpoints (protected in production)
if (process.env.NODE_ENV !== 'production') {
  app.get('/createdb', async (req, res) => {
    try {
      await pool.query('CREATE DATABASE IF NOT EXISTS child_sponsor_connect1');
      res.send('Database created or already exists');
    } catch (err) {
      res.status(500).send('Error: ' + err.message);
    }
  });

  app.get('/create-sponsors-table', async (req, res) => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sponsors (
          id INT AUTO_INCREMENT PRIMARY KEY,
          google_id VARCHAR(255) UNIQUE,
          name VARCHAR(255),
          email VARCHAR(255) UNIQUE,
          avatar VARCHAR(255),
          description TEXT,
          is_admin BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      res.send('Sponsors table created');
    } catch (err) {
      res.status(500).send('Error: ' + err.message);
    }
  });

  app.get('/create-family-members-table', async (req, res) => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS family_members (
          id INT AUTO_INCREMENT PRIMARY KEY,
          sponsor_id INT,
          name VARCHAR(255),
          email VARCHAR(255),
          date_of_birth DATE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
        )
      `);
      res.send('Family members table created');
    } catch (err) {
      res.status(500).send('Error: ' + err.message);
    }
  });
}

// Regular API Endpoints (protected)
app.get('/api/protected', authenticateToken, (req, res) => {
  res.json({ message: 'This is protected data', user: req.user });
});

// Sponsor endpoints
app.post('/api/sponsors', authenticateToken, async (req, res) => {
  const { name, email, description } = req.body;
  try {
    const [result] = await pool.execute(
      'INSERT INTO sponsors (name, email, description) VALUES (?, ?, ?)',
      [name, email, description]
    );
    res.json({ message: 'Sponsor added', sponsorId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Family member endpoints
app.post('/api/family-members', authenticateToken, async (req, res) => {
  const { sponsor_id, name, email, date_of_birth } = req.body;
  
  // Verify the sponsor_id matches the logged-in user
  if (req.user.sponsorId != sponsor_id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Not authorized to add family members for this sponsor' });
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO family_members (sponsor_id, name, email, date_of_birth) VALUES (?, ?, ?, ?)',
      [sponsor_id, name, email, new Date(date_of_birth)]
    );
    res.json({ message: 'Family member added', memberId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.sendStatus(401);
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin emails: ${ADMIN_EMAILS.join(', ')}`);
});