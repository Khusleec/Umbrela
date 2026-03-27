const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const redis = require('redis');
const Joi = require('joi');
const winston = require('winston');

dotenv.config();

const app = express();
const PORT = process.env.AUTH_SERVICE_PORT || 3001;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME || 'umbrela',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
});

const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  }
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const expectedToken = process.env.CSRF_TOKEN;
  if (!expectedToken) return next();
  const providedToken = req.headers['x-csrf-token'];
  if (providedToken !== expectedToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().required(),
  role: Joi.string().valid('admin', 'company', 'driver', 'user').required(),
  companyId: Joi.number().when('role', {
    is: 'company',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
});

const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      role: user.role,
      companyId: user.company_id 
    },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '24h' }
  );
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

const authorize = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

app.post('/login', async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password } = value;

    const [rows] = await pool.execute(
      'SELECT id, email, password, name, role, company_id FROM users WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    
    await redisClient.setEx(`token:${user.id}`, 86400, token);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.company_id,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/register', async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password, name, role, companyId } = value;

    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.execute(
      'INSERT INTO users (email, password, name, role, company_id) VALUES (?, ?, ?, ?, ?)',
      [email, hashedPassword, name, role, companyId || null]
    );

    const userId = result.insertId;
    const [userRows] = await pool.execute(
      'SELECT id, email, name, role, company_id FROM users WHERE id = ?',
      [userId]
    );

    const user = userRows[0];
    const token = generateToken(user);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.company_id,
      },
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/logout', authenticateToken, async (req, res) => {
  try {
    await redisClient.del(`token:${req.user.id}`);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/profile', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, email, name, role, company_id, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: user.company_id,
      createdAt: user.created_at,
    });
  } catch (error) {
    logger.error('Profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/validate', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'auth-service' });
});

const startServer = async () => {
  try {
    await redisClient.connect();
    // Test MySQL connection
    const conn = await pool.getConnection();
    conn.release();
    app.listen(PORT, () => {
      logger.info(`Auth service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
