import 'dotenv/config'; // Must be first — loads .env before any module import
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import { AppModule } from './app.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  // Support XML/ADF payloads
  app.use(express.text({ type: ['text/*', 'application/xml', '*/xml'] }));
  app.use(express.json());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Apply JWT auth globally — routes opt out with @Public()
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));

  const config = new DocumentBuilder()
    .setTitle('Booran Matador Replacement API')
    .setDescription(
      'New-Lead SMS Journeys, Unified Chronological Thread Portal, and DealerSocket CRM Sync for Cranbourne Kia, Cranbourne MG, and Geely Cranbourne.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('Authentication', 'Login and profile endpoints')
    .addTag('Users (Group Admin)', 'Portal user management — Group Admin only')
    .addTag('Lead Intake', 'DealerSocket lead forward ingestion, normalization, and deduplication')
    .addTag('Conversation Portal', 'Unified thread, staff messaging, internal notes, outcomes')
    .addTag('SMS Gateway & Webhooks', 'Inbound carrier webhook, STOP opt-outs, delivery receipts')
    .addTag('Compliance & Suppression', 'Spam Act & ACMA 3-rooftop global suppression list')
    .addTag('DealerSocket CRM Write-Back', 'Async activity note sync and retry queues')
    .addTag('Rooftops', 'Cranbourne Kia, MG, Geely Cranbourne identities')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`\n🚀 Booran Matador Replacement API → http://localhost:${port}`);
  console.log(`📚 Swagger Docs → http://localhost:${port}/api/docs`);
  console.log(`🔑 Default admin → admin@booran.com.au / Admin@2026!\n`);
}
bootstrap();
