const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { Pool } = require('pg');
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

const dateRangeSchema = Joi.object({
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  period: Joi.string().valid('today', 'week', 'month', 'year').optional(),
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

const getDateRange = (period, startDate, endDate) => {
  const now = moment();
  
  if (period === 'today') {
    return {
      start: now.startOf('day').toDate(),
      end: now.endOf('day').toDate()
    };
  } else if (period === 'week') {
    return {
      start: now.startOf('week').toDate(),
      end: now.endOf('week').toDate()
    };
  } else if (period === 'month') {
    return {
      start: now.startOf('month').toDate(),
      end: now.endOf('month').toDate()
    };
  } else if (period === 'year') {
    return {
      start: now.startOf('year').toDate(),
      end: now.endOf('year').toDate()
    };
  } else {
    return {
      start: startDate ? new Date(startDate) : now.startOf('month').toDate(),
      end: endDate ? new Date(endDate) : now.endOf('day').toDate()
    };
  }
};

const cacheAnalytics = async (key, data, ttl = 300) => {
  try {
    await redisClient.setex(key, ttl, JSON.stringify(data));
  } catch (error) {
    logger.error('Failed to cache analytics:', error);
  }
};

const getCachedAnalytics = async (key) => {
  try {
    const cached = await redisClient.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    logger.error('Failed to get cached analytics:', error);
    return null;
  }
};

app.get('/analytics/company/:id', authenticateToken, authorize(['admin', 'company']), async (req, res) => {
  try {
    const companyId = parseInt(req.params.id);
    
    if (req.user.role === 'company' && req.user.companyId !== companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { error, value } = dateRangeSchema.validate(req.query);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { startDate, endDate, period } = value;
    const dateRange = getDateRange(period, startDate, endDate);
    
    const cacheKey = `analytics:company:${companyId}:${JSON.stringify(dateRange)}`;
    const cached = await getCachedAnalytics(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const [
      totalOrdersResult,
      completedOrdersResult,
      averageDeliveryTimeResult,
      driverPerformanceResult,
      dailyStatsResult,
      statusBreakdownResult
    ] = await Promise.all([
      pgClient.query(`
        SELECT COUNT(*) as total_orders
        FROM orders 
        WHERE company_id = $1 
        AND created_at BETWEEN $2 AND $3
      `, [companyId, dateRange.start, dateRange.end]),
      
      pgClient.query(`
        SELECT COUNT(*) as completed_orders
        FROM orders 
        WHERE company_id = $1 
        AND status = 'delivered'
        AND created_at BETWEEN $2 AND $3
      `, [companyId, dateRange.start, dateRange.end]),
      
      pgClient.query(`
        SELECT AVG(
          CASE 
            WHEN actual_delivery_time IS NOT NULL AND estimated_delivery_time IS NOT NULL
            THEN EXTRACT(EPOCH FROM (actual_delivery_time - estimated_delivery_time)) / 60
            ELSE NULL 
          END
        ) as avg_delay_minutes
        FROM orders 
        WHERE company_id = $1 
        AND status = 'delivered'
        AND actual_delivery_time IS NOT NULL
        AND created_at BETWEEN $2 AND $3
      `, [companyId, dateRange.start, dateRange.end]),
      
      pgClient.query(`
        SELECT 
          d.id,
          d.name,
          COUNT(o.id) as total_deliveries,
          AVG(
            CASE 
              WHEN o.actual_delivery_time IS NOT NULL AND o.estimated_delivery_time IS NOT NULL
              THEN EXTRACT(EPOCH FROM (o.actual_delivery_time - o.estimated_delivery_time)) / 60
              ELSE NULL 
            END
          ) as avg_delay_minutes
        FROM drivers d
        LEFT JOIN orders o ON d.id = o.driver_id 
          AND o.status = 'delivered'
          AND o.created_at BETWEEN $1 AND $2
        WHERE d.company_id = $3
        GROUP BY d.id, d.name
        ORDER BY total_deliveries DESC
      `, [dateRange.start, dateRange.end, companyId]),
      
      pgClient.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as orders_count,
          COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_count
        FROM orders 
        WHERE company_id = $1 
        AND created_at BETWEEN $2 AND $3
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [companyId, dateRange.start, dateRange.end]),
      
      pgClient.query(`
        SELECT 
          status,
          COUNT(*) as count,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
        FROM orders 
        WHERE company_id = $1 
        AND created_at BETWEEN $2 AND $3
        GROUP BY status
        ORDER BY count DESC
      `, [companyId, dateRange.start, dateRange.end])
    ]);

    const analytics = {
      companyId,
      dateRange,
      summary: {
        totalOrders: parseInt(totalOrdersResult.rows[0].total_orders),
        completedOrders: parseInt(completedOrdersResult.rows[0].completed_orders),
        completionRate: totalOrdersResult.rows[0].total_orders > 0 
          ? (completedOrdersResult.rows[0].completed_orders / totalOrdersResult.rows[0].total_orders * 100).toFixed(2)
          : 0,
        averageDelayMinutes: parseFloat(averageDeliveryTimeResult.rows[0].avg_delay_minutes || 0).toFixed(2)
      },
      driverPerformance: driverPerformanceResult.rows.map(driver => ({
        ...driver,
        totalDeliveries: parseInt(driver.total_deliveries),
        avgDelayMinutes: parseFloat(driver.avg_delay_minutes || 0).toFixed(2)
      })),
      dailyStats: dailyStatsResult.rows.map(day => ({
        date: day.date,
        ordersCount: parseInt(day.orders_count),
        deliveredCount: parseInt(day.delivered_count)
      })),
      statusBreakdown: statusBreakdownResult.rows.map(status => ({
        status: status.status,
        count: parseInt(status.count),
        percentage: parseFloat(status.percentage)
      }))
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
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { startDate, endDate, period } = value;
    const dateRange = getDateRange(period, startDate, endDate);
    
    const cacheKey = `analytics:global:${JSON.stringify(dateRange)}`;
    const cached = await getCachedAnalytics(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const [
      totalOrdersResult,
      totalUsersResult,
      totalCompaniesResult,
      totalDriversResult,
      companyStatsResult,
      orderTrendsResult
    ] = await Promise.all([
      pgClient.query(`
        SELECT COUNT(*) as total_orders
        FROM orders 
        WHERE created_at BETWEEN $1 AND $2
      `, [dateRange.start, dateRange.end]),
      
      pgClient.query(`
        SELECT COUNT(*) as total_users
        FROM users 
        WHERE created_at BETWEEN $1 AND $2
      `, [dateRange.start, dateRange.end]),
      
      pgClient.query(`
        SELECT COUNT(*) as total_companies
        FROM companies
      `),
      
      pgClient.query(`
        SELECT COUNT(*) as total_drivers
        FROM drivers
      `),
      
      pgClient.query(`
        SELECT 
          c.id,
          c.name,
          COUNT(o.id) as orders_count,
          COUNT(CASE WHEN o.status = 'delivered' THEN 1 END) as delivered_count
        FROM companies c
        LEFT JOIN orders o ON c.id = o.company_id 
          AND o.created_at BETWEEN $1 AND $2
        GROUP BY c.id, c.name
        ORDER BY orders_count DESC
        LIMIT 10
      `, [dateRange.start, dateRange.end]),
      
      pgClient.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as orders_count
        FROM orders 
        WHERE created_at BETWEEN $1 AND $2
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [dateRange.start, dateRange.end])
    ]);

    const analytics = {
      dateRange,
      summary: {
        totalOrders: parseInt(totalOrdersResult.rows[0].total_orders),
        totalUsers: parseInt(totalUsersResult.rows[0].total_users),
        totalCompanies: parseInt(totalCompaniesResult.rows[0].total_companies),
        totalDrivers: parseInt(totalDriversResult.rows[0].total_drivers)
      },
      topCompanies: companyStatsResult.rows.map(company => ({
        ...company,
        ordersCount: parseInt(company.orders_count),
        deliveredCount: parseInt(company.delivered_count)
      })),
      orderTrends: orderTrendsResult.rows.map(trend => ({
        date: trend.date,
        ordersCount: parseInt(trend.orders_count)
      }))
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
    
    let query = 'SELECT company_id FROM drivers WHERE id = $1';
    const driverResult = await pgClient.query(query, [driverId]);
    
    if (driverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const driverCompanyId = driverResult.rows[0].company_id;
    
    if (req.user.role === 'company' && req.user.companyId !== driverCompanyId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (req.user.role === 'driver') {
      const userDriverResult = await pgClient.query(
        'SELECT id FROM drivers WHERE user_id = $1 AND id = $2',
        [req.user.id, driverId]
      );
      if (userDriverResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const { error, value } = dateRangeSchema.validate(req.query);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { startDate, endDate, period } = value;
    const dateRange = getDateRange(period, startDate, endDate);
    
    const cacheKey = `analytics:driver:${driverId}:${JSON.stringify(dateRange)}`;
    const cached = await getCachedAnalytics(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const [
      driverStatsResult,
      deliveryTimesResult,
      performanceResult
    ] = await Promise.all([
      pgClient.query(`
        SELECT 
          COUNT(*) as total_deliveries,
          COUNT(CASE WHEN status = 'delivered' THEN 1 END) as completed_deliveries,
          AVG(
            CASE 
              WHEN actual_delivery_time IS NOT NULL AND estimated_delivery_time IS NOT NULL
              THEN EXTRACT(EPOCH FROM (actual_delivery_time - estimated_delivery_time)) / 60
              ELSE NULL 
            END
          ) as avg_delay_minutes
        FROM orders 
        WHERE driver_id = $1 
        AND created_at BETWEEN $2 AND $3
      `, [driverId, dateRange.start, dateRange.end]),
      
      pgClient.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as deliveries_count
        FROM orders 
        WHERE driver_id = $1 
        AND status = 'delivered'
        AND created_at BETWEEN $2 AND $3
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [driverId, dateRange.start, dateRange.end]),
      
      pgClient.query(`
        SELECT 
          d.*,
          u.email
        FROM drivers d
        JOIN users u ON d.user_id = u.id
        WHERE d.id = $1
      `, [driverId])
    ]);

    const analytics = {
      driverId,
      dateRange,
      driver: performanceResult.rows[0],
      performance: {
        totalDeliveries: parseInt(driverStatsResult.rows[0].total_deliveries),
        completedDeliveries: parseInt(driverStatsResult.rows[0].completed_deliveries),
        completionRate: driverStatsResult.rows[0].total_deliveries > 0 
          ? (driverStatsResult.rows[0].completed_deliveries / driverStatsResult.rows[0].total_deliveries * 100).toFixed(2)
          : 0,
        averageDelayMinutes: parseFloat(driverStatsResult.rows[0].avg_delay_minutes || 0).toFixed(2)
      },
      dailyDeliveries: deliveryTimesResult.rows.map(day => ({
        date: day.date,
        deliveriesCount: parseInt(day.deliveries_count)
      }))
    };

    await cacheAnalytics(cacheKey, analytics);
    res.json(analytics);
  } catch (error) {
    logger.error('Driver analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'analytics-service' });
});

const startServer = async () => {
  try {
    await pgClient.connect();
    await redisClient.connect();
    app.listen(PORT, () => {
      logger.info(`Analytics service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
