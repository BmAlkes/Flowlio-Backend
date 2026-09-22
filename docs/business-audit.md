# T26A — Fundação de auditoria de negócio

Retomada em 22/09/2026. Branch `feat/t26a-business-audit` em FE/BE; frontend altera somente documentação. A consulta visual e a exportação pertencem à T26B.

## Catálogo inicial

| Recurso | Operações registradas | Campos |
| --- | --- | --- |
| Projeto | Alteração | Orçamento, início, prazo, status, visibilidade e responsável |
| Revisão de entrega | Solicitação e alteração | Estado, versão de origem, marco e cliente |
| Vínculo com organização | Criação, alteração e remoção | Papel, status e cinco permissões booleanas conhecidas |
| Membro da organização | Alteração | Papel do membro |

Cada evento inclui organização, recurso, ator, ação, horário UTC, referência da operação e diferenças antes/depois. A lista é explícita: não representa auditoria universal de todos os módulos. T28/T29 acrescentarão seus eventos quando existirem.

## Garantias e limites

- Gatilhos PostgreSQL gravam a alteração e a auditoria na mesma transação. Falha na auditoria desfaz a mudança; rollback não deixa evento concluído.
- Atualizações sem diferença nos campos do catálogo não geram evento. Reenvios idênticos não multiplicam o histórico; uma nova mudança real, inclusive uma reversão posterior, é outro evento legítimo.
- Contexto humano conectado à edição de projeto, promoção/rebaixamento de gestor e solicitação/decisão de entrega. Recálculo automático de status usa ator de sistema e referência ao job, quando disponível.
- Outros escritores e versões antigas continuam compatíveis: produzem eventos com ator explicitamente desconhecido. Não atribuímos essas ações ao autor do recurso nem presumimos que foram automáticas.
- Contexto restrito à transação e à organização. Histórico sem endpoint público nesta etapa; orçamento permanece restrito. A T26B deverá aplicar autorização e ocultação de dados financeiros antes de expor resultados.
- Promoção/rebaixamento passa a atualizar as três representações de papel na mesma transação.
- A tabela não aceita UPDATE/DELETE comuns. Sem FK para recursos/atores: exclusões não apagam o histórico. Isso não oferece proteção contra administradores do banco nem assinatura criptográfica.
- Retenção inicial sem expiração automática. Expurgo ou anonimização exigem operação administrativa específica e revisada; não há endpoint de limpeza. Não registrar senhas, tokens, documentos, comentários, notas, e-mails ou nomes completos.
- Sem preenchimento retroativo. O registro começa após a migração `0012_business_audit`.

## Publicação e verificação

Migração aditiva gerada com snapshot e journal. O startup verifica os gatilhos obrigatórios; versões antigas podem continuar escrevendo, mas sem atribuição de ator. Recuperação preferencial por correção adiante, preservando a tabela e o histórico de migrações. Não excluir a migração aplicada nem os gatilhos para reverter código.

Lint e build aprovados. Os 14 testes PostgreSQL específicos da T26A passaram, sem casos ignorados; cobrem controladores reais, rollback, concorrência, isolamento, atribuição, campos excluídos e proteção do histórico. Suíte geral e publicação em andamento. Usar exclusivamente o banco local dedicado `flowlio_audit_test` para os testes destrutivos; a suíte de CI configura esse banco junto dos demais testes isolados. Nenhuma operação em dados de produção é necessária para testar a etapa.

Onde conferir: ainda não há nova tela. A T26B disponibilizará consulta autorizada em Configurações → Auditoria e no projeto. Próxima etapa na sequência aprovada: T27A, central de atenção.

