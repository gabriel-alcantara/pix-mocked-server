import { Body, Controller, Delete, Get, Header, Headers, Param, Patch, Post, Put, Query, Req, UseInterceptors } from '@nestjs/common';
import { PSP } from '../core/app/psp';
import { HttpInterceptor } from '../http.interceptor';
import { CobRGetFilter, CobRPatchRequest, CobRPutRequest } from '../core/app/models/cobr';
import { PixRequest } from '../core/app/models';
import { randomUUID } from 'crypto';

@Controller("cobr")
@UseInterceptors(HttpInterceptor)
export class CobRController {
  constructor(private readonly pspService: PSP) { }

  @Put(":txid")
  async add(@Body() data: CobRPutRequest, @Param("txid") txid, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const itm: PixRequest<CobRPutRequest> = { IdOwner, txid, data }
    return await this.pspService.addCobR(itm);
  }

  @Post()
  async create(@Body() data: CobRPutRequest, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const txid: string = randomUUID().replace(/\-/g, '')
    const itm: PixRequest<CobRPutRequest> = { IdOwner, txid, data }
    return await this.pspService.addCobR(itm);
  }

  @Post(":txid/retentativa/:data")
  async createRetentativa(@Body() data: CobRPutRequest, @Param("txid") txid, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const itm: PixRequest<CobRPutRequest> = { IdOwner, txid, data }
    return await this.pspService.addCobR(itm);
  }


  @Get(":txid")
  async read(@Param("txid") txid, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const itm = await this.pspService.readCobR({ IdOwner, txid });
    return itm;
  }

  @Get()
  list(@Headers() headers, @Query() qry: CobRGetFilter) {
    const IdOwner = headers["IdOwner"];
    return this.pspService.listCobR({ ...qry, IdOwner });
  }

  @Patch(":txid")
  edit(@Body() data: CobRPatchRequest, @Param("txid") txid, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const itm: PixRequest<CobRPatchRequest> = { IdOwner, txid, data }
    return this.pspService.editCobR(itm);
  }

  @Delete(":txid")
  remove(@Param("txid") txid, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    return this.pspService.removeCobR({ IdOwner, txid });
  }

}
