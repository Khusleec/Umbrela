const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { Pool } = require('pg');
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

const pgClient = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'delivery_tracking',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));

app.use(helmet());
app.use(cors());
app.use(express.json());

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

    const result = await pgClient.query(`
      INSERT INTO orders (user_id, company_id, pickup_address, delivery_address, pickup_location, delivery_location, estimated_delivery_time, notes)
      VALUES ($1, $2, $3, $4, POINT($5, $6), POINT($7, $8), $9, $10)
      RETURNING *
    `, [
      userId,
      companyId,
      pickupAddress,
      deliveryAddress,
      pickupLocation.lng,
      pickupLocation.lat,
      deliveryLocation.lng,
      deliveryLocation.lat,
      estimatedDeliveryTime,
      notes || null
    ]);

    const order = result.rows[0];
    
    await redisClient.setex(`order:${order.id}`, 3600, JSON.stringify(order));

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
    let paramIndex = 1;

    if (req.user.role === 'user') {
      query += ` AND user_id = $${paramIndex}`;
      params.push(req.user.id);
      paramIndex++;
    } else if (req.user.role === 'company') {
      query += ` AND company_id = $${paramIndex}`;
      params.push(req.user.companyId);
      paramIndex++;
    } else if (req.user.role === 'driver') {
      query += ` AND driver_id = $${paramIndex}`;
      params.push(req.user.id);
      paramIndex++;
    }

    if (req.query.status) {
      query += ` AND status = $${paramIndex}`;
      params.push(req.query.status);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC';

    if (req.query.limit) {
      query += ` LIMIT $${paramIndex}`;
      params.push(parseInt(req.query.limit));
      paramIndex++;
    }

    const result = await pgClient.query(query, params);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/orders/:id', authenticateToken, async (req, res) => {
  try {
    const orderId = req.params.id;

    let cachedOrder = await redisClient.get(`order:${orderId}`);
    if (cachedOrder) {
      return res.json(JSON.parse(cachedOrder));
    }

    let query = 'SELECT * FROM orders WHERE id = $1';
    const params = [orderId];

    if (req.user.role === 'user') {
      query += ' AND user_id = $2';
      params.push(req.user.id);
    } else if (req.user.role === 'company') {
      query += ' AND company_id = $2';
      params.push(req.user.companyId);
    } else if (req.user.role === 'driver') {
      query += ' AND driver_id = $2';
      params.push(req.user.id);
    }

    const result = await pgClient.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = result.rows[0];
    await redisClient.setex(`order:${orderId}`, 3600, JSON.stringify(order));

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

    const orderCheck = await pgClient.query(
      'SELECT * FROM orders WHERE id = $1 AND company_id = $2',
      [orderId, req.user.companyId]
    );

    if (orderCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    const result = await pgClient.query(`
      UPDATE orders 
      SET driver_id = $1, status = 'assigned', updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [driverId, orderId]);

    const order = result.rows[0];
    
    await redisClient.setex(`order:${orderId}`, 3600, JSON.stringify(order));

    broadcastOrderUpdate(orderId, { action: 'assigned', order });

    try {
      await axios.post(`${process.env.DRIVER_SERVICE_URL || 'http://localhost:3003'}/orders/assigned`, {
        orderId,
        driverId,
      });
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

    let query = 'SELECT * FROM orders WHERE id = $1';
    const params = [orderId];

    if (req.user.role === 'driver') {
      query += ' AND driver_id = $2';
      params.push(req.user.id);
    } else if (req.user.role === 'company') {
      query += ' AND company_id = $2';
      params.push(req.user.companyId);
    }

    const orderCheck = await pgClient.query(query, params);

    if (orderCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    let updateQuery = 'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP';
    let updateParams = [status, orderId];

    if (status === 'delivered') {
      updateQuery += ', actual_delivery_time = CURRENT_TIMESTAMP';
    }

    updateQuery += ' WHERE id = $2 RETURNING *';

    const result = await pgClient.query(updateQuery, updateParams);
    const order = result.rows[0];

    await redisClient.setex(`order:${orderId}`, 3600, JSON.stringify(order));

    broadcastOrderUpdate(orderId, { action: 'status_updated', order, status });

    try {
      await axios.post(`${process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3005'}/notify/status-update`, {
        orderId,
        status,
        userId: order.user_id,
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
    logger.info(`Client subscribed to order ${orderId}`);
  });

  socket.on('unsubscribe:order', (orderId) => {
    socket.leave(`order:${orderId}`);
    logger.info(`Client unsubscribed from order ${orderId}`);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected from order service');
  });
});

const startServer = async () => {
  try {
    await pgClient.connect();
    await redisClient.connect();
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
