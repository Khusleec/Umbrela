const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { Pool } = require('pg');
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

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN 
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

app.use(helmet());
app.use(cors());
app.use(express.json());

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

const createNotificationRecord = async (userId, orderId, type, recipient, subject, content) => {
  try {
    const result = await pgClient.query(`
      INSERT INTO notifications (user_id, order_id, type, recipient, subject, content)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [userId, orderId, type, recipient, subject, content]);
    
    return result.rows[0].id;
  } catch (error) {
    logger.error('Failed to create notification record:', error);
    return null;
  }
};

const updateNotificationStatus = async (notificationId, status, error = null) => {
  try {
    await pgClient.query(`
      UPDATE notifications 
      SET status = $1, sent_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [status, notificationId]);

    if (error) {
      await pgClient.query(`
        UPDATE notifications 
        SET content = content || ' | ERROR: ' || $1
        WHERE id = $2
      `, [error, notificationId]);
    }
  } catch (updateError) {
    logger.error('Failed to update notification status:', updateError);
  }
};

const sendSMS = async (to, message, userId = null, orderId = null) => {
  try {
    if (!twilioClient) {
      throw new Error('Twilio not configured');
    }

    const notificationId = await createNotificationRecord(userId, orderId, 'sms', to, null, message);
    
    const messageResult = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to,
    });

    await updateNotificationStatus(notificationId, 'sent');
    
    logger.info(`SMS sent to ${to}: ${messageResult.sid}`);
    return { success: true, sid: messageResult.sid };
  } catch (error) {
    logger.error('SMS sending error:', error);
    throw error;
  }
};

const sendEmail = async (to, subject, content, userId = null, orderId = null, template = null) => {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error('SendGrid not configured');
    }

    const notificationId = await createNotificationRecord(userId, orderId, 'email', to, subject, content);
    
    const msg = {
      to: to,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@delivery.com',
      subject: subject,
      text: content,
      html: template || content,
    };

    const response = await sgMail.send(msg);
    await updateNotificationStatus(notificationId, 'sent');
    
    logger.info(`Email sent to ${to}`);
    return { success: true, response };
  } catch (error) {
    logger.error('Email sending error:', error);
    if (notificationId) {
      await updateNotificationStatus(notificationId, 'failed', error.message);
    }
    throw error;
  }
};

app.post('/notify/sms', authenticateToken, authorize(['admin', 'company']), async (req, res) => {
  try {
    const { error, value } = sendSmsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { to, message, orderId } = value;

    const result = await sendSMS(to, message, req.user.id, orderId);
    
    res.json({ message: 'SMS sent successfully', ...result });
  } catch (error) {
    logger.error('Send SMS error:', error);
    res.status(500).json({ error: 'Failed to send SMS', details: error.message });
  }
});

app.post('/notify/email', authenticateToken, authorize(['admin', 'company']), async (req, res) => {
  try {
    const { error, value } = sendEmailSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { to, subject, content, template, orderId } = value;

    const result = await sendEmail(to, subject, content, req.user.id, orderId, template);
    
    res.json({ message: 'Email sent successfully', ...result });
  } catch (error) {
    logger.error('Send email error:', error);
    res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
});

app.post('/notify/order-created', async (req, res) => {
  try {
    const { orderId, userId, companyId } = req.body;

    const orderResult = await pgClient.query(`
      SELECT o.*, u.email, u.name as user_name, c.name as company_name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN companies c ON o.company_id = c.id
      WHERE o.id = $1
    `, [orderId]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];

    const emailContent = `
      Dear ${order.user_name},

      Your order #${order.id} has been created successfully!

      Order Details:
      - Pickup: ${order.pickup_address}
      - Delivery: ${order.delivery_address}
      - Company: ${order.company_name}
      - Estimated Delivery: ${order.estimated_delivery_time}

      You will receive notifications when your order is assigned and during delivery.

      Thank you for using our delivery service!
    `;

    try {
      await sendEmail(
        order.email,
        `Order #${order.id} Created Successfully`,
        emailContent,
        userId,
        orderId
      );
    } catch (emailError) {
      logger.error('Failed to send order creation email:', emailError);
    }

    res.json({ message: 'Order creation notifications processed' });
  } catch (error) {
    logger.error('Order created notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/notify/status-update', async (req, res) => {
  try {
    const { orderId, status, userId } = req.body;

    const orderResult = await pgClient.query(`
      SELECT o.*, u.email, u.name as user_name, u.phone
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
    `, [orderId]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];

    const statusMessages = {
      assigned: 'Your order has been assigned to a driver!',
      picked_up: 'Your order has been picked up and is on the way!',
      on_the_way: 'Your driver is on the way to the delivery location!',
      delivered: 'Your order has been delivered successfully!',
      cancelled: 'Your order has been cancelled.'
    };

    const message = statusMessages[status] || `Your order status has been updated to: ${status}`;

    const emailContent = `
      Dear ${order.user_name},

      ${message}

      Order Details:
      - Order ID: #${order.id}
      - Pickup: ${order.pickup_address}
      - Delivery: ${order.delivery_address}
      - Status: ${status}
      - Updated: ${new Date().toLocaleString()}

      Track your order in real-time on our platform!

      Thank you for using our delivery service!
    `;

    try {
      await sendEmail(
        order.email,
        `Order #${order.id} Status Update`,
        emailContent,
        userId,
        orderId
      );
    } catch (emailError) {
      logger.error('Failed to send status update email:', emailError);
    }

    if (order.phone && (status === 'picked_up' || status === 'on_the_way' || status === 'delivered')) {
      try {
        await sendSMS(
          order.phone,
          `Delivery Update: ${message} Order #${order.id}`,
          userId,
          orderId
        );
      } catch (smsError) {
        logger.error('Failed to send status update SMS:', smsError);
      }
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
    let paramIndex = 1;

    if (req.user.role === 'user') {
      query += ` AND user_id = $${paramIndex}`;
      params.push(req.user.id);
      paramIndex++;
    } else if (req.user.role === 'company') {
      query += ` AND user_id IN (SELECT id FROM users WHERE company_id = $${paramIndex})`;
      params.push(req.user.companyId);
      paramIndex++;
    }

    if (req.query.type) {
      query += ` AND type = $${paramIndex}`;
      params.push(req.query.type);
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
    }

    const result = await pgClient.query(query, params);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'notification-service' });
});

const startServer = async () => {
  try {
    await pgClient.connect();
    await redisClient.connect();
    app.listen(PORT, () => {
      logger.info(`Notification service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
