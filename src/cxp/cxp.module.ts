import { Module } from '@nestjs/common';
import { CxpService } from './cxp.service';
import { CxpController } from './cxp.controller';

@Module({
  providers: [CxpService],
  controllers: [CxpController],
  exports: [CxpService],
})
export class CxpModule {}
