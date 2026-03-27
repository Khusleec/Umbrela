const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Delivery Tracking System - Demo Mode\n');

// Create demo .env without database
const envContent = `
# Demo Mode - No Database Required
NODE_ENV=demo
LOG_LEVEL=info

# Service Ports
GATEWAY_PORT=3000
AUTH_SERVICE_PORT=3001
ORDER_SERVICE_PORT=3002
DRIVER_SERVICE_PORT=3003
ANALYTICS_SERVICE_PORT=3004
NOTIFICATION_SERVICE_PORT=3005

# Service URLs
AUTH_SERVICE_URL=http://localhost:3001
ORDER_SERVICE_URL=http://localhost:3002
DRIVER_SERVICE_URL=http://localhost:3003
ANALYTICS_SERVICE_URL=http://localhost:3004
NOTIFICATION_SERVICE_URL=http://localhost:3005

# JWT Configuration
JWT_SECRET=demo-secret-key-for-testing

# Logging
LOG_LEVEL=info
`;

fs.writeFileSync(path.join(__dirname, '.env'), envContent);

// Create logs directories
const services = ['auth', 'gateway'];
const colors = {
  auth: '\x1b[36m', // Cyan
  gateway: '\x1b[31m', // Red
  reset: '\x1b[0m'
};

services.forEach(service => {
  const logDir = path.join(__dirname, 'services', service, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
});

console.log('📦 Starting Auth and Gateway services...\n');

// Start services
const processes = [];

services.forEach((service, index) => {
  setTimeout(() => {
    const servicePath = path.join(__dirname, 'services', service);
    const color = colors[service];
    
    console.log(`Starting ${service} service...`);
    
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
  }, index * 2000); // 2 second delay
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down services...');
  
  processes.forEach(({ service, child }) => {
    console.log(`Stopping ${service} service...`);
    child.kill('SIGTERM');
  });
  
  setTimeout(() => {
    console.log('✅ All services stopped');
    process.exit(0);
  }, 5000);
});

// Show status
setTimeout(() => {
  console.log('\n🎉 Demo Services Running!');
  console.log('\n📊 Available Endpoints:');
  console.log('🔵 Auth Service: http://localhost:3001/health');
  console.log('🔴 API Gateway: http://localhost:3000/health');
  console.log('📚 API Documentation: http://localhost:3000/docs');
  console.log('\n🧪 Test Commands:');
  console.log('curl http://localhost:3000/health');
  console.log('curl http://localhost:3001/health');
  console.log('\n⏹️  Press Ctrl+C to stop all services');
  console.log('\n💡 Demo Mode: No database required for basic testing');
}, 6000);
