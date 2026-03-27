const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwt = require('jsonwebtoken');
const winston = require('winston');
const axios = require('axios');

dotenv.config();

const app = express();
const PORT = process.env.GATEWAY_PORT || 3000;

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

const services = {
  auth: {
    url: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
    path: '/auth',
    public: ['/login', '/register', '/health']
  },
  orders: {
    url: process.env.ORDER_SERVICE_URL || 'http://localhost:3002',
    path: '/orders',
    public: ['/health']
  },
  drivers: {
    url: process.env.DRIVER_SERVICE_URL || 'http://localhost:3003',
    path: '/drivers',
    public: ['/health']
  },
  analytics: {
    url: process.env.ANALYTICS_SERVICE_URL || 'http://localhost:3004',
    path: '/analytics',
    public: ['/health']
  },
  notifications: {
    url: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3005',
    path: '/notifications',
    public: ['/health']
  }
};

app.use(helmet());
app.use(cors());
app.use(express.json());

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const response = await axios.get(`${services.auth.url}/validate`, {
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

const createServiceProxy = (serviceConfig) => {
  const { url, path, public: publicPaths = [] } = serviceConfig;

  return createProxyMiddleware({
    target: url,
    changeOrigin: true,
    pathRewrite: (path, req) => {
      return path.replace(new RegExp(`^${serviceConfig.path}`), '');
    },
    onProxyReq: (proxyReq, req, res) => {
      logger.info(`${req.method} ${req.path} -> ${url}${req.path}`);
      
      if (req.user) {
        proxyReq.setHeader('X-User-ID', req.user.id);
        proxyReq.setHeader('X-User-Role', req.user.role);
        proxyReq.setHeader('X-User-Company-ID', req.user.companyId || '');
      }
    },
    onProxyRes: (proxyRes, req, res) => {
      logger.info(`${req.method} ${req.path} <- ${proxyRes.statusCode}`);
    },
    onError: (err, req, res) => {
      logger.error(`Proxy error for ${req.path}:`, err);
      res.status(502).json({ error: 'Service unavailable' });
    }
  });
};

Object.entries(services).forEach(([serviceName, serviceConfig]) => {
  const publicPaths = serviceConfig.public || [];
  
  app.use(serviceConfig.path, (req, res, next) => {
    const isPublic = publicPaths.some(publicPath => 
      req.path.startsWith(publicPath)
    );
    
    if (!isPublic && !req.user) {
      return authenticateToken(req, res, next);
    }
    
    next();
  }, createServiceProxy(serviceConfig));
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    services: Object.keys(services)
  });
});

app.get('/services/health', async (req, res) => {
  try {
    const healthChecks = await Promise.allSettled(
      Object.entries(services).map(async ([serviceName, serviceConfig]) => {
        try {
          const response = await axios.get(`${serviceConfig.url}/health`, { timeout: 5000 });
          return { [serviceName]: { status: 'healthy', response: response.data } };
        } catch (error) {
          return { [serviceName]: { status: 'unhealthy', error: error.message } };
        }
      })
    );

    const results = healthChecks.reduce((acc, result) => {
      if (result.status === 'fulfilled') {
        Object.assign(acc, result.value);
      }
      return acc;
    }, {});

    res.json(results);
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({ error: 'Failed to check service health' });
  }
});

app.get('/docs', (req, res) => {
  res.json({
    title: 'Delivery Tracking System API',
    version: '1.0.0',
    description: 'API Gateway for the delivery tracking system with role-based access',
    endpoints: {
      auth: {
        base: '/auth',
        endpoints: [
          { method: 'POST', path: '/login', description: 'User login' },
          { method: 'POST', path: '/register', description: 'User registration' },
          { method: 'POST', path: '/logout', description: 'User logout' },
          { method: 'GET', path: '/profile', description: 'Get user profile' },
          { method: 'GET', path: '/validate', description: 'Validate token' }
        ]
      },
      orders: {
        base: '/orders',
        endpoints: [
          { method: 'POST', path: '/', description: 'Create new order' },
          { method: 'GET', path: '/', description: 'List orders (filtered by role)' },
          { method: 'GET', path: '/:id', description: 'Get order details' },
          { method: 'POST', path: '/:id/assign', description: 'Assign driver to order' },
          { method: 'PATCH', path: '/:id/status', description: 'Update order status' }
        ]
      },
      drivers: {
        base: '/drivers',
        endpoints: [
          { method: 'GET', path: '/', description: 'List drivers (filtered by role)' },
          { method: 'GET', path: '/:id', description: 'Get driver details' },
          { method: 'PATCH', path: '/:id/location', description: 'Update driver location' },
          { method: 'PATCH', path: '/:id/status', description: 'Update driver status' },
          { method: 'GET', path: '/:id/location', description: 'Get driver location' },
          { method: 'GET', path: '/company/:companyId/available', description: 'Get available drivers for company' }
        ]
      },
      analytics: {
        base: '/analytics',
        endpoints: [
          { method: 'GET', path: '/company/:id', description: 'Get company analytics' },
          { method: 'GET', path: '/global', description: 'Get global analytics (admin only)' },
          { method: 'GET', path: '/driver/:id', description: 'Get driver analytics' }
        ]
      },
      notifications: {
        base: '/notifications',
        endpoints: [
          { method: 'POST', path: '/notify/sms', description: 'Send SMS notification' },
          { method: 'POST', path: '/notify/email', description: 'Send email notification' },
          { method: 'GET', path: '/', description: 'List notifications (filtered by role)' }
        ]
      }
    },
    websocket: {
      description: 'Real-time updates available via WebSocket connections',
      connections: {
        orders: 'ws://localhost:3002',
        drivers: 'ws://localhost:3003',
        events: [
          'order:{orderId} - Order specific updates',
          'orders:update - General order updates',
          'driver:{driverId} - Driver specific updates',
          'drivers:update - General driver updates',
          'driver:{driverId}:location - Driver location updates'
        ]
      }
    },
    authentication: {
      type: 'JWT Bearer Token',
      header: 'Authorization: Bearer <token>',
      roles: ['admin', 'company', 'driver', 'user']
    }
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  logger.error('Gateway error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const startServer = () => {
  app.listen(PORT, () => {
    logger.info(`API Gateway running on port ${PORT}`);
    logger.info('Available services:', Object.keys(services));
    logger.info('API Documentation: http://localhost:3000/docs');
    logger.info('Health Check: http://localhost:3000/health');
  });
};

startServer();

module.exports = app;
