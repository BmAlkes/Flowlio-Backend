# LGPD — operação e registros

Documento interno da Flowlio para cumprir a LGPD (Lei 13.709/2018). Mantenha-o atualizado quando
surgir um novo fornecedor, um novo tipo de dado ou uma nova funcionalidade que trate dados pessoais.

## 1. Registro das operações de tratamento (art. 37)

| Operação | Titulares | Dados | Base legal | Papel da Flowlio | Retenção |
|---|---|---|---|---|---|
| Conta e assinatura | Usuários, donos de organização | Nome, e-mail, senha (hash), telefone, endereço, cobrança | Contrato (art. 7º, V) | Controladora | Enquanto ativa; 90 dias após encerramento |
| Registros de acesso | Usuários | IP, data/hora, user agent (`session`) | Obrigação legal — Marco Civil art. 15 | Controladora | 6 meses |
| Cobrança e fiscal | Donos de organização | Dados de faturamento, transações PayPal | Obrigação legal (art. 7º, II) | Controladora | 5 anos |
| CRM, leads, propostas, faturas | Clientes e leads das organizações | Nome, e-mail, telefone, CPF/CNPJ, endereço, notas | Definida pela organização | Operadora | Definida pela organização |
| Webhook de leads | Leads das organizações | Payload bruto (`lead_webhook_logs`) | Definida pela organização | Operadora | 90 dias |
| Assistente de IA (Lio) | Usuários; dados citados nas perguntas | Perguntas, respostas, anexos | Contrato | Controladora / operadora | Conversas 180 dias; anexos 24 h |
| WhatsApp (Lio) | Usuários | Telefone, mensagens | Contrato | Controladora | Enquanto vinculado |
| Google Agenda | Usuários e participantes de eventos | Eventos, tokens OAuth (criptografados) | Consentimento | Controladora | Até desconectar |
| Notificações | Usuários | Título, mensagem | Contrato | Controladora | 12 meses |
| Auditoria | Usuários | Ação, IP, user agent | Legítimo interesse (segurança) | Controladora | IP/UA anonimizados após 12 meses |
| Newsletter | Assinantes | E-mail | Consentimento | Controladora | Até o descadastro (e-mail mantido como lista de supressão) |
| Cookies de marketing | Visitantes | Eventos de navegação (Meta Pixel) | Consentimento | Controladora | Definido pela Meta |
| Backups por organização | Todos os dados da organização | Cópia completa (`organization_backups`) | Legítimo interesse (continuidade e segurança) | Controladora / operadora | 7 dias (diários); 30 dias (manuais) |
| Pedidos de titulares | Solicitantes | Tipo, data, status (`privacy_requests`) | Obrigação legal / exercício de direitos | Controladora | 5 anos |

A limpeza automática roda a cada hora no worker (`src/modules/privacy/service.ts`, `RETENTION`).
Se um prazo mudar, altere o código **e** a Política de Privacidade (`Flowlio-Frontend/src/data/legal`).

## 2. Suboperadores

A maioria dos fornecedores inclui o acordo de tratamento de dados (DPA) nos próprios termos: ao aceitar
os termos, o DPA já vale. Alguns oferecem uma versão assinável. Guarde a data e a versão de cada um.

