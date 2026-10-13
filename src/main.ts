import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  

  const config = new DocumentBuilder()
    .setTitle('Booran Matador Replacement API')
    .setDescription(
      'New-Lead SMS Journeys, Unified Chronological Thread Portal, and DealerSocket CRM Sync for Cranbourne Kia, Cranbourne MG, and Geely Cranbourne.',
    )
    .setVersion('1.0.0')
    .addTag('Lead Intake', 'DealerSocket lead forward ingestion, normalization, and deduplication')
    .addTag('Conversation Portal', 'Unified chronological thread, staff messaging, internal notes, and outcomes')
    .addTag('SMS Gateway & Webhooks', 'Inbound carrier webhook, STOP opt-outs, and delivery receipts')
    .addTag('Compliance & Suppression', 'Australian Spam Act & ACMA 3-rooftop global suppression list')
    .addTag('DealerSocket CRM Write-Back', 'Asynchronous activity note synchronization and retry queues')
    .addTag('Rooftops', 'Cranbourne Kia, Cranbourne MG, and Geely Cranbourne identities')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`\n🚀 Booran Matador Replacement API running on http://localhost:${port}`);
  console.log(`📚 Swagger API Documentation available at http://localhost:${port}/api/docs\n`);
}
bootstrap();
