// swagger configuration file
import { DocumentBuilder } from '@nestjs/swagger';
export const swaggerConfig = new DocumentBuilder()
  .setTitle('Task Manager API')
  .setDescription('API documentation for the Task Manager application')
  .setVersion('1.0')
  .addBearerAuth()
  .build();