| Fornecedor | Papel | Como o DPA vale | Ação |
|---|---|---|---|
| OpenAI | Operador (IA) | Os Business Terms pedem que quem trata dados pessoais execute o DPA pelo formulário — [DPA](https://openai.com/policies/data-processing-addendum/) | **Assinar o formulário** (gratuito) |
| Railway | Operador (hospedagem) | DPA padrão, assinável pela página de compliance — [DPA](https://railway.com/legal/dpa) | **Assinar** pelo link "Sign Railway's DPA" |
| Sentry | Operador (erros) | Aceito em Settings > Legal & Compliance pelo Owner da conta — [DPA](https://sentry.io/legal/dpa/) | **Aceitar** no painel |
| Brevo | Operador (e-mail) | Anexo dos Termos de Uso (aceito ao usar) — [onde fica](https://help.brevo.com/hc/en-us/articles/15403782599570) | Só registrar |
| Cloudinary | Operador (arquivos) | Incorporado aos termos — [DPA](https://cloudinary.com/gdpr/dpa) | Só registrar |
| Meta / WhatsApp Cloud API | Operador (Meta atua como processor) | WhatsApp Business Data Processing Terms, aceitos com os termos da plataforma — [termos](https://www.whatsapp.com/legal/business-data-processing-terms) | Só registrar |
| Meta Pixel | Controlador próprio (com consentimento) | Business Tools Terms | Só registrar |
| PayPal | Controlador próprio (pagamento) | Termos do PayPal | Só registrar |
| Google Agenda | Não é operador da Flowlio: é a conta Google do próprio usuário | [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) | A Política já tem a declaração de Limited Use. Confirmar que o app OAuth está verificado (escopo de agenda é sensível) e que a URL da Política está na tela de consentimento |

Um novo fornecedor só entra depois de ser incluído na Política de Privacidade.

## 2.1 Exportação da organização

O dono da organização baixa tudo em Configurações > Privacidade e dados > Exportar dados da organização
(`GET /api/organizations/export`, formato `flowlio-organization-export/1`). O arquivo lista as tabelas
lidas a partir das chaves estrangeiras do banco, sem senhas, tokens e segredos. Serve para portabilidade,
para cópia de segurança antes de encerrar a conta e como base de uma futura restauração por organização.

## 2.2 Backups, restauração e exclusão de organizações

- **Backup diário por organização** (worker, tabela `organization_backups`, gzip JSON completo): guarda os
  7 últimos diários; manuais e "antes de restaurar" ficam 30 dias. São apagados junto com a organização.
- **Restaurar** (Configurações do Super Admin > Backups por organização): sempre simula primeiro; ao confirmar,
  salva o estado atual como backup e restaura só aquela organização. Não restaura equipe/acessos, cobrança,
  uso de IA nem histórico de auditoria. Os gatilhos de proteção ficam desligados só dentro da transação.
- **Exclusão de organizações inativas** (assinatura `cancelled`/`expired` ou teste vencido): o worker marca
  `inactive_since`; com `ORG_AUTO_DELETE_ENABLED=true` avisa os donos por e-mail no dia 75 e exclui no dia 90
  (mínimo de 14 dias após o aviso). Pessoas que só pertenciam àquela organização são anonimizadas e os arquivos
  no Cloudinary com `public_id` são removidos. Sem a variável, nada é excluído; as datas só aparecem no painel.
- **Importação de planilhas** (Configurações > Importar dados): leads, clientes ou projetos e tarefas do
  Monday/Trello/Asana/Excel/CSV, até 2000 linhas, com os mesmos limites de plano da criação manual.

## 3. Pedidos de titulares (art. 18 e 19) — prazo: 15 dias

- **Exportação**: o próprio usuário baixa em Configurações > Privacidade e dados (`GET /api/user/privacy/export`).
- **Exclusão de membro, gestor ou cliente do portal**: automática (`POST /api/user/privacy/delete-account`).
  A conta é anonimizada; tarefas e projetos da organização permanecem sem o nome da pessoa.
- **Exclusão de dono de organização**: vira pedido pendente e gera e-mail para `PRIVACY_CONTACT_EMAIL`.
  1. Confirmar a identidade, se houver dúvida.
  2. Excluir a organização em Super Admin > Empresas.
  3. Concluir o pedido em Configurações do Super Admin > Pedidos LGPD (anonimiza a conta do dono).
- **Pedidos por e-mail** (correção, oposição, revisão de decisão automatizada, informação): responder pelo
  canal do Encarregado em até 15 dias e registrar a resposta.
- **Cliente ou lead de uma organização**: encaminhar à organização (controladora) e ajudá-la a atender.

## 4. Resposta a incidentes (art. 48 e Resolução CD/ANPD nº 15/2024)

1. **Conter** (imediato): revogar credenciais expostas, bloquear o acesso indevido, preservar logs.
2. **Avaliar** (até 24 h): que dados, quantos titulares, quais organizações, se há risco ou dano relevante
   (dados sensíveis, financeiros, de autenticação, em larga escala, de crianças).
3. **Comunicar** em até **3 dias úteis** a partir do conhecimento, se houver risco relevante:
   - ANPD, pelo formulário oficial em gov.br/anpd;
   - titulares afetados, em linguagem clara;
   - organizações afetadas (como operadora, a Flowlio avisa a controladora sem demora).
4. **Registrar** todo incidente, mesmo sem comunicação, e guardar o registro por 5 anos.
5. **Corrigir** a causa e revisar este documento.

## 5. Variáveis de ambiente

- `PRIVACY_CONTACT_EMAIL`: caixa que recebe os pedidos de exclusão de donos de organização.
- `ORG_AUTO_DELETE_ENABLED=true`: liga a exclusão automática de organizações inativas (aviso no dia 75, exclusão no dia 90).
- `TOKEN_ENCRYPTION_KEY` (opcional, ≥ 32 caracteres): chave dos tokens OAuth. Sem ela, usa `BETTER_AUTH_SECRET`.
  Trocar a chave obriga os usuários a reconectar o Google Agenda.
