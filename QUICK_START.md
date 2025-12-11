# Quick Start Guide - Task Manager API

## 🚀 Getting Started

### 1. Environment Setup

Copy the environment file:

```bash
cp .env.example .env
```

Update `.env` with your configuration:

```env
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=your_password
DB_NAME=task_manager

# Application
PORT=3000

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create MySQL Database

```sql
CREATE DATABASE task_manager;
```

### 4. Start Application

```bash
npm run start:dev
```

The application will start on `http://localhost:3000` and automatically create database tables.

---

## 📋 API Endpoints

### Authentication

| Method | Endpoint         | Description       | Auth Required |
| ------ | ---------------- | ----------------- | ------------- |
| POST   | `/auth/register` | Register new user | ❌            |
| POST   | `/auth/login`    | Login user        | ❌            |
| GET    | `/auth/profile`  | Get current user  | ✅            |

### Users

| Method | Endpoint     | Description    | Auth Required |
| ------ | ------------ | -------------- | ------------- |
| POST   | `/users`     | Create user    | ✅            |
| GET    | `/users`     | List all users | ✅            |
| GET    | `/users/:id` | Get user by ID | ✅            |
| PATCH  | `/users/:id` | Update user    | ✅            |
| DELETE | `/users/:id` | Delete user    | ✅            |

### Teams

| Method | Endpoint     | Description    | Auth Required |
| ------ | ------------ | -------------- | ------------- |
| POST   | `/teams`     | Create team    | ✅            |
| GET    | `/teams`     | List all teams | ✅            |
| GET    | `/teams/:id` | Get team by ID | ✅            |
| PATCH  | `/teams/:id` | Update team    | ✅            |
| DELETE | `/teams/:id` | Delete team    | ✅            |

### Projects

| Method | Endpoint        | Description       | Auth Required |
| ------ | --------------- | ----------------- | ------------- |
| POST   | `/projects`     | Create project    | ✅            |
| GET    | `/projects`     | List all projects | ✅            |
| GET    | `/projects/:id` | Get project by ID | ✅            |
| PATCH  | `/projects/:id` | Update project    | ✅            |
| DELETE | `/projects/:id` | Delete project    | ✅            |

### Tasks

| Method | Endpoint     | Description    | Auth Required |
| ------ | ------------ | -------------- | ------------- |
| POST   | `/tasks`     | Create task    | ✅            |
| GET    | `/tasks`     | List all tasks | ✅            |
| GET    | `/tasks/:id` | Get task by ID | ✅            |
| PATCH  | `/tasks/:id` | Update task    | ✅            |
| DELETE | `/tasks/:id` | Delete task    | ✅            |

---

## 🧪 Testing Flow

### Step 1: Register a User

```bash
POST http://localhost:3000/auth/register
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "admin123",
  "name": "Admin User",
  "role": "admin"
}
```

**Response:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "admin@example.com",
    "name": "Admin User",
    "role": "admin"
  }
}
```

### Step 2: Save the Token

Copy the `access_token` from the response.

### Step 3: Create a Team

```bash
POST http://localhost:3000/teams
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "name": "Development Team",
  "ownerId": "<user-id-from-step-1>"
}
```

### Step 4: Create a Project

```bash
POST http://localhost:3000/projects
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "name": "Task Manager App",
  "description": "Building a task management system",
  "teamId": "<team-id-from-step-3>"
}
```

### Step 5: Create a Task

```bash
POST http://localhost:3000/tasks
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "title": "Setup authentication",
  "description": "Implement JWT authentication",
  "status": "in_progress",
  "projectId": "<project-id-from-step-4>",
  "assignedTo": "<user-id-from-step-1>",
  "deadline": "2025-12-15T00:00:00.000Z"
}
```

---

## 📊 Data Models

### User

- `id` (UUID)
- `email` (unique)
- `password` (hashed)
- `name`
- `role` (admin/member)

### Team

- `id` (UUID)
- `name`
- `ownerId` → User
- Relations: owner, projects

### Project

- `id` (UUID)
- `name`
- `description`
- `teamId` → Team
- Relations: team, tasks

### Task

- `id` (UUID)
- `title`
- `description`
- `status` (todo/in_progress/done)
- `projectId` → Project
- `assignedTo` → User
- `deadline`
- Relations: project, assignee

---

## 🔐 Authentication

All endpoints except `/auth/register` and `/auth/login` require authentication.

**Add this header to protected requests:**

```
Authorization: Bearer <your-access-token>
```

**Token expires in:** 7 days (configurable in `.env`)

---

## 📝 Notes

- **Password Security**: All passwords are hashed with bcrypt
- **Auto-Sync**: Database schema is auto-synced in development mode
- **Validation**: All inputs are validated using class-validator
- **Error Handling**: Proper HTTP status codes and error messages

---

## 🐛 Troubleshooting

### Database Connection Failed

- Check MySQL is running
- Verify database credentials in `.env`
- Ensure database exists

### Unauthorized Error

- Check if token is included in Authorization header
- Verify token format: `Bearer <token>`
- Check if token is expired

### Validation Errors

- Check request body matches DTO requirements
- Ensure all required fields are provided
- Verify data types match

---

## 📚 Documentation

- [IMPLEMENTATION.md](IMPLEMENTATION.md) - Full implementation details
- [AUTH_GUIDE.md](AUTH_GUIDE.md) - Complete authentication guide

---

## 🎉 You're Ready!

Your Task Manager API is now fully functional with:
✅ JWT Authentication
✅ Complete CRUD operations
✅ User, Team, Project, Task management
✅ Password security
✅ Input validation
✅ Error handling
