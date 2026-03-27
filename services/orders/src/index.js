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
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.ORDER_SERVICE_PORT || 3002;

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

const createOrderSchema = Joi.object({
  userId: Joi.number().required(),
  companyId: Joi.number().required(),
  pickupAddress: Joi.string().required(),
  deliveryAddress: Joi.string().required(),
  pickupLocation: Joi.object({
    lat: Joi.number().required(),
    lng: Joi.number().required(),
  }).required(),
  deliveryLocation: Joi.object({
    lat: Joi.number().required(),
    lng: Joi.number().required(),
  }).required(),
  notes: Joi.string().optional(),
});

const assignOrderSchema = Joi.object({
  driverId: Joi.number().required(),
});

const updateOrderStatusSchema = Joi.object({
  status: Joi.string().valid('assigned', 'picked_up', 'on_the_way', 'delivered', 'cancelled').required(),
});

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const response = await axios.get(`${process.env.AUTH_SERVICE_URL || 'http://localhost:3001'}/validate`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.data.valid) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.user = response.data.user;
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(403).json({ error: 'Authentication failed' });
  }
};

const authorize = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

const broadcastOrderUpdate = (orderId, updateData) => {
  io.emit(`order:${orderId}`, updateData);
  io.emit('orders:update', { orderId, ...updateData });
};

app.post('/orders', authenticateToken, authorize(['user', 'company', 'admin']), async (req, res) => {
  try {
    const { error, value } = createOrderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { userId, companyId, pickupAddress, deliveryAddress, pickupLocation, deliveryLocation, notes } = value;

    const estimatedDeliveryTime = new Date();
    estimatedDeliveryTime.setHours(estimatedDeliveryTime.getHours() + 2);

    const [result] = await pool.execute(
      `INSERT INTO orders (user_id, company_id, pickup_address, delivery_address, pickup_lat, pickup_lng, delivery_lat, delivery_lng, estimated_delivery_time, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, companyId, pickupAddress, deliveryAddress, pickupLocation.lat, pickupLocation.lng, deliveryLocation.lat, deliveryLocation.lng, estimatedDeliveryTime, notes || null]
    );

    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [result.insertId]);
    const order = rows[0];
    
    await redisClient.setEx(`order:${order.id}`, 3600, JSON.stringify(order));
    broadcastOrderUpdate(order.id, { action: 'created', order });

    try {
      await axios.post(`${process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3005'}/notify/order-created`, {
        orderId: order.id,
        userId: order.user_id,
        companyId: order.company_id,
      });
    } catch (notificationError) {
      logger.error('Failed to send notification:', notificationError);
    }

    res.status(201).json(order);
  } catch (error) {
    logger.error('Create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/orders', authenticateToken, async (req, res) => {
  try {
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (req.user.role === 'user') {
      query += ' AND user_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'company') {
      query += ' AND company_id = ?';
      params.push(req.user.companyId);
    } else if (req.user.role === 'driver') {
      query += ' AND driver_id = ?';
      params.push(req.user.id);
    }

    if (req.query.status) {
      query += ' AND status = ?';
      params.push(req.query.status);
    }

    query += ' ORDER BY created_at DESC';

    if (req.query.limit) {
      query += ' LIMIT ?';
      params.push(parseInt(req.query.limit));
    }

    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (error) {
    logger.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/orders/:id', authenticateToken, async (req, res) => {
  try {
    const orderId = req.params.id;

    const cachedOrder = await redisClient.get(`order:${orderId}`);
    if (cachedOrder) {
      return res.json(JSON.parse(cachedOrder));
    }

    let query = 'SELECT * FROM orders WHERE id = ?';
    const params = [orderId];

    if (req.user.role === 'user') {
      query += ' AND user_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'company') {
      query += ' AND company_id = ?';
      params.push(req.user.companyId);
    } else if (req.user.role === 'driver') {
      query += ' AND driver_id = ?';
      params.push(req.user.id);
    }

    const [rows] = await pool.execute(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = rows[0];
    await redisClient.setEx(`order:${orderId}`, 3600, JSON.stringify(order));

    res.json(order);
  } catch (error) {
    logger.error('Get order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/orders/:id/assign', authenticateToken, authorize(['company', 'admin']), async (req, res) => {
  try {
    const { error, value } = assignOrderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const orderId = req.params.id;
    const { driverId } = value;

    const [orderCheck] = await pool.execute(
      'SELECT * FROM orders WHERE id = ? AND company_id = ?',
      [orderId, req.user.companyId]
    );

    if (orderCheck.length === 0) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    await pool.execute(
      `UPDATE orders SET driver_id = ?, status = 'assigned', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [driverId, orderId]
    );

    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
    const order = rows[0];
    
    await redisClient.setEx(`order:${orderId}`, 3600, JSON.stringify(order));
    broadcastOrderUpdate(orderId, { action: 'assigned', order });

    try {
      await axios.post(`${process.env.DRIVER_SERVICE_URL || 'http://localhost:3003'}/orders/assigned`, { orderId, driverId });
    } catch (driverError) {
      logger.error('Failed to notify driver service:', driverError);
    }

    res.json(order);
  } catch (error) {
    logger.error('Assign order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/orders/:id/status', authenticateToken, authorize(['driver', 'company', 'admin']), async (req, res) => {
  try {
    const { error, value } = updateOrderStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const orderId = req.params.id;
    const { status } = value;

    let checkQuery = 'SELECT * FROM orders WHERE id = ?';
    const checkParams = [orderId];

    if (req.user.role === 'driver') {
      checkQuery += ' AND driver_id = ?';
      checkParams.push(req.user.id);
    } else if (req.user.role === 'company') {
      checkQuery += ' AND company_id = ?';
      checkParams.push(req.user.companyId);
    }

    const [orderCheck] = await pool.execute(checkQuery, checkParams);

    if (orderCheck.length === 0) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    let updateQuery = 'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP';
    let updateParams = [status];

    if (status === 'delivered') {
      updateQuery += ', actual_delivery_time = CURRENT_TIMESTAMP';
    }

    updateQuery += ' WHERE id = ?';
    updateParams.push(orderId);

    await pool.execute(updateQuery, updateParams);
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
    const order = rows[0];

    await redisClient.setEx(`order:${orderId}`, 3600, JSON.stringify(order));
    broadcastOrderUpdate(orderId, { action: 'status_updated', order, status });

    try {
      await axios.post(`${process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3005'}/notify/status-update`, {
        orderId, status, userId: order.user_id,
      });
    } catch (notificationError) {
      logger.error('Failed to send notification:', notificationError);
    }

    res.json(order);
  } catch (error) {
    logger.error('Update order status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'order-service' });
});

io.on('connection', (socket) => {
  logger.info('Client connected to order service');

  socket.on('subscribe:order', (orderId) => {
    socket.join(`order:${orderId}`);
  });

  socket.on('unsubscribe:order', (orderId) => {
    socket.leave(`order:${orderId}`);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected from order service');
  });
});

const startServer = async () => {
  try {
    await redisClient.connect();
    const conn = await pool.getConnection();
    conn.release();
    server.listen(PORT, () => {
      logger.info(`Order service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
