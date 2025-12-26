import { Body, Controller, Post, Sse, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { RagService } from './rag/rag.service';
import { ChatRequestDto, ChatResponseDto } from './dto/chat.dto';

@ApiTags('AI Chat')
@Controller('task-manager')
export class AiController {
  constructor(private readonly ragService: RagService) {}

  @Post('chat')
  @ApiOperation({
    summary: 'Chat with AI about tasks, teams, projects, and users',
    description: `Single endpoint for all AI interactions. Just send your natural language query.
    
    Examples:
    - "Show me all overdue tasks"
    - "Who is on the backend team?"
    - "List projects for Sarah"
    - "What tasks are assigned to John?"
    
    The AI automatically:
    - Classifies intent (search/create/update/delete)
    - Extracts entity types (task/team/project/user)
    - Identifies filters (overdue, urgent, team, etc.)
    - Performs hybrid search (vector + keyword)
    - Ranks and diversifies results
    - Generates grounded answers with citations
    
    For streaming responses, use GET /task-manager/chat-stream?query=YOUR_QUERY`,
  })
  async chat(@Body() request: ChatRequestDto): Promise<ChatResponseDto> {
    return this.ragService.processQuery(request);
  }

  @Sse('chat-stream')
  @ApiOperation({
    summary: 'Stream chat responses in real-time (SSE)',
    description: `Server-Sent Events endpoint for real-time streaming responses.
    
    Usage: GET /task-manager/chat-stream?query=YOUR_QUERY
    
    The response streams JSON events:
    - type: "start" - Query initiated
    - type: "status" - Progress updates
    - type: "sources" - Retrieved documents
    - type: "chunk" - Answer tokens (real-time)
    - type: "complete" - Final result
    
    Example:
    GET /task-manager/chat-stream?query=show%20all%20overdue%20tasks
    
    Note: This endpoint may not render properly in Swagger UI. Test with curl or EventSource.`,
  })
  @ApiQuery({
    name: 'query',
    required: true,
    type: String,
    description: 'Natural language query',
    example: 'Show me all overdue tasks',
  })
  chatStream(@Query('query') query: string): Observable<MessageEvent> {
    return this.ragService.processQueryStream({ query });
  }
}
