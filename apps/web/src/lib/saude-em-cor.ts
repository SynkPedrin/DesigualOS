/**
 * A RÉGUA DA SAÚDE, num arquivo só dela.
 *
 * Quem lê um número colorido no rodapé de todas as telas precisa poder saber o
 * que o verde significa — e, pra isso, a regra precisa ser conferível sem subir
 * a aplicação. Dentro do componente ela não era: importar a barra lateral
 * arrasta o cliente do Supabase, que exige variável de ambiente, e o teste
 * morria antes de chegar na primeira asserção.
 *
 * Os cortes: 90% ou mais é tudo respondendo com folga; de 60 a 89 é degradação
 * que ainda deixa trabalhar; abaixo de 60 é parte da operação fora do ar. Sem
 * leitura nenhuma, cinza — porque não saber não é estar bem.
 */
export function saudeEmCor(percentual: number | null): string {
  if (percentual === null) return 'text-nevoa';
  if (percentual >= 90) return 'text-sucesso';
  if (percentual >= 60) return 'text-aviso';
  return 'text-erro';
}
