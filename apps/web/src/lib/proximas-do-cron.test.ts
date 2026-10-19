import { describe, expect, it } from 'vitest';
import { lerCron, proximasDoCron } from './proximas-do-cron';

/**
 * Esta conta aparece embaixo do seletor de agendamento, enquanto a pessoa
 * decide. Se ela errar, a pessoa salva uma automação achando que vai rodar às
 * 8h e ela roda às 20h — e vai descobrir no dia seguinte, quando o briefing
 * não chegou.
 */
const sexta9h30 = new Date(2026, 9, 9, 9, 30, 0, 0); // 09/10/2026, uma sexta

function comoTexto(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

describe('proximasDoCron', () => {
  it('todo dia às 08:00 começa amanhã quando já passou das 8', () => {
    const r = proximasDoCron('0 8 * * *', sexta9h30, 3).map(comoTexto);
    expect(r).toEqual(['10/10 08:00', '11/10 08:00', '12/10 08:00']);
  });

  it('todo dia às 18:00 começa hoje quando ainda não passou', () => {
    const [primeira] = proximasDoCron('0 18 * * *', sexta9h30, 1).map(comoTexto);
    expect(primeira).toBe('09/10 18:00');
  });

  it('a cada hora cai no próximo minuto cheio, não daqui a uma hora', () => {
    const r = proximasDoCron('0 * * * *', sexta9h30, 2).map(comoTexto);
    expect(r).toEqual(['09/10 10:00', '09/10 11:00']);
  });

  it('a hora corrente não é repetida: o começo é exclusivo', () => {
    // Exatamente 10:00; a próxima ocorrência horária é 11:00, não 10:00.
    const emPonto = new Date(2026, 9, 9, 10, 0, 0, 0);
    expect(proximasDoCron('0 * * * *', emPonto, 1).map(comoTexto)).toEqual(['09/10 11:00']);
  });

  it('passo entende */15', () => {
    const r = proximasDoCron('*/15 * * * *', sexta9h30, 3).map(comoTexto);
    expect(r).toEqual(['09/10 09:45', '09/10 10:00', '09/10 10:15']);
  });

  it('lista entende 0,30', () => {
    const r = proximasDoCron('0,30 * * * *', sexta9h30, 2).map(comoTexto);
    expect(r).toEqual(['09/10 10:00', '09/10 10:30']);
  });

  it('dia da semana: segunda às 8 pula o fim de semana', () => {
    const [primeira] = proximasDoCron('0 8 * * 1', sexta9h30, 1).map(comoTexto);
    expect(primeira).toBe('12/10 08:00'); // segunda-feira
  });

  it('domingo vale tanto como 0 quanto como 7', () => {
    const porZero = proximasDoCron('0 8 * * 0', sexta9h30, 1).map(comoTexto);
    const porSete = proximasDoCron('0 8 * * 7', sexta9h30, 1).map(comoTexto);
    expect(porZero).toEqual(['11/10 08:00']);
    expect(porSete).toEqual(porZero);
  });

  /**
   * A regra que quase toda implementação ingênua erra. Com dia-do-mês E
   * dia-da-semana restringidos, o cron casa quando QUALQUER UM bate, não os
   * dois: "0 8 1 * 1" é dia 1 do mês OU toda segunda.
   */
  it('dia-do-mês e dia-da-semana juntos são OU, não E', () => {
    const r = proximasDoCron('0 8 1 * 1', sexta9h30, 3).map(comoTexto);
    expect(r).toEqual(['12/10 08:00', '19/10 08:00', '26/10 08:00']);
    // E o dia 1 do mês seguinte entra mesmo não sendo segunda.
    const noFim = proximasDoCron('0 8 1 * 1', new Date(2026, 9, 28, 9, 0, 0, 0), 2).map(comoTexto);
    expect(noFim).toContain('01/11 08:00');
  });

  it('padrão ilegível não inventa data nenhuma', () => {
    expect(proximasDoCron('todo dia de manhã', sexta9h30)).toEqual([]);
    expect(proximasDoCron('0 8 * *', sexta9h30)).toEqual([]);
    expect(proximasDoCron('99 8 * * *', sexta9h30)).toEqual([]);
    expect(proximasDoCron('', sexta9h30)).toEqual([]);
  });

  /**
   * "A cada 29 de fevereiro" é padrão válido e raro. Devolver lista vazia é
   * melhor que escolher uma data: a tela diz que não sabe, em vez de dizer
   * errado.
   */
  it('padrão que não acontece no próximo ano devolve vazio em vez de chutar', () => {
    expect(proximasDoCron('0 8 30 2 *', sexta9h30, 1)).toEqual([]);
  });
});

describe('lerCron', () => {
  it('reconhece os presets do produto', () => {
    expect(lerCron('0 8 * * *')?.horas).toEqual([8]);
    expect(lerCron('0 * * * *')?.minutos).toEqual([0]);
  });

  it('marca quando os dois campos de dia foram restringidos', () => {
    expect(lerCron('0 8 * * *')?.diaRestritoPorDois).toBe(false);
    expect(lerCron('0 8 1 * 1')?.diaRestritoPorDois).toBe(true);
  });

  it('recusa campo fora de faixa em vez de normalizar em silêncio', () => {
    expect(lerCron('0 25 * * *')).toBeNull();
    expect(lerCron('0 8 32 * *')).toBeNull();
  });
});
