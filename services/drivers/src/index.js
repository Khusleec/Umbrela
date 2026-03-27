const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const redis = require('redis');
const Joi = require('joi');
const winston = require('winston');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.DRIVER_SERVICE_PORT || 3003;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
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

const updateLocationSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid('available', 'busy', 'offline').required(),
});

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access token required' });

    const response = await axios.get(`${process.env.AUTH_SERVICE_URL || 'http://localhost:3001'}/validate`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.data.valid) return res.status(403).json({ error: 'Invalid or expired token' });

    req.user = response.data.user;
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(403).json({ error: 'Authentication failed' });
  }
};

const authorize = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  next();
};

const broadcastDriverUpdate = (driverId, updateData) => {
  io.emit(`driver:${driverId}`, updateData);
  io.emit('drivers:update', { driverId, ...updateData });
};

const broadcastLocationUpdate = (driverId, location) => {
  io.emit(`driver:${driverId}:location`, { driverId, location, timestamp: new Date() });
  io.emit('drivers:location', { driverId, location, timestamp: new Date() });
};

app.get('/drivers', authenticateToken, async (req, res) => {
  try {
    let query = 'SELECT d.*, u.email FROM drivers d JOIN users u ON d.user_id = u.id WHERE 1=1';
    const params = [];

    if (req.user.role === 'company') {
      query += ' AND d.company_id = ?';
      params.push(req.user.companyId);
    } else if (req.user.role === 'driver') {
      query += ' AND d.user_id = ?';
      params.push(req.user.id);
    }

    if (req.query.status) {
      query += ' AND d.status = ?';
      params.push(req.query.status);
    }

    query += ' ORDER BY d.created_at DESC';

    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (error) {
    logger.error('Get drivers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/drivers/:id', authenticateToken, async (req, res) => {
  try {
    const driverId = req.params.id;
    let query = `SELECT d.*, u.email, u.name as user_name FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.id = ?`;
    const params = [driverId];

    if (req.user.role === 'company') {
      query += ' AND d.company_id = ?';
      params.push(req.user.companyId);
    } else if (req.user.role === 'driver') {
      query += ' AND d.user_id = ?';
      params.push(req.user.id);
    }

    const [rows] = await pool.execute(query, params);

    if (rows.length === 0) return res.status(404).json({ error: 'Driver not found' });

    res.json(rows[0]);
  } catch (error) {
    logger.error('Get driver error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/drivers/:id/location', authenticateToken, authorize(['driver']), async (req, res) => {
  try {
    const { error, value } = updateLocationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const driverId = req.params.id;
    const { lat, lng } = value;

    const [driverCheck] = await pool.execute(
      'SELECT id FROM drivers WHERE user_id = ? AND id = ?',
      [req.user.id, driverId]
    );

    if (driverCheck.length === 0) return res.status(404).json({ error: 'Driver not found or access denied' });

    await pool.execute(
      `UPDATE drivers SET current_lat = ?, current_lng = ?, last_location_update = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [lat, lng, driverId]
    );

    await redisClient.setEx(`driver:${driverId}:location`, 300, JSON.stringify({ lat, lng }));
    broadcastLocationUpdate(driverId, { lat, lng });

    res.json({ id: driverId, location: { lat, lng }, lastLocationUpdate: new Date() });
  } catch (error) {
    logger.error('Update location error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/drivers/:id/status', authenticateToken, authorize(['driver', 'company', 'admin']), async (req, res) => {
  try {
    const { error, value } = updateStatusSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const driverId = req.params.id;
    const { status } = value;

    let checkQuery = 'SELECT * FROM drivers WHERE id = ?';
    const checkParams = [driverId];

    if (req.user.role === 'driver') {
      checkQuery += ' AND user_id = ?';
      checkParams.push(req.user.id);
    } else if (req.user.role === 'company') {
      checkQuery += ' AND company_id = ?';
      checkParams.push(req.user.companyId);
    }

    const [driverCheck] = await pool.execute(checkQuery, checkParams);
    if (driverCheck.length === 0) return res.status(404).json({ error: 'Driver not found or access denied' });

    await pool.execute(
      `UPDATE drivers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, driverId]
    );

    const [rows] = await pool.execute('SELECT * FROM drivers WHERE id = ?', [driverId]);
    const driver = rows[0];

    await redisClient.setEx(`driver:${driverId}:status`, 3600, status);
    broadcastDriverUpdate(driverId, { action: 'status_updated', driver, status });

    res.json(driver);
  } catch (error) {
    logger.error('Update driver status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/drivers/:id/location', authenticateToken, async (req, res) => {
  try {
    const driverId = req.params.id;

    const cachedLocation = await redisClient.get(`driver:${driverId}:location`);
    if (cachedLocation) return res.json(JSON.parse(cachedLocation));

    let query = 'SELECT current_lat, current_lng, last_location_update FROM drivers WHERE id = ?';
    const params = [driverId];

    if (req.user.role === 'company') {
      query += ' AND company_id = ?';
      params.push(req.user.companyId);
    }

    const [rows] = await pool.execute(query, params);

    if (rows.length === 0) return res.status(404).json({ error: 'Driver not found' });

    const driver = rows[0];
    const location = driver.current_lat != null ? { lat: driver.current_lat, lng: driver.current_lng } : null;

    if (location) await redisClient.setEx(`driver:${driverId}:location`, 300, JSON.stringify(location));

    res.json({ location, lastLocationUpdate: driver.last_location_update });
  } catch (error) {
    logger.error('Get driver location error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/drivers/company/:companyId/available', authenticateToken, authorize(['company', 'admin']), async (req, res) => {
  try {
    const companyId = req.params.companyId;

    if (req.user.role === 'company' && req.user.companyId !== parseInt(companyId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [rows] = await pool.execute(
      `SELECT d.*, u.email, u.name as user_name
       FROM drivers d JOIN users u ON d.user_id = u.id
       WHERE d.company_id = ? AND d.status = 'available'
       ORDER BY d.last_location_update DESC`,
      [companyId]
    );

    res.json(rows);
  } catch (error) {
    logger.error('Get available drivers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/orders/assigned', authenticateToken, async (req, res) => {
  try {
    const { orderId, driverId } = req.body;

    await pool.execute(
      `UPDATE drivers SET status = 'busy', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [driverId]
    );

    broadcastDriverUpdate(driverId, { action: 'order_assigned', orderId, status: 'busy' });

    res.json({ message: 'Driver status updated to busy' });
  } catch (error) {
    logger.error('Order assignment notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'driver-service' });
});

io.on('connection', (socket) => {
  logger.info('Client connected to driver service');

  socket.on('subscribe:driver', (driverId) => socket.join(`driver:${driverId}`));
  socket.on('subscribe:driver:location', (driverId) => socket.join(`driver:${driverId}:location`));
  socket.on('unsubscribe:driver', (driverId) => socket.leave(`driver:${driverId}`));

  socket.on('location:update', async (data) => {
    try {
      const { driverId, lat, lng, token } = data;
      const response = await axios.get(`${process.env.AUTH_SERVICE_URL || 'http://localhost:3001'}/validate`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.valid && response.data.user.role === 'driver') {
        const [driverCheck] = await pool.execute(
          'SELECT id FROM drivers WHERE user_id = ? AND id = ?',
          [response.data.user.id, driverId]
        );

        if (driverCheck.length > 0) {
          await pool.execute(
            `UPDATE drivers SET current_lat = ?, current_lng = ?, last_location_update = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [lat, lng, driverId]
          );
          await redisClient.setEx(`driver:${driverId}:location`, 300, JSON.stringify({ lat, lng }));
          broadcastLocationUpdate(driverId, { lat, lng });
        }
      }
    } catch (error) {
      logger.error('Socket location update error:', error);
    }
  });

  socket.on('disconnect', () => logger.info('Client disconnected from driver service'));
});

const startServer = async () => {
  try {
    await redisClient.connect();
    const conn = await pool.getConnection();
    conn.release();
    server.listen(PORT, () => logger.info(`Driver service running on port ${PORT}`));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
