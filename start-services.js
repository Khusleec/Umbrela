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

console.log('🚀 Starting Delivery Tracking System Services...\n');

// Create logs directories
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

// Start all services
const processes = [];

services.forEach(serviceName => {
  if (!pathSecurity.isValidService(serviceName)) {
    console.error(`❌ Invalid service name: ${serviceName}`);
    return;
  }
  
  const servicePath = pathSecurity.getServicePath(serviceName);
  if (!servicePath) {
    console.error(`❌ Invalid service path for ${serviceName}`);
    return;
  }
  
  const color = colors[serviceName];
  
  const child = spawn('npm', ['start'], {
    cwd: servicePath,
    stdio: 'pipe',
    shell: true
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

console.log('\n📊 Services Status:');
console.log('🔵 Auth Service: http://localhost:3001');
console.log('🟢 Order Service: http://localhost:3002');
console.log('🟡 Driver Service: http://localhost:3003');
console.log('🟣 Analytics Service: http://localhost:3004');
console.log('🔵 Notification Service: http://localhost:3005');
console.log('🔴 API Gateway: http://localhost:3000');
console.log('\n📚 API Documentation: http://localhost:3000/docs');
console.log('⏹️  Press Ctrl+C to stop all services\n');

// Keep the process alive
setInterval(() => {
  const alive = processes.filter(p => p.child && !p.child.killed).length;
  if (alive === 0) {
    console.log('❌ All services have stopped');
    process.exit(1);
  }
}, 5000);
