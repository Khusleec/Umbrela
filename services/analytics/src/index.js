const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const redis = require('redis');
const Joi = require('joi');
const winston = require('winston');
const moment = require('moment');
const axios = require('axios');

dotenv.config();

const app = express();
const PORT = process.env.ANALYTICS_SERVICE_PORT || 3004;

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

const dateRangeSchema = Joi.object({
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  period: Joi.string().valid('today', 'week', 'month', 'year').optional(),
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

const getDateRange = (period, startDate, endDate) => {
  const now = moment();
  if (period === 'today') return { start: now.startOf('day').toDate(), end: now.endOf('day').toDate() };
  if (period === 'week') return { start: now.startOf('week').toDate(), end: now.endOf('week').toDate() };
  if (period === 'month') return { start: now.startOf('month').toDate(), end: now.endOf('month').toDate() };
  if (period === 'year') return { start: now.startOf('year').toDate(), end: now.endOf('year').toDate() };
  return {
    start: startDate ? new Date(startDate) : now.startOf('month').toDate(),
    end: endDate ? new Date(endDate) : now.endOf('day').toDate()
  };
};

const cacheAnalytics = async (key, data, ttl = 300) => {
  try { await redisClient.setEx(key, ttl, JSON.stringify(data)); } catch (e) { logger.error('Cache error:', e); }
};

const getCachedAnalytics = async (key) => {
  try { const c = await redisClient.get(key); return c ? JSON.parse(c) : null; } catch (e) { return null; }
};

app.get('/analytics/company/:id', authenticateToken, authorize(['admin', 'company']), async (req, res) => {
  try {
    const companyId = parseInt(req.params.id);
    if (req.user.role === 'company' && req.user.companyId !== companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { error, value } = dateRangeSchema.validate(req.query);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const dateRange = getDateRange(value.period, value.startDate, value.endDate);
    const cacheKey = `analytics:company:${companyId}:${JSON.stringify(dateRange)}`;
    const cached = await getCachedAnalytics(cacheKey);
    if (cached) return res.json(cached);

    const [totalOrders] = await pool.execute(
      `SELECT COUNT(*) as total_orders FROM orders WHERE company_id = ? AND created_at BETWEEN ? AND ?`,
      [companyId, dateRange.start, dateRange.end]
    );
    const [completedOrders] = await pool.execute(
      `SELECT COUNT(*) as completed_orders FROM orders WHERE company_id = ? AND status = 'delivered' AND created_at BETWEEN ? AND ?`,
      [companyId, dateRange.start, dateRange.end]
    );
    const [avgDelay] = await pool.execute(
      `SELECT AVG(TIMESTAMPDIFF(MINUTE, estimated_delivery_time, actual_delivery_time)) as avg_delay_minutes
       FROM orders WHERE company_id = ? AND status = 'delivered' AND actual_delivery_time IS NOT NULL AND created_at BETWEEN ? AND ?`,
      [companyId, dateRange.start, dateRange.end]
    );
    const [driverPerf] = await pool.execute(
      `SELECT d.id, d.name,
         COUNT(o.id) as total_deliveries,
         AVG(TIMESTAMPDIFF(MINUTE, o.estimated_delivery_time, o.actual_delivery_time)) as avg_delay_minutes
       FROM drivers d
       LEFT JOIN orders o ON d.id = o.driver_id AND o.status = 'delivered' AND o.created_at BETWEEN ? AND ?
       WHERE d.company_id = ? GROUP BY d.id, d.name ORDER BY total_deliveries DESC`,
      [dateRange.start, dateRange.end, companyId]
    );
    const [dailyStats] = await pool.execute(
      `SELECT DATE(created_at) as date, COUNT(*) as orders_count, COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_count
       FROM orders WHERE company_id = ? AND created_at BETWEEN ? AND ? GROUP BY DATE(created_at) ORDER BY date`,
      [companyId, dateRange.start, dateRange.end]
    );
    const [statusBreakdown] = await pool.execute(
      `SELECT status, COUNT(*) as count FROM orders WHERE company_id = ? AND created_at BETWEEN ? AND ? GROUP BY status ORDER BY count DESC`,
      [companyId, dateRange.start, dateRange.end]
    );

    const total = parseInt(totalOrders[0].total_orders);
    const completed = parseInt(completedOrders[0].completed_orders);
    const analytics = {
      companyId, dateRange,
      summary: {
        totalOrders: total, completedOrders: completed,
        completionRate: total > 0 ? (completed / total * 100).toFixed(2) : 0,
        averageDelayMinutes: parseFloat(avgDelay[0].avg_delay_minutes || 0).toFixed(2)
      },
      driverPerformance: driverPerf.map(d => ({ ...d, totalDeliveries: parseInt(d.total_deliveries), avgDelayMinutes: parseFloat(d.avg_delay_minutes || 0).toFixed(2) })),
      dailyStats: dailyStats.map(d => ({ date: d.date, ordersCount: parseInt(d.orders_count), deliveredCount: parseInt(d.delivered_count) })),
      statusBreakdown: statusBreakdown.map(s => ({ status: s.status, count: parseInt(s.count) }))
    };

    await cacheAnalytics(cacheKey, analytics);
    res.json(analytics);
  } catch (error) {
    logger.error('Company analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/analytics/global', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const { error, value } = dateRangeSchema.validate(req.query);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const dateRange = getDateRange(value.period, value.startDate, value.endDate);
    const cacheKey = `analytics:global:${JSON.stringify(dateRange)}`;
    const cached = await getCachedAnalytics(cacheKey);
    if (cached) return res.json(cached);

    const [[{ total_orders }]] = await pool.execute(
      `SELECT COUNT(*) as total_orders FROM orders WHERE created_at BETWEEN ? AND ?`, [dateRange.start, dateRange.end]
    );
    const [[{ total_users }]] = await pool.execute(
      `SELECT COUNT(*) as total_users FROM users WHERE created_at BETWEEN ? AND ?`, [dateRange.start, dateRange.end]
    );
    const [[{ total_companies }]] = await pool.execute(`SELECT COUNT(*) as total_companies FROM companies`);
    const [[{ total_drivers }]] = await pool.execute(`SELECT COUNT(*) as total_drivers FROM drivers`);
    const [topCompanies] = await pool.execute(
      `SELECT c.id, c.name, COUNT(o.id) as orders_count, COUNT(CASE WHEN o.status = 'delivered' THEN 1 END) as delivered_count
       FROM companies c LEFT JOIN orders o ON c.id = o.company_id AND o.created_at BETWEEN ? AND ?
       GROUP BY c.id, c.name ORDER BY orders_count DESC LIMIT 10`,
      [dateRange.start, dateRange.end]
    );
    const [orderTrends] = await pool.execute(
      `SELECT DATE(created_at) as date, COUNT(*) as orders_count FROM orders WHERE created_at BETWEEN ? AND ? GROUP BY DATE(created_at) ORDER BY date`,
      [dateRange.start, dateRange.end]
    );

    const analytics = {
      dateRange,
      summary: {
        totalOrders: parseInt(total_orders), totalUsers: parseInt(total_users),
        totalCompanies: parseInt(total_companies), totalDrivers: parseInt(total_drivers)
      },
      topCompanies: topCompanies.map(c => ({ ...c, ordersCount: parseInt(c.orders_count), deliveredCount: parseInt(c.delivered_count) })),
      orderTrends: orderTrends.map(t => ({ date: t.date, ordersCount: parseInt(t.orders_count) }))
    };

    await cacheAnalytics(cacheKey, analytics);
    res.json(analytics);
  } catch (error) {
    logger.error('Global analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/analytics/driver/:id', authenticateToken, authorize(['admin', 'company', 'driver']), async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    const [driverResult] = await pool.execute(`SELECT company_id FROM drivers WHERE id = ?`, [driverId]);
    if (driverResult.length === 0) return res.status(404).json({ error: 'Driver not found' });

    if (req.user.role === 'company' && req.user.companyId !== driverResult[0].company_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'driver') {
      const [check] = await pool.execute('SELECT id FROM drivers WHERE user_id = ? AND id = ?', [req.user.id, driverId]);
      if (check.length === 0) return res.status(403).json({ error: 'Access denied' });
    }

    const { error, value } = dateRangeSchema.validate(req.query);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const dateRange = getDateRange(value.period, value.startDate, value.endDate);
    const cacheKey = `analytics:driver:${driverId}:${JSON.stringify(dateRange)}`;
    const cached = await getCachedAnalytics(cacheKey);
    if (cached) return res.json(cached);

    const [[stats]] = await pool.execute(
      `SELECT COUNT(*) as total_deliveries,
         COUNT(CASE WHEN status = 'delivered' THEN 1 END) as completed_deliveries,
         AVG(TIMESTAMPDIFF(MINUTE, estimated_delivery_time, actual_delivery_time)) as avg_delay_minutes
       FROM orders WHERE driver_id = ? AND created_at BETWEEN ? AND ?`,
      [driverId, dateRange.start, dateRange.end]
    );
    const [dailyDeliveries] = await pool.execute(
      `SELECT DATE(created_at) as date, COUNT(*) as deliveries_count
       FROM orders WHERE driver_id = ? AND status = 'delivered' AND created_at BETWEEN ? AND ?
       GROUP BY DATE(created_at) ORDER BY date`,
      [driverId, dateRange.start, dateRange.end]
    );
    const [[driverInfo]] = await pool.execute(
      `SELECT d.*, u.email FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.id = ?`, [driverId]
    );

    const total = parseInt(stats.total_deliveries);
    const completed = parseInt(stats.completed_deliveries);
    const analytics = {
      driverId, dateRange, driver: driverInfo,
      performance: {
        totalDeliveries: total, completedDeliveries: completed,
        completionRate: total > 0 ? (completed / total * 100).toFixed(2) : 0,
        averageDelayMinutes: parseFloat(stats.avg_delay_minutes || 0).toFixed(2)
      },
      dailyDeliveries: dailyDeliveries.map(d => ({ date: d.date, deliveriesCount: parseInt(d.deliveries_count) }))
    };

    await cacheAnalytics(cacheKey, analytics);
    res.json(analytics);
  } catch (error) {
    logger.error('Driver analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'analytics-service' }));

const startServer = async () => {
  try {
    await redisClient.connect();
    const conn = await pool.getConnection();
    conn.release();
    app.listen(PORT, () => logger.info(`Analytics service running on port ${PORT}`));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
module.exports = app;
