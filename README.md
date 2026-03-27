# Real-Time Delivery Tracking System

A comprehensive microservices-based delivery tracking system with role-based access control, real-time GPS tracking, and analytics.

## 🚀 Features

### Core Features
- **Role-Based Access Control**: Admin, Company, Driver, and User roles
- **Real-Time Tracking**: WebSocket-based GPS location updates
- **Order Management**: Create, assign, and track deliveries
- **Notifications**: SMS and email notifications via Twilio/SendGrid
- **Analytics**: Comprehensive reporting and insights
- **Microservices Architecture**: Scalable and maintainable service design

### User Roles
- **Admin**: Manage companies, drivers, users, global analytics, audit logs
- **Company**: Manage orders, assign drivers, track deliveries, view reports
- **Driver**: Accept/reject orders, update status, share GPS location
- **User**: Place orders, track deliveries live, receive notifications, view history

## 🏗️ Architecture

### Services
1. **API Gateway** (Port 3000) - Service orchestration and routing
2. **Auth Service** (Port 3001) - JWT-based authentication and authorization
3. **Order Service** (Port 3002) - Order management and real-time updates
4. **Driver Service** (Port 3003) - GPS tracking and driver status
5. **Analytics Service** (Port 3004) - Reporting and insights
6. **Notification Service** (Port 3005) - SMS/Email notifications

### Infrastructure
- **Database**: PostgreSQL for transactional data
- **Cache**: Redis for real-time lookups and caching
- **Load Balancer**: Nginx for traffic distribution
- **Monitoring**: Prometheus + Grafana
- **Containerization**: Docker + Kubernetes

## 📋 Prerequisites

- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 15+
- Redis 7+
- Kubernetes (for production deployment)

## 🚀 Quick Start

### Using Docker Compose (Recommended)

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd delivery-tracking-system
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start all services**
   ```bash
   docker-compose up -d
   ```

4. **Run database migrations**
   ```bash
   npm run migrate
   ```

5. **Seed the database with sample data**
   ```bash
   npm run seed
   ```

6. **Access the system**
   - API Gateway: http://localhost:3000
   - API Documentation: http://localhost:3000/docs
   - Grafana Dashboard: http://localhost:3001 (admin/admin)

### Manual Setup

1. **Install dependencies**
   ```bash
   npm install
   cd services/auth && npm install
   cd ../orders && npm install
   cd ../drivers && npm install
   cd ../notifications && npm install
   cd ../analytics && npm install
   cd ../../gateway && npm install
   cd ../database && npm install
   ```

2. **Set up PostgreSQL and Redis**
   ```bash
   # Start PostgreSQL and Redis services
   # Update .env file with connection details
   ```

3. **Run migrations and seeds**
   ```bash
   cd database
   npm run migrate
   npm run seed
   ```

4. **Start all services**
   ```bash
   cd ..
   npm run dev
   ```

## 📚 API Documentation

### Authentication Endpoints
- `POST /auth/login` - User login
- `POST /auth/register` - User registration
- `POST /auth/logout` - User logout
- `GET /auth/profile` - Get user profile
- `GET /auth/validate` - Validate token

### Order Endpoints
- `POST /orders` - Create new order
- `GET /orders` - List orders (filtered by role)
- `GET /orders/:id` - Get order details
- `POST /orders/:id/assign` - Assign driver to order
- `PATCH /orders/:id/status` - Update order status

### Driver Endpoints
- `GET /drivers` - List drivers (filtered by role)
- `GET /drivers/:id` - Get driver details
- `PATCH /drivers/:id/location` - Update driver location
- `PATCH /drivers/:id/status` - Update driver status
- `GET /drivers/:id/location` - Get driver location

### Analytics Endpoints
- `GET /analytics/company/:id` - Get company analytics
- `GET /analytics/global` - Get global analytics (admin only)
- `GET /analytics/driver/:id` - Get driver analytics

### Notification Endpoints
- `POST /notifications/notify/sms` - Send SMS notification
- `POST /notifications/notify/email` - Send email notification
- `GET /notifications` - List notifications (filtered by role)

## 🔄 Real-Time Updates

### WebSocket Connections
- **Orders**: `ws://localhost:3002` - Order status and assignment updates
- **Drivers**: `ws://localhost:3003` - Driver location and status updates

### Events
- `order:{orderId}` - Order specific updates
- `orders:update` - General order updates
- `driver:{driverId}` - Driver specific updates
- `drivers:update` - General driver updates
- `driver:{driverId}:location` - Driver location updates

## 📊 Monitoring

### Prometheus Metrics
- Service health status
- Response times
- Error rates
- Resource usage

### Grafana Dashboards
- System overview
- Service performance
- Database metrics
- Custom analytics

Access monitoring at:
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001

## 🚀 Deployment

### Kubernetes Deployment

1. **Build and push Docker images**
   ```bash
   # Build images for each service
   docker build -t delivery-tracking/auth-service ./services/auth
   docker build -t delivery-tracking/order-service ./services/orders
   docker build -t delivery-tracking/driver-service ./services/drivers
   docker build -t delivery-tracking/analytics-service ./services/analytics
   docker build -t delivery-tracking/notification-service ./services/notifications
   docker build -t delivery-tracking/api-gateway ./gateway
   ```

2. **Deploy to Kubernetes**
   ```bash
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/configmap.yaml
   kubectl apply -f k8s/secret.yaml
   kubectl apply -f k8s/postgres.yaml
   kubectl apply -f k8s/redis.yaml
   kubectl apply -f k8s/services.yaml
   kubectl apply -f k8s/gateway.yaml
   ```

3. **Verify deployment**
   ```bash
   kubectl get pods -n delivery-tracking
   kubectl get services -n delivery-tracking
   kubectl get ingress -n delivery-tracking
   ```

### CI/CD Pipeline

The system includes a complete CI/CD pipeline using GitHub Actions:
- Automated testing
- Docker image building
- Kubernetes deployment
- Security scanning
- Rollback capabilities

## 🔧 Configuration

### Environment Variables

Key environment variables in `.env`:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=delivery_tracking
DB_USER=postgres
DB_PASSWORD=password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-super-secret-jwt-key

# Twilio (for SMS)
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# SendGrid (for Email)
SENDGRID_API_KEY=your-sendgrid-api-key
SENDGRID_FROM_EMAIL=noreply@delivery.com
```

## 🧪 Testing

### Run Tests
```bash
# Run all tests
npm test

# Run tests for specific service
cd services/auth && npm test
cd services/orders && npm test
# ... etc
```

### Test Coverage
- Unit tests for all services
- Integration tests for API endpoints
- Database migration tests
- WebSocket connection tests

## 🔒 Security Features

- JWT-based authentication
- Role-based authorization
- Input validation and sanitization
- Rate limiting
- CORS protection
- Security headers
- SQL injection prevention
- XSS protection

## 📈 Performance

- Redis caching for frequent queries
- Database connection pooling
- Asynchronous processing
- Load balancing
- Horizontal scaling support
- Optimized database queries

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:
- Create an issue in the GitHub repository
- Check the API documentation at `/docs`
- Review the logs in the respective service directories

## 🔄 Version History

- **v1.0.0** - Initial release with all core features
- Complete microservices architecture
- Real-time tracking capabilities
- Comprehensive analytics
- Full CI/CD pipeline

---

**Built with ❤️ using Node.js, PostgreSQL, Redis, Docker, and Kubernetes**
