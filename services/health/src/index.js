const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.HEALTH_SERVICE_PORT || 3006;

app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'health-service',
    timestamp: new Date().toISOString(),
    message: 'Backend services are running in demo mode'
  });
});

// Mock auth endpoint for testing
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  
  // Demo users
  const users = {
    'admin@delivery.com': { id: 1, name: 'System Admin', role: 'admin', companyId: null },
    'company@fastdelivery.com': { id: 2, name: 'Company Manager', role: 'company', companyId: 1 },
    'driver1@fastdelivery.com': { id: 3, name: 'John Driver', role: 'driver', companyId: 1 },
    'user1@example.com': { id: 4, name: 'Alice Customer', role: 'user', companyId: null }
  };

  if (users[email] && password === 'password123') {
    const user = users[email];
    const token = 'demo-jwt-token-' + Date.now();
    
    res.json({
      token,
      user: {
        id: user.id,
        email: email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
      },
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Mock validate token endpoint
app.get('/validate', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token && token.startsWith('demo-jwt-token-')) {
    res.json({ 
      valid: true, 
      user: {
        id: 1,
        email: 'admin@delivery.com',
        name: 'System Admin',
        role: 'admin',
        companyId: null,
      }
    });
  } else {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
});

// Mock orders endpoint
app.get('/orders', (req, res) => {
  res.json([
    {
      id: 1,
      user_id: 4,
      driver_id: 3,
      company_id: 1,
      pickup_address: '123 Pickup St, City, State',
      delivery_address: '456 Delivery Ave, Town, State',
      status: 'pending',
      created_at: new Date().toISOString(),
      estimated_delivery_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      notes: 'Handle with care'
    },
    {
      id: 2,
      user_id: 4,
      driver_id: 3,
      company_id: 1,
      pickup_address: '789 Pickup Blvd, City, State',
      delivery_address: '321 Delivery Way, Town, State',
      status: 'assigned',
      created_at: new Date().toISOString(),
      estimated_delivery_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      notes: 'Fragile package'
    }
  ]);
});

// Mock order details endpoint
app.get('/orders/:id', (req, res) => {
  const orderId = parseInt(req.params.id);
  
  const order = {
    id: orderId,
    user_id: 4,
    driver_id: 3,
    company_id: 1,
    pickup_address: '123 Pickup St, City, State',
    delivery_address: '456 Delivery Ave, Town, State',
    status: 'on_the_way',
    created_at: new Date().toISOString(),
    estimated_delivery_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    actual_delivery_time: null,
    notes: 'Handle with care'
  };
  
  res.json(order);
});

// Mock profile endpoint
app.get('/profile', (req, res) => {
  res.json({
    id: 1,
    email: 'admin@delivery.com',
    name: 'System Admin',
    role: 'admin',
    companyId: null,
    createdAt: new Date().toISOString(),
  });
});

// Mock notifications endpoint
app.get('/notifications', (req, res) => {
  res.json([
    {
      id: 1,
      user_id: 4,
      order_id: 1,
      type: 'email',
      status: 'sent',
      recipient: 'user1@example.com',
      subject: 'Order #1 Created',
      content: 'Your order has been created successfully',
      created_at: new Date().toISOString()
    }
  ]);
});

// Mock analytics endpoint
app.get('/analytics/company/1', (req, res) => {
  res.json({
    companyId: 1,
    dateRange: { start: new Date(), end: new Date() },
    summary: {
      totalOrders: 25,
      completedOrders: 20,
      completionRate: '80.00',
      averageDelayMinutes: '15.50'
    },
    driverPerformance: [
      {
        id: 3,
        name: 'John Driver',
        totalDeliveries: 20,
        avgDelayMinutes: '15.50'
      }
    ],
    dailyStats: [
      {
        date: new Date().toISOString().split('T')[0],
        ordersCount: 5,
        deliveredCount: 4
      }
    ],
    statusBreakdown: [
      { status: 'delivered', count: 20, percentage: 80.00 },
      { status: 'pending', count: 5, percentage: 20.00 }
    ]
  });
});

const startServer = () => {
  app.listen(PORT, () => {
    console.log(`Health/Mock Service running on port ${PORT}`);
    console.log(`Available endpoints:`);
    console.log(`  - GET  /health`);
    console.log(`  - POST /login`);
    console.log(`  - GET  /validate`);
    console.log(`  - GET  /orders`);
    console.log(`  - GET  /orders/:id`);
    console.log(`  - GET  /profile`);
    console.log(`  - GET  /notifications`);
    console.log(`  - GET  /analytics/company/:id`);
  });
};

startServer();

module.exports = app;
