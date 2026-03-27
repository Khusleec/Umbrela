const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const PathSecurity = require('./utils/pathSecurity');

// Initialize path security
const pathSecurity = new PathSecurity(__dirname);

// Create logs directories for all services
const services = ['auth', 'orders', 'drivers', 'analytics', 'notifications', 'gateway'];
const colors = {
  auth: '\x1b[36m', // Cyan
  orders: '\x1b[32m', // Green
  drivers: '\x1b[33m', // Yellow
  analytics: '\x1b[35m', // Magenta
  notifications: '\x1b[34m', // Blue
  gateway: '\x1b[31m', // Red
  reset: '\x1b[0m'  // Reset
};

services.forEach(serviceName => {
  if (!pathSecurity.isValidService(serviceName)) {
    console.error(`❌ Invalid service name: ${serviceName}`);
    return;
  }
  
  const servicePath = pathSecurity.getServicePath(serviceName);
  if (servicePath) {
    const logDir = path.join(servicePath, 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      console.log(`Created logs directory for ${serviceName} service`);
    }
  }
});

console.log('🚀 Starting Delivery Tracking System Services (without database)...\n');

// Create .env file with mock database settings
const envPath = pathSecurity.resolvePath('.env');
if (!envPath) {
  console.error('❌ Invalid .env path');
  process.exit(1);
}

const envContent = `
# Database Configuration (using mock for demo)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=delivery_tracking
DB_USER=postgres
DB_PASSWORD=password

# Redis Configuration (optional for demo)
REDIS_HOST=localhost
REDIS_PORT=6379

# Service Ports
GATEWAY_PORT=3000
AUTH_SERVICE_PORT=3001
ORDER_SERVICE_PORT=3002
DRIVER_SERVICE_PORT=3003
ANALYTICS_SERVICE_PORT=3004
NOTIFICATION_SERVICE_PORT=3005

# Service URLs (for inter-service communication)
AUTH_SERVICE_URL=http://localhost:3001
ORDER_SERVICE_URL=http://localhost:3002
DRIVER_SERVICE_URL=http://localhost:3003
ANALYTICS_SERVICE_URL=http://localhost:3004
NOTIFICATION_SERVICE_URL=http://localhost:3005

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Twilio Configuration (for SMS notifications)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# SendGrid Configuration (for email notifications)
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=noreply@delivery.com

# Logging
LOG_LEVEL=info
`;

fs.writeFileSync(envPath, envContent);

// Start services
const processes = [];

services.forEach((serviceName, index) => {
  setTimeout(() => {
    const servicePath = pathSecurity.getServicePath(serviceName);
    if (!servicePath) {
      console.error(`❌ Invalid service path for ${serviceName}`);
      return;
    }
    
    const color = colors[serviceName];
    
    console.log(`Starting ${serviceName} service...`);
    
    const child = spawn('node', ['src/index.js'], {
      cwd: servicePath,
      stdio: 'pipe',
      shell: true,
      env: { ...process.env, NODE_ENV: 'demo' }
    });

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`${color}[${service.toUpperCase()}]${colors.reset} ${line}`);
        }
      });
    });

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`${color}[${service.toUpperCase()}]${colors.reset} \x1b[31m${line}\x1b[0m`);
        }
      });
    });

    child.on('close', (code) => {
      console.log(`${color}[${service.toUpperCase()}]${colors.reset} Process exited with code ${code}`);
    });

    child.on('error', (error) => {
      console.log(`${color}[${service.toUpperCase()}]${colors.reset} \x1b[31mError: ${error.message}\x1b[0m`);
    });

    processes.push({ service, child });
  }, index * 2000); // Start services with 2-second delay
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down all services...');
  
  processes.forEach(({ service, child }) => {
    console.log(`Stopping ${service} service...`);
    child.kill('SIGTERM');
  });
  
  setTimeout(() => {
    console.log('✅ All services stopped');
    process.exit(0);
  }, 5000);
});

setTimeout(() => {
  console.log('\n📊 Services Status:');
  console.log('🔵 Auth Service: http://localhost:3001');
  console.log('🔴 API Gateway: http://localhost:3000');
  console.log('\n📚 API Documentation: http://localhost:3000/docs');
  console.log('⏹️  Press Ctrl+C to stop all services');
  console.log('\n⚠️  Note: Running in demo mode without database');
}, 5000);
