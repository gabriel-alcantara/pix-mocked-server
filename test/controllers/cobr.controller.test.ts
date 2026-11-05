import { Test, TestingModule } from '@nestjs/testing';
import { PSP } from '../../src/core/app/psp';
import { randomUUID } from 'crypto';
import { MemoryDB } from '../../src/libs/fakedb';
import { correntistas } from '../../src/data/db.json'
import { CobRController } from '../../src/controllers/cobr.controller';
import { StatusCobR } from '../../src/core/app/models/cobr';
import { addDays, flatDate } from '../../src/libs/utils';
import { PoliticaRetentativa } from '../../src/core/app/models/rec';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('CobRController', () => {
  let ctrl: CobRController;


  beforeAll(async () => {
    const cst = MemoryDB.create("CORRENTISTAS", ['chave', 'cpfcnpj']);

    MemoryDB.create("COB", ['txid']);
    MemoryDB.create("COB_HIST", ['id']);

    MemoryDB.create("COBR", ['txid']);
    MemoryDB.create("REC", ['idRec']);


    MemoryDB.create("LOCATIONS", ['id', 'uuid']);
    MemoryDB.create("LOC_COB", ['id', 'txid']);

    await Promise.all(correntistas.map(c => cst.add('DEV', c)));

    const app: TestingModule = await Test.createTestingModule({
      controllers: [CobRController],
      providers: [PSP],
    }).compile();

    ctrl = app.get<CobRController>(CobRController);
  });

  let IdOwner: string;

  beforeEach(async () => {
    IdOwner = randomUUID();
    await MemoryDB.get('REC').add(IdOwner, { idRec: data.idRec, politicaRetentativa: PoliticaRetentativa.Permite });
  });

  const data: any = {
    idRec: 'RN3114167220240926abcdefghijk',
    infoAdicional: 'Serviço de Streaming',
    calendario: { dataDeVencimento: flatDate(addDays(new Date(), 1)).toJSON() },
    dadosDevedor: { cpf: correntistas[1].cpfcnpj, cep: '26083190', cidade: 'Nova Iguaçu', logradouro: 'Rua Gemeos', uf: 'RJ' },
    contaRecebedor: { agencia: '0001', conta: '123456', tipoConta: 'CORRENTE' }
  };

  describe('ADD (PUT)', () => {
    it('persiste e retorna a cobrança', async () => {
      const txid = randomUUID().replace(/\-/g, '');
      await expect(ctrl.add(data, txid, { IdOwner })).resolves.toMatchObject({ txid, idRec: data.idRec, status: StatusCobR.Criada });
      await expect(ctrl.read(txid, { IdOwner })).resolves.toMatchObject({ txid, idRec: data.idRec });
    });
  });

  describe('ADD - idRec', () => {
    it('recusa idRec de outro recebedor', async () => {
      const outro = randomUUID();
      const idRec = 'RR3114167220240926zyxwvutsrqp';
      await MemoryDB.get('REC').add(outro, { idRec, politicaRetentativa: PoliticaRetentativa.Permite });
      const txid = randomUUID().replace(/\-/g, '');
      await expect(ctrl.add({ ...data, idRec }, txid, { IdOwner })).rejects.toThrow(BadRequestException);
      await expect(ctrl.read(txid, { IdOwner })).resolves.toBeUndefined();
    });

    it('recusa idRec inexistente', async () => {
      await expect(ctrl.add({ ...data, idRec: 'RN3114167220240926naoexiste01' }, randomUUID().replace(/\-/g, ''), { IdOwner })).rejects.toThrow(BadRequestException);
    });
  });

  describe('ADD - concorrência', () => {
    it('mesmo txid em paralelo cria apenas uma cobrança', async () => {
      const txid = randomUUID().replace(/\-/g, '');
      const res = await Promise.allSettled([ctrl.add(data, txid, { IdOwner }), ctrl.add(data, txid, { IdOwner })]);
      expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(res.filter(r => r.status === 'rejected')).toHaveLength(1);
      const { cobs } = await ctrl.list({ IdOwner }, { inicio: flatDate(addDays(new Date(), -1)).toJSON(), fim: flatDate(addDays(new Date(), +1)).toJSON() });
      expect(cobs.filter(c => c.txid === txid)).toHaveLength(1);
    });
  });

  describe('RETENTATIVA', () => {
    const ymd = (d: Date) => d.toJSON().substring(0, 10);
    const vencimento = () => flatDate(addDays(new Date(), 1));
    let txid: string;

    beforeEach(async () => {
      txid = randomUUID().replace(/\-/g, '');
      await ctrl.add(data, txid, { IdOwner });
    });

    it('registra retentativa', async () => {
      const dia = ymd(addDays(vencimento(), 2));
      await expect(ctrl.createRetentativa(txid, dia, { IdOwner })).resolves.toMatchObject({ txid, tentativas: [{ dataLiquidacao: dia, tipo: 'RETENTATIVA', status: 'SOLICITADA' }] });
      await expect(ctrl.read(txid, { IdOwner })).resolves.toMatchObject({ tentativas: [{ dataLiquidacao: dia }] });
    });

    it('limite de 3 retentativas', async () => {
      for (let i = 1; i <= 3; i++) {
        await ctrl.createRetentativa(txid, ymd(addDays(vencimento(), i)), { IdOwner });
      }
      await expect(ctrl.createRetentativa(txid, ymd(addDays(vencimento(), 4)), { IdOwner })).rejects.toThrow(BadRequestException);
    });

    it('data repetida', async () => {
      await ctrl.createRetentativa(txid, ymd(addDays(vencimento(), 1)), { IdOwner });
      await expect(ctrl.createRetentativa(txid, ymd(addDays(vencimento(), 1)), { IdOwner })).rejects.toThrow(BadRequestException);
    });

    it('data fora da janela de 7 dias', async () => {
      await expect(ctrl.createRetentativa(txid, ymd(vencimento()), { IdOwner })).rejects.toThrow(BadRequestException);
      await expect(ctrl.createRetentativa(txid, ymd(addDays(vencimento(), 8)), { IdOwner })).rejects.toThrow(BadRequestException);
    });

    it('data inválida', async () => {
      await expect(ctrl.createRetentativa(txid, '2024-13-45', { IdOwner })).rejects.toThrow(BadRequestException);
      await expect(ctrl.createRetentativa(txid, 'amanha', { IdOwner })).rejects.toThrow(BadRequestException);
      await expect(ctrl.createRetentativa(txid, '2030-02-30', { IdOwner })).rejects.toThrow(BadRequestException);
    });

    it('recorrência sem retentativa', async () => {
      const idRec = 'RN3114167220240926naopermite0';
      await MemoryDB.get('REC').add(IdOwner, { idRec, politicaRetentativa: PoliticaRetentativa.NaoPermite });
      const outro = randomUUID().replace(/\-/g, '');
      await ctrl.add({ ...data, idRec }, outro, { IdOwner });
      await expect(ctrl.createRetentativa(outro, ymd(addDays(vencimento(), 1)), { IdOwner })).rejects.toThrow(BadRequestException);
    });

    it('status não permite', async () => {
      await MemoryDB.get('COBR').patch(IdOwner, { txid }, { status: StatusCobR.Cancelada });
      await expect(ctrl.createRetentativa(txid, ymd(addDays(vencimento(), 1)), { IdOwner })).rejects.toThrow(BadRequestException);
    });

    it('cobrança removida', async () => {
      await ctrl.edit({ status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }, txid, { IdOwner });
      await expect(ctrl.createRetentativa(txid, ymd(addDays(vencimento(), 1)), { IdOwner })).rejects.toThrow(BadRequestException);
    });

    it('cobrança inexistente', async () => {
      await expect(ctrl.createRetentativa(randomUUID().replace(/\-/g, ''), ymd(addDays(vencimento(), 1)), { IdOwner })).rejects.toThrow(NotFoundException);
    });
  });

  describe('CREATE (POST)', () => {
    it('gera txid', async () => {
      const res = await ctrl.create(data, { IdOwner });
      expect(res.txid).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('EDIT', () => {
    it('altera campos', async () => {
      const txid = randomUUID().replace(/\-/g, '');
      await ctrl.add(data, txid, { IdOwner });
      await expect(ctrl.edit({ solicitacaoPagador: 'novo' }, txid, { IdOwner })).resolves.toMatchObject({ txid, solicitacaoPagador: 'novo' });
    });

    it('calendario preserva vencimento e criação', async () => {
      const txid = randomUUID().replace(/\-/g, '');
      const { calendario } = await ctrl.add(data, txid, { IdOwner });
      const res = await ctrl.edit({ calendario: { expiracao: 3600 } } as any, txid, { IdOwner });
      expect(res.calendario).toMatchObject({ dataDeVencimento: calendario.dataDeVencimento, dataCriacao: calendario.dataCriacao, expiracao: 3600 });
    });

    it('inexistente', async () => {
      await expect(ctrl.edit({ solicitacaoPagador: 'novo' }, randomUUID().replace(/\-/g, ''), { IdOwner })).resolves.toBeNull();
    });
  });

  describe('REMOVE', () => {
    it('success', async () => {
      const txid = randomUUID().replace(/\-/g, '');
      await ctrl.add(data, txid, { IdOwner });
      await expect(ctrl.remove(txid, { IdOwner })).resolves.toBeTruthy();
      await expect(ctrl.read(txid, { IdOwner })).resolves.toBeUndefined();
    });
  });

  describe('LIST', () => {
    const filter = () => ({ inicio: flatDate(addDays(new Date(), -1)).toJSON(), fim: flatDate(addDays(new Date(), +1)).toJSON() });

    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        await ctrl.add(data, randomUUID().replace(/\-/g, ''), { IdOwner });
      }
      await ctrl.add({ ...data, dadosDevedor: { ...data.dadosDevedor, cpf: undefined, cnpj: correntistas[0].cpfcnpj } }, randomUUID().replace(/\-/g, ''), { IdOwner });
    });

    it('periodo', async () => {
      const { parametros, cobs } = await ctrl.list({ IdOwner }, filter());
      expect(cobs).toHaveLength(4);
      expect(parametros).toMatchObject({ paginacao: { quantidadeDePaginas: 1, quantidadeTotalDeItens: 4 } });
    });

    it('cpf', async () => {
      const { cobs } = await ctrl.list({ IdOwner }, { ...filter(), cpf: correntistas[1].cpfcnpj });
      expect(cobs).toHaveLength(3);
    });

    it('status', async () => {
      await expect(ctrl.list({ IdOwner }, { ...filter(), status: StatusCobR.Criada as any })).resolves.toMatchObject({ parametros: { paginacao: { quantidadeTotalDeItens: 4 } } });
      await expect(ctrl.list({ IdOwner }, { ...filter(), status: StatusCobR.Cancelada as any })).resolves.toMatchObject({ parametros: { paginacao: { quantidadeTotalDeItens: 0 } } });
    });

    it('owner isolado', async () => {
      await expect(ctrl.list({ IdOwner: randomUUID() }, filter())).resolves.toMatchObject({ cobs: [] });
    });
  });

  // describe('CREATE', () => {
  //   it('Success', async () => await expect(ctrl.create({ chave, valor: { original: "10.00" } }, { IdOwner })).resolves.toMatchObject({ chave, loc: { tipoCob: TipoCob.imediato } }));
  // });


  // describe('EDIT', () => {
  //   it('success', async () => {
  //     await ctrl.add({ chave, valor: { original: "1.00" } }, txid, { IdOwner });
  //     await expect(ctrl.edit({ valor: { original: "2.00" } }, txid, { IdOwner })).resolves.toMatchObject({ chave, txid, revisao: 1, status: Situacao.Ativa, loc: { tipoCob: TipoCob.imediato } });
  //   });

  //   it('sem mudança de revisão', async () => {
  //     await ctrl.add({ chave, valor: { original: "1.00" } }, txid, { IdOwner });
  //     await expect(ctrl.read(txid, { IdOwner })).resolves.toMatchObject({ revisao: 0, status: Situacao.Ativa, loc: { tipoCob: TipoCob.imediato } });
  //     const { id } = await ctrlLoc.create({ tipoCob: TipoCob.imediato }, { IdOwner });
  //     await expect(ctrl.edit({ loc: { id } }, txid, { IdOwner })).resolves.not.toThrow();
  //     await expect(ctrl.read(txid, { IdOwner })).resolves.toMatchObject({ loc: { id, tipoCob: TipoCob.imediato }, revisao: 0, status: Situacao.Ativa });
  //   });
  // })

  // describe('REMOVE', () => {
  //   it('success', async () => {
  //     await ctrl.add({ chave, valor: { original: "1.00" } }, txid, { IdOwner });
  //     await expect(ctrl.remove(txid, { IdOwner })).resolves.toBeTruthy();
  //     await expect(ctrl.read(txid, { IdOwner })).resolves.toBeUndefined();
  //   });


  // })

  // describe("LIST", () => {
  //   const FILL_TEST = 11
  //   let lsPix: CobPutResponse[] = [];
  //   beforeEach(async () => {
  //     lsPix = [];
  //     for (const c of correntistas) {
  //       for (let i = 0; i < FILL_TEST; i++) {
  //         txid = randomUUID().replace(/\-/g, '');
  //         lsPix.push(await ctrl.add({ chave: c.chave, valor: { original: (Math.floor(Math.random() * 1000) * 1.53).toFixed(2) } }, txid, { IdOwner }));
  //       }
  //     }
  //   })

  //   describe('PERIODO', () => {
  //     let filter: CobGetFilter = { inicio: flatDate(addDays(new Date(), -1)).toJSON(), fim: flatDate(addDays(new Date(), +1)).toJSON() };

  //     it('sucesso', async () => await expect(ctrl.list({ IdOwner }, filter)).resolves.not.toThrow());

  //     it('quantidades', async () => {
  //       const { parametros, cobs } = await ctrl.list({ IdOwner }, filter);
  //       expect(cobs).toHaveLength(correntistas.length * FILL_TEST);
  //       expect(parametros).toMatchObject({ paginacao: { quantidadeDePaginas: 1, quantidadeTotalDeItens: correntistas.length * FILL_TEST } });

  //     });
  //   })

  //   describe('CORRENTISTA - CPF', () => {
  //     let filter: CobGetFilter = { inicio: flatDate(addDays(new Date(), -1)).toJSON(), fim: flatDate(addDays(new Date(), +1)).toJSON(), cpf: correntistas[1].cpfcnpj };

  //     it('sucesso', async () => await expect(ctrl.list({ IdOwner }, filter)).resolves.not.toThrow());

  //     it('quantidades', async () => {
  //       const { parametros, cobs } = await ctrl.list({ IdOwner }, filter);
  //       expect(cobs).toHaveLength(FILL_TEST);
  //       expect(parametros).toMatchObject({ paginacao: { quantidadeDePaginas: 1, quantidadeTotalDeItens: FILL_TEST } });
  //     });
  //   })

  //   describe('CORRENTISTA - CNPJ', () => {
  //     let filter: CobGetFilter = { inicio: flatDate(addDays(new Date(), -1)).toJSON(), fim: flatDate(addDays(new Date(), +1)).toJSON(), cnpj: correntistas[0].cpfcnpj };

  //     it('sucesso', async () => await expect(ctrl.list({ IdOwner }, filter)).resolves.not.toThrow());

  //     it('quantidades', async () => {
  //       const { parametros, cobs } = await ctrl.list({ IdOwner }, filter);
  //       expect(cobs).toHaveLength(FILL_TEST);
  //       expect(parametros).toMatchObject({ paginacao: { quantidadeDePaginas: 1, quantidadeTotalDeItens: FILL_TEST } });
  //     });
  //   });

  //   describe('CORRENTISTA - CPF INEXISTENTE', () => {
  //     let filter: CobGetFilter = { inicio: flatDate(addDays(new Date(), -1)).toJSON(), fim: flatDate(addDays(new Date(), +1)).toJSON(), cpf: gerarCPF() };

  //     it('sucesso', async () => await expect(ctrl.list({ IdOwner }, filter)).resolves.not.toThrow());

  //     it('quantidades', async () => {
  //       const { parametros, cobs } = await ctrl.list({ IdOwner }, filter);
  //       expect(cobs).toHaveLength(0);
  //       expect(parametros).toMatchObject({ paginacao: { quantidadeDePaginas: 0, quantidadeTotalDeItens: 0 } });
  //     });
  //   });

  //   describe('LOCATION', () => {
  //     let filter: CobGetFilter = { inicio: flatDate(addDays(new Date(), -1)).toJSON(), fim: flatDate(addDays(new Date(), +1)).toJSON() };
  //     const QTD_REM = 3;
  //     beforeEach(async () => {
  //       for (let i = 0; i < QTD_REM; i++) {
  //         await ctrlLoc.remove({ id: lsPix[i].loc.id }, { IdOwner });
  //       }
  //     })

  //     it('presente', async () => {
  //       filter.locationPresente = true;
  //       const { parametros, cobs } = await ctrl.list({ IdOwner }, filter);
  //       expect(cobs).toHaveLength(correntistas.length * FILL_TEST - QTD_REM);
  //       expect(parametros).toMatchObject({ paginacao: { quantidadeDePaginas: 1, quantidadeTotalDeItens: correntistas.length * FILL_TEST - QTD_REM } });
  //     });

  //     it('ausente', async () => {
  //       filter.locationPresente = false;
  //       const { parametros, cobs } = await ctrl.list({ IdOwner }, filter);
  //       expect(cobs).toHaveLength(QTD_REM);
  //       expect(parametros).toMatchObject({ paginacao: { quantidadeDePaginas: 1, quantidadeTotalDeItens: QTD_REM } });
  //     });
  //   })

  //   describe('PAGINAÇÃO', () => {
  //     let filter: CobGetFilter = { inicio: flatDate(addDays(new Date(), -1)).toJSON(), fim: flatDate(addDays(new Date(), +1)).toJSON() };


  //     it('pag:1 | Tam: 5 | 5 itens', async () => {
  //       filter.paginacao = { itensPorPagina: 5, paginaAtual: 1 }
  //       const { parametros, cobs } = await ctrl.list({ IdOwner }, filter);
  //       expect(cobs).toHaveLength(5);
  //       expect(parametros).toMatchObject({ paginacao: { quantidadeDePaginas: 7, quantidadeTotalDeItens: correntistas.length * FILL_TEST } });

  //     });

  //     it('pag:6 | Tam: 5 | 3 itens', async () => {
  //       filter.paginacao = { itensPorPagina: 5, paginaAtual: 6 }
  //       const { parametros, cobs } = await ctrl.list({ IdOwner }, filter);
  //       expect(cobs).toHaveLength(3);
  //       expect(parametros).toMatchObject({ paginacao: { quantidadeDePaginas: 7, quantidadeTotalDeItens: correntistas.length * FILL_TEST } });
  //     });
  // })
  // })
});
