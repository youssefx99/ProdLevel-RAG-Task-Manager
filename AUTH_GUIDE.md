# Authentication Implementation Guide

## ✅ Implementation Complete

### 📁 Auth Module Structure

```
src/auth/
├── auth.module.ts           # Main auth module
├── auth.service.ts          # Auth business logic
├── auth.controller.ts       # Auth endpoints
├── dto/
│   ├── login.dto.ts        # Login payload validation
│   └── register.dto.ts     # Registration payload validation
├── strategies/
│   └── jwt.strategy.ts     # JWT token validation
├── guards/
│   └── jwt-auth.guard.ts   # Route protection guard
└── decorators/
    ├── current-user.decorator.ts  # Get logged-in user
    └── public.decorator.ts        # Mark routes as public
```

---

## 🔐 Authentication Endpoints

### 1. **Register** - `POST /auth/register`

Creates new user and returns JWT token.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe",
  "role": "member" // optional: "admin" | "member"
}
```

**Response:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "member"
  }
}
```

---

### 2. **Login** - `POST /auth/login`

Authenticates user and returns JWT token.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "member"
  }
}
```

---

### 3. **Get Profile** - `GET /auth/profile`

Returns current authenticated user's profile.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "member",
  "createdAt": "2025-12-11T10:00:00.000Z",
  "updatedAt": "2025-12-11T10:00:00.000Z"
}
```

---

## 🛡️ Protecting Routes

### Using Guards on Controllers/Methods

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';

@Controller('tasks')
@UseGuards(JwtAuthGuard) // Protect entire controller
export class TasksController {
  @Get()
  findAll(@CurrentUser() user: User) {
    // user is automatically injected from JWT
    console.log('User ID:', user.id);
    return this.tasksService.findAll();
  }
}
```

### Accessing Current User

```typescript
@Get('my-tasks')
@UseGuards(JwtAuthGuard)
findMyTasks(@CurrentUser() user: User) {
  return this.tasksService.findByUserId(user.id);
}
```

---

## 🔧 How It Works

### 1. **Registration Flow**

- User sends email, password, name
- Password is hashed with bcrypt (10 rounds)
- User is saved to database
- JWT token is generated and returned

### 2. **Login Flow**

- User sends email and password
- System finds user by email
- Password is compared with bcrypt
- If valid, JWT token is generated and returned

### 3. **Protected Route Flow**

- Client sends request with `Authorization: Bearer <token>` header
- JwtAuthGuard intercepts request
- JwtStrategy validates token
- If valid, user is loaded from database
- User object is attached to request
- Controller receives user via @CurrentUser() decorator

---

## 🔑 JWT Token Structure

**Payload:**

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "member",
  "iat": 1702291200,
  "exp": 1702896000
}
```

**Configuration:**

- Secret: `JWT_SECRET` from .env
- Expiration: `JWT_EXPIRES_IN` from .env (default: 7d)

---

## 📝 Environment Variables

Add to your `.env` file:

```env
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d
```

---

## 🧪 Testing with Postman/Insomnia

### 1. Register a User

```
POST http://localhost:3000/auth/register
Content-Type: application/json

{
  "email": "admin@test.com",
  "password": "admin123",
  "name": "Admin User",
  "role": "admin"
}
```

### 2. Copy the `access_token` from response

### 3. Use Token in Protected Routes

```
GET http://localhost:3000/auth/profile
Authorization: Bearer <paste-your-token-here>
```

### 4. Test Protected Endpoints

```
GET http://localhost:3000/tasks
Authorization: Bearer <paste-your-token-here>
```

---

## 🚀 Next Steps

### 1. Protect All Routes (Recommended)

Add `@UseGuards(JwtAuthGuard)` to:

- TeamsController
- ProjectsController
- TasksController
- UsersController (except registration if needed)

### 2. Add Role-Based Authorization

Create a `RolesGuard` to check user roles:

```typescript
@Post()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
create(@Body() dto: CreateTeamDto) {
  // Only admins can create teams
}
```

### 3. Add Refresh Tokens

Implement refresh token flow for better security.

### 4. Add Password Reset

Implement forgot password / reset password flow.

### 5. Add Email Verification

Send verification email on registration.

---

## ⚠️ Security Best Practices

✅ **Already Implemented:**

- Passwords hashed with bcrypt
- Password excluded from queries by default
- JWT tokens with expiration
- Secure token validation

🔜 **Recommended:**

- Use strong JWT secret in production
- Enable HTTPS in production
- Add rate limiting on auth endpoints
- Add CORS configuration
- Add refresh token rotation
- Add account lockout after failed attempts

---

## 🐛 Common Issues

### "Unauthorized" Error

- Check if token is included in Authorization header
- Verify token format: `Bearer <token>`
- Check if token is expired
- Verify JWT_SECRET matches

### "User not found"

- Token is valid but user was deleted
- Check database connection

### "Invalid credentials"

- Wrong email or password
- Check if user exists in database
