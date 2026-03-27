const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const redis = require('redis');
const Joi = require('joi');
const winston = require('winston');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');
const axios = require('axios');

dotenv.config();

const app = express();
const PORT = process.env.NOTIFICATION_SERVICE_PORT || 3005;

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

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

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

const sendSmsSchema = Joi.object({
  to: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
  message: Joi.string().max(1600).required(),
  orderId: Joi.number().optional(),
});

const sendEmailSchema = Joi.object({
  to: Joi.string().email().required(),
  subject: Joi.string().max(200).required(),
  content: Joi.string().required(),
  template: Joi.string().optional(),
  orderId: Joi.number().optional(),
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

const createNotificationRecord = async (userId, orderId, type, recipient, subject, content) => {
  try {
    const [result] = await pool.execute(
      `INSERT INTO notifications (user_id, order_id, type, recipient, subject, content) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, orderId, type, recipient, subject, content]
    );
    return result.insertId;
  } catch (error) {
    logger.error('Failed to create notification record:', error);
    return null;
  }
};

const updateNotificationStatus = async (notificationId, status, errorMsg = null) => {
  try {
    await pool.execute(
      `UPDATE notifications SET status = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, notificationId]
    );
    if (errorMsg) {
      await pool.execute(
        `UPDATE notifications SET content = CONCAT(content, ' | ERROR: ', ?) WHERE id = ?`,
        [errorMsg, notificationId]
      );
    }
  } catch (e) {
    logger.error('Failed to update notification status:', e);
  }
};

const sendSMS = async (to, message, userId = null, orderId = null) => {
  if (!twilioClient) throw new Error('Twilio not configured');
  const notificationId = await createNotificationRecord(userId, orderId, 'sms', to, null, message);
  const messageResult = await twilioClient.messages.create({ body: message, from: process.env.TWILIO_PHONE_NUMBER, to });
  await updateNotificationStatus(notificationId, 'sent');
  logger.info(`SMS sent to ${to}: ${messageResult.sid}`);
  return { success: true, sid: messageResult.sid };
};

const sendEmail = async (to, subject, content, userId = null, orderId = null, template = null) => {
  if (!process.env.SENDGRID_API_KEY) throw new Error('SendGrid not configured');
  const notificationId = await createNotificationRecord(userId, orderId, 'email', to, subject, content);
  const msg = { to, from: process.env.SENDGRID_FROM_EMAIL || 'noreply@delivery.com', subject, text: content, html: template || content };
  const response = await sgMail.send(msg);
  await updateNotificationStatus(notificationId, 'sent');
  logger.info(`Email sent to ${to}`);
  return { success: true, response };
};

app.post('/notify/sms', authenticateToken, authorize(['admin', 'company']), async (req, res) => {
  try {
    const { error, value } = sendSmsSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const result = await sendSMS(value.to, value.message, req.user.id, value.orderId);
    res.json({ message: 'SMS sent successfully', ...result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send SMS', details: error.message });
  }
});

app.post('/notify/email', authenticateToken, authorize(['admin', 'company']), async (req, res) => {
  try {
    const { error, value } = sendEmailSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const result = await sendEmail(value.to, value.subject, value.content, req.user.id, value.orderId, value.template);
    res.json({ message: 'Email sent successfully', ...result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
});

app.post('/notify/order-created', async (req, res) => {
  try {
    const { orderId, userId, companyId } = req.body;

    const [rows] = await pool.execute(
      `SELECT o.*, u.email, u.name as user_name, c.name as company_name
       FROM orders o JOIN users u ON o.user_id = u.id JOIN companies c ON o.company_id = c.id
       WHERE o.id = ?`,
      [orderId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });

    const order = rows[0];
    const emailContent = `Dear ${order.user_name},\n\nYour order #${order.id} has been created successfully!\n\nPickup: ${order.pickup_address}\nDelivery: ${order.delivery_address}\nCompany: ${order.company_name}\nEstimated Delivery: ${order.estimated_delivery_time}\n\nThank you!`;

    try { await sendEmail(order.email, `Order #${order.id} Created`, emailContent, userId, orderId); } catch (e) { logger.error('Email error:', e); }

    res.json({ message: 'Order creation notifications processed' });
  } catch (error) {
    logger.error('Order created notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/notify/status-update', async (req, res) => {
  try {
    const { orderId, status, userId } = req.body;

    const [rows] = await pool.execute(
      `SELECT o.*, u.email, u.name as user_name, u.phone FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?`,
      [orderId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });

    const order = rows[0];
    const statusMessages = {
      assigned: 'Your order has been assigned to a driver!',
      picked_up: 'Your order has been picked up!',
      on_the_way: 'Your driver is on the way!',
      delivered: 'Your order has been delivered!',
      cancelled: 'Your order has been cancelled.'
    };

    const message = statusMessages[status] || `Order status updated to: ${status}`;
    const emailContent = `Dear ${order.user_name},\n\n${message}\n\nOrder #${order.id}\nPickup: ${order.pickup_address}\nDelivery: ${order.delivery_address}\nStatus: ${status}\n\nThank you!`;

    try { await sendEmail(order.email, `Order #${order.id} Status Update`, emailContent, userId, orderId); } catch (e) { logger.error('Email error:', e); }

    if (order.phone && ['picked_up', 'on_the_way', 'delivered'].includes(status)) {
      try { await sendSMS(order.phone, `Delivery Update: ${message} Order #${order.id}`, userId, orderId); } catch (e) { logger.error('SMS error:', e); }
    }

    res.json({ message: 'Status update notifications processed' });
  } catch (error) {
    logger.error('Status update notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/notifications', authenticateToken, async (req, res) => {
  try {
    let query = 'SELECT * FROM notifications WHERE 1=1';
    const params = [];

    if (req.user.role === 'user') { query += ' AND user_id = ?'; params.push(req.user.id); }
    else if (req.user.role === 'company') { query += ' AND user_id IN (SELECT id FROM users WHERE company_id = ?)'; params.push(req.user.companyId); }

    if (req.query.type) { query += ' AND type = ?'; params.push(req.query.type); }
    if (req.query.status) { query += ' AND status = ?'; params.push(req.query.status); }

    query += ' ORDER BY created_at DESC';
    if (req.query.limit) { query += ' LIMIT ?'; params.push(parseInt(req.query.limit)); }

    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'notification-service' }));

const startServer = async () => {
  try {
    await redisClient.connect();
    const conn = await pool.getConnection();
    conn.release();
    app.listen(PORT, () => logger.info(`Notification service running on port ${PORT}`));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
module.exports = app;
