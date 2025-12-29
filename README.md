# Task Manager Backend

A production-grade Task Management API built with NestJS, featuring an advanced AI-powered assistant using Retrieval-Augmented Generation (RAG) for intelligent task, team, project, and user management through natural language conversations.

## Overview

This backend service provides a comprehensive RESTful API for managing tasks, teams, projects, and users, enhanced with an AI chat interface that allows users to interact with their data using natural language queries. The system leverages vector search, semantic understanding, and hybrid retrieval to deliver accurate, context-aware responses.

## Key Features

### Core Functionality

- **Task Management**: Create, update, delete, and track tasks with status, priority, and deadline management
- **Team Management**: Organize users into teams with role-based access control
- **Project Management**: Handle project lifecycles with team assignments and task associations
- **User Management**: Complete user authentication, authorization, and profile management

### AI-Powered Chat Assistant

- **Natural Language Processing**: Interact with your data using conversational queries
- **Hybrid Search**: Combines vector similarity and keyword matching for precise results
- **Context-Aware Responses**: Generates grounded answers with citations from your actual data
- **Intent Classification**: Automatically understands whether you want to search, create, update, or delete
- **Entity Recognition**: Identifies task, team, project, or user references in your queries
- **Smart Filtering**: Extracts filters like "overdue", "urgent", "in progress" from natural language

### Technical Architecture

- **Vector Store**: Qdrant for semantic search and similarity matching
- **Embeddings**: Ollama-powered text embeddings for document indexing
- **LLM Integration**: Local Ollama models for response generation
- **Caching Layer**: Redis for optimized performance and reduced latency
- **Database**: MySQL for structured data persistence
- **Real-time Updates**: SSE (Server-Sent Events) for streaming AI responses

## Tech Stack

- **Framework**: NestJS (Node.js/TypeScript)
- **Database**: MySQL 8.0 with TypeORM
- **Vector Database**: Qdrant
- **Cache**: Redis
- **AI/ML**: Ollama (Local LLM & Embeddings)
- **Authentication**: JWT with Passport
- **API Documentation**: Swagger/OpenAPI
- **Container Orchestration**: Docker Compose

## Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose
- Ollama installed locally with models:
  - `nomic-embed-text` for embeddings
  - `llama3.2:3b` or similar for chat responses

## Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd task-manager-backend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:

   ```env
   # Database
   DB_HOST=localhost
   DB_PORT=3306
   DB_USERNAME=root
   DB_PASSWORD=your_password
   DB_NAME=task_management

   # Redis
   REDIS_HOST=localhost
   REDIS_PORT=6379

   # Qdrant
   QDRANT_HOST=localhost
   QDRANT_PORT=6333

   # JWT
   JWT_SECRET=your_jwt_secret
   JWT_EXPIRES_IN=1d

   # Ollama
   OLLAMA_BASE_URL=http://localhost:11434
   ```

4. **Start infrastructure services**

   ```bash
   docker-compose up -d
   ```

5. **Run database migrations and seed data**

   ```bash
   npm run seed
   ```

6. **Index data for AI search** (required for AI features)
   ```bash
   npm run index:all
   ```

## Running the Application

```bash
# Development mode with hot-reload
npm run start:dev

# Production mode
npm run start:prod

# Debug mode
npm run start:debug
```

The API will be available at `http://localhost:3000`

## Available Scripts

```bash
# Development
npm run start:dev          # Start in watch mode
npm run seed               # Seed database with sample data

# AI/RAG Operations
npm run index:all          # Index all entities for AI search
npm run index:reset        # Reset vector store
npm run index:system       # Index system documentation
npm run reindex:all        # Full reindex of all data
npm run test:chat          # Test AI chat functionality

# Testing
npm run test               # Run unit tests
npm run test:e2e           # Run end-to-end tests
npm run test:cov           # Generate coverage report

# Build
npm run build              # Build for production
npm run lint               # Lint and fix code
```

## API Documentation

Once the server is running, access the interactive Swagger documentation at:

```
http://localhost:3000/api
```

### Main Endpoints

- **Auth**: `/auth/register`, `/auth/login`
- **Tasks**: `/tasks` (CRUD operations)
- **Teams**: `/teams` (CRUD operations)
- **Projects**: `/projects` (CRUD operations)
- **Users**: `/users` (CRUD operations)
- **AI Chat**: `/task-manager/chat` (Natural language interface)

## AI Chat Examples

```
"Show me all overdue tasks"
"Who is on the backend team?"
"List projects for Sarah"
"What tasks are assigned to John?"
"Create a new urgent task for the API endpoint"
"Update the database migration task to completed"
```

## Project Structure

```
src/
├── ai/                      # AI/RAG implementation
│   ├── rag/                # RAG service and strategy
│   ├── embeddings/         # Text embedding service
│   ├── vector-store/       # Qdrant integration
│   ├── llm/                # Ollama LLM service
│   ├── indexing/           # Document indexing
│   └── prompts/            # AI prompt templates
├── auth/                   # Authentication & JWT
├── tasks/                  # Task management
├── teams/                  # Team management
├── projects/               # Project management
├── users/                  # User management
├── common/                 # Shared utilities
└── config/                 # Configuration files
```

## Development Notes

- The application uses TypeORM for database operations with automatic migrations
- JWT tokens are used for authentication with configurable expiration
- Vector embeddings are cached in Redis for performance
- The RAG system supports hybrid search with adjustable weights
- All AI responses include citations to source documents for transparency
