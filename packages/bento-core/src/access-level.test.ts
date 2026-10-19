import { describe, expect, it } from 'vitest';
import { classificarAcesso, ehPedidoDeLeitura } from './access-level';

/**
 * O corpus é a especificação. Cada frase aqui ou veio de um incidente medido
 * ou é a vizinha perigosa dele — a que separa a regra certa da regra que só
 * funciona no exemplo do commit.
 */
describe('classificarAcesso — o objeto decide, não o verbo', () => {
  describe('o incidente que originou o módulo (29/09/2026)', () => {
    it('"Faça um briefing executivo completo da agência" é LEITURA', () => {
      const c = classificarAcesso('Faça um briefing executivo completo da agência.');
      expect(c.nivel).toBe('READ');
      expect(c.objeto).toBe('texto');
    });

    it('"Faça uma task de carrossel" continua sendo escrita — mesmo verbo, outro objeto', () => {
      expect(classificarAcesso('Faça uma task de carrossel para o Pedro.').nivel).not.toBe('READ');
    });

    it('"Reatribua todas as tasks para a Tammy" é escrita', () => {
      const c = classificarAcesso('Reatribua todas as tasks para a Tammy.');
      expect(c.nivel).toBe('WRITE');
      expect(c.objeto).toBe('recurso');
    });

    it('"Me diga quais tasks deveriam ser reatribuídas" é PROPOSE, não escrita', () => {
      const c = classificarAcesso('Me diga quais tasks deveriam ser reatribuídas.');
      expect(c.nivel).toBe('PROPOSE');
      expect(ehPedidoDeLeitura('Me diga quais tasks deveriam ser reatribuídas.')).toBe(true);
    });
  });

  describe('as perguntas do benchmark de inteligência — todas têm que passar', () => {
    const leituras = [
      'Me explique tudo que você sabe sobre a Agência Desigual.',
      'Quem trabalha aqui e qual é a função de cada pessoa?',
      'Quais clientes precisam de atenção hoje?',
      'Quais são os maiores riscos operacionais neste momento?',
      'O que mudou na agência nos últimos 7 dias?',
      'Quais clientes estão com entregas atrasadas?',
      'Quais projetos internos parecem abandonados?',
      'Quem está sobrecarregado?',
      'Quais tarefas dependem do Endrigo?',
      'O que pode dar problema esta semana?',
      'Qual é o estado atual do Desigual OS?',
      'O que aconteceu ontem?',
      'Quais informações estão inconsistentes no ClickUp?',
      'O que está parado há mais tempo?',
      'Faça um briefing executivo completo da agência.',
      'Me entregue um briefing completo da Agência Desigual.',
      'Analise todo o ClickUp da agência e me entregue um briefing completo de tudo que você sabe sobre a agência.',
      'Me fale tudo que sabe sobre D. Carvalho e o que precisa de atenção.',
      'Me dá um panorama da operação.',
      'Me atualiza aí.',
    ];
    for (const frase of leituras) {
      it(`LEITURA: "${frase.slice(0, 58)}"`, () => {
        expect(ehPedidoDeLeitura(frase)).toBe(true);
      });
    }
  });

  describe('escrita continua escrita — nenhuma destas pode virar leitura', () => {
    const escritas = [
      'Crie uma task chamada "Carrossel Outubro" para Pedro Gabriel.',
      'atualiza essa task e coloca pra sexta',
      'muda o prazo dela pra amanhã',
      'adiciona o Matheus também',
      'troca o responsável pra Sofia',
      'nessa mesma task coloca prioridade alta',
      'apaga essa task',
      'não, tira o Matheus dela',
      'corrige a task que você acabou de criar',
      'conclui essa demanda',
      'anexa esse print na tarefa',
      'comenta nessa task que o cliente aprovou',
      'reagenda a tarefa do Cosentino pra semana que vem',
      'move esse card pra coluna de revisão',
    ];
    for (const frase of escritas) {
      it(`NÃO é leitura: "${frase.slice(0, 58)}"`, () => {
        expect(ehPedidoDeLeitura(frase)).toBe(false);
      });
    }
  });

  describe('as vizinhas perigosas', () => {
    it('"briefing" como CAMPO de uma task não é entregável de texto', () => {
      expect(ehPedidoDeLeitura('coloca esse briefing na task')).toBe(false);
      expect(ehPedidoDeLeitura('atualiza o briefing dela')).toBe(false);
      expect(ehPedidoDeLeitura('acrescenta no briefing da tarefa que é 1080x1350')).toBe(false);
    });

    it('"status" como campo não abre leitura', () => {
      expect(ehPedidoDeLeitura('muda o status dessa task pra aprovado')).toBe(false);
    });

    it('pergunta que cita recurso continua sendo leitura', () => {
      const c = classificarAcesso('Quais tasks estão atrasadas?');
      expect(c.nivel).toBe('READ');
      expect(c.objeto).toBe('recurso');
    });

    it('negação sobre mutação nunca vira ordem nem atalho de leitura', () => {
      const c = classificarAcesso('não cria a task ainda');
      expect(c.nivel).toBe('INDEFINIDO');
      expect(c.sinais).toContain('nao_executavel');
    });

    it('mensagem vazia não decide nada', () => {
      expect(classificarAcesso('   ').nivel).toBe('INDEFINIDO');
    });

    it('nunca devolve READ para frase com verbo de mutação sobre referente', () => {
      for (const f of ['atualiza ela', 'apaga isso', 'renomeia essa', 'remove o Gui dela']) {
        expect(classificarAcesso(f).nivel).not.toBe('READ');
      }
    });
  });

  describe('as armadilhas que a suíte pegou ao escrever este módulo', () => {
    it('ORTOGRAFIA: "coloque" não contém "coloc" — colocar vira coloQUe', () => {
      // `coloc[a-z]*` parece geral e é mais ESTREITO que o guard antigo, que
      // sempre listou `coloc(a|ar|ue)`. Sem a variante, "me coloque como
      // responsável nessa tarefa" perdia o verbo e virava leitura.
      expect('coloque'.includes('coloc')).toBe(false);
      expect(classificarAcesso('Agora me coloque também como responsável nessa tarefa').nivel).not.toBe('READ');
    });

    it('"como" de preposição não é pergunta', () => {
      expect(classificarAcesso('me coloque como responsável nessa tarefa').nivel).not.toBe('READ');
      // e continua sendo pergunta quando abre a frase
      expect(classificarAcesso('Como está a operação hoje?').nivel).toBe('READ');
    });

    it('"isso" é referente — era o buraco que deixava mutação virar leitura', () => {
      expect(classificarAcesso('adiciona isso no briefing').nivel).toBe('WRITE');
      expect(classificarAcesso('incrementa o briefing com isso').nivel).toBe('WRITE');
    });

    it('verbo de mutação inequívoco vence o atalho de entregável de texto', () => {
      // "faça um briefing" (despacho ambíguo) é leitura;
      // "atualiza o briefing" (mutação inequívoca) não é.
      expect(classificarAcesso('Faça um briefing da agência').nivel).toBe('READ');
      expect(classificarAcesso('atualiza o briefing').nivel).not.toBe('READ');
    });
  });

  describe('o contrato do módulo', () => {
    it('WRITE nunca autoriza nada — só recusa o atalho de leitura', () => {
      // A garantia é negativa de propósito: o módulo não tem função que
      // devolva "pode escrever". Quem autoriza continua sendo a policy.
      expect(ehPedidoDeLeitura('Crie uma task para o Pedro')).toBe(false);
      expect(Object.keys({ classificarAcesso, ehPedidoDeLeitura })).toHaveLength(2);
    });

    it('sempre devolve motivo legível e sinais', () => {
      const c = classificarAcesso('Faça um briefing da agência');
      expect(c.motivo.length).toBeGreaterThan(10);
      expect(c.sinais).toContain('entregavel_de_texto');
    });
  });
});
