import 'dotenv/config'; // Must be first — loads .env before any module import
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import { AppModule } from './app.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { WebhookGuard } from './modules/auth/guards/webhook.guard';

async function bootstrap() {
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  )
    throw new Error(
      'Production requires a JWT_SECRET of at least 32 characters',
    );
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  // Support XML/ADF payloads
  app.use(express.text({ type: ['text/*', 'application/xml', '*/xml'] }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Apply JWT auth globally — routes opt out with @Public()
  const reflector = app.get(Reflector);
  app.useGlobalGuards(
    new WebhookGuard(),
    new JwtAuthGuard(reflector),
    new RolesGuard(reflector),
  );

  const config = new DocumentBuilder()
    .setTitle('Booran Matador Replacement API')
    .setDescription(
      'New-Lead SMS Journeys, Unified Chronological Thread Portal, and DealerSocket CRM Sync for Cranbourne Kia, Cranbourne MG, and Geely Cranbourne.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-lead-forward-token' },
      'leadForward',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-webhook-test-token',
        description:
          'Development-only carrier webhook testing; disabled in production',
      },
      'webhookTest',
    )
    .addTag(
      'Journey Configuration',
      'Versioned rooftop/lead-type journey drafts and publishing',
    )
    .addTag('Template Library', 'Persisted staff SMS templates')
    .addTag(
      'System Settings',
      'Consent rules, retention, duplicate matching and entity mapping',
    )
    .addTag('Reports', 'Rooftop-scoped journey performance')
    .addTag(
      'Staff Tasks & Notifications',
      'Handoff tasks and duplicate/reply notifications',
    )
    .addTag('Authentication', 'Login and profile endpoints')
    .addTag('Users (Group Admin)', 'Portal user management — Group Admin only')
    .addTag(
      'Lead Intake',
      'DealerSocket lead forward ingestion, normalization, and deduplication',
    )
    .addTag(
      'Conversation Portal',
      'Unified thread, staff messaging, internal notes, outcomes',
    )
    .addTag(
      'SMS Gateway & Webhooks',
      'Inbound carrier webhook, STOP opt-outs, delivery receipts',
    )
    .addTag(
      'Compliance & Suppression',
      'Spam Act & ACMA 3-rooftop global suppression list',
    )
    .addTag(
      'DealerSocket CRM Write-Back',
      'Async activity note sync and retry queues',
    )
    .addTag('Rooftops', 'Cranbourne Kia, MG, Geely Cranbourne identities')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`\n🚀 Booran Matador Replacement API → http://localhost:${port}`);
  console.log(`📚 Swagger Docs → http://localhost:${port}/api/docs`);
}
bootstrap();
