import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MemoryDB } from './libs/fakedb';
import {correntistas} from './data/db.json'
import { AuthModule } from './auth.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { swaggerAppConfig } from './swagger-app.config';
import { swaggerAuthConfig } from './swagger-auth.config';

async function bootstrap() {
  
  
  MemoryDB.create("COB", ['txid']);
  MemoryDB.create("LOCATIONS", ['id', 'uuid']);

  const corr =  MemoryDB.create("CORRENTISTAS", ['chave']);
    await Promise.all(correntistas.map(async (c) => {
      await corr.add('DEV', c)
    }));
  
  //SERVIÇO PRINCIPAL  
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  
  const appDocument = SwaggerModule.createDocument(app, swaggerAppConfig);
  SwaggerModule.setup('api-docs', app, appDocument);
  
  await app.listen(3000);

  //SERVIÇO DE AUTENTICAÇÃO
  const auth = await NestFactory.create(AuthModule);
  
  const authDocument = SwaggerModule.createDocument(auth, swaggerAuthConfig);
  SwaggerModule.setup('api-docs', auth, authDocument);
  
  await auth.listen(3001);
}
bootstrap();
