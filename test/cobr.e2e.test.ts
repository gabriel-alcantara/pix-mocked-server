import { BadRequestException, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { randomUUID } from "crypto";
import * as request from 'supertest';
import { AppModule } from "../src/app.module";
import { MemoryDB } from "../src/libs/fakedb";
import { addDays, errorFormatter, flatDate } from "../src/libs/utils";
import { PoliticaRetentativa } from "../src/core/app/models/rec";
import { owners } from "../src/data/db.json";
import { expectPost200, expectPost400 } from "./e2e";

describe('COBR', () => {
    let app: INestApplication;
    const idRec = 'RR3114167220240926abcdefghijk';
    const vencimento = flatDate(addDays(new Date(), 1));
    const data = { idRec, infoAdicional: 'Serviço de Streaming', calendario: { dataDeVencimento: vencimento.toJSON() } };

    beforeAll(async () => {
        MemoryDB.create("COBR", ['txid']);
        const rec = MemoryDB.create("REC", ['idRec']);
        await rec.add(owners[0].id, { idRec, politicaRetentativa: PoliticaRetentativa.Permite });

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({
            disableErrorMessages: false,
            transform: true,
            skipMissingProperties: true,
            exceptionFactory: (errors) => {
                throw new BadRequestException(errorFormatter(errors))
            }
        }));
        await app.init();
    });

    afterAll(async () => await app.close());

    const put = (txid: string, payload: any) => request(app.getHttpServer()).put(`/cobr/${txid}`).send(payload).set("mocked-token", "123-abc");

    it('PUT cria a cobrança', async () => {
        const txid = randomUUID().replace(/\-/g, '');
        await put(txid, data).expect(200).expect(res => expect(res.body).toMatchObject({ txid, idRec, status: 'CRIADA' }));
    });

    it('PUT com schema inválido retorna 400', async () => {
        await put(randomUUID().replace(/\-/g, ''), { ...data, infoAdicional: 'x'.repeat(141) })
            .expect(400)
            .expect(res => expect(res.body).toMatchObject({
                status: 400,
                detail: 'A cobrança não respeita o schema.',
                violacoes: [{ propriedade: 'cobr.infoAdicional', razao: 'O campo cobr.infoAdicional não respeita o schema.' }]
            }));
    });

    it('PUT com idRec de outro recebedor retorna 400', async () => {
        const idRecOutro = 'RN3114167220240926outrodono0';
        await MemoryDB.get('REC').add(owners[1].id, { idRec: idRecOutro, politicaRetentativa: PoliticaRetentativa.Permite });
        await put(randomUUID().replace(/\-/g, ''), { ...data, idRec: idRecOutro })
            .expect(400)
            .expect(res => expect(res.body).toMatchObject({ status: 400, violacoes: [{ propriedade: 'cobr.idRec' }] }));
    });

    it('POST retentativa', async () => {
        const txid = randomUUID().replace(/\-/g, '');
        await put(txid, data).expect(200);
        const dia = addDays(vencimento, 2).toJSON().substring(0, 10);
        await expectPost200(app, `/cobr/${txid}/retentativa/${dia}`, {}, { txid, tentativas: [{ dataLiquidacao: dia, status: 'SOLICITADA' }] });
        await expectPost400(app, `/cobr/${txid}/retentativa/${dia}`, {}, 'A cobrança não respeita o schema.', [{ propriedade: 'cobr.data', razao: 'Já existe retentativa para a data informada.' }]);
    });
});
