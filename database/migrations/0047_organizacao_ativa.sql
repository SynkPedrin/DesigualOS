-- 0047_organizacao_ativa.sql — em qual empresa a pessoa está trabalhando agora.
--
-- POR QUE NO BANCO E NÃO NA URL, que é a decisão inteira desta migração:
--
-- O provedor precisa poder entrar numa empresa e sair dela. A forma mais fácil
-- seria `?org=<id>` na URL, e é justamente a que não pode ser usada: virar
-- tenant por query string faz da barra de endereço uma superfície de
-- autorização. Qualquer pessoa trocaria o id e o servidor teria que confiar no
-- que o navegador mandou — que é exatamente o bypass que a fronteira construída
-- na 0045 e depois existe para impedir.
--
-- Aqui a organização ativa é ESTADO DO USUÁRIO, escrito pelo servidor depois de
-- validar que ele é membro. A URL pode refletir a empresa para a pessoa se
-- situar; a AUTORIZAÇÃO nunca sai daqui.
--
-- E por ser persistida, sobrevive a recarregar a página e a trocar de aba — que
-- é o comportamento que alguém espera de "entrei na Cosentino".
--
-- ADITIVA: nullable, sem default. `null` significa "estou no contexto do
-- provedor", que é o estado de quem só pertence a uma organização — a esmagadora
-- maioria, hoje todo mundo.
--
-- `set null` no vínculo, e é deliberado: se a organização for apagada, a pessoa
-- volta ao contexto do provedor em vez de ficar presa apontando para uma empresa
-- que não existe mais.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS organizacao_ativa_id uuid
    REFERENCES organizations(id) ON DELETE SET NULL;

-- Diagnóstico, não alteração. Depois de aplicar, o esperado é todo mundo com
-- `null` — ninguém "entrou" em empresa nenhuma ainda:
--
--   select count(*) filter (where organizacao_ativa_id is null) as no_provedor,
--          count(*) filter (where organizacao_ativa_id is not null) as dentro_de_empresa
--   from users;
