import { randomUUID } from "crypto";
import { PSP } from "../../../src/core/app/psp"
import { MemoryDB } from "../../../src/libs/fakedb";
import { correntistas } from '../../../src/data/db.json'
import { ModalidadeAlteracao, Situacao, TipoCob } from "../../../src/core/app/models";
import { MESSAGES } from "../../../src/libs/messages";
import { owners } from "../../../src/data/db.json";
import { PoliticaRetentativa } from "../../../src/core/app/models/rec";
import { StatusCobR } from "../../../src/core/app/models/cobr";
import { addDays, flatDate } from "../../../src/libs/utils";
describe("PSP", () => {


    let psp: PSP;


    beforeAll(async () => {
        const cst = MemoryDB.create("CORRENTISTAS", ['chave']);
        MemoryDB.create("COB", ['txid']);
        MemoryDB.create("LOCATIONS", ['id', 'uuid']);
        MemoryDB.create("LOC_COB", ['id', 'txid']);
        MemoryDB.create("COB_HIST", ['id']);
        MemoryDB.create("COBR", ['txid']);
        MemoryDB.create("REC", ['idRec']);

        await Promise.all(correntistas.map(async (c) => {
            await cst.add('DEV', c)
        }));

        psp = new PSP();
    });

    let IdOwner: string;
    let txid: string;
    let chave: string;

    beforeEach(() => {
        IdOwner = randomUUID();
        txid = randomUUID().replace(/\-/g, '');
        chave = correntistas[Math.floor(Math.random() * correntistas.length)].chave
    })


    describe('COB', () => {
        describe("add", () => {
            it('retirada', async () => {
                await expect(psp.addCob({ IdOwner, txid, data: { chave, valor: { original: "10.00", retirada: {  } } } })).rejects.toThrow('NÃO IMPLEMENTADO')
            });
            it('success', async () => {
                await expect(psp.addCob({ IdOwner, txid, data: { chave, valor: { original: "10.00" } } })).resolves.toMatchObject({ txid, revisao: 0, chave, valor: { original: "10.00", modalidadeAlteracao: ModalidadeAlteracao.NaoEditavel }, status: Situacao.Ativa })
            });
        });

        describe("read", () => {
            it('success', async () => {
                await psp.addCob({ IdOwner, txid, data: { chave, valor: { original: "10.00" } } });
                await expect(psp.readCob({ IdOwner, txid })).resolves.toMatchObject({ txid, revisao: 0, chave, valor: { original: "10.00", modalidadeAlteracao: ModalidadeAlteracao.NaoEditavel }, status: Situacao.Ativa });
            });
        });

        describe('edit', () => {
            let id: number;
            beforeEach(async () => {
                id = +new Date();
                await psp.addCob({ IdOwner, txid, data: { chave, valor: { original: "10.00" } } });
                await psp.addLoc({ IdOwner, tipoCob: TipoCob.imediato })
            })


            describe('sem revisão', () => {

                describe('falha', () => {
                    it('location não encontrada', async () => {
                        await expect(psp.editCob({ IdOwner, txid, data: { loc: { id: Number.MAX_SAFE_INTEGER } } })).rejects.toThrow(MESSAGES.Errors.defaults.NOT_FOUNT('location'))
                    })
                    it('tipo divergente', async () => {
                        const loc_div = await psp.addLoc({ IdOwner, tipoCob: TipoCob.vencimento })
                        await expect(psp.editCob({ IdOwner, txid, data: { loc: { id: loc_div.id } } })).rejects.toThrow(MESSAGES.Errors.defaults.UNEXPECTED_VALUE('tipoCob', TipoCob.vencimento))
                    });

                    it('location em uso', async () => {

                        const cob = await psp.addCob({ IdOwner, txid: randomUUID().replace(/\-/g, ''), data: { chave, valor: { original: "10.00" } } });
                        await expect(psp.editCob({ IdOwner, txid, data: { loc: { id: cob.loc.id } } })).rejects.toThrow('LOCATION JÁ ESTÁ VINCULADO A UMA COBRANÇA')
                    });
                })
                it('sucesso', async () => {
                    const new_loc = await psp.addLoc({ IdOwner, tipoCob: TipoCob.imediato })
                    await expect(psp.editCob({ IdOwner, txid, data: { loc: { id: new_loc.id } } })).resolves.toMatchObject({ txid, revisao: 0 })
                })
            })
        })
    })


    describe('LOC', () => {


        describe('add', () => {
            it('success', async () => {
                expect(psp.addLoc({ IdOwner, tipoCob: TipoCob.imediato })).resolves.toMatchObject({ tipoCob: TipoCob.imediato });
            });
        });

        describe('read', () => {
            it('success', async () => {
                const { id } = await psp.addLoc({ IdOwner, tipoCob: TipoCob.imediato })
                await expect(psp.readLoc({ IdOwner, id })).resolves.toMatchObject({ id, tipoCob: TipoCob.imediato });
                const res = await psp.readLoc({ IdOwner, id });
                await expect(psp.readLocUUID(IdOwner, res.uuid)).resolves.toMatchObject({ id, tipoCob: TipoCob.imediato });
            });
        });

        describe('delete', () => {
            it('success', async () => {
                const cob = await psp.addCob({ IdOwner, txid, data: { chave, valor: { original: "10.00" } } });
                expect(cob.loc?.id).not.toBeUndefined();
                expect(cob).toMatchObject({ txid });

                await expect(psp.readLoc({ IdOwner, id: cob.loc.id })).resolves.toMatchObject({ txid });
                await expect(psp.removeLoc({ IdOwner, id: cob.loc.id })).resolves.toBeTruthy();
                await expect(psp.readLoc({ IdOwner, id: cob.loc.id })).resolves.not.toMatchObject({ txid });
                await expect(psp.readCob({ IdOwner, txid })).resolves.not.toMatchObject({ loc: { id: cob.loc.id } });

            })
        })


    })


    describe('LOC - id sequencial', () => {
        it('incrementa por owner', async () => {
            const a = await psp.addLoc({ IdOwner, tipoCob: TipoCob.imediato });
            const b = await psp.addLoc({ IdOwner, tipoCob: TipoCob.imediato });
            const outro = await psp.addLoc({ IdOwner: randomUUID(), tipoCob: TipoCob.imediato });
            expect(a.id).toBe(1);
            expect(b.id).toBe(2);
            expect(outro.id).toBe(1);
        });

        it('sem colisão em chamadas concorrentes', async () => {
            const locs = await Promise.all(Array.from({ length: 10 }, () => psp.addLoc({ IdOwner, tipoCob: TipoCob.imediato })));
            expect(new Set(locs.map(l => l.id)).size).toBe(10);
        });
    });

    describe('COB - filtro status', () => {
        it('filtra por status', async () => {
            const filter = { IdOwner, inicio: flatDate(addDays(new Date(), -1)).toJSON(), fim: flatDate(addDays(new Date(), +1)).toJSON() };
            const txidRem = randomUUID().replace(/\-/g, '');
            await psp.addCob({ IdOwner, txid, data: { chave, valor: { original: "10.00" } } });
            await psp.addCob({ IdOwner, txid: txidRem, data: { chave, valor: { original: "10.00" } } });
            await psp.editCob({ IdOwner, txid: txidRem, data: { status: Situacao.Removida } });

            await expect(psp.listCob(filter)).resolves.toMatchObject({ parametros: { paginacao: { quantidadeTotalDeItens: 2 } } });

            const ativas = await psp.listCob({ ...filter, status: Situacao.Ativa });
            expect(ativas.cobs.map(c => c.txid)).toEqual([txid]);

            const removidas = await psp.listCob({ ...filter, status: Situacao.Removida });
            expect(removidas.cobs.map(c => c.txid)).toEqual([txidRem]);
        });
    });

    describe('COBR', () => {
        const data: any = { idRec: 'RN3114167220240926abcdefghijk', infoAdicional: 'teste', calendario: { dataDeVencimento: flatDate(addDays(new Date(), 1)).toJSON() } };

        beforeEach(async () => {
            await MemoryDB.get('REC').add(IdOwner, { idRec: data.idRec, politicaRetentativa: PoliticaRetentativa.Permite });
        });

        it('addCobR persiste na coleção COBR', async () => {
            await expect(psp.addCobR({ IdOwner, txid, data })).resolves.toMatchObject({ txid, idRec: data.idRec, status: StatusCobR.Criada, revisao: 0 });
            await expect(psp.readCobR({ IdOwner, txid })).resolves.toMatchObject({ txid, idRec: data.idRec });
            await expect(psp.readCob({ IdOwner, txid })).resolves.toBeUndefined();
        });

        it('addCobR txid duplicado', async () => {
            await psp.addCobR({ IdOwner, txid, data });
            await expect(psp.addCobR({ IdOwner, txid, data })).rejects.toThrow('Duplicate Key');
        });
    });

    describe('REC', () => {
        it('idRec sem espaço', async () => {
            const res = await psp.addRec({ IdOwner: owners[0].id, data: { politicaRetentativa: PoliticaRetentativa.NaoPermite } as any });
            expect(res.idRec).toMatch(/^RN[0-9a-z]{8}\d{8}$/);
        });
    });

})